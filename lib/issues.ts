import { getDb, type AppDatabase } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { newId } from "@/lib/ids";
import { hasRichText, richTextToPlain, sanitizeRichText } from "@/lib/sanitize";
import {
  momentForNow,
  resolveGroupAt,
  setIssueGroupHandlers,
  type BasicUser,
  type GroupResolution,
} from "@/lib/schedule";
import { getProjectAccess, requireProjectAccess, type ProjectAccess } from "@/lib/access";
import { getPendingCount } from "@/lib/schedule";
import { recordAnomaly, recordAssignmentHistory, type EntityRef } from "@/lib/history";
import { sendNotifications } from "@/lib/notifications";
import { nowIso } from "@/lib/time";
import {
  loadBarcodeIssueContexts,
  loadIssueContexts,
  permissionsForBarcode,
  permissionsForIssue,
  type IssueContext,
  type IssuePermissions,
  type BarcodePermissions,
} from "@/lib/issue-access";

export const PRIORITIES = ["HIGH", "MEDIUM", "LOW"] as const;
export type Priority = (typeof PRIORITIES)[number];
export const PRIORITY_LABELS: Record<Priority, string> = { HIGH: "高", MEDIUM: "中", LOW: "低" };

export interface BasicProjectRef {
  id: string;
  name: string;
}

export interface ProjectStatus {
  id: string;
  name: string;
  color: string;
  counts_pending: number;
  requires_reason: number;
  is_identified: number;
  is_default: number;
  sort_order: number;
}

export interface ProjectCategory {
  id: string;
  name: string;
  color: string;
}

export interface ProjectGroupSummary {
  id: string;
  name: string;
  enabled: number;
}

export interface BarcodeRow {
  id: string;
  barcode: string;
  location_no: string;
  host_ip: string | null;
  device_ip: string | null;
  priority: string;
  priority_label: string;
  category_id: string | null;
  category_name: string | null;
  category_color: string | null;
  remark: string | null;
  created_by: string;
  creator_name: string;
  created_at: string;
  updated_at: string;
  issue_count: number;
}

export interface BarcodeListFilters {
  page?: number;
  pageSize?: number;
  search?: string;
  groupId?: string;
  statusId?: string;
  categoryId?: string;
  priority?: string;
}

export interface ListGroupView {
  id: string;
  name: string;
  handlers: { id: string; name: string; isPrimary: boolean }[];
}

export interface BarcodeListRow extends BarcodeRow {
  statuses: { id: string; name: string; color: string; is_identified: number }[];
  groups: ListGroupView[];
  permissions: {
    canUpdateAllStatuses: boolean;
    canTransferAll: boolean;
    canDelete: boolean;
  };
}

interface ListGroupAggregate extends ListGroupView {
  handlerSet: Set<string>;
}

export function getProjectGroups(projectId: string, enabledOnly = false): ProjectGroupSummary[] {
  const suffix = enabledOnly ? " AND enabled = 1" : "";
  return getDb()
    .prepare(`SELECT id, name, enabled FROM groups WHERE project_id = ?${suffix} ORDER BY name`)
    .all(projectId) as ProjectGroupSummary[];
}

export function getProjectStatuses(projectId: string): ProjectStatus[] {
  return getDb()
    .prepare("SELECT * FROM statuses WHERE project_id = ? ORDER BY sort_order, name")
    .all(projectId) as ProjectStatus[];
}

export function getProjectCategories(projectId: string): ProjectCategory[] {
  return getDb()
    .prepare("SELECT id, name, color FROM categories WHERE project_id = ? ORDER BY name")
    .all(projectId) as ProjectCategory[];
}

export function getDefaultGroupIds(projectId: string): string[] {
  return (
    getDb()
      .prepare("SELECT group_id FROM project_default_groups WHERE project_id = ? ORDER BY sort_order")
      .all(projectId) as { group_id: string }[]
  ).map((row) => row.group_id);
}

export function getDefaultStatus(projectId: string): ProjectStatus {
  const db = getDb();
  const status =
    (db.prepare("SELECT * FROM statuses WHERE project_id = ? AND is_default = 1").get(projectId) as ProjectStatus | undefined) ||
    (db.prepare("SELECT * FROM statuses WHERE project_id = ? ORDER BY sort_order LIMIT 1").get(projectId) as ProjectStatus | undefined);
  if (!status) throw new AppError(409, "项目尚未配置问题状态，请先让项目 PM 完成配置");
  return status;
}

export interface CreateBarcodeInput {
  barcode: string;
  locationNo: string;
  groupIds?: string[];
  categoryId?: string | null;
  priority: string;
  remark?: string;
  deviceIp?: string | null;
}

export interface CreateBarcodeResult {
  barcodeId: string;
  issueId: string;
  recipientIds: string[];
}

interface ResolvedEntryGroup {
  groupId: string;
  groupName: string;
  resolution: GroupResolution;
}

function validatePriority(priority: string): Priority {
  if (!PRIORITIES.includes(priority as Priority)) throw new AppError(400, "优先级必须为高、中、低之一");
  return priority as Priority;
}

