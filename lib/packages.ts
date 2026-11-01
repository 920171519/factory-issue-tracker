import { getDb } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { newId } from "@/lib/ids";
import { getProjectAccess, requireProjectManager, requireProjectAccess, type ProjectAccess } from "@/lib/access";
import { nowIso, todayLocal } from "@/lib/time";

/* ------------------------------------------------------------------ *
 * 软件包版本流转领域服务：转测试 → 测试结论 → 转验证 → 验证结论 → 转正
 *
 * 关键概念：
 *  - 软件包（code_list）：编码即包名，version 为正式服务器上的正式版本；
 *    test_version / verification_version 为最近一次转测 / 转验证的版本。
 *  - 转测试申请（package_requests.kind=TEST）：责任组成员提交，等待负责人统一组织。
 *  - 转测试批次（package_batches.kind=TEST）：组织时生成「全量配套表」快照，
 *    转测包取申请版本，其余包取正式版本；并标注相较正式版本、相较上一批转测版本是否更新。
 *  - 测试结论（package_batch_items.conclusion）：测试责任组成员逐包给出。
 *  - 转验证申请/批次（kind=VERIFY）：测试通过的包由提交人申请，负责人组织；
 *    每个包可绑定多个验证条码，给出验证结论。
 *  - 转正：验证通过后可转为正式版本，正式版本号随之更新并保留全过程历史。
 * ------------------------------------------------------------------ */

export type PackageKind = "TEST" | "VERIFY";
export type Conclusion = "PENDING" | "PASS" | "FAIL" | "CONDITIONAL";
export type PackageStatus =
  | "OFFICIAL"
  | "TEST_PENDING"
  | "IN_TEST"
  | "TEST_PASSED"
  | "VERIFY_PENDING"
  | "IN_VERIFY"
  | "READY";

export const STATUS_LABELS: Record<PackageStatus, string> = {
  OFFICIAL: "正式",
  TEST_PENDING: "待组织转测",
  IN_TEST: "测试中",
  TEST_PASSED: "待提交转验证",
  VERIFY_PENDING: "待处理验证",
  IN_VERIFY: "验证中",
  READY: "可转正",
};

export const CONCLUSION_LABELS: Record<Conclusion, string> = {
  PENDING: "待结论",
  PASS: "通过",
  FAIL: "不通过",
  CONDITIONAL: "有条件通过",
};

interface CodeRow {
  id: string;
  code: string;
  description: string | null;
  version: string | null;
  groupId: string | null;
  groupName: string | null;
  ownerId: string | null;
  ownerName: string | null;
  nodeId: string | null;
  nodeName: string | null;
  usageNote: string | null;
  testVersion: string | null;
  verificationVersion: string | null;
  updatedAt: string;
}

interface ItemRow {
  id: string;
  batch_id: string;
  package_id: string;
  package_code: string;
  package_name: string | null;
  group_id: string | null;
  group_name: string | null;
  owner_name: string | null;
  official_version: string | null;
  version: string | null;
  updated_vs_official: number;
  updated_vs_previous: number;
  previous_version: string | null;
  request_id: string | null;
  change_summary: string;
  package_url: string | null;
  submitted_by: string | null;
  submitted_by_name: string | null;
  conclusion: Conclusion;
  conclusion_note: string;
  concluded_by: string | null;
  concluded_by_name: string | null;
  concluded_at: string | null;
  barcodes: string;
  promoted: number;
  promoted_at: string | null;
  promoted_by: string | null;
  promoted_by_name: string | null;
  created_at: string;
  request_submitted_at?: string | null;
  batch_code?: string;
  batch_kind?: PackageKind;
  batch_created_at?: string;
}

export interface PackageOverview {
  id: string;
  code: string;
  name: string;
  groupId: string | null;
  groupName: string | null;
  ownerId: string | null;
  ownerName: string | null;
  nodeId: string | null;
  nodeName: string | null;
  usageNote: string | null;
  officialVersion: string | null;
  testVersion: string | null;
  verificationVersion: string | null;
  status: PackageStatus;
  statusLabel: string;
  lastTestConclusion: Conclusion | null;
  lastTestBatchCode: string | null;
  lastVerifyConclusion: Conclusion | null;
  lastVerifyProcessUrl: string | null;
  updatedAt: string;
}

export interface RequestView {
  id: string;
  kind: PackageKind;
  packageId: string;
  packageCode: string;
  packageName: string;
  groupName: string | null;
  version: string;
  changeSummary: string;
  packageUrl: string | null;
  sourceItemId: string | null;
  submittedBy: string;
  submittedByName: string;
  submittedAt: string;
  status: string;
}

export interface BatchItemView {
  id: string;
  packageId: string;
  packageCode: string;
  packageName: string | null;
  groupId: string | null;
  groupName: string | null;
  ownerName: string | null;
  officialVersion: string | null;
  version: string | null;
  updatedVsOfficial: boolean;
  updatedVsPrevious: boolean;
  previousVersion: string | null;
  isTransferred: boolean;
  changeSummary: string;
  packageUrl: string | null;
  submittedById: string | null;
  submittedByName: string | null;
  submittedAt: string | null;
  conclusion: Conclusion;
  conclusionNote: string;
  concludedByName: string | null;
  concludedAt: string | null;
  barcodes: string[];
  promoted: boolean;
  promotedAt: string | null;
  promotedByName: string | null;
}

export interface BatchView {
  id: string;
  kind: PackageKind;
  seq: number;
  code: string;
  title: string;
  scheduledDate: string | null;
  note: string;
  createdBy: string;
  createdByName: string;
  createdAt: string;
  status: "OPEN" | "DONE";
  transferredCount: number;
  summary: { pending: number; pass: number; fail: number; conditional: number };
  items: BatchItemView[];
}

/** 转测后尚未出结论的配套包（跨批次，用于「在测跟踪」）。 */
export interface OpenTestItem {
  id: string;
  batchId: string;
  batchCode: string;
  batchTitle: string;
  scheduledDate: string | null;
  batchCreatedAt: string;
  packageId: string;
  packageCode: string;
  packageName: string | null;
  groupName: string | null;
  version: string | null;
  officialVersion: string | null;
  updatedVsOfficial: boolean;
  updatedVsPrevious: boolean;
  previousVersion: string | null;
  submittedById: string | null;
  submittedByName: string | null;
  submittedAt: string | null;
  conclusion: Conclusion;
}

/** 逐包转验证记录（转验证不再有批次，由软件经理逐包处理）。 */
export interface VerificationView {
  id: string;
  requestId: string | null;
  packageId: string;
  packageCode: string;
  packageName: string | null;
  groupId: string | null;
  groupName: string | null;
  version: string | null;
  officialVersion: string | null;
  processUrl: string | null;
  barcodes: string[];
  conclusion: Conclusion;
  conclusionNote: string;
  concludedByName: string | null;
  concludedAt: string | null;
  promoted: boolean;
  promotedAt: string | null;
  promotedByName: string | null;
  handledByName: string | null;
  handledAt: string | null;
  submittedByName: string | null;
  submittedAt: string | null;
  createdAt: string;
}

/** 验证条码台账：按条码查看所属软件包与验证结论。 */
export interface BarcodeEntry {
  barcode: string;
  packageId: string;
  packageCode: string;
  packageName: string | null;
  groupName: string | null;
  version: string | null;
  processUrl: string | null;
  verificationId: string;
  conclusion: Conclusion;
  concludedAt: string | null;
  promoted: boolean;
  promotedAt: string | null;
}

export interface PackagePermissions {
  isPm: boolean;
  isSupervisor: boolean;
  isSoftwareManager: boolean;
  isTester: boolean;
  testerGroupLeader: boolean;
  canManage: boolean;
  canOrganize: boolean;
  canConclude: boolean;
  canPromote: boolean;
  /** 软件经理/PM/主管逐包处理转验证申请（填写电子流程链接与条码）。 */
  canHandleVerification: boolean;
  /** PM / 主管 / 软件经理可以为任意责任组的软件包提交申请。 */
  canSubmitAny: boolean;
  groupIds: string[];
}

