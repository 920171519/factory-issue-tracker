import { getDb } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { newId } from "@/lib/ids";
import { nowIso } from "@/lib/time";
import {
  ensureProjectMembership,
  getProjectPmIds,
  requireProjectAccess,
  requireProjectManager,
  type ProjectAccess,
} from "@/lib/access";
import { getPendingCounts, getCoordinationCounts } from "@/lib/schedule";
import { getProjectIssueCount, getMyPendingInProject } from "@/lib/issues";
import { pendingDeletionCount } from "@/lib/deletion";
import { syncGroupHandoffKey } from "@/lib/schedule";

export const DEFAULT_STATUSES = [
  { name: "定位中", color: "#2563eb", countsPending: 1, requiresReason: 0, isIdentified: 0, isDefault: 1 },
  { name: "已定位", color: "#16a34a", countsPending: 0, requiresReason: 1, isIdentified: 1, isDefault: 0 },
  { name: "非问题", color: "#64748b", countsPending: 0, requiresReason: 1, isIdentified: 0, isDefault: 0 },
  { name: "挂起", color: "#d97706", countsPending: 0, requiresReason: 1, isIdentified: 0, isDefault: 0 },
  { name: "待维修", color: "#7c3aed", countsPending: 1, requiresReason: 0, isIdentified: 1, isDefault: 0 },
  { name: "维修中", color: "#9333ea", countsPending: 1, requiresReason: 0, isIdentified: 1, isDefault: 0 },
  { name: "维修完成", color: "#0d9488", countsPending: 1, requiresReason: 0, isIdentified: 1, isDefault: 0 },
  { name: "等待复测", color: "#0891b2", countsPending: 1, requiresReason: 0, isIdentified: 1, isDefault: 0 },
  { name: "复测中", color: "#0284c7", countsPending: 1, requiresReason: 0, isIdentified: 1, isDefault: 0 },
  { name: "隔离中", color: "#b91c1c", countsPending: 1, requiresReason: 0, isIdentified: 0, isDefault: 0 },
];

export const DEFAULT_TIME_SLOTS = [
  { name: "白班", startMinute: 8 * 60, endMinute: 20 * 60 },
  { name: "夜班", startMinute: 20 * 60, endMinute: 8 * 60 },
];

export interface ProjectSummary {
  id: string;
  name: string;
  code: string | null;
  description: string | null;
  issueCount: number;
  memberCount: number;
  groupCount: number;
  myPending: number;
  pendingApprovals: number;
  isPm: boolean;
  isSupervisor: boolean;
  updatedAt: string;
}

export interface ProjectMemberView {
  userId: string;
  name: string;
  employeeNo: string;
  isPm: boolean;
  isSupervisor: boolean;
  joinedAt: string;
  groups: { id: string; name: string; isLeader: boolean }[];
  pending: number;
  coordination: number;
}