function assertGroupSelection(projectId: string, groupIds: string[]): ProjectGroupSummary[] {
  const unique = [...new Set(groupIds)];
  if (unique.length === 0) {
    const defaults = getDefaultGroupIds(projectId);
    if (defaults.length === 0) throw new AppError(400, "请选择参与责任组（项目尚未配置默认责任组）");
    return assertGroupSelection(projectId, defaults);
  }
  const db = getDb();
  const placeholders = unique.map(() => "?").join(",");
  const groups = db
    .prepare(`SELECT id, name, enabled FROM groups WHERE project_id = ? AND id IN (${placeholders})`)
    .all(projectId, ...unique) as ProjectGroupSummary[];
  if (groups.length !== unique.length) throw new AppError(400, "参与责任组包含不属于当前项目的责任组");
  const disabled = groups.filter((group) => group.enabled === 0);
  if (disabled.length > 0) throw new AppError(400, `责任组「${disabled.map((g) => g.name).join("、")}」已停用，不能选择`);
  return groups;
}

function assertCategory(projectId: string, categoryId?: string | null): string | null {
  if (!categoryId) return null;
  const row = getDb().prepare("SELECT id FROM categories WHERE id = ? AND project_id = ?").get(categoryId, projectId);
  if (!row) throw new AppError(400, "问题分类不存在");
  return categoryId;
}

export function getBarcodeBase(projectId: string, barcodeId: string): {
  id: string;
  barcode: string;
  location_no: string;
  project_id: string;
} | null {
  return (
    (getDb()
      .prepare("SELECT id, barcode, location_no, project_id FROM barcodes WHERE id = ? AND project_id = ?")
      .get(barcodeId, projectId) as { id: string; barcode: string; location_no: string; project_id: string } | undefined) ??
    null
  );
}

export function createBarcode(
  projectId: string,
  userId: string,
  input: CreateBarcodeInput,
  options: { now?: Date; notify?: boolean } = {},
): CreateBarcodeResult {
  requireProjectAccess(userId, projectId);
  const now = options.now || new Date();
  const timestamp = now.toISOString();
  const moment = momentForNow(now);
  const db = getDb();

  const barcode = input.barcode.trim();
  const locationNo = input.locationNo.trim();
  if (!barcode) throw new AppError(400, "请输入条码");
  if (barcode.length > 100) throw new AppError(400, "条码长度不能超过 100 个字符");
  if (!locationNo) throw new AppError(400, "请输入库位号");
  if (locationNo.length > 50) throw new AppError(400, "库位号长度不能超过 50 个字符");
  const priority = validatePriority(input.priority || "MEDIUM");
  const categoryId = assertCategory(projectId, input.categoryId);
  const selectedGroups = assertGroupSelection(projectId, input.groupIds || []);
  const status = getDefaultStatus(projectId);
  const existing = db.prepare("SELECT id FROM barcodes WHERE project_id = ? AND barcode = ?").get(projectId, barcode);
  if (existing) throw new AppError(409, `条码「${barcode}」已在本项目录入，请从问题列表打开`);

  const host = db
    .prepare("SELECT host_ip, host_account, host_password FROM location_hosts WHERE project_id = ? AND location_no = ?")
    .get(projectId, locationNo) as { host_ip: string; host_account: string | null; host_password: string | null } | undefined;

  const barcodeId = newId("bar");
  const issueId = newId("iss");
  const recipientIds: string[] = [];

  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO barcodes
        (id, project_id, barcode, location_no, host_ip, host_account, host_password, device_ip, priority, category_id,
         remark, tracking_groups, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', ?, ?, ?)`,
    ).run(
      barcodeId,
      projectId,
      barcode,
      locationNo,
      host?.host_ip || null,
      host?.host_account || null,
      host?.host_password || null,
      input.deviceIp?.trim() || null,
      priority,
      categoryId,
      input.remark?.trim() || null,
      userId,
      timestamp,
      timestamp,
    );
    db.prepare(
      `INSERT INTO issues (id, barcode_id, project_id, error_item, status_id, created_by, created_at, updated_at)
       VALUES (?, ?, ?, '', ?, ?, ?, ?)`,
    ).run(issueId, barcodeId, projectId, status.id, userId, timestamp, timestamp);

    const resolved: ResolvedEntryGroup[] = selectedGroups.map((group) => ({
      groupId: group.id,
      groupName: group.name,
      resolution: resolveGroupAt(group.id, moment),
    }));

    const toHandlerMap = new Map<string, BasicUser>();
    const anomalies: string[] = [];
    for (const entry of resolved) {
      db.prepare(
        "INSERT INTO issue_groups (id, issue_id, group_id, pinned_user_id, created_at) VALUES (?, ?, ?, NULL, ?)",
      ).run(newId("igr"), issueId, entry.groupId, timestamp);
      const issueGroup = db.prepare("SELECT id FROM issue_groups WHERE issue_id = ? AND group_id = ?").get(issueId, entry.groupId) as { id: string };
      setIssueGroupHandlers(db, issueGroup.id, entry.resolution.handlerIds, timestamp, null);
      for (const handler of entry.resolution.handlers) toHandlerMap.set(handler.id, handler);
      recipientIds.push(...entry.resolution.handlerIds);
      if (entry.resolution.source === "FALLBACK") {
        const message = `责任组「${entry.groupName}」${entry.resolution.fallbackReason || "排班缺失"}，已兜底分配并通知`;
        anomalies.push(message);
        recordAnomaly({
          projectId,
          issueId,
          groupId: entry.groupId,
          kind: "SCHEDULE_MISSING",
          message,
          createdAt: timestamp,
        });
      }
    }

    const toGroups: EntityRef[] = resolved.map((entry) => ({ id: entry.groupId, name: entry.groupName }));
    const toHandlers: EntityRef[] = [...toHandlerMap.values()].map((user) => ({ id: user.id, name: user.name }));
    recordAssignmentHistory({
      issueId,
      changeType: "ENTRY",
      operatorId: userId,
      fromGroups: [],
      toGroups,
      fromHandlers: [],
      toHandlers,
      reasonHtml: "问题录入，按当前班次排班分配责任组处理人",
      meta: {
        groupNames: selectedGroups.map((group) => group.name),
        anomalies,
        fromGroupNames: [],
        toGroupNames: toGroups.map((item) => item.name),
        retainedGroupNames: [],
        fromHandlerNames: [],
        toHandlerNames: toHandlers.map((item) => item.name),
      },
      createdAt: timestamp,
    });
  });
  tx();

  const recipients = [...new Set(recipientIds)];
  if (options.notify !== false) {
    const operator = db.prepare("SELECT name FROM users WHERE id = ?").get(userId) as { name: string };
    sendNotifications({
      projectId,
      recipientIds: recipients,
      title: "新问题待处理",
      body: `条码「${barcode}」已录入并分配给你处理，录入人：${operator.name}。`,
      barcodeIds: [barcodeId],
    });
  }
  return { barcodeId, issueId, recipientIds: recipients };
}