export interface PackagesPayload {
  packages: PackageOverview[];
  groups: { id: string; name: string; enabled: boolean }[];
  members: { id: string; name: string; employeeNo: string }[];
  testerGroup: { id: string; name: string } | null;
  permissions: PackagePermissions;
  pendingTestRequests: RequestView[];
  pendingVerifyRequests: RequestView[];
  testBatches: BatchView[];
  verifications: VerificationView[];
  promoteCandidates: VerificationView[];
  verifyRequestCandidates: BatchItemView[];
  openTestItems: OpenTestItem[];
  barcodeLedger: BarcodeEntry[];
  nodes: { id: string; name: string }[];
  stats: {
    total: number;
    official: number;
    inTest: number;
    inVerify: number;
    ready: number;
    pendingTest: number;
    pendingVerify: number;
    openTest: number;
  };
}

function parseBarcodes(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === "string") : [];
  } catch {
    return [];
  }
}

function normalizeVersion(value: string): string {
  const version = value.trim();
  if (!version) throw new AppError(400, "请填写版本号");
  if (version.length > 50) throw new AppError(400, "版本号过长");
  return version;
}

function normalizeUrl(value: string | undefined | null): string | null {
  const url = (value || "").trim();
  if (!url) return null;
  if (url.length > 500) throw new AppError(400, "链接过长");
  return url;
}

function tail(value: string, length = 500): string {
  const text = value.trim();
  if (text.length > length) throw new AppError(400, "内容过长");
  return text;
}

/* ----------------------------- 权限 ----------------------------- */

export function getTesterGroup(projectId: string): { id: string; name: string } | null {
  const row = getDb()
    .prepare(
      `SELECT g.id, g.name FROM projects p JOIN groups g ON g.id = p.tester_group_id
       WHERE p.id = ? AND g.project_id = ? AND g.enabled = 1`,
    )
    .get(projectId, projectId) as { id: string; name: string } | undefined;
  return row || null;
}

function groupLeaderIds(projectId: string, userId: string): string[] {
  return (
    getDb()
      .prepare(
        `SELECT gm.group_id AS groupId FROM group_members gm JOIN groups g ON g.id = gm.group_id
         WHERE g.project_id = ? AND gm.user_id = ? AND gm.is_leader = 1`,
      )
      .all(projectId, userId) as { groupId: string }[]
  ).map((row) => row.groupId);
}

function isTesterGroupMember(projectId: string, userId: string): boolean {
  const tester = getTesterGroup(projectId);
  if (!tester) return false;
  return Boolean(
    getDb().prepare("SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?").get(tester.id, userId),
  );
}

export function permissionsFor(projectId: string, userId: string): PackagePermissions {
  const access = requireProjectAccess(userId, projectId);
  const tester = getTesterGroup(projectId);
  const leaders = groupLeaderIds(projectId, userId);
  const isTester = isTesterGroupMember(projectId, userId);
  const testerGroupLeader = Boolean(tester && leaders.includes(tester.id));
  const canSubmitAny = access.isPm || access.isSupervisor || access.isSoftwareManager;
  return {
    isPm: access.isPm,
    isSupervisor: access.isSupervisor,
    isSoftwareManager: access.isSoftwareManager,
    isTester,
    testerGroupLeader,
    canManage: access.isPm,
    canOrganize: access.isPm || access.isSupervisor || access.isSoftwareManager,
    canConclude: isTester || access.isPm || access.isSupervisor,
    canPromote: access.isPm || access.isSupervisor,
    canHandleVerification: access.isPm || access.isSupervisor || access.isSoftwareManager,
    canSubmitAny,
    groupIds: access.groupIds,
  };
}

function requireOrganize(projectId: string, userId: string): PackagePermissions {
  const permissions = permissionsFor(projectId, userId);
  if (!permissions.canOrganize) throw new AppError(403, "仅软件经理、项目 PM 或项目主管可组织转测试/转验证批次");
  return permissions;
}

function requireConclude(projectId: string, userId: string): PackagePermissions {
  const permissions = permissionsFor(projectId, userId);
  if (!permissions.canConclude) throw new AppError(403, "仅测试责任组成员、项目 PM 或项目主管可填写测试/验证结论");
  return permissions;
}

function requirePromote(projectId: string, userId: string): PackagePermissions {
  const permissions = permissionsFor(projectId, userId);
  if (!permissions.canPromote) throw new AppError(403, "仅项目 PM 或项目主管可执行转正");
  return permissions;
}

function assertCanSubmitForPackage(access: ProjectAccess, packageGroupId: string | null): void {
  if (access.isPm || access.isSupervisor || access.isSoftwareManager) return;
  if (!packageGroupId) throw new AppError(400, "该软件包尚未指定责任组，请联系项目 PM 补充");
  if (!access.groupIds.includes(packageGroupId)) {
    throw new AppError(403, "只能选择自己责任组内的软件包");
  }
}

/* ----------------------------- 软件包 ----------------------------- */

function listCodeRows(projectId: string): CodeRow[] {
  return getDb()
    .prepare(
      `SELECT c.id, c.code, c.description, c.version, c.group_id AS groupId, g.name AS groupName,
              c.owner_id AS ownerId, u.name AS ownerName, c.node_id AS nodeId, cat.name AS nodeName,
              c.usage_note AS usageNote, c.test_version AS testVersion,
              c.verification_version AS verificationVersion, c.updated_at AS updatedAt
       FROM code_list c
       LEFT JOIN groups g ON g.id = c.group_id
       LEFT JOIN users u ON u.id = c.owner_id
       LEFT JOIN categories cat ON cat.id = c.node_id
       WHERE c.project_id = ?
       ORDER BY c.code`,
    )
    .all(projectId) as CodeRow[];
}

export function countPackages(projectId: string): number {
  const row = getDb().prepare("SELECT COUNT(*) AS count FROM code_list WHERE project_id = ?").get(projectId) as { count: number };
  return row.count;
}

/** 问题跟踪页用：按归属节点关联软件包，便于从节点问题反查该节点使用的软件包。 */
export function listPackageNodeRefs(projectId: string): { id: string; code: string; name: string; nodeId: string | null }[] {
  return getDb()
    .prepare(
      `SELECT id, code, COALESCE(description, code) AS name, node_id AS nodeId
       FROM code_list WHERE project_id = ? ORDER BY code`,
    )
    .all(projectId) as { id: string; code: string; name: string; nodeId: string | null }[];
}

export function createPackage(
  projectId: string,
  userId: string,
  input: {
    code: string;
    description?: string;
    version?: string;
    ownerId?: string | null;
    groupId?: string | null;
    nodeId?: string | null;
    usageNote?: string | null;
  },
): { id: string } {
  requireProjectManager(userId, projectId);
  const db = getDb();
  const code = input.code.trim();
  if (!code) throw new AppError(400, "请填写软件包编码（包名）");
  if (code.length > 80) throw new AppError(400, "编码过长");
  if (db.prepare("SELECT 1 FROM code_list WHERE project_id = ? AND code = ?").get(projectId, code)) {
    throw new AppError(409, "该编码已存在");
  }
  if (input.ownerId) {
    const member = db.prepare("SELECT 1 FROM project_members WHERE project_id = ? AND user_id = ?").get(projectId, input.ownerId);
    if (!member) throw new AppError(400, "责任人必须是项目成员");
  }
  if (input.groupId) {
    const group = db.prepare("SELECT 1 FROM groups WHERE id = ? AND project_id = ?").get(input.groupId, projectId);
    if (!group) throw new AppError(400, "责任组不存在");
  }
  if (input.nodeId) {
    const node = db.prepare("SELECT 1 FROM categories WHERE id = ? AND project_id = ?").get(input.nodeId, projectId);
    if (!node) throw new AppError(400, "归属节点不存在");
  }
  const id = newId("cod");
  db.prepare(
    `INSERT INTO code_list (id, project_id, code, description, version, owner_id, group_id, node_id, usage_note, test_version, verification_version, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?)`,
  ).run(
    id,
    projectId,
    code,
    input.description?.trim() || null,
    input.version?.trim() || null,
    input.ownerId || null,
    input.groupId || null,
    input.nodeId || null,
    input.usageNote?.trim() || null,
    nowIso(),
  );
  return { id };
}

