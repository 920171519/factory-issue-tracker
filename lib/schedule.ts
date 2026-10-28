import { getDb, type AppDatabase } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { newId } from "@/lib/ids";
import {
  addDays,
  getLocalParts,
  minutesToTime,
  timeToMinutes,
  weekdayLabel,
  zonedDateTimeToUtc,
} from "@/lib/time";

export interface TimeSlotRow {
  id: string;
  project_id: string;
  name: string;
  start_minute: number;
  end_minute: number;
  sort_order: number;
  created_at: string;
}

export interface BasicUser {
  id: string;
  name: string;
  employee_no: string;
}

export interface ShiftMoment {
  date: string;
  weekday: number;
  minutes: number;
  at: Date;
}

export interface ShiftSlot {
  slot: TimeSlotRow;
  anchorDate: string;
  anchorWeekday: number;
}

export interface GroupResolution {
  groupId: string;
  groupName: string;
  handlerIds: string[];
  handlers: BasicUser[];
  primaryId: string | null;
  primaryCounts: Record<string, number>;
  source: "SCHEDULE" | "OVERRIDE" | "FALLBACK";
  sourceLabel: string;
  fallbackReason: string | null;
  slot: TimeSlotRow | null;
  anchorDate: string | null;
  anchorWeekday: number | null;
  overrideKind?: string;
  overrideNote?: string | null;
}

export function momentForNow(now: Date = new Date()): ShiftMoment {
  const parts = getLocalParts(now);
  return { date: parts.date, weekday: parts.weekday, minutes: parts.minutes, at: now };
}

export function momentForDateTime(dateStr: string, timeStr: string): ShiftMoment {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) throw new AppError(400, "日期格式应为 YYYY-MM-DD");
  const minutes = timeToMinutes(timeStr);
  const weekday = weekdayOf(dateStr);
  return {
    date: dateStr,
    weekday,
    minutes,
    at: zonedDateTimeToUtc(dateStr, timeStr),
  };
}

function weekdayOf(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return dow === 0 ? 7 : dow;
}

export function listTimeSlots(projectId: string): TimeSlotRow[] {
  return getDb()
    .prepare("SELECT * FROM time_slots WHERE project_id = ? ORDER BY sort_order, start_minute, name")
    .all(projectId) as TimeSlotRow[];
}

export function findActiveSlot(projectId: string, moment: ShiftMoment): ShiftSlot | null {
  const slots = listTimeSlots(projectId);
  for (const slot of slots) {
    if (slot.start_minute === slot.end_minute) continue;
    if (slot.start_minute < slot.end_minute) {
      if (moment.minutes >= slot.start_minute && moment.minutes < slot.end_minute) {
        return { slot, anchorDate: moment.date, anchorWeekday: moment.weekday };
      }
    } else {
      if (moment.minutes >= slot.start_minute) {
        return { slot, anchorDate: moment.date, anchorWeekday: moment.weekday };
      }
      if (moment.minutes < slot.end_minute) {
        const anchorDate = addDays(moment.date, -1);
        return { slot, anchorDate, anchorWeekday: weekdayOf(anchorDate) };
      }
    }
  }
  return null;
}

export function shiftKeyFor(projectId: string, moment: ShiftMoment): string {
  const active = findActiveSlot(projectId, moment);
  if (!active) return `${moment.date}|none`;
  return `${active.anchorDate}|${active.slot.id}`;
}

export function syncGroupHandoffKey(groupId: string, now: Date = new Date()): void {
  const db = getDb();
  const group = db.prepare("SELECT project_id FROM groups WHERE id = ?").get(groupId) as { project_id: string } | undefined;
  if (!group) return;
  const key = shiftKeyFor(group.project_id, momentForNow(now));
  db.prepare("UPDATE groups SET last_handoff_key = ?, last_handoff_at = ? WHERE id = ?").run(key, now.toISOString(), groupId);
}

export function syncProjectHandoffKeys(projectId: string, now: Date = new Date()): void {
  const db = getDb();
  const groups = db.prepare("SELECT id FROM groups WHERE project_id = ?").all(projectId) as { id: string }[];
  const key = shiftKeyFor(projectId, momentForNow(now));
  const stmt = db.prepare("UPDATE groups SET last_handoff_key = ?, last_handoff_at = ? WHERE id = ?");
  for (const group of groups) stmt.run(key, now.toISOString(), group.id);
}

