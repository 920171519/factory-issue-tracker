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
  VERIFY_PENDING: "待组织验证",
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
  officialVersion: string | null;
  testVersion: string | null;
  verificationVersion: string | null;
  status: PackageStatus;
  statusLabel: string;
  lastTestConclusion: Conclusion | null;
  lastTestBatchCode: string | null;
  lastVerifyConclusion: Conclusion | null;
  lastVerifyBatchCode: string | null;
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

export interface PackagePermissions {
  isPm: boolean;
  isSupervisor: boolean;
  isTester: boolean;
  testerGroupLeader: boolean;
  canManage: boolean;
  canOrganize: boolean;
  canConclude: boolean;
  canPromote: boolean;
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
  verifyBatches: BatchView[];
  promoteCandidates: BatchItemView[];
  verifyRequestCandidates: BatchItemView[];
  stats: {
    total: number;
    official: number;
    inTest: number;
    inVerify: number;
    ready: number;
    pendingTest: number;
    pendingVerify: number;
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
  return {
    isPm: access.isPm,
    isSupervisor: access.isSupervisor,
    isTester,
    testerGroupLeader,
    canManage: access.isPm,
    canOrganize: access.isPm || access.isSupervisor || testerGroupLeader,
    canConclude: isTester || access.isPm || access.isSupervisor,
    canPromote: access.isPm || access.isSupervisor,
    groupIds: access.groupIds,
  };
}

function requireOrganize(projectId: string, userId: string): PackagePermissions {
  const permissions = permissionsFor(projectId, userId);
  if (!permissions.canOrganize) throw new AppError(403, "仅项目 PM、项目主管或测试责任组负责人可组织批次");
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
  if (access.isPm || access.isSupervisor) return;
  if (!packageGroupId) throw new AppError(400, "该软件包尚未指定责任组，请联系项目 PM 补充");
  if (!access.groupIds.includes(packageGroupId)) throw new AppError(403, "仅该软件包所属责任组成员可提交申请");
}

/* ----------------------------- 软件包 ----------------------------- */

function listCodeRows(projectId: string): CodeRow[] {
  return getDb()
    .prepare(
      `SELECT c.id, c.code, c.description, c.version, c.group_id AS groupId, g.name AS groupName,
              c.owner_id AS ownerId, u.name AS ownerName, c.test_version AS testVersion,
              c.verification_version AS verificationVersion, c.updated_at AS updatedAt
       FROM code_list c
       LEFT JOIN groups g ON g.id = c.group_id
       LEFT JOIN users u ON u.id = c.owner_id
       WHERE c.project_id = ?
       ORDER BY c.code`,
    )
    .all(projectId) as CodeRow[];
}

export function countPackages(projectId: string): number {
  const row = getDb().prepare("SELECT COUNT(*) AS count FROM code_list WHERE project_id = ?").get(projectId) as { count: number };
  return row.count;
}

export function createPackage(
  projectId: string,
  userId: string,
  input: { code: string; description?: string; version?: string; ownerId?: string | null; groupId?: string | null },
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
  const id = newId("cod");
  db.prepare(
    `INSERT INTO code_list (id, project_id, code, description, version, owner_id, group_id, test_version, verification_version, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?)`,
  ).run(
    id,
    projectId,
    code,
    input.description?.trim() || null,
    input.version?.trim() || null,
    input.ownerId || null,
    input.groupId || null,
    nowIso(),
  );
  return { id };
}

export function updatePackage(
  projectId: string,
  packageId: string,
  userId: string,
  input: { code?: string; description?: string | null; version?: string | null; ownerId?: string | null; groupId?: string | null },
): void {
  requireProjectManager(userId, projectId);
  const db = getDb();
  const current = db
    .prepare("SELECT code, description, version, owner_id AS ownerId, group_id AS groupId FROM code_list WHERE id = ? AND project_id = ?")
    .get(packageId, projectId) as
    | { code: string; description: string | null; version: string | null; ownerId: string | null; groupId: string | null }
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
  db.prepare(
    `UPDATE code_list SET code = ?, description = ?, version = ?, owner_id = ?, group_id = ?, updated_at = ? WHERE id = ?`,
  ).run(
    code,
    input.description === undefined ? current.description : input.description?.trim() || null,
    input.version === undefined ? current.version : input.version?.trim() || null,
    input.ownerId === undefined ? current.ownerId : input.ownerId,
    input.groupId === undefined ? current.groupId : input.groupId,
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
    if (!access.isPm && !access.isSupervisor && item.submittedBy !== userId && !access.leaderGroupIds.includes(pkg.groupId || "")) {
      throw new AppError(403, "仅原转测申请人、该责任组负责人或项目 PM/主管可提交转验证申请");
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
  input: { kind: PackageKind; requestIds: string[]; title?: string; scheduledDate?: string | null; note?: string },
): { batchId: string; code: string } {
  requireOrganize(projectId, userId);
  const db = getDb();
  const kind: PackageKind = input.kind === "VERIFY" ? "VERIFY" : "TEST";
  const ids = [...new Set(input.requestIds || [])];
  if (ids.length === 0) throw new AppError(400, "请选择要纳入本批次的申请");

  const requests = db
    .prepare(
      `SELECT r.id, r.kind, r.package_id AS packageId, r.version, r.change_summary AS changeSummary, r.package_url AS packageUrl,
              r.submitted_by AS submittedBy, u.name AS submittedByName
       FROM package_requests r JOIN users u ON u.id = r.submitted_by
       WHERE r.project_id = ? AND r.status = 'PENDING' AND r.id IN (${ids.map(() => "?").join(",")})`,
    )
    .all(projectId, ...ids) as {
    id: string;
    kind: PackageKind;
    packageId: string;
    version: string;
    changeSummary: string;
    packageUrl: string | null;
    submittedBy: string;
    submittedByName: string;
  }[];
  if (requests.length !== ids.length) throw new AppError(400, "部分申请已被处理或已撤回，请刷新后重试");
  if (requests.some((request) => request.kind !== kind)) throw new AppError(400, "所选申请类型不一致");

  const requested = new Map(requests.map((request) => [request.packageId, request]));
  const packages = listCodeRows(projectId);
  if (kind === "VERIFY") {
    const missing = requests.filter((request) => !packages.some((pkg) => pkg.id === request.packageId));
    if (missing.length > 0) throw new AppError(400, "部分软件包不存在");
  }

  const seq = nextBatchSeq(projectId, kind);
  const year = todayLocal().slice(0, 4);
  const batchCode = `${kind === "TEST" ? "T" : "V"}-${year}-${String(seq).padStart(3, "0")}`;
  const batchId = newId("pbt");
  const createdAt = nowIso();

  // 上一批转测（同项目、同类型）中每个软件包的版本，用于「相较上次转测是否更新」。
  const previousVersions = new Map<string, string>();
  if (kind === "TEST") {
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
  const setVerificationVersion = db.prepare("UPDATE code_list SET verification_version = ?, updated_at = ? WHERE id = ?");
  const markRequest = db.prepare("UPDATE package_requests SET status = 'BATCHED', batch_item_id = ? WHERE id = ?");

  const transaction = db.transaction(() => {
    db.prepare(
      `INSERT INTO package_batches (id, project_id, kind, seq, code, title, scheduled_date, note, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(batchId, projectId, kind, seq, batchCode, (input.title || "").trim(), input.scheduledDate || todayLocal(), (input.note || "").trim(), userId, createdAt);

    const targets = kind === "TEST" ? packages : packages.filter((pkg) => requested.has(pkg.id));
    if (targets.length === 0) throw new AppError(400, "没有可纳入配套表的软件包");

    for (const pkg of targets) {
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
        if (kind === "TEST") setTestVersion.run(version, createdAt, pkg.id);
        else setVerificationVersion.run(version, createdAt, pkg.id);
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
}

export function setItemBarcodes(
  projectId: string,
  batchId: string,
  itemId: string,
  userId: string,
  barcodes: string[],
): void {
  const permissions = permissionsFor(projectId, userId);
  if (!permissions.canConclude && !permissions.canOrganize) throw new AppError(403, "无权维护验证条码");
  const db = getDb();
  const item = db
    .prepare(
      `SELECT i.id, b.kind FROM package_batch_items i JOIN package_batches b ON b.id = i.batch_id
       WHERE i.id = ? AND i.batch_id = ? AND b.project_id = ?`,
    )
    .get(itemId, batchId, projectId) as { id: string; kind: PackageKind } | undefined;
  if (!item) throw new AppError(404, "批次条目不存在");
  if (item.kind !== "VERIFY") throw new AppError(400, "只有转验证批次可绑定验证条码");
  const normalized = [...new Set((barcodes || []).map((entry) => entry.trim()).filter(Boolean))];
  if (normalized.length > 20) throw new AppError(400, "单个软件包最多绑定 20 个条码");
  if (normalized.some((entry) => entry.length > 80)) throw new AppError(400, "条码过长");
  db.prepare("UPDATE package_batch_items SET barcodes = ? WHERE id = ?").run(JSON.stringify(normalized), itemId);
}

export function promoteItems(projectId: string, userId: string, batchId: string, itemIds: string[], note?: string): { promoted: number } {
  requirePromote(projectId, userId);
  const db = getDb();
  const ids = [...new Set(itemIds || [])];
  if (ids.length === 0) throw new AppError(400, "请选择要转正的软件包");
  const batch = db
    .prepare("SELECT id, kind FROM package_batches WHERE id = ? AND project_id = ?")
    .get(batchId, projectId) as { id: string; kind: PackageKind } | undefined;
  if (!batch) throw new AppError(404, "批次不存在");
  if (batch.kind !== "VERIFY") throw new AppError(400, "只有转验证批次可执行转正");
  const items = db
    .prepare(
      `SELECT id, package_id AS packageId, version, conclusion, promoted FROM package_batch_items
       WHERE batch_id = ? AND id IN (${ids.map(() => "?").join(",")})`,
    )
    .all(batchId, ...ids) as { id: string; packageId: string; version: string | null; conclusion: Conclusion; promoted: number }[];
  if (items.length !== ids.length) throw new AppError(400, "部分软件包不属于该批次");
  const invalid = items.filter((item) => item.conclusion !== "PASS" || item.promoted === 1);
  if (invalid.length > 0) throw new AppError(400, "仅验证结论为「通过」且未转正的软件包可转正");

  const operator = db.prepare("SELECT name FROM users WHERE id = ?").get(userId) as { name: string } | undefined;
  const promotedAt = nowIso();
  const promoteItem = db.prepare(
    "UPDATE package_batch_items SET promoted = 1, promoted_at = ?, promoted_by = ?, promoted_by_name = ? WHERE id = ?",
  );
  const promotePackage = db.prepare("UPDATE code_list SET version = ?, updated_at = ? WHERE id = ?");
  const transaction = db.transaction(() => {
    for (const item of items) {
      if (item.version) promotePackage.run(item.version, promotedAt, item.packageId);
      promoteItem.run(promotedAt, userId, operator?.name || null, item.id);
    }
  });
  transaction();
  void note;
  return { promoted: items.length };
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
       WHERE b.project_id = ?
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

  const byPackage = new Map<string, { test?: ItemRow; verify?: ItemRow; openTest?: ItemRow; openVerify?: ItemRow; ready?: ItemRow; passedTest?: ItemRow }>();
  for (const item of items) {
    const entry = byPackage.get(item.package_id) || {};
    if (item.batch_kind === "TEST") {
      // 只有本批实际转测的软件包才代表一次真实结论；未变更行不参与结论展示。
      if (!entry.test && item.request_id) entry.test = item;
      if (!entry.openTest && item.conclusion === "PENDING" && item.request_id) entry.openTest = item;
      if (!entry.passedTest && item.conclusion === "PASS" && item.request_id && !consumedTestItems.has(item.id)) entry.passedTest = item;
    } else {
      if (!entry.verify) entry.verify = item;
      if (!entry.openVerify && item.conclusion === "PENDING" && item.request_id) entry.openVerify = item;
      if (!entry.ready && item.conclusion === "PASS" && item.promoted === 0) entry.ready = item;
    }
    byPackage.set(item.package_id, entry);
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
      officialVersion: code.version,
      testVersion: code.testVersion,
      verificationVersion: code.verificationVersion,
      status,
      statusLabel: STATUS_LABELS[status],
      lastTestConclusion: entry.test?.conclusion ?? null,
      lastTestBatchCode: entry.test?.batch_code ?? null,
      lastVerifyConclusion: entry.verify?.conclusion ?? null,
      lastVerifyBatchCode: entry.verify?.batch_code ?? null,
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

  const verifyBatches = listBatches(projectId, "VERIFY");
  const promoteCandidates = verifyBatches.flatMap((batch) => batch.items).filter((item) => item.conclusion === "PASS" && !item.promoted);
  const verifyRequestCandidates = [...byPackage.values()]
    .map((entry) => entry.passedTest)
    .filter((item): item is ItemRow => Boolean(item))
    .map(toItemView);

  return {
    packages,
    groups: groups.map((group) => ({ id: group.id, name: group.name, enabled: group.enabled === 1 })),
    members,
    testerGroup: getTesterGroup(projectId),
    permissions,
    pendingTestRequests: listRequests(projectId, "TEST"),
    pendingVerifyRequests: listRequests(projectId, "VERIFY"),
    testBatches: listBatches(projectId, "TEST"),
    verifyBatches,
    promoteCandidates,
    verifyRequestCandidates,
    stats: {
      total: packages.length,
      official: packages.filter((pkg) => pkg.status === "OFFICIAL").length,
      inTest: packages.filter((pkg) => pkg.status === "IN_TEST").length,
      inVerify: packages.filter((pkg) => pkg.status === "IN_VERIFY").length,
      ready: packages.filter((pkg) => pkg.status === "READY").length,
      pendingTest: packages.filter((pkg) => pkg.status === "TEST_PENDING").length,
      pendingVerify: packages.filter((pkg) => pkg.status === "VERIFY_PENDING").length,
    },
  };
}

/* ----------------------------- 历史 ----------------------------- */

export interface HistoryEvent {
  id: string;
  type: "REQUEST" | "BATCH" | "CONCLUSION" | "BARCODES" | "PROMOTE";
  kind: PackageKind;
  at: string;
  title: string;
  detail: string;
  version: string | null;
  batchCode: string | null;
  batchId: string | null;
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

  const items = db
    .prepare(
      `SELECT i.*, b.code AS batch_code, b.kind AS batch_kind, b.created_at AS batch_created_at
       FROM package_batch_items i JOIN package_batches b ON b.id = i.batch_id
       WHERE b.project_id = ? AND i.package_id = ?
       ORDER BY b.created_at ASC`,
    )
    .all(projectId, packageId) as ItemRow[];

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

  for (const item of items) {
    const kindLabel = item.batch_kind === "TEST" ? "转测试" : "转验证";
    events.push({
      id: `batch-${item.id}`,
      type: "BATCH",
      kind: item.batch_kind || "TEST",
      at: item.batch_created_at || item.created_at,
      title: `${kindLabel}批次 ${item.batch_code} 组织`,
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
        kind: item.batch_kind || "TEST",
        at: item.concluded_at,
        title: `${kindLabel}结论：${CONCLUSION_LABELS[item.conclusion]}`,
        detail: item.conclusion_note || "未填写说明",
        version: item.version,
        batchCode: item.batch_code || null,
        batchId: item.batch_id,
        operatorName: item.concluded_by_name,
        conclusion: item.conclusion,
      });
    }
    const barcodes = parseBarcodes(item.barcodes);
    if (barcodes.length > 0) {
      events.push({
        id: `barcodes-${item.id}`,
        type: "BARCODES",
        kind: "VERIFY",
        at: item.concluded_at || item.created_at,
        title: "绑定验证条码",
        detail: barcodes.join("、"),
        version: item.version,
        batchCode: item.batch_code || null,
        batchId: item.batch_id,
        operatorName: null,
      });
    }
    if (item.promoted === 1) {
      events.push({
        id: `promote-${item.id}`,
        type: "PROMOTE",
        kind: "VERIFY",
        at: item.promoted_at || item.created_at,
        title: `转为正式版本 ${item.version || ""}`.trim(),
        detail: `正式版本由 ${item.official_version || "—"} 更新为 ${item.version || "—"}`,
        version: item.version,
        batchCode: item.batch_code || null,
        batchId: item.batch_id,
        operatorName: item.promoted_by_name,
      });
    }
  }

  // 同一毫秒内产生的多个事件按流程先后倒序排列，保证历史稳定可读。
  const rank: Record<HistoryEvent["type"], number> = { REQUEST: 1, BATCH: 2, BARCODES: 3, CONCLUSION: 4, PROMOTE: 5 };
  events.sort((left, right) => {
    if (left.at !== right.at) return left.at < right.at ? 1 : -1;
    return (rank[right.type] || 0) - (rank[left.type] || 0);
  });
  return { package: pkg, events };
}