export function updatePackage(
  projectId: string,
  packageId: string,
  userId: string,
  input: {
    code?: string;
    description?: string | null;
    version?: string | null;
    ownerId?: string | null;
    groupId?: string | null;
    nodeId?: string | null;
    usageNote?: string | null;
  },
): void {
  requireProjectManager(userId, projectId);
  const db = getDb();
  const current = db
    .prepare(
      `SELECT code, description, version, owner_id AS ownerId, group_id AS groupId, node_id AS nodeId, usage_note AS usageNote
       FROM code_list WHERE id = ? AND project_id = ?`,
    )
    .get(packageId, projectId) as
    | { code: string; description: string | null; version: string | null; ownerId: string | null; groupId: string | null; nodeId: string | null; usageNote: string | null }
    | undefined;
  if (!current) throw new AppError(404, "软件包不存在");
  const code = input.code === undefined ? current.code : input.code.trim();
  if (!code) throw new AppError(400, "编码不能为空");
  const duplicate = db
    .prepare("SELECT 1 FROM code_list WHERE project_id = ? AND code = ? AND id <> ?")
    .get(projectId, code, packageId);
  if (duplicate) throw new AppError(409, "该编码已存在");
  if (input.ownerId) {
    const member = db.prepare("SELECT 1 FROM project_members WHERE project_id = ? AND user_id = ?").get(projectId, input.ownerId);
    if (!member) throw new AppError(400, "责任人必须是项目成员");
  }
  if (input.groupId) {
    const group = db.prepare("SELECT 1 FROM groups WHERE id = ? AND project_id = ?").get(input.groupId, projectId);
    if (!group) throw new AppError(400, "责任组不存在");
  }
  if (input.nodeId) {
    const node = db.prepare("SELECT 1 FROM categories WHERE id = ? AND project_id = ?").get(input.nodeId, projectId);
    if (!node) throw new AppError(400, "归属节点不存在");
  }
  db.prepare(
    `UPDATE code_list SET code = ?, description = ?, version = ?, owner_id = ?, group_id = ?, node_id = ?, usage_note = ?, updated_at = ?
     WHERE id = ?`,
  ).run(
    code,
    input.description === undefined ? current.description : input.description?.trim() || null,
    input.version === undefined ? current.version : input.version?.trim() || null,
    input.ownerId === undefined ? current.ownerId : input.ownerId,
    input.groupId === undefined ? current.groupId : input.groupId,
    input.nodeId === undefined ? current.nodeId : input.nodeId,
    input.usageNote === undefined ? current.usageNote : input.usageNote?.trim() || null,
    nowIso(),
    packageId,
  );
}

export function deletePackage(projectId: string, packageId: string, userId: string): void {
  requireProjectManager(userId, projectId);
  const db = getDb();
  const used = db
    .prepare(
      `SELECT (SELECT COUNT(*) FROM package_batch_items i JOIN package_batches b ON b.id = i.batch_id WHERE i.package_id = ?) AS items,
              (SELECT COUNT(*) FROM package_requests r WHERE r.package_id = ?) AS requests`,
    )
    .get(packageId, packageId) as { items: number; requests: number };
  if (used.items > 0 || used.requests > 0) throw new AppError(409, "该软件包已有转测/验证记录，不能删除");
  const result = db.prepare("DELETE FROM code_list WHERE id = ? AND project_id = ?").run(packageId, projectId);
  if (result.changes === 0) throw new AppError(404, "软件包不存在");
}

export function setTesterGroup(projectId: string, userId: string, groupId: string | null): void {
  requireProjectManager(userId, projectId);
  const db = getDb();
  if (groupId) {
    const group = db.prepare("SELECT 1 FROM groups WHERE id = ? AND project_id = ?").get(groupId, projectId);
    if (!group) throw new AppError(400, "责任组不存在");
  }
  db.prepare("UPDATE projects SET tester_group_id = ?, updated_at = ? WHERE id = ?").run(groupId, nowIso(), projectId);
}

/* ----------------------------- 申请 ----------------------------- */

export function createRequest(
  projectId: string,
  userId: string,
  input: { kind: PackageKind; packageId: string; version: string; changeSummary?: string; packageUrl?: string; sourceItemId?: string },
): { id: string } {
  const db = getDb();
  const access = requireProjectAccess(userId, projectId);
  const kind: PackageKind = input.kind === "VERIFY" ? "VERIFY" : "TEST";
  const pkg = db
    .prepare("SELECT id, code, description, version, group_id AS groupId FROM code_list WHERE id = ? AND project_id = ?")
    .get(input.packageId, projectId) as { id: string; code: string; version: string | null; groupId: string | null } | undefined;
  if (!pkg) throw new AppError(404, "软件包不存在");
  const version = normalizeVersion(input.version);
  const changeSummary = tail(input.changeSummary || "");
  const packageUrl = normalizeUrl(input.packageUrl);
  let sourceItemId: string | null = null;

  if (kind === "TEST") {
    assertCanSubmitForPackage(access, pkg.groupId);
    if (!changeSummary) throw new AppError(400, "请填写本次修改内容");
    if (!packageUrl) throw new AppError(400, "请填写软件包存放链接");
    const duplicate = db
      .prepare(
        `SELECT 1 FROM package_requests WHERE project_id = ? AND package_id = ? AND kind = 'TEST' AND version = ? AND status = 'PENDING'`,
      )
      .get(projectId, pkg.id, version);
    if (duplicate) throw new AppError(409, "该软件包同版本已有待组织的转测试申请");
  } else {
    if (!input.sourceItemId) throw new AppError(400, "请选择测试通过的转测记录作为转验证依据");
    const item = db
      .prepare(
        `SELECT i.id, i.package_id AS packageId, i.version, i.conclusion, i.request_id AS requestId, i.submitted_by AS submittedBy,
                b.project_id AS projectId, b.kind
         FROM package_batch_items i JOIN package_batches b ON b.id = i.batch_id
         WHERE i.id = ? AND b.project_id = ?`,
      )
      .get(input.sourceItemId, projectId) as
      | { id: string; packageId: string; version: string | null; conclusion: Conclusion; requestId: string | null; submittedBy: string | null; projectId: string; kind: PackageKind }
      | undefined;
    if (!item || item.kind !== "TEST") throw new AppError(404, "转测记录不存在");
    if (item.packageId !== pkg.id) throw new AppError(400, "转验证申请必须对应该软件包的转测记录");
    if (item.conclusion !== "PASS") throw new AppError(400, "仅测试结论为「通过」的转测记录可申请转验证");
    if (!access.isPm && !access.isSupervisor && !access.isSoftwareManager && item.submittedBy !== userId && !access.groupIds.includes(pkg.groupId || "")) {
      throw new AppError(403, "仅该软件包所属责任组成员、原转测申请人或项目 PM/主管/软件经理可提交转验证申请");
    }
    const duplicate = db
      .prepare(
        `SELECT 1 FROM package_requests WHERE project_id = ? AND source_item_id = ? AND kind = 'VERIFY' AND status IN ('PENDING','BATCHED')`,
      )
      .get(projectId, item.id);
    if (duplicate) throw new AppError(409, "该转测记录已提交过转验证申请");
    sourceItemId = item.id;
    if (item.version && item.version !== version) {
      throw new AppError(400, "转验证版本必须与测试通过的版本一致");
    }
  }

  const id = newId("prq");
  db.prepare(
    `INSERT INTO package_requests (id, project_id, package_id, kind, version, change_summary, package_url, source_item_id, submitted_by, submitted_at, status, batch_item_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', NULL, ?)`,
  ).run(id, projectId, pkg.id, kind, version, changeSummary, packageUrl, sourceItemId, userId, nowIso(), nowIso());
  return { id };
}