function fallbackHandlers(projectId: string, groupId: string): {
  handlers: BasicUser[];
  reason: string;
  labels: string[];
} {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT u.id, u.name, u.employee_no,
              gm.is_leader, gm.is_default_assignee, gm.is_fallback_assignee
       FROM group_members gm JOIN users u ON u.id = gm.user_id
       WHERE gm.group_id = ? AND (gm.is_leader = 1 OR gm.is_default_assignee = 1 OR gm.is_fallback_assignee = 1)`,
    )
    .all(groupId) as (BasicUser & { is_leader: number; is_default_assignee: number; is_fallback_assignee: number })[];
  const pmRows = db
    .prepare(
      `SELECT u.id, u.name, u.employee_no
       FROM project_members pm JOIN users u ON u.id = pm.user_id
       WHERE pm.project_id = ? AND pm.is_pm = 1
       ORDER BY pm.joined_at`,
    )
    .all(projectId) as BasicUser[];

  const order = (row: (typeof rows)[number]) => (row.is_leader ? 0 : row.is_default_assignee ? 1 : 2);
  rows.sort((a, b) => order(a) - order(b));
  const seen = new Set<string>();
  const handlers: BasicUser[] = [];
  for (const row of [...rows, ...pmRows]) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    handlers.push({ id: row.id, name: row.name, employee_no: row.employee_no });
  }
  const labels: string[] = [];
  if (rows.some((r) => r.is_leader)) labels.push("组负责人");
  if (rows.some((r) => r.is_default_assignee)) labels.push("默认处理人");
  if (rows.some((r) => r.is_fallback_assignee)) labels.push("兜底处理人");
  labels.push("项目 PM");
  return {
    handlers,
    reason: `排班缺失，已兜底至${labels.join("、")}`,
    labels,
  };
}

export function rankHandlers(userIds: string[]): { id: string; pending: number; employee_no: string; name: string }[] {
  const db = getDb();
  const unique = [...new Set(userIds)];
  if (unique.length === 0) return [];
  const placeholders = unique.map(() => "?").join(",");
  const users = db
    .prepare(`SELECT id, name, employee_no FROM users WHERE id IN (${placeholders})`)
    .all(...unique) as BasicUser[];
  const counts = getPendingCounts(unique);
  return users
    .map((user) => ({ ...user, pending: counts.get(user.id) || 0 }))
    .sort((a, b) => a.pending - b.pending || a.employee_no.localeCompare(b.employee_no, "zh-CN"));
}

export function getPendingCounts(userIds: string[], projectId?: string): Map<string, number> {
  const result = new Map<string, number>();
  if (userIds.length === 0) return result;
  const db = getDb();
  const stmt = db.prepare(
    `SELECT COUNT(DISTINCT i.id) AS count
     FROM issue_group_handlers h
     JOIN issue_groups ig ON ig.id = h.issue_group_id
     JOIN issues i ON i.id = ig.issue_id
     JOIN statuses s ON s.id = i.status_id
     WHERE h.user_id = ? AND h.is_primary = 1 AND s.counts_pending = 1
       ${projectId ? "AND i.project_id = ?" : ""}`,
  );
  for (const userId of new Set(userIds)) {
    const row = (projectId ? stmt.get(userId, projectId) : stmt.get(userId)) as { count: number };
    result.set(userId, row.count);
  }
  return result;
}

export function getPendingCount(userId: string): number {
  return getPendingCounts([userId]).get(userId) || 0;
}

export function getCoordinationCounts(userIds: string[], projectId?: string): Map<string, number> {
  const result = new Map<string, number>();
  if (userIds.length === 0) return result;
  const db = getDb();
  const stmt = db.prepare(
    `SELECT COUNT(DISTINCT i.id) AS count
     FROM issue_group_handlers h
     JOIN issue_groups ig ON ig.id = h.issue_group_id
     JOIN issues i ON i.id = ig.issue_id
     JOIN statuses s ON s.id = i.status_id
     WHERE h.user_id = ? AND h.is_primary = 0 AND s.counts_pending = 1
       ${projectId ? "AND i.project_id = ?" : ""}`,
  );
  for (const userId of new Set(userIds)) {
    const row = (projectId ? stmt.get(userId, projectId) : stmt.get(userId)) as { count: number };
    result.set(userId, row.count);
  }
  return result;
}

export function resolveGroupAt(groupId: string, moment: ShiftMoment): GroupResolution {
  const db = getDb();
  const group = db
    .prepare("SELECT id, project_id, name, enabled FROM groups WHERE id = ?")
    .get(groupId) as { id: string; project_id: string; name: string; enabled: number } | undefined;
  if (!group) throw new AppError(404, "责任组不存在");

  const active = findActiveSlot(group.project_id, moment);
  if (group.enabled === 0 || !active) {
    const fallback = fallbackHandlers(group.project_id, groupId);
    if (fallback.handlers.length === 0) throw new AppError(409, "责任组无可用兜底处理人");
    const ranked = rankHandlers(fallback.handlers.map((h) => h.id));
    return {
      groupId,
      groupName: group.name,
      handlerIds: fallback.handlers.map((h) => h.id),
      handlers: fallback.handlers,
      primaryId: ranked[0]?.id || fallback.handlers[0].id,
      primaryCounts: Object.fromEntries(ranked.map((r) => [r.id, r.pending])),
      source: "FALLBACK",
      sourceLabel: fallback.reason,
      fallbackReason: group.enabled === 0 ? "责任组已停用" : "当前时间不在任何班次内",
      slot: null,
      anchorDate: null,
      anchorWeekday: null,
    };
  }

  const slot = active.slot;
  const overrides = db
    .prepare(
      `SELECT so.id, so.slot_id, so.kind, so.note, u.id AS user_id, u.name, u.employee_no
       FROM schedule_overrides so
       JOIN users u ON u.id = so.user_id
       JOIN group_members gm ON gm.group_id = so.group_id AND gm.user_id = so.user_id
       WHERE so.group_id = ? AND so.override_date = ?
         AND (so.slot_id = ? OR so.slot_id IS NULL)
       ORDER BY CASE WHEN so.slot_id IS NULL THEN 1 ELSE 0 END, u.employee_no`,
    )
    .all(groupId, active.anchorDate, slot.id) as {
    id: string;
    slot_id: string | null;
    kind: string;
    note: string | null;
    user_id: string;
    name: string;
    employee_no: string;
  }[];

  if (overrides.length > 0) {
    const specific = overrides.filter((row) => row.slot_id !== null);
    const chosen = specific.length > 0 ? specific : overrides;
    const seen = new Set<string>();
    const handlers: BasicUser[] = [];
    for (const row of chosen) {
      if (seen.has(row.user_id)) continue;
      seen.add(row.user_id);
      handlers.push({ id: row.user_id, name: row.name, employee_no: row.employee_no });
    }
    const ranked = rankHandlers(handlers.map((h) => h.id));
    return {
      groupId,
      groupName: group.name,
      handlerIds: handlers.map((h) => h.id),
      handlers,
      primaryId: ranked[0]?.id || null,
      primaryCounts: Object.fromEntries(ranked.map((r) => [r.id, r.pending])),
      source: "OVERRIDE",
      sourceLabel: chosen[0].kind === "HOLIDAY" ? "节假日覆盖" : chosen[0].kind === "PROXY" ? "代理值班" : "临时调班",
      fallbackReason: null,
      slot,
      anchorDate: active.anchorDate,
      anchorWeekday: active.anchorWeekday,
      overrideKind: chosen[0].kind,
      overrideNote: chosen[0].note,
    };
  }

  const scheduled = db
    .prepare(
      `SELECT DISTINCT u.id, u.name, u.employee_no
       FROM schedules s
       JOIN users u ON u.id = s.user_id
       JOIN group_members gm ON gm.group_id = s.group_id AND gm.user_id = s.user_id
       WHERE s.group_id = ? AND s.weekday = ? AND s.slot_id = ?
         AND s.effective_from <= ?
         AND (s.effective_to IS NULL OR s.effective_to >= ?)
       ORDER BY u.employee_no`,
    )
    .all(groupId, active.anchorWeekday, slot.id, active.anchorDate, active.anchorDate) as BasicUser[];

  if (scheduled.length === 0) {
    const fallback = fallbackHandlers(group.project_id, groupId);
    if (fallback.handlers.length === 0) throw new AppError(409, "排班缺失且责任组无可用兜底处理人");
    const ranked = rankHandlers(fallback.handlers.map((h) => h.id));
    return {
      groupId,
      groupName: group.name,
      handlerIds: fallback.handlers.map((h) => h.id),
      handlers: fallback.handlers,
      primaryId: ranked[0]?.id || fallback.handlers[0].id,
      primaryCounts: Object.fromEntries(ranked.map((r) => [r.id, r.pending])),
      source: "FALLBACK",
      sourceLabel: fallback.reason,
      fallbackReason: "当前班次无排班",
      slot,
      anchorDate: active.anchorDate,
      anchorWeekday: active.anchorWeekday,
    };
  }

  const ranked = rankHandlers(scheduled.map((h) => h.id));
  return {
    groupId,
    groupName: group.name,
    handlerIds: scheduled.map((h) => h.id),
    handlers: scheduled,
    primaryId: ranked[0]?.id || null,
    primaryCounts: Object.fromEntries(ranked.map((r) => [r.id, r.pending])),
    source: "SCHEDULE",
    sourceLabel: "按班次排班",
    fallbackReason: null,
    slot,
    anchorDate: active.anchorDate,
    anchorWeekday: active.anchorWeekday,
  };
}

export function setIssueGroupHandlers(
  db: AppDatabase,
  issueGroupId: string,
  userIds: string[],
  assignedAt: string,
  pinnedUserId: string | null = null,
): { primaryId: string; userIds: string[] } {
  const unique = [...new Set(userIds)];
  if (unique.length === 0) throw new AppError(409, "无法解析处理人：排班和兜底均为空");
  db.prepare("DELETE FROM issue_group_handlers WHERE issue_group_id = ?").run(issueGroupId);
  const ranked = rankHandlers(unique);
  const primaryId = ranked[0]?.id || unique[0];
  const insert = db.prepare(
    "INSERT INTO issue_group_handlers (id, issue_group_id, user_id, is_primary, assigned_at) VALUES (?, ?, ?, ?, ?)",
  );
  for (const userId of unique) {
    insert.run(newId("igh"), issueGroupId, userId, userId === primaryId ? 1 : 0, assignedAt);
  }
  db.prepare("UPDATE issue_groups SET pinned_user_id = ? WHERE id = ?").run(pinnedUserId, issueGroupId);
  return { primaryId, userIds: unique };
}

export function listProjectGroupResolutions(projectId: string, moment: ShiftMoment): GroupResolution[] {
  const groups = getDb()
    .prepare("SELECT id FROM groups WHERE project_id = ? AND enabled = 1 ORDER BY name")
    .all(projectId) as { id: string }[];
  return groups.map((group) => resolveGroupAt(group.id, moment));
}

export function validateTimeSlotWindow(start: string, end: string): { startMinute: number; endMinute: number } {
  const startMinute = timeToMinutes(start);
  const endMinute = timeToMinutes(end);
  if (startMinute === endMinute) throw new AppError(400, "班次开始和结束时间不能相同");
  return { startMinute, endMinute };
}

function slotSegments(start: number, end: number): [number, number][] {
  if (start < end) return [[start, end]];
  return [
    [start, 1440],
    [0, end],
  ];
}

export function assertNoTimeSlotOverlap(
  projectId: string,
  input: { startMinute: number; endMinute: number; excludeId?: string },
): void {
  const slots = listTimeSlots(projectId);
  const newSegments = slotSegments(input.startMinute, input.endMinute);
  for (const slot of slots) {
    if (slot.id === input.excludeId) continue;
    const existing = slotSegments(slot.start_minute, slot.end_minute);
    for (const [aStart, aEnd] of newSegments) {
      for (const [bStart, bEnd] of existing) {
        if (aStart < bEnd && bStart < aEnd) {
          throw new AppError(
            409,
            `时间段与现有班次「${slot.name}（${minutesToTime(slot.start_minute)}–${minutesToTime(slot.end_minute)}）」重叠`,
          );
        }
      }
    }
  }
}

export function requireActiveSlotForShift(projectId: string, date: string, time: string): {
  moment: ShiftMoment;
  active: ShiftSlot;
} {
  const moment: ShiftMoment = {
    date,
    weekday: weekdayOf(date),
    minutes: timeToMinutes(time),
    at: zonedDateTimeToUtc(date, time),
  };
  const active = findActiveSlot(projectId, moment);
  if (!active) throw new AppError(400, "所选时间不在任何配置班次内");
  return { moment, active };
}

export function scheduleDayLabel(weekday: number): string {
  return weekdayLabel(weekday);
}