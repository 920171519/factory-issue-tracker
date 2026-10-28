import { getDb } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { newId } from "@/lib/ids";
import { nowIso, todayLocal, weekdayLabel, timeRangeLabel, parseDateInput } from "@/lib/time";
import {
  canManageGroup,
  ensureProjectMembership,
  requireGroupManager,
  requireProjectAccess,
  requireProjectManager,
  type ProjectAccess,
} from "@/lib/access";
import {
  getPendingCounts,
  getCoordinationCounts,
  listTimeSlots,
  momentForDateTime,
  momentForNow,
  resolveGroupAt,
  shiftKeyFor,
  syncGroupHandoffKey,
  type GroupResolution,
} from "@/lib/schedule";
import { reassignGroupAssignmentsAfterMemberRemoval } from "@/lib/assignments";

export interface GroupMemberView {
  userId: string;
  name: string;
  employeeNo: string;
  isLeader: boolean;
  isDefaultAssignee: boolean;
  isFallbackAssignee: boolean;
  pending: number;
  coordination: number;
}

export interface ScheduleView {
  id: string;
  weekday: number;
  weekdayLabel: string;
  slotId: string;
  slotName: string;
  startMinute: number;
  endMinute: number;
  timeLabel: string;
  userId: string;
  userName: string;
  employeeNo: string;
  effectiveFrom: string;
  effectiveTo: string | null;
}

export interface OverrideView {
  id: string;
  overrideDate: string;
  slotId: string | null;
  slotName: string | null;
  userId: string;
  userName: string;
  employeeNo: string;
  kind: string;
  kindLabel: string;
  note: string | null;
}

export interface GroupCard {
  id: string;
  name: string;
  description: string | null;
  enabled: boolean;
  canManage: boolean;
  leaders: { id: string; name: string }[];
  memberCount: number;
  defaultAssignee: { id: string; name: string } | null;
  fallbackAssignee: { id: string; name: string } | null;
  scheduleCount: number;
  activeIssueCount: number;
  currentResolution: GroupResolution | null;
}

export interface GroupDetails {
  group: {
    id: string;
    projectId: string;
    name: string;
    description: string | null;
    enabled: boolean;
    createdAt: string;
    updatedAt: string;
  };
  canManage: boolean;
  members: GroupMemberView[];
  schedules: ScheduleView[];
  overrides: OverrideView[];
  timeSlots: ReturnType<typeof listTimeSlots>;
  anomalies: {
    id: string;
    message: string;
    createdAt: string;
    kind: string;
    barcode: string | null;
    errorItem: string | null;
  }[];
  activeIssueCount: number;
}

const OVERRIDE_LABELS: Record<string, string> = {
  TEMP: "临时调班",
  HOLIDAY: "节假日覆盖",
  PROXY: "代理值班",
};

function getGroupRow(projectId: string, groupId: string): {
  id: string;
  project_id: string;
  name: string;
  description: string | null;
  enabled: number;
  created_at: string;
  updated_at: string;
} {
  const row = getDb()
    .prepare("SELECT * FROM groups WHERE id = ? AND project_id = ?")
    .get(groupId, projectId) as
    | {
        id: string;
        project_id: string;
        name: string;
        description: string | null;
        enabled: number;
        created_at: string;
        updated_at: string;
      }
    | undefined;
  if (!row) throw new AppError(404, "责任组不存在");
  return row;
}

function validateGroupName(projectId: string, name: string, excludeId?: string): string {
  const trimmed = name.trim();
  if (!trimmed) throw new AppError(400, "请输入责任组名称");
  if (trimmed.length > 50) throw new AppError(400, "责任组名称不能超过 50 个字符");
  const existing = getDb()
    .prepare("SELECT id FROM groups WHERE project_id = ? AND name = ? AND id <> ?")
    .get(projectId, trimmed, excludeId || "") as { id: string } | undefined;
  if (existing) throw new AppError(409, "同项目下已存在同名责任组");
  return trimmed;
}