export function cancelRequest(projectId: string, userId: string, requestId: string): void {
  const db = getDb();
  const access = requireProjectAccess(userId, projectId);
  const request = db
    .prepare("SELECT id, submitted_by AS submittedBy, status FROM package_requests WHERE id = ? AND project_id = ?")
    .get(requestId, projectId) as { id: string; submittedBy: string; status: string } | undefined;
  if (!request) throw new AppError(404, "申请不存在");
  if (request.status !== "PENDING") throw new AppError(400, "该申请已纳入批次，无法撤回");
  if (!access.isPm && !access.isSupervisor && request.submittedBy !== userId) {
    throw new AppError(403, "仅申请人或项目 PM/主管可撤回申请");
  }
  db.prepare("UPDATE package_requests SET status = 'CANCELLED' WHERE id = ?").run(requestId);
}

/* ----------------------------- 批次 ----------------------------- */

function nextBatchSeq(projectId: string, kind: PackageKind): number {
  const row = getDb()
    .prepare("SELECT COALESCE(MAX(seq), 0) AS seq FROM package_batches WHERE project_id = ? AND kind = ?")
    .get(projectId, kind) as { seq: number };
  return row.seq + 1;
}

export function createBatch(
  projectId: string,
  userId: string,
  input: {
    kind?: PackageKind;
    requestIds: string[];
    title?: string;
    scheduledDate?: string | null;
    note?: string;
  },
): { batchId: string; code: string } {
  requireOrganize(projectId, userId);
  if (input.kind === "VERIFY") throw new AppError(400, "转验证按软件包逐个处理，不再组织批次");
  const db = getDb();
  const ids = [...new Set(input.requestIds || [])];
  if (ids.length === 0) throw new AppError(400, "请选择要纳入本批次的申请");

  const requests = db
    .prepare(
      `SELECT r.id, r.package_id AS packageId, c.code AS packageCode, r.version,
              r.change_summary AS changeSummary, r.package_url AS packageUrl,
              r.submitted_by AS submittedBy, u.name AS submittedByName
       FROM package_requests r
       JOIN code_list c ON c.id = r.package_id
       JOIN users u ON u.id = r.submitted_by
       WHERE r.project_id = ? AND r.kind = 'TEST' AND r.status = 'PENDING'
         AND r.id IN (${ids.map(() => "?").join(",")})`,
    )
    .all(projectId, ...ids) as {
    id: string;
    packageId: string;
    packageCode: string;
    version: string;
    changeSummary: string;
    packageUrl: string | null;
    submittedBy: string;
    submittedByName: string;
  }[];
  if (requests.length !== ids.length) throw new AppError(400, "部分申请已被处理或已撤回，请刷新后重试");

  const requested = new Map(requests.map((request) => [request.packageId, request]));
  const packages = listCodeRows(projectId);

  const seq = nextBatchSeq(projectId, "TEST");
  const year = todayLocal().slice(0, 4);
  const batchCode = `T-${year}-${String(seq).padStart(3, "0")}`;
  const batchId = newId("pbt");
  const createdAt = nowIso();

  // 上一批转测（同项目）中每个软件包的版本，用于「相较上次转测是否更新」。
  const previousVersions = new Map<string, string>();
  const previousBatch = db
    .prepare(
      `SELECT b.id FROM package_batches b WHERE b.project_id = ? AND b.kind = 'TEST'
       ORDER BY b.seq DESC LIMIT 1`,
    )
    .get(projectId) as { id: string } | undefined;
  if (previousBatch) {
    const rows = db
      .prepare("SELECT package_id AS packageId, version FROM package_batch_items WHERE batch_id = ?")
      .all(previousBatch.id) as { packageId: string; version: string | null }[];
    for (const row of rows) previousVersions.set(row.packageId, row.version || "");
  }

  const insertItem = db.prepare(
    `INSERT INTO package_batch_items
      (id, batch_id, package_id, package_code, package_name, group_id, group_name, owner_name, official_version, version,
       updated_vs_official, updated_vs_previous, previous_version, request_id, change_summary, package_url, submitted_by,
       submitted_by_name, conclusion, conclusion_note, concluded_by, concluded_by_name, concluded_at, barcodes,
       promoted, promoted_at, promoted_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', '', NULL, NULL, NULL, '[]', 0, NULL, NULL, ?)`,
  );

  const setTestVersion = db.prepare("UPDATE code_list SET test_version = ?, updated_at = ? WHERE id = ?");
  const markRequest = db.prepare("UPDATE package_requests SET status = 'BATCHED', batch_item_id = ? WHERE id = ?");

  const transaction = db.transaction(() => {
    db.prepare(
      `INSERT INTO package_batches (id, project_id, kind, seq, code, title, scheduled_date, note, created_by, created_at)
       VALUES (?, ?, 'TEST', ?, ?, ?, ?, ?, ?, ?)`,
    ).run(batchId, projectId, seq, batchCode, (input.title || "").trim(), input.scheduledDate || todayLocal(), (input.note || "").trim(), userId, createdAt);

    if (packages.length === 0) throw new AppError(400, "没有可纳入配套表的软件包");

    for (const pkg of packages) {
      const request = requested.get(pkg.id);
      const officialVersion = pkg.version || "";
      const version = request ? request.version : officialVersion;
      const previousVersion = previousVersions.get(pkg.id) ?? officialVersion;
      const updatedVsOfficial = version !== officialVersion ? 1 : 0;
      const updatedVsPrevious = version !== previousVersion ? 1 : 0;
      const itemId = newId("pit");
      insertItem.run(
        itemId,
        batchId,
        pkg.id,
        pkg.code,
        pkg.description,
        pkg.groupId,
        pkg.groupName,
        pkg.ownerName,
        officialVersion,
        version,
        updatedVsOfficial,
        updatedVsPrevious,
        previousVersion,
        request?.id || null,
        request?.changeSummary || "",
        request?.packageUrl || null,
        request?.submittedBy || null,
        request?.submittedByName || null,
        createdAt,
      );
      if (request) {
        setTestVersion.run(version, createdAt, pkg.id);
        markRequest.run(itemId, request.id);
      }
    }
  });
  transaction();
  return { batchId, code: batchCode };
}

