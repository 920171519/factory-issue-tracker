import { getDb } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { newId } from "@/lib/ids";
import { nowIso, parseDateInput, timeRangeLabel } from "@/lib/time";
import { requireGroupManager, requireProjectAccess, requireProjectManager } from "@/lib/access";
import {
  assertNoTimeSlotOverlap,
  listTimeSlots,
  syncProjectHandoffKeys,
  validateTimeSlotWindow,
} from "@/lib/schedule";

export interface CategoryView {
  id: string;
  name: string;
  color: string;
  issueCount: number;
}

export interface StatusView {
  id: string;
  name: string;
  color: string;
  countsPending: boolean;
  requiresReason: boolean;
  isIdentified: boolean;
  isDefault: boolean;
  sortOrder: number;
  issueCount: number;
}

export interface HolidayView {
  id: string;
  date: string;
  name: string;
  createdAt: string;
}

export interface HostView {
  id: string;
  locationNo: string;
  hostIp: string;
  hostAccount: string | null;
  hostPassword: string | null;
  updatedAt: string;
}

export interface CodeView {
  id: string;
  code: string;
  description: string | null;
  version: string | null;
  ownerId: string | null;
  ownerName: string | null;
  updatedAt: string;
}

export function listCategories(projectId: string): CategoryView[] {
  return getDb()
    .prepare(
      `SELECT c.id, c.name, c.color,
              (SELECT COUNT(*) FROM barcodes b WHERE b.category_id = c.id) AS issueCount
       FROM categories c WHERE c.project_id = ? ORDER BY c.name`,
    )
    .all(projectId) as CategoryView[];
}

export function createCategory(projectId: string, userId: string, input: { name: string; color?: string }): { id: string } {
  requireProjectManager(userId, projectId);
  const name = input.name.trim();
  if (!name) throw new AppError(400, "请输入问题分类名称");
  if (name.length > 40) throw new AppError(400, "问题分类名称不能超过 40 个字符");
  const color = normalizeColor(input.color);
  const db = getDb();
  if (db.prepare("SELECT 1 FROM categories WHERE project_id = ? AND name = ?").get(projectId, name)) {
    throw new AppError(409, "同项目下已存在该问题分类");
  }
  const id = newId("cat");
  db.prepare("INSERT INTO categories (id, project_id, name, color, created_at) VALUES (?, ?, ?, ?, ?)").run(
    id,
    projectId,
    name,
    color,
    nowIso(),
  );
  return { id };
}

export function updateCategory(
  projectId: string,
  categoryId: string,
  userId: string,
  input: { name?: string; color?: string },
): void {
  requireProjectManager(userId, projectId);
  const db = getDb();
  const current = db.prepare("SELECT * FROM categories WHERE id = ? AND project_id = ?").get(categoryId, projectId) as
    | { name: string; color: string }
    | undefined;
  if (!current) throw new AppError(404, "问题分类不存在");
  const name = input.name === undefined ? current.name : input.name.trim();
  if (!name) throw new AppError(400, "问题分类名称不能为空");
  const color = input.color === undefined ? current.color : normalizeColor(input.color);
  const duplicate = db
    .prepare("SELECT 1 FROM categories WHERE project_id = ? AND name = ? AND id <> ?")
    .get(projectId, name, categoryId);
  if (duplicate) throw new AppError(409, "同项目下已存在该问题分类");
  db.prepare("UPDATE categories SET name = ?, color = ? WHERE id = ?").run(name, color, categoryId);
}

export function deleteCategory(projectId: string, categoryId: string, userId: string): void {
  requireProjectManager(userId, projectId);
  const db = getDb();
  const used = db.prepare("SELECT COUNT(*) AS count FROM barcodes WHERE category_id = ?").get(categoryId) as { count: number };
  if (used.count > 0) throw new AppError(409, "该分类已被问题使用，不能删除；可改名保留");
  const result = db.prepare("DELETE FROM categories WHERE id = ? AND project_id = ?").run(categoryId, projectId);
  if (result.changes === 0) throw new AppError(404, "问题分类不存在");
}