export function createProject(
  userId: string,
  input: { name: string; code?: string; description?: string },
): { id: string } {
  const name = input.name.trim();
  if (!name) throw new AppError(400, "请输入项目名称");
  if (name.length > 80) throw new AppError(400, "项目名称不能超过 80 个字符");
  const code = input.code?.trim() || null;
  if (code && code.length > 40) throw new AppError(400, "项目编码不能超过 40 个字符");
  const description = input.description?.trim() || null;
  if (description && description.length > 500) throw new AppError(400, "项目简介不能超过 500 个字符");
  const db = getDb();
  const now = nowIso();
  const projectId = newId("prj");
  db.transaction(() => {
    db.prepare(
      "INSERT INTO projects (id, name, code, description, notify_self_on_status, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?, ?)",
    ).run(projectId, name, code, description, userId, now, now);
    db.prepare(
      "INSERT INTO project_members (project_id, user_id, is_pm, is_supervisor, joined_at) VALUES (?, ?, 1, 0, ?)",
    ).run(projectId, userId, now);
    const statusInsert = db.prepare(
      `INSERT INTO statuses
        (id, project_id, name, color, counts_pending, requires_reason, is_identified, is_default, sort_order, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    DEFAULT_STATUSES.forEach((status, index) => {
      statusInsert.run(
        newId("sts"),
        projectId,
        status.name,
        status.color,
        status.countsPending,
        status.requiresReason,
        status.isIdentified,
        status.isDefault,
        index,
        now,
      );
    });
    const slotInsert = db.prepare(
      "INSERT INTO time_slots (id, project_id, name, start_minute, end_minute, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    );
    DEFAULT_TIME_SLOTS.forEach((slot, index) => {
      slotInsert.run(newId("tsl"), projectId, slot.name, slot.startMinute, slot.endMinute, index, now);
    });
  })();
  return { id: projectId };
}

export function listProjectsForUser(userId: string): ProjectSummary[] {
  const db = getDb();
  const memberships = db
    .prepare(
      `SELECT p.*, pm.is_pm, pm.is_supervisor
       FROM project_members pm JOIN projects p ON p.id = pm.project_id
       WHERE pm.user_id = ? ORDER BY p.updated_at DESC, p.name`,
    )
    .all(userId) as (Record<string, unknown> & {
    id: string;
    name: string;
    code: string | null;
    description: string | null;
    updated_at: string;
    is_pm: number;
    is_supervisor: number;
  })[];
  return memberships.map((project) => {
    const issueCount = (db.prepare("SELECT COUNT(*) AS count FROM issues WHERE project_id = ?").get(project.id) as { count: number }).count;
    const memberCount = (db.prepare("SELECT COUNT(*) AS count FROM project_members WHERE project_id = ?").get(project.id) as { count: number }).count;
    const groupCount = (db.prepare("SELECT COUNT(*) AS count FROM groups WHERE project_id = ?").get(project.id) as { count: number }).count;
    return {
      id: project.id,
      name: project.name,
      code: project.code,
      description: project.description,
      issueCount,
      memberCount,
      groupCount,
      myPending: getMyPendingInProject(userId, project.id),
      pendingApprovals: pendingDeletionCount(project.id),
      isPm: project.is_pm === 1,
      isSupervisor: project.is_supervisor === 1,
      updatedAt: project.updated_at,
    };
  });
}

export function updateProject(
  projectId: string,
  userId: string,
  input: { name?: string; code?: string | null; description?: string | null; notifySelfOnStatus?: boolean },
): void {
  requireProjectManager(userId, projectId);
  const db = getDb();
  const current = db.prepare("SELECT * FROM projects WHERE id = ?").get(projectId) as
    | { name: string; code: string | null; description: string | null; notify_self_on_status: number }
    | undefined;
  if (!current) throw new AppError(404, "项目不存在");
  const name = input.name === undefined ? current.name : input.name.trim();
  if (!name) throw new AppError(400, "项目名称不能为空");
  if (name.length > 80) throw new AppError(400, "项目名称不能超过 80 个字符");
  const code = input.code === undefined ? current.code : input.code?.trim() || null;
  const description = input.description === undefined ? current.description : input.description?.trim() || null;
  if (description && description.length > 500) throw new AppError(400, "项目简介不能超过 500 个字符");
  const notify = input.notifySelfOnStatus === undefined ? current.notify_self_on_status : input.notifySelfOnStatus ? 1 : 0;
  db.prepare(
    "UPDATE projects SET name = ?, code = ?, description = ?, notify_self_on_status = ?, updated_at = ? WHERE id = ?",
  ).run(name, code, description, notify, nowIso(), projectId);
}

export function listProjectMembers(projectId: string): ProjectMemberView[] {
  const db = getDb();
  const members = db
    .prepare(
      `SELECT u.id, u.name, u.employee_no, pm.is_pm, pm.is_supervisor, pm.joined_at
       FROM project_members pm JOIN users u ON u.id = pm.user_id
       WHERE pm.project_id = ? ORDER BY pm.is_pm DESC, pm.is_supervisor DESC, u.name`,
    )
    .all(projectId) as {
    id: string;
    name: string;
    employee_no: string;
    is_pm: number;
    is_supervisor: number;
    joined_at: string;
  }[];
  const groups = db
    .prepare(
      `SELECT gm.user_id, g.id, g.name, gm.is_leader
       FROM group_members gm JOIN groups g ON g.id = gm.group_id
       WHERE g.project_id = ? ORDER BY g.name`,
    )
    .all(projectId) as { user_id: string; id: string; name: string; is_leader: number }[];
  const ids = members.map((member) => member.id);
  const pending = getPendingCounts(ids, projectId);
  const coordination = getCoordinationCounts(ids, projectId);
  return members.map((member) => ({
    userId: member.id,
    name: member.name,
    employeeNo: member.employee_no,
    isPm: member.is_pm === 1,
    isSupervisor: member.is_supervisor === 1,
    joinedAt: member.joined_at,
    groups: groups
      .filter((group) => group.user_id === member.id)
      .map((group) => ({ id: group.id, name: group.name, isLeader: group.is_leader === 1 })),
    pending: pending.get(member.id) || 0,
    coordination: coordination.get(member.id) || 0,
  }));
}

export function addProjectMember(
  projectId: string,
  operatorId: string,
  input: { employeeNo?: string; userId?: string; isPm?: boolean; isSupervisor?: boolean },
): { userId: string } {
  requireProjectManager(operatorId, projectId);
  const db = getDb();
  const user = input.userId
    ? (db.prepare("SELECT id, name FROM users WHERE id = ?").get(input.userId) as { id: string; name: string } | undefined)
    : input.employeeNo
      ? (db.prepare("SELECT id, name FROM users WHERE employee_no = ?").get(input.employeeNo.trim()) as
          | { id: string; name: string }
          | undefined)
      : undefined;
  if (!user) throw new AppError(404, "未找到该用户，请确认工号");
  const exists = db.prepare("SELECT 1 FROM project_members WHERE project_id = ? AND user_id = ?").get(projectId, user.id);
  if (exists) throw new AppError(409, "该用户已是项目成员");
  db.prepare(
    "INSERT INTO project_members (project_id, user_id, is_pm, is_supervisor, joined_at) VALUES (?, ?, ?, ?, ?)",
  ).run(projectId, user.id, input.isPm ? 1 : 0, input.isSupervisor ? 1 : 0, nowIso());
  return { userId: user.id };
}

export function updateProjectMemberRoles(
  projectId: string,
  operatorId: string,
  targetUserId: string,
  input: { isPm: boolean; isSupervisor: boolean },
): void {
  requireProjectManager(operatorId, projectId);
  const db = getDb();
  const member = db
    .prepare("SELECT is_pm, is_supervisor FROM project_members WHERE project_id = ? AND user_id = ?")
    .get(projectId, targetUserId) as { is_pm: number; is_supervisor: number } | undefined;
  if (!member) throw new AppError(404, "项目成员不存在");
  if (!input.isPm && member.is_pm === 1) {
    const pmCount = (db.prepare("SELECT COUNT(*) AS count FROM project_members WHERE project_id = ? AND is_pm = 1").get(projectId) as { count: number }).count;
    if (pmCount <= 1) throw new AppError(409, "项目至少需要保留一名 PM");
  }
  db.prepare("UPDATE project_members SET is_pm = ?, is_supervisor = ? WHERE project_id = ? AND user_id = ?").run(
    input.isPm ? 1 : 0,
    input.isSupervisor ? 1 : 0,
    projectId,
    targetUserId,
  );
}

export function removeProjectMember(projectId: string, operatorId: string, targetUserId: string): void {
  requireProjectManager(operatorId, projectId);
  const db = getDb();
  const member = db
    .prepare("SELECT is_pm FROM project_members WHERE project_id = ? AND user_id = ?")
    .get(projectId, targetUserId) as { is_pm: number } | undefined;
  if (!member) throw new AppError(404, "项目成员不存在");
  if (member.is_pm === 1) {
    const pmCount = (db.prepare("SELECT COUNT(*) AS count FROM project_members WHERE project_id = ? AND is_pm = 1").get(projectId) as { count: number }).count;
    if (pmCount <= 1) throw new AppError(409, "不能移除项目唯一 PM");
  }
  const groupCount = (db
    .prepare(
      `SELECT COUNT(*) AS count FROM group_members gm JOIN groups g ON g.id = gm.group_id
       WHERE g.project_id = ? AND gm.user_id = ?`,
    )
    .get(projectId, targetUserId) as { count: number }).count;
  if (groupCount > 0) throw new AppError(409, "该成员仍属于项目责任组，请先在责任组中移除后再移出项目");
  const assignment = db
    .prepare(
      `SELECT COUNT(*) AS count FROM issue_group_handlers h
       JOIN issue_groups ig ON ig.id = h.issue_group_id
       JOIN issues i ON i.id = ig.issue_id
       WHERE i.project_id = ? AND h.user_id = ?`,
    )
    .get(projectId, targetUserId) as { count: number };
  if (assignment.count > 0) throw new AppError(409, "该成员仍是问题当前处理人，请先完成转交后再移出项目");
  db.prepare("DELETE FROM project_members WHERE project_id = ? AND user_id = ?").run(projectId, targetUserId);
}

export function ensureGroupMemberProject(projectId: string, userId: string): void {
  ensureProjectMembership(projectId, userId);
}

export function getProjectHomeSummary(userId: string, projectId: string, access: ProjectAccess): {
  issueCount: number;
  memberCount: number;
  groupCount: number;
  myPending: number;
  pendingApprovals: number;
  myCoordination: number;
  pmIds: string[];
} {
  const db = getDb();
  const memberCount = (db.prepare("SELECT COUNT(*) AS count FROM project_members WHERE project_id = ?").get(projectId) as { count: number }).count;
  const groupCount = (db.prepare("SELECT COUNT(*) AS count FROM groups WHERE project_id = ?").get(projectId) as { count: number }).count;
  const pending = getPendingCounts([userId]).get(userId) || 0;
  const coordination = getCoordinationCounts([userId]).get(userId) || 0;
  void access;
  return {
    issueCount: getProjectIssueCount(projectId),
    memberCount,
    groupCount,
    myPending: getMyPendingInProject(userId, projectId),
    pendingApprovals: pendingDeletionCount(projectId),
    myCoordination: coordination,
    pmIds: getProjectPmIds(projectId),
  };
}

export function touchProject(projectId: string): void {
  getDb().prepare("UPDATE projects SET updated_at = ? WHERE id = ?").run(nowIso(), projectId);
}