export function addErrorIssue(
  projectId: string,
  barcodeId: string,
  userId: string,
  input: { errorItem: string },
): { issueId: string } {
  const access = requireProjectAccess(userId, projectId);
  const barcode = getBarcodeBase(projectId, barcodeId);
  if (!barcode) throw new AppError(404, "条码不存在");
  const errorItem = input.errorItem.trim();
  if (!errorItem) throw new AppError(400, "请填写报错测试项");
  if (errorItem.length > 500) throw new AppError(400, "报错测试项不能超过 500 个字符");

  const db = getDb();
  const source = db
    .prepare("SELECT id FROM issues WHERE barcode_id = ? ORDER BY created_at DESC, id DESC LIMIT 1")
    .get(barcodeId) as { id: string } | undefined;
  if (!source) throw new AppError(409, "条码下尚无可继承的初始问题");
  const sourceContext = loadIssueContexts([source.id]).get(source.id);
  if (!sourceContext) throw new AppError(409, "无法读取条码问题");
  const permissions = permissionsForIssue(sourceContext, access, userId);
  if (!permissions.canEditContent) throw new AppError(403, "仅参与该问题的责任组成员可添加报错项");

  const status = getDefaultStatus(projectId);
  const now = new Date();
  const timestamp = now.toISOString();
  const newIssueId = newId("iss");

  db.transaction(() => {
    db.prepare(
      `INSERT INTO issues (id, barcode_id, project_id, error_item, status_id, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(newIssueId, barcodeId, projectId, errorItem, status.id, userId, timestamp, timestamp);

    for (const group of sourceContext.groups) {
      db.prepare(
        "INSERT INTO issue_groups (id, issue_id, group_id, pinned_user_id, created_at) VALUES (?, ?, ?, ?, ?)",
      ).run(newId("igr"), newIssueId, group.groupId, group.pinnedUserId, timestamp);
      const newGroup = db
        .prepare("SELECT id FROM issue_groups WHERE issue_id = ? AND group_id = ?")
        .get(newIssueId, group.groupId) as { id: string };
      setIssueGroupHandlers(db, newGroup.id, group.handlerIds, timestamp, group.pinnedUserId);
    }
    const toGroups = sourceContext.groups.map((group) => ({ id: group.groupId, name: group.groupName }));
    const names = db
      .prepare(`SELECT id, name FROM users WHERE id IN (${sourceContext.handlerIds.map(() => "?").join(",") || "''"})`)
      .all(...(sourceContext.handlerIds.length ? sourceContext.handlerIds : [""])) as { id: string; name: string }[];
    recordAssignmentHistory({
      issueId: newIssueId,
      changeType: "ENTRY",
      operatorId: userId,
      fromGroups: [],
      toGroups,
      fromHandlers: [],
      toHandlers: names.map((u) => ({ id: u.id, name: u.name })),
      reasonHtml: "追加报错项，继承条码当前责任配置",
      meta: { addedErrorItem: errorItem },
      createdAt: timestamp,
    });
    db.prepare("UPDATE barcodes SET updated_at = ? WHERE id = ?").run(timestamp, barcodeId);
  })();
  return { issueId: newIssueId };
}

export function updateErrorItem(
  projectId: string,
  issueId: string,
  userId: string,
  errorItem: string,
): void {
  const access = requireProjectAccess(userId, projectId);
  const db = getDb();
  const issue = db.prepare("SELECT id, barcode_id FROM issues WHERE id = ? AND project_id = ?").get(issueId, projectId) as
    | { id: string; barcode_id: string }
    | undefined;
  if (!issue) throw new AppError(404, "报错项不存在");
  const context = loadIssueContexts([issueId]).get(issueId);
  if (!context) throw new AppError(404, "报错项不存在");
  if (!permissionsForIssue(context, access, userId).canEditContent) {
    throw new AppError(403, "仅参与该问题的责任组成员可编辑报错项");
  }
  const value = errorItem.trim();
  if (!value) throw new AppError(400, "请填写报错测试项");
  if (value.length > 500) throw new AppError(400, "报错测试项不能超过 500 个字符");
  const timestamp = nowIso();
  db.prepare("UPDATE issues SET error_item = ?, updated_at = ? WHERE id = ?").run(value, timestamp, issueId);
  db.prepare("UPDATE barcodes SET updated_at = ? WHERE id = ?").run(timestamp, issue.barcode_id);
}

export function updateTrackingGroups(
  projectId: string,
  barcodeId: string,
  userId: string,
  groups: string[],
): string[] {
  requireProjectAccess(userId, projectId);
  const barcode = getBarcodeBase(projectId, barcodeId);
  if (!barcode) throw new AppError(404, "条码不存在");
  const clean = [...new Set(groups.map((group) => group.trim()).filter(Boolean))];
  if (clean.length > 20) throw new AppError(400, "跟踪群号最多 20 个");
  if (clean.some((group) => group.length > 100)) throw new AppError(400, "单个跟踪群号不能超过 100 个字符");
  getDb().prepare("UPDATE barcodes SET tracking_groups = ?, updated_at = ? WHERE id = ?").run(
    JSON.stringify(clean),
    nowIso(),
    barcodeId,
  );
  return clean;
}

export interface DetailGroup {
  groupId: string;
  groupName: string;
  pinnedUserId: string | null;
  handlers: { id: string; name: string; employeeNo: string; isPrimary: boolean }[];
}

export interface StatusHistoryView {
  id: string;
  oldStatus: string;
  newStatus: string;
  newStatusColor: string;
  reasonHtml: string;
  operator: string;
  createdAt: string;
}

export interface AssignmentHistoryView {
  id: string;
  changeType: string;
  changeTypeLabel: string;
  operator: string | null;
  fromGroups: string[];
  toGroups: string[];
  retainedGroups: string[];
  fromHandlers: string[];
  toHandlers: string[];
  reasonHtml: string;
  createdAt: string;
  anomalies: string[];
}

export interface BarcodeIssueDetail {
  id: string;
  errorItem: string;
  status: { id: string; name: string; color: string; requiresReason: boolean; countsPending: boolean; isIdentified: boolean };
  groups: DetailGroup[];
  creator: string;
  createdAt: string;
  updatedAt: string;
  statusHistory: StatusHistoryView[];
  assignmentHistory: AssignmentHistoryView[];
  permissions: IssuePermissions;
}

export interface BarcodeDetail {
  id: string;
  barcode: string;
  locationNo: string;
  hostIp: string | null;
  hostAccount: string | null;
  hostPassword: string | null;
  deviceIp: string | null;
  priority: string;
  priorityLabel: string;
  category: { id: string; name: string; color: string } | null;
  remark: string | null;
  trackingGroups: string[];
  creator: string;
  createdAt: string;
  updatedAt: string;
  issues: BarcodeIssueDetail[];
  permissions: BarcodePermissions;
}

const CHANGE_TYPE_LABELS: Record<string, string> = {
  ENTRY: "录入分配",
  INTRA_GROUP: "组内转交",
  CROSS_GROUP: "跨组转接",
  SHIFT_HANDOFF: "班次交接",
  FALLBACK: "兜底分配",
  FORCED: "PM/主管强制转交",
};

function parseJsonArray(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

export function getBarcodeDetail(projectId: string, barcodeId: string, userId: string): BarcodeDetail {
  const access = requireProjectAccess(userId, projectId);
  const db = getDb();
  const barcode = db
    .prepare(
      `SELECT b.*, c.name AS category_name, c.color AS category_color, u.name AS creator_name
       FROM barcodes b
       LEFT JOIN categories c ON c.id = b.category_id
       JOIN users u ON u.id = b.created_by
       WHERE b.id = ? AND b.project_id = ?`,
    )
    .get(barcodeId, projectId) as
    | (Record<string, unknown> & {
        id: string;
        barcode: string;
        location_no: string;
        host_ip: string | null;
        host_account: string | null;
        host_password: string | null;
        device_ip: string | null;
        priority: string;
        category_id: string | null;
        category_name: string | null;
        category_color: string | null;
        remark: string | null;
        tracking_groups: string;
        creator_name: string;
        created_at: string;
        updated_at: string;
      })
    | undefined;
  if (!barcode) throw new AppError(404, "条码不存在");

  const issueRows = db
    .prepare(
      `SELECT i.*, s.name AS status_name, s.color AS status_color, s.requires_reason, s.counts_pending,
              s.is_identified, u.name AS creator_name
       FROM issues i
       JOIN statuses s ON s.id = i.status_id
       JOIN users u ON u.id = i.created_by
       WHERE i.barcode_id = ? ORDER BY i.created_at, i.id`,
    )
    .all(barcodeId) as {
    id: string;
    error_item: string;
    status_id: string;
    status_name: string;
    status_color: string;
    requires_reason: number;
    counts_pending: number;
    is_identified: number;
    created_at: string;
    updated_at: string;
    creator_name: string;
  }[];
  const issueIds = issueRows.map((row) => row.id);
  const contexts = loadIssueContexts(issueIds);

  const groups = db
    .prepare(
      `SELECT ig.issue_id, ig.group_id, ig.pinned_user_id, g.name AS group_name,
              h.user_id, h.is_primary, u.name AS user_name, u.employee_no
       FROM issues i
       JOIN issue_groups ig ON ig.issue_id = i.id
       JOIN groups g ON g.id = ig.group_id
       LEFT JOIN issue_group_handlers h ON h.issue_group_id = ig.id
       LEFT JOIN users u ON u.id = h.user_id
       WHERE i.barcode_id = ?
       ORDER BY g.name, h.is_primary DESC, u.name`,
    )
    .all(barcodeId) as {
    issue_id: string;
    group_id: string;
    pinned_user_id: string | null;
    group_name: string;
    user_id: string | null;
    is_primary: number | null;
    user_name: string | null;
    employee_no: string | null;
  }[];
  const groupsByIssue = new Map<string, DetailGroup[]>();
  const groupIndex = new Map<string, DetailGroup>();
  for (const row of groups) {
    const key = `${row.issue_id}:${row.group_id}`;
    let group = groupIndex.get(key);
    if (!group) {
      group = {
        groupId: row.group_id,
        groupName: row.group_name,
        pinnedUserId: row.pinned_user_id,
        handlers: [],
      };
      groupIndex.set(key, group);
      const list = groupsByIssue.get(row.issue_id) || [];
      list.push(group);
      groupsByIssue.set(row.issue_id, list);
    }
    if (row.user_id && row.user_name) {
      group.handlers.push({
        id: row.user_id,
        name: row.user_name,
        employeeNo: row.employee_no || "",
        isPrimary: row.is_primary === 1,
      });
    }
  }

  const statusHistoryRows = db
    .prepare(
      `SELECT h.id, h.issue_id, h.reason_html, h.created_at, u.name AS operator,
              old_s.name AS old_status, new_s.name AS new_status, new_s.color AS new_status_color
       FROM status_history h
       JOIN users u ON u.id = h.operator_id
       LEFT JOIN statuses old_s ON old_s.id = h.old_status_id
       JOIN statuses new_s ON new_s.id = h.new_status_id
       WHERE h.issue_id IN (${issueIds.map(() => "?").join(",") || "''"})
       ORDER BY h.created_at, h.id`,
    )
    .all(...(issueIds.length ? issueIds : [""])) as {
    id: string;
    issue_id: string;
    reason_html: string;
    created_at: string;
    operator: string;
    old_status: string | null;
    new_status: string;
    new_status_color: string;
  }[];
  const statusHistoryByIssue = new Map<string, StatusHistoryView[]>();
  for (const row of statusHistoryRows) {
    const list = statusHistoryByIssue.get(row.issue_id) || [];
    list.push({
      id: row.id,
      oldStatus: row.old_status || "—",
      newStatus: row.new_status,
      newStatusColor: row.new_status_color,
      reasonHtml: row.reason_html,
      operator: row.operator,
      createdAt: row.created_at,
    });
    statusHistoryByIssue.set(row.issue_id, list);
  }

  const assignmentRows = db
    .prepare(
      `SELECT h.*, u.name AS operator_name
       FROM assignment_history h LEFT JOIN users u ON u.id = h.operator_id
       WHERE h.issue_id IN (${issueIds.map(() => "?").join(",") || "''"})
       ORDER BY h.created_at, h.id`,
    )
    .all(...(issueIds.length ? issueIds : [""])) as {
    id: string;
    issue_id: string;
    change_type: string;
    operator_name: string | null;
    from_group_ids: string;
    to_group_ids: string;
    retained_group_ids: string;
    from_handler_ids: string;
    to_handler_ids: string;
    reason_html: string;
    meta: string;
    created_at: string;
  }[];
  const assignmentByIssue = new Map<string, AssignmentHistoryView[]>();
  const nameCache = new Map<string, string>();
  const lookupNames = (ids: string[], kind: "group" | "user"): string[] => {
    return ids.map((id) => {
      const key = `${kind}:${id}`;
      if (nameCache.has(key)) return nameCache.get(key) || id;
      const row =
        kind === "group"
          ? (db.prepare("SELECT name FROM groups WHERE id = ?").get(id) as { name: string } | undefined)
          : (db.prepare("SELECT name FROM users WHERE id = ?").get(id) as { name: string } | undefined);
      const name = row?.name || id;
      nameCache.set(key, name);
      return name;
    });
  };
  for (const row of assignmentRows) {
    let meta: Record<string, unknown> = {};
    try {
      meta = JSON.parse(row.meta) as Record<string, unknown>;
    } catch {
      meta = {};
    }
    const fromGroupNames = Array.isArray(meta.fromGroupNames) ? (meta.fromGroupNames as string[]) : lookupNames(parseJsonArray(row.from_group_ids), "group");
    const toGroupNames = Array.isArray(meta.toGroupNames) ? (meta.toGroupNames as string[]) : lookupNames(parseJsonArray(row.to_group_ids), "group");
    const retainedNames = Array.isArray(meta.retainedGroupNames)
      ? (meta.retainedGroupNames as string[])
      : lookupNames(parseJsonArray(row.retained_group_ids), "group");
    const fromHandlerNames = Array.isArray(meta.fromHandlerNames)
      ? (meta.fromHandlerNames as string[])
      : lookupNames(parseJsonArray(row.from_handler_ids), "user");
    const toHandlerNames = Array.isArray(meta.toHandlerNames)
      ? (meta.toHandlerNames as string[])
      : lookupNames(parseJsonArray(row.to_handler_ids), "user");
    const anomalies = Array.isArray(meta.anomalies) ? (meta.anomalies as string[]) : [];
    const list = assignmentByIssue.get(row.issue_id) || [];
    list.push({
      id: row.id,
      changeType: row.change_type,
      changeTypeLabel: CHANGE_TYPE_LABELS[row.change_type] || row.change_type,
      operator: row.operator_name,
      fromGroups: fromGroupNames,
      toGroups: toGroupNames,
      retainedGroups: retainedNames,
      fromHandlers: fromHandlerNames,
      toHandlers: toHandlerNames,
      reasonHtml: row.reason_html,
      createdAt: row.created_at,
      anomalies,
    });
    assignmentByIssue.set(row.issue_id, list);
  }

  const issues: BarcodeIssueDetail[] = issueRows.map((row) => {
    const context = contexts.get(row.id);
    return {
      id: row.id,
      errorItem: row.error_item,
      status: {
        id: row.status_id,
        name: row.status_name,
        color: row.status_color,
        requiresReason: row.requires_reason === 1,
        countsPending: row.counts_pending === 1,
        isIdentified: row.is_identified === 1,
      },
      groups: groupsByIssue.get(row.id) || [],
      creator: row.creator_name,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      statusHistory: statusHistoryByIssue.get(row.id) || [],
      assignmentHistory: assignmentByIssue.get(row.id) || [],
      permissions: context
        ? permissionsForIssue(context, access, userId)
        : {
            canUpdateStatus: false,
            canEditContent: false,
            canTransfer: false,
            canIntraTransferGroupIds: [],
            canCrossTransfer: false,
            canForceTransfer: false,
          },
    };
  });

  const contextsForBarcode = issueIds.map((id) => contexts.get(id)).filter((context): context is IssueContext => Boolean(context));
  return {
    id: barcode.id,
    barcode: barcode.barcode,
    locationNo: barcode.location_no,
    hostIp: barcode.host_ip,
    hostAccount: barcode.host_account,
    hostPassword: barcode.host_password,
    deviceIp: barcode.device_ip,
    priority: barcode.priority,
    priorityLabel: PRIORITY_LABELS[barcode.priority as Priority] || barcode.priority,
    category: barcode.category_id
      ? { id: barcode.category_id, name: barcode.category_name || "", color: barcode.category_color || "#64748b" }
      : null,
    remark: barcode.remark,
    trackingGroups: parseJsonArray(barcode.tracking_groups),
    creator: barcode.creator_name,
    createdAt: barcode.created_at,
    updatedAt: barcode.updated_at,
    issues,
    permissions: permissionsForBarcode(contextsForBarcode, access, userId),
  };
}

export function listBarcodes(
  projectId: string,
  userId: string,
  filters: BarcodeListFilters = {},
): { rows: BarcodeListRow[]; total: number; page: number; pageSize: number; pageCount: number } {
  const access = requireProjectAccess(userId, projectId);
  const db = getDb();
  const page = Math.max(1, Math.floor(filters.page || 1));
  const allowedSizes = [10, 20, 50, 100];
  const pageSize = allowedSizes.includes(Number(filters.pageSize)) ? Number(filters.pageSize) : 20;

  const conditions = ["b.project_id = ?"];
  const params: (string | number)[] = [projectId];
  if (filters.search?.trim()) {
    conditions.push("(b.barcode LIKE ? OR b.location_no LIKE ? OR b.host_ip LIKE ? OR b.device_ip LIKE ?)");
    const search = `%${filters.search.trim()}%`;
    params.push(search, search, search, search);
  }
  if (filters.groupId) {
    conditions.push(
      "EXISTS (SELECT 1 FROM issues i2 JOIN issue_groups ig2 ON ig2.issue_id = i2.id WHERE i2.barcode_id = b.id AND ig2.group_id = ?)",
    );
    params.push(filters.groupId);
  }
  if (filters.statusId) {
    conditions.push("EXISTS (SELECT 1 FROM issues i3 WHERE i3.barcode_id = b.id AND i3.status_id = ?)");
    params.push(filters.statusId);
  }
  if (filters.categoryId) {
    conditions.push("b.category_id = ?");
    params.push(filters.categoryId);
  }
  if (filters.priority && PRIORITIES.includes(filters.priority as Priority)) {
    conditions.push("b.priority = ?");
    params.push(filters.priority);
  }
  const where = conditions.join(" AND ");
  const total = (db.prepare(`SELECT COUNT(*) AS count FROM barcodes b WHERE ${where}`).get(...params) as { count: number }).count;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, pageCount);
  const offset = (safePage - 1) * pageSize;

  const rows = db
    .prepare(
      `SELECT b.*, c.name AS category_name, c.color AS category_color, u.name AS creator_name,
              (SELECT COUNT(*) FROM issues i WHERE i.barcode_id = b.id) AS issue_count
       FROM barcodes b
       LEFT JOIN categories c ON c.id = b.category_id
       JOIN users u ON u.id = b.created_by
       WHERE ${where}
       ORDER BY b.updated_at DESC, b.id DESC
       LIMIT ? OFFSET ?`,
    )
    .all(...params, pageSize, offset) as (Record<string, unknown> & BarcodeRow)[];

  if (rows.length === 0) {
    return { rows: [], total, page: safePage, pageSize, pageCount };
  }
  const barcodeIds = rows.map((row) => row.id);
  const placeholders = barcodeIds.map(() => "?").join(",");
  const issueRows = db
    .prepare(
      `SELECT i.id, i.barcode_id, i.status_id, s.name AS status_name, s.color AS status_color, s.is_identified
       FROM issues i JOIN statuses s ON s.id = i.status_id
       WHERE i.barcode_id IN (${placeholders})
       ORDER BY i.created_at`,
    )
    .all(...barcodeIds) as {
    id: string;
    barcode_id: string;
    status_id: string;
    status_name: string;
    status_color: string;
    is_identified: number;
  }[];
  const groupRows = db
    .prepare(
      `SELECT i.barcode_id, ig.issue_id, ig.group_id, g.name AS group_name, h.user_id, h.is_primary, u.name AS user_name
       FROM issues i
       JOIN issue_groups ig ON ig.issue_id = i.id
       JOIN groups g ON g.id = ig.group_id
       LEFT JOIN issue_group_handlers h ON h.issue_group_id = ig.id
       LEFT JOIN users u ON u.id = h.user_id
       WHERE i.barcode_id IN (${placeholders})
       ORDER BY g.name, h.is_primary DESC, u.name`,
    )
    .all(...barcodeIds) as {
    barcode_id: string;
    issue_id: string;
    group_id: string;
    group_name: string;
    user_id: string | null;
    is_primary: number | null;
    user_name: string | null;
  }[];
  const issueIds = issueRows.map((row) => row.id);
  const contexts = loadIssueContexts(issueIds);
  const statusesByBarcode = new Map<string, Map<string, { id: string; name: string; color: string; is_identified: number }>>();
  for (const issue of issueRows) {
    const map = statusesByBarcode.get(issue.barcode_id) || new Map();
    map.set(issue.status_id, {
      id: issue.status_id,
      name: issue.status_name,
      color: issue.status_color,
      is_identified: issue.is_identified,
    });
    statusesByBarcode.set(issue.barcode_id, map);
  }
  const groupsByBarcode = new Map<string, Map<string, ListGroupAggregate>>();
  const issueToBarcode = new Map(issueRows.map((issue) => [issue.id, issue.barcode_id]));
  for (const row of groupRows) {
    const barcodeId = issueToBarcode.get(row.issue_id);
    if (!barcodeId) continue;
    const barcodeMap = groupsByBarcode.get(barcodeId) || new Map<string, ListGroupAggregate>();
    let group = barcodeMap.get(row.group_id);
    if (!group) {
      group = { id: row.group_id, name: row.group_name, handlers: [], handlerSet: new Set() };
      barcodeMap.set(row.group_id, group);
      groupsByBarcode.set(barcodeId, barcodeMap);
    }
    if (row.user_id && row.user_name && !group.handlerSet.has(row.user_id)) {
      group.handlerSet.add(row.user_id);
      group.handlers.push({ id: row.user_id, name: row.user_name, isPrimary: row.is_primary === 1 });
    }
    if (row.user_id && row.is_primary === 1) {
      const existing = group.handlers.find((h) => h.id === row.user_id);
      if (existing) existing.isPrimary = true;
    }
  }

  const output = rows.map((row) => {
    const barcodeIssues = issueRows.filter((issue) => issue.barcode_id === row.id);
    const contextsForBarcode = barcodeIssues
      .map((issue) => contexts.get(issue.id))
      .filter((context): context is IssueContext => Boolean(context));
    const permissions = permissionsForBarcode(contextsForBarcode, access, userId);
    return {
      ...row,
      priority_label: PRIORITY_LABELS[row.priority as Priority] || row.priority,
      statuses: [...(statusesByBarcode.get(row.id)?.values() || [])],
      groups: [...(groupsByBarcode.get(row.id)?.values() || [])].map((group) => ({
        id: group.id,
        name: group.name,
        handlers: group.handlers,
      })),
      permissions: {
        canUpdateAllStatuses: permissions.canUpdateAllStatuses,
        canTransferAll: permissions.canTransferAll,
        canDelete: permissions.canDelete,
      },
    };
  });
  return { rows: output, total, page: safePage, pageSize, pageCount };
}

export function getMyPendingByProject(userId: string): Map<string, number> {
  const rows = getDb()
    .prepare(
      `SELECT p.id AS project_id, COUNT(DISTINCT i.id) AS count
       FROM projects p
       JOIN project_members pm ON pm.project_id = p.id
       JOIN barcodes b ON b.project_id = p.id
       JOIN issues i ON i.barcode_id = b.id
       JOIN issue_groups ig ON ig.issue_id = i.id
       JOIN issue_group_handlers h ON h.issue_group_id = ig.id AND h.user_id = ? AND h.is_primary = 1
       JOIN statuses s ON s.id = i.status_id AND s.counts_pending = 1
       WHERE pm.user_id = ?
       GROUP BY p.id`,
    )
    .all(userId, userId) as { project_id: string; count: number }[];
  return new Map(rows.map((row) => [row.project_id, row.count]));
}

export function getMyPendingInProject(userId: string, projectId: string): number {
  const row = getDb()
    .prepare(
      `SELECT COUNT(DISTINCT i.id) AS count
       FROM project_members pm
       JOIN barcodes b ON b.project_id = pm.project_id
       JOIN issues i ON i.barcode_id = b.id
       JOIN issue_groups ig ON ig.issue_id = i.id
       JOIN issue_group_handlers h ON h.issue_group_id = ig.id
       JOIN statuses s ON s.id = i.status_id
       WHERE pm.user_id = ? AND pm.project_id = ? AND h.user_id = ? AND h.is_primary = 1 AND s.counts_pending = 1`,
    )
    .get(userId, projectId, userId) as { count: number };
  return row.count;
}

export function issuePriorityLabel(priority: string): string {
  return PRIORITY_LABELS[priority as Priority] || priority;
}

export function assertStatusBelongsToProject(projectId: string, statusId: string): ProjectStatus {
  const row = getDb().prepare("SELECT * FROM statuses WHERE id = ? AND project_id = ?").get(statusId, projectId) as
    | ProjectStatus
    | undefined;
  if (!row) throw new AppError(400, "状态不存在");
  return row;
}

export function requireReasonIfNeeded(status: ProjectStatus, reasonHtml: string): void {
  const clean = sanitizeRichText(reasonHtml);
  if (status.requires_reason === 1 && !richTextToPlain(clean)) {
    throw new AppError(400, `状态「${status.name}」必须填写定位原因`);
  }
}

export function getGroupMemberRefs(groupIds: string[]): Record<string, { id: string; name: string; employeeNo: string; isLeader: boolean }[]> {
  if (groupIds.length === 0) return {};
  const placeholders = groupIds.map(() => "?").join(",");
  const rows = getDb()
    .prepare(
      `SELECT gm.group_id, u.id, u.name, u.employee_no, gm.is_leader
       FROM group_members gm JOIN users u ON u.id = gm.user_id
       WHERE gm.group_id IN (${placeholders}) ORDER BY gm.is_leader DESC, u.name`,
    )
    .all(...groupIds) as { group_id: string; id: string; name: string; employee_no: string; is_leader: number }[];
  const result: Record<string, { id: string; name: string; employeeNo: string; isLeader: boolean }[]> = {};
  for (const groupId of groupIds) result[groupId] = [];
  for (const row of rows) {
    result[row.group_id]?.push({ id: row.id, name: row.name, employeeNo: row.employee_no, isLeader: row.is_leader === 1 });
  }
  return result;
}

export function getIssueProjectAndBarcode(issueId: string): { projectId: string; barcodeId: string } | null {
  const row = getDb().prepare("SELECT project_id, barcode_id FROM issues WHERE id = ?").get(issueId) as
    | { project_id: string; barcode_id: string }
    | undefined;
  return row ? { projectId: row.project_id, barcodeId: row.barcode_id } : null;
}

export function getProjectIssueCount(projectId: string): number {
  const row = getDb().prepare("SELECT COUNT(*) AS count FROM issues WHERE project_id = ?").get(projectId) as { count: number };
  return row.count;
}

export function getBarcodeReadableLabel(barcodeId: string): string {
  const row = getDb().prepare("SELECT barcode FROM barcodes WHERE id = ?").get(barcodeId) as { barcode: string } | undefined;
  return row?.barcode || barcodeId;
}

export { resolveGroupAt, setIssueGroupHandlers, getPendingCount };