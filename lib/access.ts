import { getDb } from "@/lib/db";
import { AppError } from "@/lib/errors";

export interface ProjectRow {
  id: string;
  name: string;
  code: string | null;
  description: string | null;
  notify_self_on_status: number;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface ProjectAccess {
  project: ProjectRow;
  isPm: boolean;
  isSupervisor: boolean;
  isGroupLeader: boolean;
  groupIds: string[];
  leaderGroupIds: string[];
}

export function getProject(projectId: string): ProjectRow | null {
  return (getDb().prepare("SELECT * FROM projects WHERE id = ?").get(projectId) as ProjectRow | undefined) ?? null;
}

export function getProjectAccess(userId: string, projectId: string): ProjectAccess | null {
  const db = getDb();
  const project = getProject(projectId);
  if (!project) return null;
  const member = db
    .prepare("SELECT is_pm, is_supervisor FROM project_members WHERE project_id = ? AND user_id = ?")
    .get(projectId, userId) as { is_pm: number; is_supervisor: number } | undefined;
  if (!member) return null;
  const groups = db
    .prepare(
      `SELECT gm.group_id, gm.is_leader
       FROM group_members gm JOIN groups g ON g.id = gm.group_id
       WHERE g.project_id = ? AND gm.user_id = ?`,
    )
    .all(projectId, userId) as { group_id: string; is_leader: number }[];
  return {
    project,
    isPm: member.is_pm === 1,
    isSupervisor: member.is_supervisor === 1,
    isGroupLeader: groups.some((g) => g.is_leader === 1),
    groupIds: groups.map((g) => g.group_id),
    leaderGroupIds: groups.filter((g) => g.is_leader === 1).map((g) => g.group_id),
  };
}

export function requireProjectAccess(userId: string, projectId: string): ProjectAccess {
  const access = getProjectAccess(userId, projectId);
  if (!access) throw new AppError(404, "项目不存在或你无权访问");
  return access;
}

export function requireProjectManager(userId: string, projectId: string): ProjectAccess {
  const access = requireProjectAccess(userId, projectId);
  if (!access.isPm) throw new AppError(403, "仅项目 PM 可执行此操作");
  return access;
}

export function requireProjectManagerOrSupervisor(userId: string, projectId: string): ProjectAccess {
  const access = requireProjectAccess(userId, projectId);
  if (!access.isPm && !access.isSupervisor) throw new AppError(403, "仅项目 PM 或项目主管可执行此操作");
  return access;
}

export function canManageGroup(access: ProjectAccess, groupId: string): boolean {
  return access.isPm || access.leaderGroupIds.includes(groupId);
}

export function requireGroupManager(userId: string, projectId: string, groupId: string): ProjectAccess {
  const access = requireProjectAccess(userId, projectId);
  if (!canManageGroup(access, groupId)) throw new AppError(403, "仅项目 PM 或该责任组负责人可维护此责任组");
  return access;
}

export function isGroupMember(groupId: string, userId: string): boolean {
  return Boolean(getDb().prepare("SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?").get(groupId, userId));
}

export function getGroup(groupId: string): { id: string; project_id: string; name: string; enabled: number } | null {
  return (
    (getDb().prepare("SELECT id, project_id, name, enabled FROM groups WHERE id = ?").get(groupId) as
      | { id: string; project_id: string; name: string; enabled: number }
      | undefined) ?? null
  );
}

export function ensureProjectMembership(projectId: string, userId: string): void {
  const db = getDb();
  const exists = db.prepare("SELECT 1 FROM project_members WHERE project_id = ? AND user_id = ?").get(projectId, userId);
  if (!exists) {
    db.prepare(
      "INSERT INTO project_members (project_id, user_id, is_pm, is_supervisor, joined_at) VALUES (?, ?, 0, 0, ?)",
    ).run(projectId, userId, new Date().toISOString());
  }
}

export function getProjectPmIds(projectId: string): string[] {
  const rows = getDb()
    .prepare("SELECT user_id FROM project_members WHERE project_id = ? AND is_pm = 1 ORDER BY joined_at")
    .all(projectId) as { user_id: string }[];
  return rows.map((row) => row.user_id);
}

export function getProjectMemberCount(projectId: string): number {
  const row = getDb().prepare("SELECT COUNT(*) AS count FROM project_members WHERE project_id = ?").get(projectId) as { count: number };
  return row.count;
}

export interface AccessPayload {
  isPm: boolean;
  isSupervisor: boolean;
  isGroupLeader: boolean;
  leaderGroupIds: string[];
  groupIds: string[];
}

export function accessPayload(access: ProjectAccess): AccessPayload {
  return {
    isPm: access.isPm,
    isSupervisor: access.isSupervisor,
    isGroupLeader: access.isGroupLeader,
    leaderGroupIds: access.leaderGroupIds,
    groupIds: access.groupIds,
  };
}