export function concludeItem(
  projectId: string,
  batchId: string,
  itemId: string,
  userId: string,
  input: { conclusion: Conclusion; note?: string },
): void {
  requireConclude(projectId, userId);
  const db = getDb();
  const item = db
    .prepare(
      `SELECT i.id, i.request_id AS requestId, b.project_id AS projectId, b.kind
       FROM package_batch_items i JOIN package_batches b ON b.id = i.batch_id
       WHERE i.id = ? AND i.batch_id = ? AND b.project_id = ?`,
    )
    .get(itemId, batchId, projectId) as { id: string; requestId: string | null; projectId: string; kind: PackageKind } | undefined;
  if (!item) throw new AppError(404, "批次条目不存在");
  if (item.kind !== "TEST") throw new AppError(400, "转验证按软件包逐个处理，请使用逐包处理入口");
  if (!item.requestId) throw new AppError(400, "只有本批次实际转测的软件包需要填写结论");
  const conclusion: Conclusion = ["PASS", "FAIL", "CONDITIONAL"].includes(input.conclusion) ? input.conclusion : "PENDING";
  const note = tail(input.note || "");
  if ((conclusion === "FAIL" || conclusion === "CONDITIONAL") && !note) {
    throw new AppError(400, "不通过或有条件通过时必须填写说明");
  }
  const operator = db.prepare("SELECT name FROM users WHERE id = ?").get(userId) as { name: string } | undefined;
  db.prepare(
    `UPDATE package_batch_items SET conclusion = ?, conclusion_note = ?, concluded_by = ?, concluded_by_name = ?, concluded_at = ?
     WHERE id = ?`,
  ).run(conclusion, note, userId, operator?.name || null, nowIso(), itemId);

  // 已出测试结论后不再有「当前测试版本」：只有仍在测试中的批次保留 test_version。
  const packageRow = db.prepare("SELECT package_id AS packageId FROM package_batch_items WHERE id = ?").get(itemId) as { packageId: string };
  const openItem = db
    .prepare(
      `SELECT i.version FROM package_batch_items i JOIN package_batches b ON b.id = i.batch_id
       WHERE i.package_id = ? AND b.kind = 'TEST' AND i.request_id IS NOT NULL AND i.conclusion = 'PENDING'
       ORDER BY b.seq DESC LIMIT 1`,
    )
    .get(packageRow.packageId) as { version: string | null } | undefined;
  db.prepare("UPDATE code_list SET test_version = ?, updated_at = ? WHERE id = ?").run(
    openItem ? openItem.version : null,
    nowIso(),
    packageRow.packageId,
  );
}

/* --------------------- 转验证（逐包处理，无批次） --------------------- */

function normalizeBarcodeList(barcodes: string[]): string[] {
  const normalized = [...new Set((barcodes || []).map((entry) => entry.trim()).filter(Boolean))];
  if (normalized.length > 20) throw new AppError(400, "单个软件包最多绑定 20 个条码");
  if (normalized.some((entry) => entry.length > 80)) throw new AppError(400, "条码过长");
  return normalized;
}

export function handleVerification(
  projectId: string,
  userId: string,
  input: { requestId: string; processUrl: string; barcodes: string[] },
): { verificationId: string } {
  const permissions = permissionsFor(projectId, userId);
  if (!permissions.canHandleVerification) throw new AppError(403, "仅软件经理、项目 PM 或项目主管可处理转验证申请");
  const db = getDb();
  const request = db
    .prepare(
      `SELECT r.id, r.package_id AS packageId, r.version, r.source_item_id AS sourceItemId,
              c.code AS packageCode, c.description AS packageName, c.version AS officialVersion,
              c.group_id AS groupId, g.name AS groupName
       FROM package_requests r
       JOIN code_list c ON c.id = r.package_id
       LEFT JOIN groups g ON g.id = c.group_id
       WHERE r.id = ? AND r.project_id = ? AND r.kind = 'VERIFY' AND r.status = 'PENDING'`,
    )
    .get(input.requestId, projectId) as
    | {
        id: string;
        packageId: string;
        version: string;
        sourceItemId: string | null;
        packageCode: string;
        packageName: string | null;
        officialVersion: string | null;
        groupId: string | null;
        groupName: string | null;
      }
    | undefined;
  if (!request) throw new AppError(404, "转验证申请不存在或已处理");
  const processUrl = normalizeUrl(input.processUrl);
  if (!processUrl) throw new AppError(400, "请填写电子流程链接");
  const barcodes = normalizeBarcodeList(input.barcodes || []);
  if (barcodes.length === 0) throw new AppError(400, "请填写至少一个验证条码");
  const duplicate = db
    .prepare("SELECT 1 FROM package_verifications WHERE project_id = ? AND package_id = ? AND version = ?")
    .get(projectId, request.packageId, request.version);
  if (duplicate) throw new AppError(409, "该软件包此版本已有转验证记录");

  const operator = db.prepare("SELECT name FROM users WHERE id = ?").get(userId) as { name: string } | undefined;
  const now = nowIso();
  const verificationId = newId("pvf");
  const transaction = db.transaction(() => {
    db.prepare(
      `INSERT INTO package_verifications
        (id, project_id, package_id, request_id, test_item_id, package_code, package_name, group_id, group_name,
         version, official_version, process_url, barcodes, conclusion, conclusion_note, concluded_by,
         concluded_by_name, concluded_at, promoted, promoted_at, promoted_by, promoted_by_name,
         handled_by, handled_by_name, handled_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', '', NULL, NULL, NULL, 0, NULL, NULL, NULL, ?, ?, ?, ?, ?)`,
    ).run(
      verificationId,
      projectId,
      request.packageId,
      request.id,
      request.sourceItemId,
      request.packageCode,
      request.packageName,
      request.groupId,
      request.groupName,
      request.version,
      request.officialVersion,
      processUrl,
      JSON.stringify(barcodes),
      userId,
      operator?.name || null,
      now,
      now,
      now,
    );
    db.prepare("UPDATE package_requests SET status = 'BATCHED', batch_item_id = ? WHERE id = ?").run(verificationId, request.id);
    db.prepare("UPDATE code_list SET verification_version = ?, updated_at = ? WHERE id = ?").run(request.version, now, request.packageId);
  });
  transaction();
  return { verificationId };
}

export function updateVerification(
  projectId: string,
  userId: string,
  verificationId: string,
  input: { processUrl?: string; barcodes?: string[] },
): void {
  const permissions = permissionsFor(projectId, userId);
  if (!permissions.canHandleVerification) throw new AppError(403, "仅软件经理、项目 PM 或项目主管可维护转验证信息");
  const db = getDb();
  const current = db
    .prepare("SELECT id, promoted, process_url AS processUrl, barcodes FROM package_verifications WHERE id = ? AND project_id = ?")
    .get(verificationId, projectId) as { id: string; promoted: number; processUrl: string | null; barcodes: string } | undefined;
  if (!current) throw new AppError(404, "转验证记录不存在");
  if (current.promoted === 1) throw new AppError(409, "已转正的记录不能再修改");
  let processUrl = current.processUrl;
  if (input.processUrl !== undefined) {
    processUrl = normalizeUrl(input.processUrl);
    if (!processUrl) throw new AppError(400, "请填写电子流程链接");
  }
  let barcodes = current.barcodes;
  if (input.barcodes !== undefined) {
    const normalized = normalizeBarcodeList(input.barcodes);
    if (normalized.length === 0) throw new AppError(400, "请填写至少一个验证条码");
    barcodes = JSON.stringify(normalized);
  }
  db.prepare("UPDATE package_verifications SET process_url = ?, barcodes = ?, updated_at = ? WHERE id = ?").run(
    processUrl,
    barcodes,
    nowIso(),
    verificationId,
  );
}

export function concludeVerification(
  projectId: string,
  userId: string,
  verificationId: string,
  input: { conclusion: Conclusion; note?: string },
): void {
  requireConclude(projectId, userId);
  const db = getDb();
  const current = db
    .prepare("SELECT id, promoted FROM package_verifications WHERE id = ? AND project_id = ?")
    .get(verificationId, projectId) as { id: string; promoted: number } | undefined;
  if (!current) throw new AppError(404, "转验证记录不存在");
  if (current.promoted === 1) throw new AppError(409, "已转正的记录不能再修改验证结论");
  const conclusion: Conclusion = ["PASS", "FAIL", "CONDITIONAL"].includes(input.conclusion) ? input.conclusion : "PENDING";
  const note = tail(input.note || "");
  if ((conclusion === "FAIL" || conclusion === "CONDITIONAL") && !note) {
    throw new AppError(400, "不通过或有条件通过时必须填写说明");
  }
  const operator = db.prepare("SELECT name FROM users WHERE id = ?").get(userId) as { name: string } | undefined;
  db.prepare(
    `UPDATE package_verifications SET conclusion = ?, conclusion_note = ?, concluded_by = ?, concluded_by_name = ?, concluded_at = ?, updated_at = ?
     WHERE id = ?`,
  ).run(conclusion, note, userId, operator?.name || null, nowIso(), nowIso(), verificationId);
}