function normalizeColor(color?: string): string {
  const value = (color || "#64748b").trim();
  if (!/^#[0-9a-fA-F]{6}$/.test(value)) throw new AppError(400, "颜色必须为 #RRGGBB 格式");
  return value.toLowerCase();
}

export function listStatuses(projectId: string): StatusView[] {
  return getDb()
    .prepare(
      `SELECT s.*,
              (SELECT COUNT(*) FROM issues i WHERE i.status_id = s.id) AS issueCount
       FROM statuses s WHERE s.project_id = ? ORDER BY s.sort_order, s.name`,
    )
    .all(projectId) as StatusView[];
}

export function createStatus(
  projectId: string,
  userId: string,
  input: {
    name: string;
    color?: string;
    countsPending?: boolean;
    requiresReason?: boolean;
    isIdentified?: boolean;
    isDefault?: boolean;
  },
): { id: string } {
  requireProjectManager(userId, projectId);
  const name = input.name.trim();
  if (!name) throw new AppError(400, "请输入状态名称");
  if (name.length > 30) throw new AppError(400, "状态名称不能超过 30 个字符");
  const db = getDb();
  if (db.prepare("SELECT 1 FROM statuses WHERE project_id = ? AND name = ?").get(projectId, name)) {
    throw new AppError(409, "同项目下已存在该状态");
  }
  const color = normalizeColor(input.color);
  const maxOrder = (db.prepare("SELECT COALESCE(MAX(sort_order), -1) AS value FROM statuses WHERE project_id = ?").get(projectId) as { value: number }).value;
  const id = newId("sts");
  db.transaction(() => {
    if (input.isDefault) db.prepare("UPDATE statuses SET is_default = 0 WHERE project_id = ?").run(projectId);
    db.prepare(
      `INSERT INTO statuses
        (id, project_id, name, color, counts_pending, requires_reason, is_identified, is_default, sort_order, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      projectId,
      name,
      color,
      input.countsPending === false ? 0 : 1,
      input.requiresReason ? 1 : 0,
      input.isIdentified ? 1 : 0,
      input.isDefault ? 1 : 0,
      maxOrder + 1,
      nowIso(),
    );
  })();
  return { id };
}

export function updateStatus(
  projectId: string,
  statusId: string,
  userId: string,
  input: {
    name?: string;
    color?: string;
    countsPending?: boolean;
    requiresReason?: boolean;
    isIdentified?: boolean;
    isDefault?: boolean;
    sortOrder?: number;
  },
): void {
  requireProjectManager(userId, projectId);
  const db = getDb();
  const current = db.prepare("SELECT * FROM statuses WHERE id = ? AND project_id = ?").get(statusId, projectId) as
    | {
        name: string;
        color: string;
        counts_pending: number;
        requires_reason: number;
        is_identified: number;
        is_default: number;
        sort_order: number;
      }
    | undefined;
  if (!current) throw new AppError(404, "状态不存在");
  if (input.isDefault === false && current.is_default === 1) {
    throw new AppError(409, "必须保留一个默认状态；请先将其他状态设为默认");
  }
  const name = input.name === undefined ? current.name : input.name.trim();
  if (!name) throw new AppError(400, "状态名称不能为空");
  const duplicate = db
    .prepare("SELECT 1 FROM statuses WHERE project_id = ? AND name = ? AND id <> ?")
    .get(projectId, name, statusId);
  if (duplicate) throw new AppError(409, "同项目下已存在该状态");
  const color = input.color === undefined ? current.color : normalizeColor(input.color);
  db.transaction(() => {
    if (input.isDefault) db.prepare("UPDATE statuses SET is_default = 0 WHERE project_id = ?").run(projectId);
    db.prepare(
      `UPDATE statuses SET name = ?, color = ?, counts_pending = ?, requires_reason = ?,
              is_identified = ?, is_default = ?, sort_order = ? WHERE id = ?`,
    ).run(
      name,
      color,
      input.countsPending === undefined ? current.counts_pending : input.countsPending ? 1 : 0,
      input.requiresReason === undefined ? current.requires_reason : input.requiresReason ? 1 : 0,
      input.isIdentified === undefined ? current.is_identified : input.isIdentified ? 1 : 0,
      input.isDefault === undefined ? current.is_default : input.isDefault ? 1 : 0,
      input.sortOrder === undefined ? current.sort_order : Math.floor(input.sortOrder),
      statusId,
    );
  })();
}

export function deleteStatus(projectId: string, statusId: string, userId: string): void {
  requireProjectManager(userId, projectId);
  const db = getDb();
  const status = db.prepare("SELECT * FROM statuses WHERE id = ? AND project_id = ?").get(statusId, projectId) as
    | { is_default: number }
    | undefined;
  if (!status) throw new AppError(404, "状态不存在");
  if (status.is_default === 1) throw new AppError(409, "默认状态不能删除");
  const used = db.prepare("SELECT COUNT(*) AS count FROM issues WHERE status_id = ?").get(statusId) as { count: number };
  if (used.count > 0) throw new AppError(409, "该状态已被问题使用，不能删除");
  const history = db
    .prepare("SELECT COUNT(*) AS count FROM status_history WHERE old_status_id = ? OR new_status_id = ?")
    .get(statusId, statusId) as { count: number };
  if (history.count > 0) throw new AppError(409, "该状态存在历史记录，不能删除");
  const count = (db.prepare("SELECT COUNT(*) AS count FROM statuses WHERE project_id = ?").get(projectId) as { count: number }).count;
  if (count <= 1) throw new AppError(409, "项目至少需要保留一个状态");
  db.prepare("DELETE FROM statuses WHERE id = ?").run(statusId);
}

export function listTimeSlotViews(projectId: string): {
  id: string;
  name: string;
  startMinute: number;
  endMinute: number;
  timeLabel: string;
  scheduleCount: number;
}[] {
  const db = getDb();
  return listTimeSlots(projectId).map((slot) => ({
    id: slot.id,
    name: slot.name,
    startMinute: slot.start_minute,
    endMinute: slot.end_minute,
    timeLabel: timeRangeLabel(slot.start_minute, slot.end_minute),
    scheduleCount: (db.prepare("SELECT COUNT(*) AS count FROM schedules WHERE slot_id = ?").get(slot.id) as { count: number }).count,
  }));
}

export function createTimeSlot(
  projectId: string,
  userId: string,
  input: { name: string; start: string; end: string },
): { id: string } {
  requireProjectManager(userId, projectId);
  const name = input.name.trim();
  if (!name) throw new AppError(400, "请输入班次名称");
  const { startMinute, endMinute } = validateTimeSlotWindow(input.start, input.end);
  assertNoTimeSlotOverlap(projectId, { startMinute, endMinute });
  const db = getDb();
  if (db.prepare("SELECT 1 FROM time_slots WHERE project_id = ? AND name = ?").get(projectId, name)) {
    throw new AppError(409, "同项目下已存在同名班次");
  }
  const maxOrder = (db.prepare("SELECT COALESCE(MAX(sort_order), -1) AS value FROM time_slots WHERE project_id = ?").get(projectId) as { value: number }).value;
  const id = newId("tsl");
  db.prepare(
    "INSERT INTO time_slots (id, project_id, name, start_minute, end_minute, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run(id, projectId, name, startMinute, endMinute, maxOrder + 1, nowIso());
  syncProjectHandoffKeys(projectId);
  return { id };
}

export function updateTimeSlot(
  projectId: string,
  slotId: string,
  userId: string,
  input: { name?: string; start?: string; end?: string },
): void {
  requireProjectManager(userId, projectId);
  const db = getDb();
  const current = db.prepare("SELECT * FROM time_slots WHERE id = ? AND project_id = ?").get(slotId, projectId) as
    | { name: string; start_minute: number; end_minute: number }
    | undefined;
  if (!current) throw new AppError(404, "班次不存在");
  const name = input.name === undefined ? current.name : input.name.trim();
  if (!name) throw new AppError(400, "班次名称不能为空");
  const start = input.start || minutesString(current.start_minute);
  const end = input.end || minutesString(current.end_minute);
  const { startMinute, endMinute } = validateTimeSlotWindow(start, end);
  assertNoTimeSlotOverlap(projectId, { startMinute, endMinute, excludeId: slotId });
  const duplicate = db
    .prepare("SELECT 1 FROM time_slots WHERE project_id = ? AND name = ? AND id <> ?")
    .get(projectId, name, slotId);
  if (duplicate) throw new AppError(409, "同项目下已存在同名班次");
  db.prepare("UPDATE time_slots SET name = ?, start_minute = ?, end_minute = ? WHERE id = ?").run(
    name,
    startMinute,
    endMinute,
    slotId,
  );
  syncProjectHandoffKeys(projectId);
}

export function deleteTimeSlot(projectId: string, slotId: string, userId: string): void {
  requireProjectManager(userId, projectId);
  const db = getDb();
  const usedSchedules = db.prepare("SELECT COUNT(*) AS count FROM schedules WHERE slot_id = ?").get(slotId) as { count: number };
  const usedOverrides = db.prepare("SELECT COUNT(*) AS count FROM schedule_overrides WHERE slot_id = ?").get(slotId) as { count: number };
  if (usedSchedules.count > 0 || usedOverrides.count > 0) {
    throw new AppError(409, "该班次已被排班或调班使用，不能删除");
  }
  const result = db.prepare("DELETE FROM time_slots WHERE id = ? AND project_id = ?").run(slotId, projectId);
  if (result.changes === 0) throw new AppError(404, "班次不存在");
  syncProjectHandoffKeys(projectId);
}

function minutesString(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

export function listDefaultGroupIds(projectId: string): string[] {
  return (
    getDb()
      .prepare("SELECT group_id FROM project_default_groups WHERE project_id = ? ORDER BY sort_order")
      .all(projectId) as { group_id: string }[]
  ).map((row) => row.group_id);
}

export function setDefaultGroups(projectId: string, userId: string, groupIds: string[]): void {
  requireProjectManager(userId, projectId);
  const unique = [...new Set(groupIds)];
  const db = getDb();
  if (unique.length > 0) {
    const placeholders = unique.map(() => "?").join(",");
    const groups = db
      .prepare("SELECT id, name, enabled FROM groups WHERE project_id = ? AND id IN (" + placeholders + ")")
      .all(projectId, ...unique) as { id: string; name: string; enabled: number }[];
    if (groups.length !== unique.length) throw new AppError(400, "默认责任组包含不属于当前项目的责任组");
    if (groups.some((group) => group.enabled === 0)) throw new AppError(400, "默认责任组不能选择已停用责任组");
  }
  db.transaction(() => {
    db.prepare("DELETE FROM project_default_groups WHERE project_id = ?").run(projectId);
    const insert = db.prepare("INSERT INTO project_default_groups (project_id, group_id, sort_order) VALUES (?, ?, ?)");
    unique.forEach((groupId, index) => insert.run(projectId, groupId, index));
  })();
}

export function listHolidays(projectId: string): HolidayView[] {
  return getDb()
    .prepare("SELECT id, holiday_date AS date, name, created_at AS createdAt FROM holidays WHERE project_id = ? ORDER BY holiday_date DESC")
    .all(projectId) as HolidayView[];
}

export function addHoliday(projectId: string, userId: string, input: { date: string; name: string }): { id: string } {
  requireProjectManager(userId, projectId);
  const date = parseDateInput(input.date);
  const name = input.name.trim();
  if (!name) throw new AppError(400, "请输入节假日名称");
  if (name.length > 50) throw new AppError(400, "节假日名称不能超过 50 个字符");
  const db = getDb();
  if (db.prepare("SELECT 1 FROM holidays WHERE project_id = ? AND holiday_date = ?").get(projectId, date)) {
    throw new AppError(409, "该日期已配置节假日");
  }
  const id = newId("hol");
  db.prepare("INSERT INTO holidays (id, project_id, holiday_date, name, created_at) VALUES (?, ?, ?, ?, ?)").run(
    id,
    projectId,
    date,
    name,
    nowIso(),
  );
  return { id };
}

export function deleteHoliday(projectId: string, holidayId: string, userId: string): void {
  requireProjectManager(userId, projectId);
  const result = getDb().prepare("DELETE FROM holidays WHERE id = ? AND project_id = ?").run(holidayId, projectId);
  if (result.changes === 0) throw new AppError(404, "节假日不存在");
}

export function listHosts(projectId: string): HostView[] {
  return getDb()
    .prepare(
      `SELECT id, location_no AS locationNo, host_ip AS hostIp, host_account AS hostAccount,
              host_password AS hostPassword, updated_at AS updatedAt
       FROM location_hosts WHERE project_id = ? ORDER BY location_no`,
    )
    .all(projectId) as HostView[];
}

export function saveHost(
  projectId: string,
  userId: string,
  input: { locationNo: string; hostIp: string; hostAccount?: string; hostPassword?: string },
): { id: string } {
  requireProjectManager(userId, projectId);
  const locationNo = input.locationNo.trim();
  const hostIp = input.hostIp.trim();
  if (!locationNo) throw new AppError(400, "请输入库位号");
  if (!hostIp) throw new AppError(400, "请输入云主机 IP");
  if (locationNo.length > 50) throw new AppError(400, "库位号过长");
  if (hostIp.length > 100) throw new AppError(400, "云主机 IP 过长");
  const db = getDb();
  const existing = db
    .prepare("SELECT id FROM location_hosts WHERE project_id = ? AND location_no = ?")
    .get(projectId, locationNo) as { id: string } | undefined;
  const now = nowIso();
  if (existing) {
    db.prepare(
      "UPDATE location_hosts SET host_ip = ?, host_account = ?, host_password = ?, updated_at = ? WHERE id = ?",
    ).run(hostIp, input.hostAccount?.trim() || null, input.hostPassword || null, now, existing.id);
    return { id: existing.id };
  }
  const id = newId("hst");
  db.prepare(
    "INSERT INTO location_hosts (id, project_id, location_no, host_ip, host_account, host_password, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run(id, projectId, locationNo, hostIp, input.hostAccount?.trim() || null, input.hostPassword || null, now);
  return { id };
}

export function deleteHost(projectId: string, hostId: string, userId: string): void {
  requireProjectManager(userId, projectId);
  const result = getDb().prepare("DELETE FROM location_hosts WHERE id = ? AND project_id = ?").run(hostId, projectId);
  if (result.changes === 0) throw new AppError(404, "库位云主机映射不存在");
}

export function listCodes(projectId: string): CodeView[] {
  return getDb()
    .prepare(
      `SELECT c.id, c.code, c.description, c.version, c.owner_id AS ownerId, u.name AS ownerName,
              c.updated_at AS updatedAt
       FROM code_list c LEFT JOIN users u ON u.id = c.owner_id
       WHERE c.project_id = ? ORDER BY c.code`,
    )
    .all(projectId) as CodeView[];
}

export function createCode(
  projectId: string,
  userId: string,
  input: { code: string; description?: string; version?: string; ownerId?: string | null },
): { id: string } {
  requireProjectManager(userId, projectId);
  const code = input.code.trim();
  if (!code) throw new AppError(400, "请输入编码");
  if (code.length > 80) throw new AppError(400, "编码过长");
  const db = getDb();
  if (db.prepare("SELECT 1 FROM code_list WHERE project_id = ? AND code = ?").get(projectId, code)) {
    throw new AppError(409, "该编码已存在");
  }
  if (input.ownerId) {
    const member = db.prepare("SELECT 1 FROM project_members WHERE project_id = ? AND user_id = ?").get(projectId, input.ownerId);
    if (!member) throw new AppError(400, "责任人必须是项目成员");
  }
  const id = newId("cod");
  db.prepare(
    "INSERT INTO code_list (id, project_id, code, description, version, owner_id, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run(id, projectId, code, input.description?.trim() || null, input.version?.trim() || null, input.ownerId || null, nowIso());
  return { id };
}

export function updateCode(
  projectId: string,
  codeId: string,
  userId: string,
  input: { code?: string; description?: string | null; version?: string | null; ownerId?: string | null },
): void {
  requireProjectManager(userId, projectId);
  const db = getDb();
  const current = db.prepare("SELECT * FROM code_list WHERE id = ? AND project_id = ?").get(codeId, projectId) as
    | { code: string; description: string | null; version: string | null; owner_id: string | null }
    | undefined;
  if (!current) throw new AppError(404, "编码不存在");
  const code = input.code === undefined ? current.code : input.code.trim();
  if (!code) throw new AppError(400, "编码不能为空");
  if (input.ownerId) {
    const member = db.prepare("SELECT 1 FROM project_members WHERE project_id = ? AND user_id = ?").get(projectId, input.ownerId);
    if (!member) throw new AppError(400, "责任人必须是项目成员");
  }
  const duplicate = db
    .prepare("SELECT 1 FROM code_list WHERE project_id = ? AND code = ? AND id <> ?")
    .get(projectId, code, codeId);
  if (duplicate) throw new AppError(409, "该编码已存在");
  db.prepare(
    "UPDATE code_list SET code = ?, description = ?, version = ?, owner_id = ?, updated_at = ? WHERE id = ?",
  ).run(
    code,
    input.description === undefined ? current.description : input.description?.trim() || null,
    input.version === undefined ? current.version : input.version?.trim() || null,
    input.ownerId === undefined ? current.owner_id : input.ownerId,
    nowIso(),
    codeId,
  );
}

export function deleteCode(projectId: string, codeId: string, userId: string): void {
  requireProjectManager(userId, projectId);
  const result = getDb().prepare("DELETE FROM code_list WHERE id = ? AND project_id = ?").run(codeId, projectId);
  if (result.changes === 0) throw new AppError(404, "编码不存在");
}

export function getLocationHost(projectId: string, locationNo: string): {
  hostIp: string;
  hostAccount: string | null;
  hostPassword: string | null;
} | null {
  const row = getDb()
    .prepare("SELECT host_ip, host_account, host_password FROM location_hosts WHERE project_id = ? AND location_no = ?")
    .get(projectId, locationNo.trim()) as { host_ip: string; host_account: string | null; host_password: string | null } | undefined;
  return row ? { hostIp: row.host_ip, hostAccount: row.host_account, hostPassword: row.host_password } : null;
}

export function getProjectMemberOptions(projectId: string): { id: string; name: string; employeeNo: string }[] {
  return getDb()
    .prepare(
      `SELECT u.id, u.name, u.employee_no AS employeeNo
       FROM project_members pm JOIN users u ON u.id = pm.user_id
       WHERE pm.project_id = ? ORDER BY u.name`,
    )
    .all(projectId) as { id: string; name: string; employeeNo: string }[];
}

export function assertGroupInProject(projectId: string, groupId: string): void {
  const row = getDb().prepare("SELECT 1 FROM groups WHERE id = ? AND project_id = ?").get(groupId, projectId);
  if (!row) throw new AppError(400, "责任组不存在");
}

export function canManageProjectGroups(projectId: string, userId: string, groupId: string): boolean {
  try {
    requireGroupManager(userId, projectId, groupId);
    return true;
  } catch {
    return false;
  }
}