export function createGroup(
  projectId: string,
  operatorId: string,
  input: {
    name: string;
    description?: string;
    leaderIds: string[];
    defaultAssigneeId?: string | null;
    fallbackAssigneeId?: string | null;
  },
): { id: string } {
  requireProjectManager(operatorId, projectId);
  const db = getDb();
  const name = validateGroupName(projectId, input.name);
  const leaderIds = [...new Set(input.leaderIds || [])];
  if (leaderIds.length === 0) throw new AppError(400, "新增责任组必须配置至少一名组负责人");
  const optionalIds = [input.defaultAssigneeId, input.fallbackAssigneeId].filter((id): id is string => Boolean(id));
  const allIds = [...new Set([...leaderIds, ...optionalIds])];
  const placeholders = allIds.map(() => "?").join(",");
  const users = db.prepare(`SELECT id, name FROM users WHERE id IN (${placeholders})`).all(...allIds) as {
    id: string;
    name: string;
  }[];
  if (users.length !== allIds.length) throw new AppError(400, "所选组负责人或处理人不存在");
  if (!allIds.includes(operatorId)) {
    // The creator may be PM without joining the group; no action needed.
  }
  const now = nowIso();
  const groupId = newId("grp");
  db.transaction(() => {
    db.prepare(
      `INSERT INTO groups (id, project_id, name, description, enabled, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, ?, ?, ?)`,
    ).run(groupId, projectId, name, input.description?.trim() || null, operatorId, now, now);
    const insertMember = db.prepare(
      `INSERT INTO group_members
        (id, group_id, user_id, is_leader, is_default_assignee, is_fallback_assignee, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const userId of allIds) {
      ensureProjectMembership(projectId, userId);
      insertMember.run(
        newId("gmb"),
        groupId,
        userId,
        leaderIds.includes(userId) ? 1 : 0,
        input.defaultAssigneeId === userId ? 1 : 0,
        input.fallbackAssigneeId === userId ? 1 : 0,
        now,
      );
    }
    db.prepare("UPDATE groups SET last_handoff_key = ?, last_handoff_at = ? WHERE id = ?").run(
      shiftKeyFor(projectId, momentForNow()),
      now,
      groupId,
    );
  })();
  return { id: groupId };
}

export function updateGroup(
  projectId: string,
  groupId: string,
  operatorId: string,
  input: { name?: string; description?: string | null; enabled?: boolean },
): void {
  const access = requireGroupManager(operatorId, projectId, groupId);
  const group = getGroupRow(projectId, groupId);
  if (input.enabled !== undefined && !access.isPm) {
    throw new AppError(403, "仅项目 PM 可启用或停用责任组");
  }
  const name = input.name === undefined ? group.name : validateGroupName(projectId, input.name, groupId);
  const description = input.description === undefined ? group.description : input.description?.trim() || null;
  const enabled = input.enabled === undefined ? group.enabled === 1 : input.enabled;
  if (enabled) {
    const leaders = getDb()
      .prepare("SELECT COUNT(*) AS count FROM group_members WHERE group_id = ? AND is_leader = 1")
      .get(groupId) as { count: number };
    if (leaders.count === 0) throw new AppError(409, "责任组至少需要一名组负责人才能启用");
  } else if (group.enabled === 1) {
    const activeIssues = getDb()
      .prepare(
        `SELECT COUNT(DISTINCT i.id) AS count FROM issue_groups ig JOIN issues i ON i.id = ig.issue_id
         WHERE ig.group_id = ?`,
      )
      .get(groupId) as { count: number };
    if (activeIssues.count > 0) throw new AppError(409, `该责任组仍有 ${activeIssues.count} 个问题参与，不能停用；请先完成转接`);
    getDb().prepare("DELETE FROM project_default_groups WHERE group_id = ?").run(groupId);
  }
  getDb()
    .prepare("UPDATE groups SET name = ?, description = ?, enabled = ?, updated_at = ? WHERE id = ?")
    .run(name, description, enabled ? 1 : 0, nowIso(), groupId);
}

export function deleteGroup(projectId: string, groupId: string, operatorId: string): void {
  requireProjectManager(operatorId, projectId);
  const group = getGroupRow(projectId, groupId);
  const activeIssues = getDb()
    .prepare(
      `SELECT COUNT(DISTINCT i.id) AS count FROM issue_groups ig JOIN issues i ON i.id = ig.issue_id
       WHERE ig.group_id = ?`,
    )
    .get(groupId) as { count: number };
  if (activeIssues.count > 0) throw new AppError(409, `责任组「${group.name}」仍参与 ${activeIssues.count} 个问题，不能删除`);
  getDb().prepare("DELETE FROM groups WHERE id = ? AND project_id = ?").run(groupId, projectId);
}

export function addGroupMember(
  projectId: string,
  groupId: string,
  operatorId: string,
  input: { userId?: string; employeeNo?: string },
): { userId: string } {
  requireGroupManager(operatorId, projectId, groupId);
  const db = getDb();
  const user = input.userId
    ? (db.prepare("SELECT id, name FROM users WHERE id = ?").get(input.userId) as { id: string; name: string } | undefined)
    : input.employeeNo
      ? (db.prepare("SELECT id, name FROM users WHERE employee_no = ?").get(input.employeeNo.trim()) as
          | { id: string; name: string }
          | undefined)
      : undefined;
  if (!user) throw new AppError(404, "未找到该用户");
  const exists = db.prepare("SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?").get(groupId, user.id);
  if (exists) throw new AppError(409, "该用户已在责任组中");
  ensureProjectMembership(projectId, user.id);
  db.prepare(
    "INSERT INTO group_members (id, group_id, user_id, is_leader, is_default_assignee, is_fallback_assignee, created_at) VALUES (?, ?, ?, 0, 0, 0, ?)",
  ).run(newId("gmb"), groupId, user.id, nowIso());
  return { userId: user.id };
}

export function updateGroupMember(
  projectId: string,
  groupId: string,
  operatorId: string,
  targetUserId: string,
  input: { isLeader?: boolean; isDefaultAssignee?: boolean; isFallbackAssignee?: boolean },
): void {
  requireGroupManager(operatorId, projectId, groupId);
  const db = getDb();
  const member = db
    .prepare("SELECT * FROM group_members WHERE group_id = ? AND user_id = ?")
    .get(groupId, targetUserId) as
    | {
        id: string;
        is_leader: number;
        is_default_assignee: number;
        is_fallback_assignee: number;
      }
    | undefined;
  if (!member) throw new AppError(404, "责任组成员不存在");
  if (input.isLeader === false && member.is_leader === 1) {
    const leaderCount = (db.prepare("SELECT COUNT(*) AS count FROM group_members WHERE group_id = ? AND is_leader = 1").get(groupId) as { count: number }).count;
    if (leaderCount <= 1) throw new AppError(409, "责任组至少需要保留一名组负责人");
  }
  db.transaction(() => {
    if (input.isLeader !== undefined) {
      db.prepare("UPDATE group_members SET is_leader = ? WHERE id = ?").run(input.isLeader ? 1 : 0, member.id);
    }
    if (input.isDefaultAssignee !== undefined) {
      if (input.isDefaultAssignee) {
        db.prepare("UPDATE group_members SET is_default_assignee = 0 WHERE group_id = ?").run(groupId);
      }
      db.prepare("UPDATE group_members SET is_default_assignee = ? WHERE id = ?").run(input.isDefaultAssignee ? 1 : 0, member.id);
    }
    if (input.isFallbackAssignee !== undefined) {
      if (input.isFallbackAssignee) {
        db.prepare("UPDATE group_members SET is_fallback_assignee = 0 WHERE group_id = ?").run(groupId);
      }
      db.prepare("UPDATE group_members SET is_fallback_assignee = ? WHERE id = ?").run(input.isFallbackAssignee ? 1 : 0, member.id);
    }
    db.prepare("UPDATE groups SET updated_at = ? WHERE id = ?").run(nowIso(), groupId);
  })();
}

export function removeGroupMember(
  projectId: string,
  groupId: string,
  operatorId: string,
  targetUserId: string,
): { reassignedIssues: number } {
  requireGroupManager(operatorId, projectId, groupId);
  const db = getDb();
  const member = db.prepare("SELECT * FROM group_members WHERE group_id = ? AND user_id = ?").get(groupId, targetUserId) as
    | { id: string; is_leader: number }
    | undefined;
  if (!member) throw new AppError(404, "责任组成员不存在");
  if (member.is_leader === 1) {
    const leaderCount = (db.prepare("SELECT COUNT(*) AS count FROM group_members WHERE group_id = ? AND is_leader = 1").get(groupId) as { count: number }).count;
    if (leaderCount <= 1) throw new AppError(409, "责任组至少需要保留一名组负责人，不能移除最后一名负责人");
  }
  db.transaction(() => {
    db.prepare("DELETE FROM schedules WHERE group_id = ? AND user_id = ?").run(groupId, targetUserId);
    db.prepare("DELETE FROM schedule_overrides WHERE group_id = ? AND user_id = ?").run(groupId, targetUserId);
    db.prepare("DELETE FROM group_members WHERE id = ?").run(member.id);
  })();
  const reassignedIssues = reassignGroupAssignmentsAfterMemberRemoval(projectId, groupId, targetUserId, operatorId);
  syncGroupHandoffKey(groupId);
  return { reassignedIssues };
}

export function listGroupCards(projectId: string, userId: string): GroupCard[] {
  const access = requireProjectAccess(userId, projectId);
  const db = getDb();
  const groups = db
    .prepare("SELECT id, name, description, enabled FROM groups WHERE project_id = ? ORDER BY name")
    .all(projectId) as { id: string; name: string; description: string | null; enabled: number }[];
  const now = new Date();
  return groups.map((group) => {
    const members = db
      .prepare(
        `SELECT gm.user_id, u.name, gm.is_leader, gm.is_default_assignee, gm.is_fallback_assignee
         FROM group_members gm JOIN users u ON u.id = gm.user_id WHERE gm.group_id = ? ORDER BY gm.is_leader DESC, u.name`,
      )
      .all(group.id) as {
      user_id: string;
      name: string;
      is_leader: number;
      is_default_assignee: number;
      is_fallback_assignee: number;
    }[];
    const scheduleCount = (db.prepare("SELECT COUNT(*) AS count FROM schedules WHERE group_id = ?").get(group.id) as { count: number }).count;
    const activeIssueCount = (db
      .prepare(
        `SELECT COUNT(DISTINCT i.id) AS count FROM issue_groups ig JOIN issues i ON i.id = ig.issue_id WHERE ig.group_id = ?`,
      )
      .get(group.id) as { count: number }).count;
    let currentResolution: GroupResolution | null = null;
    if (group.enabled === 1) {
      try {
        currentResolution = resolveGroupAt(group.id, momentForNow(now));
      } catch {
        currentResolution = null;
      }
    }
    return {
      id: group.id,
      name: group.name,
      description: group.description,
      enabled: group.enabled === 1,
      canManage: canManageGroup(access, group.id),
      leaders: members.filter((m) => m.is_leader === 1).map((m) => ({ id: m.user_id, name: m.name })),
      memberCount: members.length,
      defaultAssignee: (() => {
        const item = members.find((m) => m.is_default_assignee === 1);
        return item ? { id: item.user_id, name: item.name } : null;
      })(),
      fallbackAssignee: (() => {
        const item = members.find((m) => m.is_fallback_assignee === 1);
        return item ? { id: item.user_id, name: item.name } : null;
      })(),
      scheduleCount,
      activeIssueCount,
      currentResolution,
    };
  });
}

export function getGroupDetails(projectId: string, groupId: string, userId: string): GroupDetails {
  const access = requireProjectAccess(userId, projectId);
  const group = getGroupRow(projectId, groupId);
  const db = getDb();
  const memberRows = db
    .prepare(
      `SELECT gm.user_id, gm.is_leader, gm.is_default_assignee, gm.is_fallback_assignee, u.name, u.employee_no
       FROM group_members gm JOIN users u ON u.id = gm.user_id
       WHERE gm.group_id = ? ORDER BY gm.is_leader DESC, u.name`,
    )
    .all(groupId) as {
    user_id: string;
    is_leader: number;
    is_default_assignee: number;
    is_fallback_assignee: number;
    name: string;
    employee_no: string;
  }[];
  const userIds = memberRows.map((row) => row.user_id);
  const pending = getPendingCounts(userIds, projectId);
  const coordination = getCoordinationCounts(userIds, projectId);
  const schedules = db
    .prepare(
      `SELECT s.id, s.weekday, s.slot_id, s.user_id, s.effective_from, s.effective_to,
              t.name AS slot_name, t.start_minute, t.end_minute, u.name AS user_name, u.employee_no
       FROM schedules s
       JOIN time_slots t ON t.id = s.slot_id
       JOIN users u ON u.id = s.user_id
       WHERE s.group_id = ?
       ORDER BY s.weekday, t.start_minute, u.name`,
    )
    .all(groupId) as {
    id: string;
    weekday: number;
    slot_id: string;
    user_id: string;
    effective_from: string;
    effective_to: string | null;
    slot_name: string;
    start_minute: number;
    end_minute: number;
    user_name: string;
    employee_no: string;
  }[];
  const overrides = db
    .prepare(
      `SELECT so.id, so.override_date, so.slot_id, so.user_id, so.kind, so.note,
              t.name AS slot_name, u.name AS user_name, u.employee_no
       FROM schedule_overrides so
       LEFT JOIN time_slots t ON t.id = so.slot_id
       JOIN users u ON u.id = so.user_id
       WHERE so.group_id = ? ORDER BY so.override_date DESC, t.start_minute, u.name`,
    )
    .all(groupId) as {
    id: string;
    override_date: string;
    slot_id: string | null;
    user_id: string;
    kind: string;
    note: string | null;
    slot_name: string | null;
    user_name: string;
    employee_no: string;
  }[];
  const anomalies = db
    .prepare(
      `SELECT a.id, a.message, a.created_at, a.kind, b.barcode, i.error_item
       FROM anomalies a
       LEFT JOIN issues i ON i.id = a.issue_id
       LEFT JOIN barcodes b ON b.id = i.barcode_id
       WHERE a.group_id = ? ORDER BY a.created_at DESC LIMIT 30`,
    )
    .all(groupId) as {
    id: string;
    message: string;
    created_at: string;
    kind: string;
    barcode: string | null;
    error_item: string | null;
  }[];
  const activeIssueCount = (db
    .prepare(
      `SELECT COUNT(DISTINCT i.id) AS count FROM issue_groups ig JOIN issues i ON i.id = ig.issue_id WHERE ig.group_id = ?`,
    )
    .get(groupId) as { count: number }).count;
  return {
    group: {
      id: group.id,
      projectId: group.project_id,
      name: group.name,
      description: group.description,
      enabled: group.enabled === 1,
      createdAt: group.created_at,
      updatedAt: group.updated_at,
    },
    canManage: canManageGroup(access, group.id),
    members: memberRows.map((row) => ({
      userId: row.user_id,
      name: row.name,
      employeeNo: row.employee_no,
      isLeader: row.is_leader === 1,
      isDefaultAssignee: row.is_default_assignee === 1,
      isFallbackAssignee: row.is_fallback_assignee === 1,
      pending: pending.get(row.user_id) || 0,
      coordination: coordination.get(row.user_id) || 0,
    })),
    schedules: schedules.map((row) => ({
      id: row.id,
      weekday: row.weekday,
      weekdayLabel: weekdayLabel(row.weekday),
      slotId: row.slot_id,
      slotName: row.slot_name,
      startMinute: row.start_minute,
      endMinute: row.end_minute,
      timeLabel: timeRangeLabel(row.start_minute, row.end_minute),
      userId: row.user_id,
      userName: row.user_name,
      employeeNo: row.employee_no,
      effectiveFrom: row.effective_from,
      effectiveTo: row.effective_to,
    })),
    overrides: overrides.map((row) => ({
      id: row.id,
      overrideDate: row.override_date,
      slotId: row.slot_id,
      slotName: row.slot_name,
      userId: row.user_id,
      userName: row.user_name,
      employeeNo: row.employee_no,
      kind: row.kind,
      kindLabel: OVERRIDE_LABELS[row.kind] || row.kind,
      note: row.note,
    })),
    timeSlots: listTimeSlots(projectId),
    anomalies: anomalies.map((row) => ({
      id: row.id,
      message: row.message,
      createdAt: row.created_at,
      kind: row.kind,
      barcode: row.barcode,
      errorItem: row.error_item,
    })),
    activeIssueCount,
  };
}

export function addSchedule(
  projectId: string,
  groupId: string,
  operatorId: string,
  input: { weekday: number; slotId: string; userId: string; effectiveFrom?: string; effectiveTo?: string | null },
): { id: string } {
  requireGroupManager(operatorId, projectId, groupId);
  if (!Number.isInteger(input.weekday) || input.weekday < 1 || input.weekday > 7) throw new AppError(400, "星期必须为周一至周日");
  const db = getDb();
  const slot = db.prepare("SELECT * FROM time_slots WHERE id = ? AND project_id = ?").get(input.slotId, projectId) as
    | { id: string; name: string; start_minute: number; end_minute: number }
    | undefined;
  if (!slot) throw new AppError(400, "时间段不存在");
  const member = db.prepare("SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?").get(groupId, input.userId);
  if (!member) throw new AppError(400, "排班处理人必须是该责任组成员");
  const effectiveFrom = input.effectiveFrom ? parseDateInput(input.effectiveFrom) : todayLocal();
  const effectiveTo = input.effectiveTo ? parseDateInput(input.effectiveTo) : null;
  if (effectiveTo && effectiveTo < effectiveFrom) throw new AppError(400, "生效结束日期不能早于开始日期");
  const duplicate = db
    .prepare(
      "SELECT 1 FROM schedules WHERE group_id = ? AND weekday = ? AND slot_id = ? AND user_id = ? AND effective_from = ?",
    )
    .get(groupId, input.weekday, input.slotId, input.userId, effectiveFrom);
  if (duplicate) throw new AppError(409, "该成员在此星期和班次的相同生效日期已存在排班");
  const id = newId("sch");
  db.prepare(
    "INSERT INTO schedules (id, group_id, weekday, slot_id, user_id, effective_from, effective_to, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(id, groupId, input.weekday, input.slotId, input.userId, effectiveFrom, effectiveTo, nowIso());
  db.prepare("UPDATE groups SET updated_at = ? WHERE id = ?").run(nowIso(), groupId);
  syncGroupHandoffKey(groupId);
  return { id };
}

export function deleteSchedule(projectId: string, groupId: string, operatorId: string, scheduleId: string): void {
  requireGroupManager(operatorId, projectId, groupId);
  const result = getDb().prepare("DELETE FROM schedules WHERE id = ? AND group_id = ?").run(scheduleId, groupId);
  if (result.changes === 0) throw new AppError(404, "排班不存在");
  syncGroupHandoffKey(groupId);
}

export function addScheduleOverride(
  projectId: string,
  groupId: string,
  operatorId: string,
  input: { overrideDate: string; slotId?: string | null; userId: string; kind?: string; note?: string },
): { id: string } {
  requireGroupManager(operatorId, projectId, groupId);
  const date = parseDateInput(input.overrideDate);
  const kind = input.kind || "TEMP";
  if (!["TEMP", "HOLIDAY", "PROXY"].includes(kind)) throw new AppError(400, "调班类型无效");
  const db = getDb();
  if (input.slotId) {
    const slot = db.prepare("SELECT 1 FROM time_slots WHERE id = ? AND project_id = ?").get(input.slotId, projectId);
    if (!slot) throw new AppError(400, "时间段不存在");
  }
  const member = db.prepare("SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?").get(groupId, input.userId);
  if (!member) throw new AppError(400, "调班处理人必须是该责任组成员");
  const duplicate = db
    .prepare(
      `SELECT 1 FROM schedule_overrides
       WHERE group_id = ? AND override_date = ? AND COALESCE(slot_id, '') = ? AND user_id = ?`,
    )
    .get(groupId, date, input.slotId || "", input.userId);
  if (duplicate) throw new AppError(409, "该日期、班次和成员已存在调班配置");
  const id = newId("ovr");
  db.prepare(
    "INSERT INTO schedule_overrides (id, group_id, override_date, slot_id, user_id, kind, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(id, groupId, date, input.slotId || null, input.userId, kind, input.note?.trim() || null, nowIso());
  db.prepare("UPDATE groups SET updated_at = ? WHERE id = ?").run(nowIso(), groupId);
  return { id };
}

export function deleteScheduleOverride(projectId: string, groupId: string, operatorId: string, overrideId: string): void {
  requireGroupManager(operatorId, projectId, groupId);
  const result = getDb().prepare("DELETE FROM schedule_overrides WHERE id = ? AND group_id = ?").run(overrideId, groupId);
  if (result.changes === 0) throw new AppError(404, "调班记录不存在");
}

export function searchDirectoryUsers(query: string): { id: string; name: string; employeeNo: string }[] {
  const trimmed = query.trim();
  if (!trimmed) return [];
  return getDb()
    .prepare(
      `SELECT id, name, employee_no AS employeeNo FROM users
       WHERE name LIKE ? OR employee_no LIKE ? ORDER BY name LIMIT 20`,
    )
    .all(`%${trimmed}%`, `%${trimmed}%`) as { id: string; name: string; employeeNo: string }[];
}

export interface CommunicationGroup {
  id: string;
  name: string;
  enabled: boolean;
  leaders: { id: string; name: string; employeeNo: string }[];
  members: { id: string; name: string; employeeNo: string; isLeader: boolean }[];
  schedules: { weekday: number; weekdayLabel: string; slotName: string; timeLabel: string; users: string[] }[];
  resolution: GroupResolution | null;
}

export interface CommunicationData {
  date: string;
  time: string;
  timeSlots: { id: string; name: string; startMinute: number; endMinute: number; timeLabel: string }[];
  groups: CommunicationGroup[];
  holiday: { name: string; date: string } | null;
}

export function getCommunicationData(
  projectId: string,
  userId: string,
  options: { date?: string; time?: string } = {},
): CommunicationData {
  requireProjectAccess(userId, projectId);
  const date = options.date || todayLocal();
  const time = options.time || nowLocalTime();
  if (!/^\d{2}:\d{2}$/.test(time)) throw new AppError(400, "时间格式应为 HH:mm");
  const moment = momentForDateTime(date, time);
  const db = getDb();
  const slots = listTimeSlots(projectId);
  const holiday = db
    .prepare("SELECT name, holiday_date AS date FROM holidays WHERE project_id = ? AND holiday_date = ?")
    .get(projectId, date) as { name: string; date: string } | undefined;
  const groupRows = db
    .prepare("SELECT id, name, enabled FROM groups WHERE project_id = ? ORDER BY name")
    .all(projectId) as { id: string; name: string; enabled: number }[];
  return {
    date,
    time,
    timeSlots: slots.map((slot) => ({
      id: slot.id,
      name: slot.name,
      startMinute: slot.start_minute,
      endMinute: slot.end_minute,
      timeLabel: timeRangeLabel(slot.start_minute, slot.end_minute),
    })),
    groups: groupRows.map((group) => {
      const members = db
        .prepare(
          `SELECT u.id, u.name, u.employee_no, gm.is_leader
           FROM group_members gm JOIN users u ON u.id = gm.user_id
           WHERE gm.group_id = ? ORDER BY gm.is_leader DESC, u.name`,
        )
        .all(group.id) as { id: string; name: string; employee_no: string; is_leader: number }[];
      const scheduleRows = db
        .prepare(
          `SELECT s.weekday, t.name AS slot_name, t.start_minute, t.end_minute, u.name AS user_name
           FROM schedules s JOIN time_slots t ON t.id = s.slot_id JOIN users u ON u.id = s.user_id
           WHERE s.group_id = ? AND s.effective_from <= ? AND (s.effective_to IS NULL OR s.effective_to >= ?)
           ORDER BY s.weekday, t.start_minute, u.name`,
        )
        .all(group.id, date, date) as {
        weekday: number;
        slot_name: string;
        start_minute: number;
        end_minute: number;
        user_name: string;
      }[];
      const matrix = new Map<string, { weekday: number; weekdayLabel: string; slotName: string; timeLabel: string; users: string[] }>();
      for (const row of scheduleRows) {
        const key = `${row.weekday}:${row.slot_name}:${row.start_minute}`;
        const existing = matrix.get(key) || {
          weekday: row.weekday,
          weekdayLabel: weekdayLabel(row.weekday),
          slotName: row.slot_name,
          timeLabel: timeRangeLabel(row.start_minute, row.end_minute),
          users: [],
        };
        if (!existing.users.includes(row.user_name)) existing.users.push(row.user_name);
        matrix.set(key, existing);
      }
      let resolution: GroupResolution | null = null;
      if (group.enabled === 1) {
        try {
          resolution = resolveGroupAt(group.id, moment);
        } catch {
          resolution = null;
        }
      }
      return {
        id: group.id,
        name: group.name,
        enabled: group.enabled === 1,
        leaders: members
          .filter((member) => member.is_leader === 1)
          .map((member) => ({ id: member.id, name: member.name, employeeNo: member.employee_no })),
        members: members.map((member) => ({
          id: member.id,
          name: member.name,
          employeeNo: member.employee_no,
          isLeader: member.is_leader === 1,
        })),
        schedules: [...matrix.values()],
        resolution,
      };
    }),
    holiday: holiday || null,
  };
}

function nowLocalTime(): string {
  const now = new Date();
  const local = new Intl.DateTimeFormat("en-GB", {
    timeZone: process.env.APP_TIMEZONE || "Asia/Shanghai",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(now);
  return local;
}

export function groupMemberOptions(projectId: string): { id: string; name: string; employeeNo: string }[] {
  return getDb()
    .prepare(
      `SELECT u.id, u.name, u.employee_no AS employeeNo
       FROM project_members pm JOIN users u ON u.id = pm.user_id
       WHERE pm.project_id = ? ORDER BY u.name`,
    )
    .all(projectId) as { id: string; name: string; employeeNo: string }[];
}

export function currentScheduleResolution(projectId: string, groupId: string): GroupResolution {
  const group = getGroupRow(projectId, groupId);
  void group;
  return resolveGroupAt(groupId, momentForNow());
}