export function promoteVerifications(projectId: string, userId: string, verificationIds: string[]): { promoted: number } {
  requirePromote(projectId, userId);
  const db = getDb();
  const ids = [...new Set(verificationIds || [])];
  if (ids.length === 0) throw new AppError(400, "请选择要转正的软件包");
  const rows = db
    .prepare(
      `SELECT id, package_id AS packageId, version, conclusion, promoted, process_url AS processUrl
       FROM package_verifications WHERE project_id = ? AND id IN (${ids.map(() => "?").join(",")})`,
    )
    .all(projectId, ...ids) as {
    id: string;
    packageId: string;
    version: string | null;
    conclusion: Conclusion;
    promoted: number;
    processUrl: string | null;
  }[];
  if (rows.length !== ids.length) throw new AppError(400, "部分软件包不属于当前项目的转验证记录");
  const invalid = rows.filter((row) => row.conclusion !== "PASS" || row.promoted === 1);
  if (invalid.length > 0) throw new AppError(400, "仅验证结论为「通过」且未转正的软件包可转正");
  const missingProcess = rows.filter((row) => !row.processUrl);
  if (missingProcess.length > 0) throw new AppError(400, "转正前需要先填写电子流程链接");

  const operator = db.prepare("SELECT name FROM users WHERE id = ?").get(userId) as { name: string } | undefined;
  const promotedAt = nowIso();
  const promoteVerification = db.prepare(
    "UPDATE package_verifications SET promoted = 1, promoted_at = ?, promoted_by = ?, promoted_by_name = ?, updated_at = ? WHERE id = ?",
  );
  const promotePackage = db.prepare("UPDATE code_list SET version = ?, updated_at = ? WHERE id = ?");
  const transaction = db.transaction(() => {
    for (const row of rows) {
      if (row.version) promotePackage.run(row.version, promotedAt, row.packageId);
      promoteVerification.run(promotedAt, userId, operator?.name || null, promotedAt, row.id);
    }
  });
  transaction();
  return { promoted: rows.length };
}

/* ----------------------------- 查询 ----------------------------- */

function latestItems(projectId: string): ItemRow[] {
  return getDb()
    .prepare(
      `SELECT i.*, b.code AS batch_code, b.kind AS batch_kind, b.created_at AS batch_created_at,
              r.submitted_at AS request_submitted_at
       FROM package_batch_items i
       JOIN package_batches b ON b.id = i.batch_id
       LEFT JOIN package_requests r ON r.id = i.request_id
       WHERE b.project_id = ? AND b.kind = 'TEST'
       ORDER BY b.seq DESC, i.package_code ASC`,
    )
    .all(projectId) as ItemRow[];
}

export function toItemView(row: ItemRow): BatchItemView {
  return {
    id: row.id,
    packageId: row.package_id,
    packageCode: row.package_code,
    packageName: row.package_name,
    groupId: row.group_id,
    groupName: row.group_name,
    ownerName: row.owner_name,
    officialVersion: row.official_version,
    version: row.version,
    updatedVsOfficial: row.updated_vs_official === 1,
    updatedVsPrevious: row.updated_vs_previous === 1,
    previousVersion: row.previous_version,
    isTransferred: Boolean(row.request_id),
    changeSummary: row.change_summary,
    packageUrl: row.package_url,
    submittedById: row.submitted_by,
    submittedByName: row.submitted_by_name,
    submittedAt: row.request_submitted_at ?? null,
    conclusion: row.conclusion,
    conclusionNote: row.conclusion_note,
    concludedByName: row.concluded_by_name,
    concludedAt: row.concluded_at,
    barcodes: parseBarcodes(row.barcodes),
    promoted: row.promoted === 1,
    promotedAt: row.promoted_at,
    promotedByName: row.promoted_by_name,
  };
}

function listRequests(projectId: string, kind: PackageKind): RequestView[] {
  return getDb()
    .prepare(
      `SELECT r.id, r.kind, r.package_id AS packageId, c.code AS packageCode, COALESCE(c.description, '') AS packageName,
              g.name AS groupName, r.version, r.change_summary AS changeSummary, r.package_url AS packageUrl,
              r.source_item_id AS sourceItemId, r.submitted_by AS submittedBy, u.name AS submittedByName,
              r.submitted_at AS submittedAt, r.status
       FROM package_requests r
       JOIN code_list c ON c.id = r.package_id
       LEFT JOIN groups g ON g.id = c.group_id
       JOIN users u ON u.id = r.submitted_by
       WHERE r.project_id = ? AND r.kind = ? AND r.status = 'PENDING'
       ORDER BY r.submitted_at DESC`,
    )
    .all(projectId, kind) as RequestView[];
}

export function listBatches(projectId: string, kind: PackageKind): BatchView[] {
  const db = getDb();
  const batches = db
    .prepare(
      `SELECT b.id, b.kind, b.seq, b.code, b.title, b.scheduled_date AS scheduledDate, b.note,
              b.created_by AS createdBy, u.name AS createdByName, b.created_at AS createdAt
       FROM package_batches b JOIN users u ON u.id = b.created_by
       WHERE b.project_id = ? AND b.kind = ? ORDER BY b.seq DESC LIMIT 30`,
    )
    .all(projectId, kind) as (Omit<BatchView, "status" | "transferredCount" | "summary" | "items">)[];
  if (batches.length === 0) return [];
  const items = db
    .prepare(
      `SELECT i.*, r.submitted_at AS request_submitted_at FROM package_batch_items i
       LEFT JOIN package_requests r ON r.id = i.request_id
       WHERE i.batch_id IN (${batches.map(() => "?").join(",")})
       ORDER BY i.package_code ASC`,
    )
    .all(...batches.map((batch) => batch.id)) as ItemRow[];
  const byBatch = new Map<string, ItemRow[]>();
  for (const item of items) {
    const list = byBatch.get(item.batch_id) || [];
    list.push(item);
    byBatch.set(item.batch_id, list);
  }
  return batches.map((batch) => {
    const rows = byBatch.get(batch.id) || [];
    const transferred = rows.filter((row) => row.request_id);
    const summary = { pending: 0, pass: 0, fail: 0, conditional: 0 };
    for (const row of transferred) {
      if (row.conclusion === "PASS") summary.pass += 1;
      else if (row.conclusion === "FAIL") summary.fail += 1;
      else if (row.conclusion === "CONDITIONAL") summary.conditional += 1;
      else summary.pending += 1;
    }
    const status: "OPEN" | "DONE" = transferred.length > 0 && summary.pending === 0 ? "DONE" : "OPEN";
    return {
      ...batch,
      status,
      transferredCount: transferred.length,
      summary,
      items: rows.map(toItemView),
    };
  });
}

function listOpenTestItems(projectId: string): OpenTestItem[] {
  const rows = getDb()
    .prepare(
      `SELECT i.*, b.id AS batch_id, b.code AS batch_code, b.title AS batch_title,
              b.scheduled_date AS scheduled_date, b.created_at AS batch_created_at,
              r.submitted_at AS request_submitted_at
       FROM package_batch_items i
       JOIN package_batches b ON b.id = i.batch_id
       LEFT JOIN package_requests r ON r.id = i.request_id
       WHERE b.project_id = ? AND b.kind = 'TEST' AND i.request_id IS NOT NULL AND i.conclusion = 'PENDING'
       ORDER BY b.seq DESC, i.package_code ASC`,
    )
    .all(projectId) as (ItemRow & { batch_title: string; scheduled_date: string | null })[];
  return rows.map((row) => ({
    id: row.id,
    batchId: row.batch_id,
    batchCode: row.batch_code || "",
    batchTitle: row.batch_title || "",
    scheduledDate: row.scheduled_date,
    batchCreatedAt: row.batch_created_at || row.created_at,
    packageId: row.package_id,
    packageCode: row.package_code,
    packageName: row.package_name,
    groupName: row.group_name,
    version: row.version,
    officialVersion: row.official_version,
    updatedVsOfficial: row.updated_vs_official === 1,
    updatedVsPrevious: row.updated_vs_previous === 1,
    previousVersion: row.previous_version,
    submittedById: row.submitted_by,
    submittedByName: row.submitted_by_name,
    submittedAt: row.request_submitted_at ?? null,
    conclusion: row.conclusion,
  }));
}

interface VerificationRow {
  id: string;
  package_id: string;
  request_id: string | null;
  package_code: string;
  package_name: string | null;
  group_id: string | null;
  group_name: string | null;
  version: string | null;
  official_version: string | null;
  process_url: string | null;
  barcodes: string;
  conclusion: Conclusion;
  conclusion_note: string;
  concluded_by_name: string | null;
  concluded_at: string | null;
  promoted: number;
  promoted_at: string | null;
  promoted_by_name: string | null;
  handled_by_name: string | null;
  handled_at: string | null;
  created_at: string;
  request_submitted_at?: string | null;
  submitted_by_name?: string | null;
}

function listVerificationRows(projectId: string): VerificationRow[] {
  return getDb()
    .prepare(
      `SELECT v.*, r.submitted_at AS request_submitted_at, u.name AS submitted_by_name
       FROM package_verifications v
       LEFT JOIN package_requests r ON r.id = v.request_id
       LEFT JOIN users u ON u.id = r.submitted_by
       WHERE v.project_id = ?
       ORDER BY v.created_at DESC, v.package_code ASC`,
    )
    .all(projectId) as VerificationRow[];
}

function toVerificationView(row: VerificationRow): VerificationView {
  return {
    id: row.id,
    requestId: row.request_id,
    packageId: row.package_id,
    packageCode: row.package_code,
    packageName: row.package_name,
    groupId: row.group_id,
    groupName: row.group_name,
    version: row.version,
    officialVersion: row.official_version,
    processUrl: row.process_url,
    barcodes: parseBarcodes(row.barcodes),
    conclusion: row.conclusion,
    conclusionNote: row.conclusion_note,
    concludedByName: row.concluded_by_name,
    concludedAt: row.concluded_at,
    promoted: row.promoted === 1,
    promotedAt: row.promoted_at,
    promotedByName: row.promoted_by_name,
    handledByName: row.handled_by_name,
    handledAt: row.handled_at,
    submittedByName: row.submitted_by_name || null,
    submittedAt: row.request_submitted_at ?? null,
    createdAt: row.created_at,
  };
}

export function listVerifications(projectId: string): VerificationView[] {
  return listVerificationRows(projectId).map(toVerificationView);
}

function listBarcodeLedger(projectId: string): BarcodeEntry[] {
  return listVerificationRows(projectId).flatMap((row) =>
    parseBarcodes(row.barcodes).map((barcode) => ({
      barcode,
      packageId: row.package_id,
      packageCode: row.package_code,
      packageName: row.package_name,
      groupName: row.group_name,
      version: row.version,
      processUrl: row.process_url,
      verificationId: row.id,
      conclusion: row.conclusion,
      concludedAt: row.concluded_at,
      promoted: row.promoted === 1,
      promotedAt: row.promoted_at,
    })),
  );
}

export function getPackagesPayload(projectId: string, userId: string): PackagesPayload {
  const access = requireProjectAccess(userId, projectId);
  const permissions = permissionsFor(projectId, userId);
  const db = getDb();
  const codes = listCodeRows(projectId);
  const items = latestItems(projectId);
  const requests = db
    .prepare("SELECT id, package_id AS packageId, kind FROM package_requests WHERE project_id = ? AND status = 'PENDING'")
    .all(projectId) as { packageId: string; kind: PackageKind }[];

  // 已提交转验证申请（PENDING/BATCHED）的转测记录，用于判断「待提交转验证」。
  const consumedTestItems = new Set(
    (
      db
        .prepare(
          `SELECT source_item_id AS id FROM package_requests
           WHERE project_id = ? AND kind = 'VERIFY' AND status IN ('PENDING','BATCHED') AND source_item_id IS NOT NULL`,
        )
        .all(projectId) as { id: string }[]
    ).map((row) => row.id),
  );

  const byPackage = new Map<string, { test?: ItemRow; openTest?: ItemRow; ready?: VerificationRow; passedTest?: ItemRow; verify?: VerificationRow; openVerify?: VerificationRow }>();
  for (const item of items) {
    const entry = byPackage.get(item.package_id) || {};
    // 只有本批实际转测的软件包才代表一次真实结论；未变更行不参与结论展示。
    if (!entry.test && item.request_id) entry.test = item;
    if (!entry.openTest && item.conclusion === "PENDING" && item.request_id) entry.openTest = item;
    if (!entry.passedTest && item.conclusion === "PASS" && item.request_id && !consumedTestItems.has(item.id)) entry.passedTest = item;
    byPackage.set(item.package_id, entry);
  }
  // 逐包转验证记录（按时间倒序，首次命中即最新）。
  const verificationRows = listVerificationRows(projectId);
  for (const verification of verificationRows) {
    const entry = byPackage.get(verification.package_id) || {};
    if (!entry.verify) entry.verify = verification;
    if (!entry.openVerify && verification.conclusion === "PENDING" && verification.promoted === 0) entry.openVerify = verification;
    if (!entry.ready && verification.conclusion === "PASS" && verification.promoted === 0) entry.ready = verification;
    byPackage.set(verification.package_id, entry);
  }

  const pendingTestByPackage = new Set(requests.filter((request) => request.kind === "TEST").map((request) => request.packageId));
  const pendingVerifyByPackage = new Set(requests.filter((request) => request.kind === "VERIFY").map((request) => request.packageId));

  const packages: PackageOverview[] = codes.map((code) => {
    const entry = byPackage.get(code.id) || {};
    let status: PackageStatus = "OFFICIAL";
    if (entry.openVerify) status = "IN_VERIFY";
    else if (entry.openTest) status = "IN_TEST";
    else if (entry.ready) status = "READY";
    else if (pendingVerifyByPackage.has(code.id)) status = "VERIFY_PENDING";
    else if (entry.passedTest) status = "TEST_PASSED";
    else if (pendingTestByPackage.has(code.id)) status = "TEST_PENDING";
    return {
      id: code.id,
      code: code.code,
      name: code.description || code.code,
      groupId: code.groupId,
      groupName: code.groupName,
      ownerId: code.ownerId,
      ownerName: code.ownerName,
      nodeId: code.nodeId,
      nodeName: code.nodeName,
      usageNote: code.usageNote,
      officialVersion: code.version,
      testVersion: entry.openTest?.version ?? null,
      verificationVersion: code.verificationVersion,
      status,
      statusLabel: STATUS_LABELS[status],
      lastTestConclusion: entry.test?.conclusion ?? null,
      lastTestBatchCode: entry.test?.batch_code ?? null,
      lastVerifyConclusion: entry.verify?.conclusion ?? null,
      lastVerifyProcessUrl: entry.verify?.process_url ?? null,
      updatedAt: code.updatedAt,
    };
  });

  const groups = db
    .prepare("SELECT id, name, enabled FROM groups WHERE project_id = ? ORDER BY name")
    .all(projectId) as { id: string; name: string; enabled: number }[];
  const members = db
    .prepare(
      `SELECT u.id, u.name, u.employee_no AS employeeNo FROM project_members pm JOIN users u ON u.id = pm.user_id
       WHERE pm.project_id = ? ORDER BY u.name`,
    )
    .all(projectId) as { id: string; name: string; employeeNo: string }[];

  const verifications = verificationRows.map(toVerificationView);
  const promoteCandidates = verifications.filter((item) => item.conclusion === "PASS" && !item.promoted);
  const verifyRequestCandidates = [...byPackage.values()]
    .map((entry) => entry.passedTest)
    .filter((item): item is ItemRow => Boolean(item))
    .map(toItemView);
  const openTestItems = listOpenTestItems(projectId);
  const nodes = db
    .prepare("SELECT id, name FROM categories WHERE project_id = ? ORDER BY name")
    .all(projectId) as { id: string; name: string }[];

  return {
    packages,
    groups: groups.map((group) => ({ id: group.id, name: group.name, enabled: group.enabled === 1 })),
    members,
    testerGroup: getTesterGroup(projectId),
    permissions,
    pendingTestRequests: listRequests(projectId, "TEST"),
    pendingVerifyRequests: listRequests(projectId, "VERIFY"),
    testBatches: listBatches(projectId, "TEST"),
    verifications,
    promoteCandidates,
    verifyRequestCandidates,
    openTestItems,
    barcodeLedger: listBarcodeLedger(projectId),
    nodes,
    stats: {
      total: packages.length,
      official: packages.filter((pkg) => pkg.status === "OFFICIAL").length,
      inTest: packages.filter((pkg) => pkg.status === "IN_TEST").length,
      inVerify: packages.filter((pkg) => pkg.status === "IN_VERIFY").length,
      ready: packages.filter((pkg) => pkg.status === "READY").length,
      pendingTest: packages.filter((pkg) => pkg.status === "TEST_PENDING").length,
      pendingVerify: packages.filter((pkg) => pkg.status === "VERIFY_PENDING").length,
      openTest: openTestItems.length,
    },
  };
}

/* ----------------------------- 历史 ----------------------------- */

export interface HistoryEvent {
  id: string;
  type: "REQUEST" | "BATCH" | "VERIFICATION" | "CONCLUSION" | "PROMOTE";
  kind: PackageKind;
  at: string;
  title: string;
  detail: string;
  version: string | null;
  batchCode: string | null;
  batchId: string | null;
  processUrl?: string | null;
  operatorName: string | null;
  conclusion?: Conclusion;
}

export function getPackageHistory(
  projectId: string,
  packageId: string,
  userId: string,
): { package: PackageOverview; events: HistoryEvent[] } {
  const payload = getPackagesPayload(projectId, userId);
  const pkg = payload.packages.find((entry) => entry.id === packageId);
  if (!pkg) throw new AppError(404, "软件包不存在");
  const db = getDb();

  const requests = db
    .prepare(
      `SELECT r.id, r.kind, r.version, r.change_summary AS changeSummary, r.package_url AS packageUrl, r.status,
              r.submitted_at AS submittedAt, u.name AS submittedByName
       FROM package_requests r JOIN users u ON u.id = r.submitted_by
       WHERE r.project_id = ? AND r.package_id = ?
       ORDER BY r.submitted_at ASC`,
    )
    .all(projectId, packageId) as {
    id: string;
    kind: PackageKind;
    version: string;
    changeSummary: string;
    packageUrl: string | null;
    status: string;
    submittedAt: string;
    submittedByName: string;
  }[];

  const testItems = db
    .prepare(
      `SELECT i.*, b.code AS batch_code, b.kind AS batch_kind, b.created_at AS batch_created_at
       FROM package_batch_items i JOIN package_batches b ON b.id = i.batch_id
       WHERE b.project_id = ? AND i.package_id = ? AND b.kind = 'TEST'
       ORDER BY b.created_at ASC`,
    )
    .all(projectId, packageId) as ItemRow[];

  const verifications = listVerificationRows(projectId).filter((row) => row.package_id === packageId);

  const events: HistoryEvent[] = [];
  for (const request of requests) {
    events.push({
      id: `req-${request.id}`,
      type: "REQUEST",
      kind: request.kind,
      at: request.submittedAt,
      title: `${request.kind === "TEST" ? "提交转测试申请" : "提交转验证申请"} · 版本 ${request.version}`,
      detail:
        request.status === "CANCELLED"
          ? `已撤回${request.changeSummary ? `：${request.changeSummary}` : ""}`
          : request.changeSummary || "未填写修改说明",
      version: request.version,
      batchCode: null,
      batchId: null,
      operatorName: request.submittedByName,
    });
  }

  for (const item of testItems) {
    events.push({
      id: `batch-${item.id}`,
      type: "BATCH",
      kind: "TEST",
      at: item.batch_created_at || item.created_at,
      title: `转测试批次 ${item.batch_code} 组织`,
      detail: item.request_id
        ? `纳入本批配套表，版本 ${item.version}（${item.updated_vs_official ? `更新自正式版本 ${item.official_version || "—"}` : "版本未变"}）`
        : `随配套表下发正式版本 ${item.official_version || "—"}`,
      version: item.version,
      batchCode: item.batch_code || null,
      batchId: item.batch_id,
      operatorName: null,
    });
    if (item.conclusion !== "PENDING" && item.concluded_at) {
      events.push({
        id: `conclusion-${item.id}`,
        type: "CONCLUSION",
        kind: "TEST",
        at: item.concluded_at,
        title: `测试结论：${CONCLUSION_LABELS[item.conclusion]}`,
        detail: item.conclusion_note || "未填写说明",
        version: item.version,
        batchCode: item.batch_code || null,
        batchId: item.batch_id,
        operatorName: item.concluded_by_name,
        conclusion: item.conclusion,
      });
    }
  }

  for (const verification of verifications) {
    const barcodes = parseBarcodes(verification.barcodes);
    events.push({
      id: `verify-${verification.id}`,
      type: "VERIFICATION",
      kind: "VERIFY",
      at: verification.handled_at || verification.created_at,
      title: `转验证处理 · 版本 ${verification.version || "—"}`,
      detail: [
        verification.process_url ? `电子流程：${verification.process_url}` : "未填写电子流程链接",
        barcodes.length > 0 ? `验证条码：${barcodes.join("、")}` : "未绑定条码",
      ].join(" · "),
      version: verification.version,
      batchCode: null,
      batchId: null,
      processUrl: verification.process_url,
      operatorName: verification.handled_by_name,
    });
    if (verification.conclusion !== "PENDING" && verification.concluded_at) {
      events.push({
        id: `verify-conclusion-${verification.id}`,
        type: "CONCLUSION",
        kind: "VERIFY",
        at: verification.concluded_at,
        title: `验证结论：${CONCLUSION_LABELS[verification.conclusion]}`,
        detail: verification.conclusion_note || "未填写说明",
        version: verification.version,
        batchCode: null,
        batchId: null,
        processUrl: verification.process_url,
        operatorName: verification.concluded_by_name,
        conclusion: verification.conclusion,
      });
    }
    if (verification.promoted === 1) {
      events.push({
        id: `promote-${verification.id}`,
        type: "PROMOTE",
        kind: "VERIFY",
        at: verification.promoted_at || verification.created_at,
        title: `转为正式版本 ${verification.version || ""}`.trim(),
        detail: `正式版本由 ${verification.official_version || "—"} 更新为 ${verification.version || "—"}`,
        version: verification.version,
        batchCode: null,
        batchId: null,
        processUrl: verification.process_url,
        operatorName: verification.promoted_by_name,
      });
    }
  }

  // 同一毫秒内产生的多个事件按流程先后倒序排列，保证历史稳定可读。
  const rank: Record<HistoryEvent["type"], number> = { REQUEST: 1, BATCH: 2, VERIFICATION: 3, CONCLUSION: 4, PROMOTE: 5 };
  events.sort((left, right) => {
    if (left.at !== right.at) return left.at < right.at ? 1 : -1;
    return (rank[right.type] || 0) - (rank[left.type] || 0);
  });
  return { package: pkg, events };
}
