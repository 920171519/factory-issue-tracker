/**
 * 软件包流程 HTTP API 端到端校验（使用临时项目，结束后删除，不影响演示数据）。
 * 覆盖：建项目 → 设测试责任组 → 建包 → 转测试申请（校验）→ 组织转测批次 → 测试结论
 *      → 转验证申请 → 组织转验证 → 多條码 → 验证结论 → 转正 → 历史；权限与错误分支。
 *
 * 用法：先启动开发服务器，再执行 node scripts/e2e-packages.mjs
 */
import assert from "node:assert/strict";
import Database from "better-sqlite3";

const BASE = process.env.E2E_BASE_URL || "http://localhost:3000";
const DB_PATH = process.env.DATABASE_PATH || "data/app.db";

let cookie = "";
async function call(method, path, body) {
  const headers = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (cookie) headers.cookie = cookie;
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const setCookies = response.headers.getSetCookie?.() || [];
  for (const entry of setCookies) {
    const pair = entry.split(";")[0];
    if (pair.includes("=")) cookie = pair;
  }
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: response.status, data };
}

function step(name) {
  console.log("PASS", name);
}

const stamp = Date.now().toString(36);
let projectId = null;

try {
  // 0. 未登录访问应 401
  const anonymous = await call("GET", "/api/projects/anything/packages");
  assert.equal(anonymous.status, 401, `未登录应返回 401，实际 ${anonymous.status}`);

  // 1. 管理员登录并创建临时项目
  const login = await call("POST", "/api/auth/login", { employeeNo: "a00000001", password: "Demo1234" });
  assert.equal(login.status, 200, `登录失败：${JSON.stringify(login.data)}`);
  const created = await call("POST", "/api/projects", { name: `E2E 软件包流程 ${stamp}`, code: `E2E-PKG-${stamp}`, description: "自动化校验临时项目" });
  assert.equal(created.status, 201, `创建项目失败：${JSON.stringify(created.data)}`);
  projectId = created.data.project.id;
  assert.ok(projectId, "创建项目应返回项目 id");
  step("管理员创建临时项目");

  // 2. 测试责任组设置
  const me = await call("GET", "/api/auth/me");
  const adminId = me.data.user.id;
  const group = await call("POST", `/api/projects/${projectId}/groups`, {
    name: "E2E 测试组",
    description: "校验用",
    leaderIds: [adminId],
  });
  assert.equal(group.status, 201, `创建责任组失败：${JSON.stringify(group.data)}`);
  const settings = await call("PATCH", `/api/projects/${projectId}/packages/settings`, { testerGroupId: group.data.id });
  assert.equal(settings.status, 200, `设置测试责任组失败：${JSON.stringify(settings.data)}`);
  step("创建责任组并设置测试责任组");

  // 3. 创建软件包
  const pkg = await call("POST", `/api/projects/${projectId}/packages`, {
    code: "E2E-PKG-A",
    description: "E2E 演示软件包",
    version: "1.0",
    groupId: group.data.id,
  });
  assert.equal(pkg.status, 201, `创建软件包失败：${JSON.stringify(pkg.data)}`);
  const packageId = pkg.data.id;
  step("创建软件包（正式版本 1.0）");

  // 4. 转测试申请校验
  const missingUrl = await call("POST", `/api/projects/${projectId}/package-requests`, {
    kind: "TEST", packageId, version: "1.1", changeSummary: "修复问题",
  });
  assert.equal(missingUrl.status, 400, "缺少存放链接应 400");
  const request = await call("POST", `/api/projects/${projectId}/package-requests`, {
    kind: "TEST",
    packageId,
    version: "1.1",
    changeSummary: "修复 E2E 校验问题",
    packageUrl: "\\\\share\\e2e\\E2E-PKG-A\\1.1",
  });
  assert.equal(request.status, 201, `提交转测试申请失败：${JSON.stringify(request.data)}`);
  const duplicate = await call("POST", `/api/projects/${projectId}/package-requests`, {
    kind: "TEST", packageId, version: "1.1", changeSummary: "重复", packageUrl: "x",
  });
  assert.equal(duplicate.status, 409, "同版本重复申请应 409");
  step("提交转测试申请并校验重复与必填");

  // 5. 组织转测试批次
  const testBatch = await call("POST", `/api/projects/${projectId}/package-batches`, {
    kind: "TEST", requestIds: [request.data.id], title: "E2E 第一批", scheduledDate: "2026-11-01", note: "自动化",
  });
  assert.equal(testBatch.status, 201, `组织转测批次失败：${JSON.stringify(testBatch.data)}`);
  assert.match(testBatch.data.code, /^T-\d{4}-\d{3}$/, "批次号格式应为 T-YYYY-NNN");
  const testBatchId = testBatch.data.batchId;

  const afterBatch = await call("GET", `/api/projects/${projectId}/packages`);
  assert.equal(afterBatch.status, 200);
  const testBatchView = afterBatch.data.testBatches.find((batch) => batch.id === testBatchId);
  assert.ok(testBatchView, "总览应返回转测批次");
  assert.equal(testBatchView.items.length, 1, "配套表应包含全部软件包");
  const testItem = testBatchView.items[0];
  assert.equal(testItem.version, "1.1");
  assert.equal(testItem.updatedVsOfficial, true);
  assert.equal(testItem.updatedVsPrevious, true);
  assert.equal(testItem.conclusion, "PENDING");
  const pkgAfterBatch = afterBatch.data.packages.find((entry) => entry.id === packageId);
  assert.equal(pkgAfterBatch.testVersion, "1.1");
  assert.equal(pkgAfterBatch.status, "IN_TEST");
  assert.equal(afterBatch.data.stats.openTest, 1, "在测跟踪应包含未出结论的转测包");
  assert.equal(afterBatch.data.openTestItems[0].packageId, packageId);
  assert.match(afterBatch.data.openTestItems[0].submittedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/, "转测时间应精确到秒");
  step("组织转测试批次并生成全量配套表与版本差异");

  // 6. 测试结论
  const failedConclusion = await call("PATCH", `/api/projects/${projectId}/package-batches/${testBatchId}`, {
    action: "conclude", itemId: testItem.id, conclusion: "FAIL", note: "",
  });
  assert.equal(failedConclusion.status, 400, "不通过必须填写说明");
  const testConclusion = await call("PATCH", `/api/projects/${projectId}/package-batches/${testBatchId}`, {
    action: "conclude", itemId: testItem.id, conclusion: "PASS", note: "自动化校验通过",
  });
  assert.equal(testConclusion.status, 200, `测试结论失败：${JSON.stringify(testConclusion.data)}`);
  const afterConclusion = await call("GET", `/api/projects/${projectId}/packages`);
  assert.equal(afterConclusion.data.stats.openTest, 0, "出结论后应移出在测列表");
  step("录入测试结论（必填说明校验、在测列表移除）");

  // 7. 转验证：逐包处理（无批次），必须填写电子流程链接与验证条码
  const verifyRequest = await call("POST", `/api/projects/${projectId}/package-requests`, {
    kind: "VERIFY", packageId, version: "1.1", sourceItemId: testItem.id, changeSummary: "E2E 转验证",
  });
  assert.equal(verifyRequest.status, 201, `提交转验证申请失败：${JSON.stringify(verifyRequest.data)}`);
  const noBatch = await call("POST", `/api/projects/${projectId}/package-batches`, {
    kind: "VERIFY", requestIds: [verifyRequest.data.id], title: "不应存在的验证批次",
  });
  assert.equal(noBatch.status, 400, "转验证不再组织批次");
  const missingLink = await call("POST", `/api/projects/${projectId}/package-verifications`, {
    requestId: verifyRequest.data.id, processUrl: "", barcodes: ["E2E-BAR-1"],
  });
  assert.equal(missingLink.status, 400, "缺少电子流程链接应 400");
  const missingBarcode = await call("POST", `/api/projects/${projectId}/package-verifications`, {
    requestId: verifyRequest.data.id, processUrl: "https://flow.example.com/e2e-1", barcodes: [],
  });
  assert.equal(missingBarcode.status, 400, "缺少验证条码应 400");
  const handled = await call("POST", `/api/projects/${projectId}/package-verifications`, {
    requestId: verifyRequest.data.id,
    processUrl: "https://flow.example.com/e2e-1",
    barcodes: ["E2E-BAR-1", "E2E-BAR-2", "E2E-BAR-1"],
  });
  assert.equal(handled.status, 201, `处理转验证失败：${JSON.stringify(handled.data)}`);
  const verificationId = handled.data.verificationId;
  const afterHandle = await call("GET", `/api/projects/${projectId}/packages`);
  assert.equal(afterHandle.data.pendingVerifyRequests.length, 0, "处理后应移出待处理列表");
  assert.equal(afterHandle.data.verifications.length, 1, "应生成逐包验证记录");
  const verifyRecord = afterHandle.data.verifications[0];
  assert.deepEqual(verifyRecord.barcodes, ["E2E-BAR-1", "E2E-BAR-2"], "条码应去重保存");
  assert.equal(verifyRecord.processUrl, "https://flow.example.com/e2e-1");
  assert.equal(verifyRecord.conclusion, "PENDING");
  assert.equal(afterHandle.data.packages.find((entry) => entry.id === packageId).status, "IN_VERIFY");
  assert.equal(afterHandle.data.barcodeLedger.length, 2, "条码台账应按条码展开");
  step("测试通过后提交转验证，软件经理逐包填写电子流程链接与条码");

  // 8. 修改转验证信息 + 验证结论
  const update = await call("PATCH", `/api/projects/${projectId}/package-verifications/${verificationId}`, {
    action: "update", processUrl: "https://flow.example.com/e2e-2", barcodes: ["E2E-BAR-1", "E2E-BAR-2"],
  });
  assert.equal(update.status, 200, `更新转验证信息失败：${JSON.stringify(update.data)}`);
  const verifyConclusion = await call("PATCH", `/api/projects/${projectId}/package-verifications/${verificationId}`, {
    action: "conclude", conclusion: "PASS", note: "正式服务器验证通过",
  });
  assert.equal(verifyConclusion.status, 200, `验证结论失败：${JSON.stringify(verifyConclusion.data)}`);
  const withConclusion = await call("GET", `/api/projects/${projectId}/packages`);
  assert.equal(withConclusion.data.promoteCandidates.length, 1, "验证通过后应出现可转正条目");
  assert.equal(withConclusion.data.barcodeLedger[0].conclusion, "PASS");
  assert.equal(withConclusion.data.barcodeLedger[0].processUrl, "https://flow.example.com/e2e-2");
  step("更新电子流程链接并录入验证结论，条码台账同步");

  // 9. 转正
  const promote = await call("PATCH", `/api/projects/${projectId}/package-verifications`, {
    action: "promote", verificationIds: [verificationId],
  });
  assert.equal(promote.status, 200, `转正失败：${JSON.stringify(promote.data)}`);
  assert.equal(promote.data.promoted, 1);
  const finalPayload = await call("GET", `/api/projects/${projectId}/packages`);
  const promotedPackage = finalPayload.data.packages.find((entry) => entry.id === packageId);
  assert.equal(promotedPackage.officialVersion, "1.1", "转正后正式版本应更新");
  assert.equal(promotedPackage.status, "OFFICIAL");
  assert.equal(finalPayload.data.promoteCandidates.length, 0);
  assert.equal(finalPayload.data.barcodeLedger[0].promoted, true, "条码台账应反映已转正");
  const afterPromoteUpdate = await call("PATCH", `/api/projects/${projectId}/package-verifications/${verificationId}`, {
    action: "update", processUrl: "https://flow.example.com/e2e-3",
  });
  assert.equal(afterPromoteUpdate.status, 409, "转正后不允许再修改转验证信息");
  step("验证通过后转正，正式版本号更新");

  // 10. 历史
  const history = await call("GET", `/api/projects/${projectId}/packages/${packageId}`);
  assert.equal(history.status, 200, `读取历史失败：${JSON.stringify(history.data)}`);
  const types = history.data.events.map((event) => event.type);
  for (const type of ["REQUEST", "BATCH", "VERIFICATION", "CONCLUSION", "PROMOTE"]) {
    assert.ok(types.includes(type), `历史应包含 ${type}，实际 ${types.join(",")}`);
  }
  assert.equal(history.data.package.officialVersion, "1.1");
  assert.ok(history.data.events.some((event) => event.processUrl), "历史应保留电子流程链接");
  step("历史记录包含申请、批次、转验证处理、结论与转正");

  // 11. 软件经理角色：可提交任意责任组的包并组织批次
  const added = await call("POST", `/api/projects/${projectId}/members`, { employeeNo: "c00000004" });
  assert.equal(added.status, 201, `添加成员失败：${JSON.stringify(added.data)}`);
  const roleSet = await call("PATCH", `/api/projects/${projectId}/members/${added.data.member.userId}`, {
    isPm: false, isSupervisor: false, isSoftwareManager: true,
  });
  assert.equal(roleSet.status, 200, `设置软件经理角色失败：${JSON.stringify(roleSet.data)}`);
  cookie = "";
  const managerLogin = await call("POST", "/api/auth/login", { employeeNo: "c00000004", password: "Demo1234" });
  assert.equal(managerLogin.status, 200, "软件经理登录失败");
  const managerRequest = await call("POST", `/api/projects/${projectId}/package-requests`, {
    kind: "TEST", packageId, version: "1.2", changeSummary: "软件经理提交", packageUrl: "\\\\share\\e2e\\1.2",
  });
  assert.equal(managerRequest.status, 201, `软件经理提交申请失败：${JSON.stringify(managerRequest.data)}`);
  const managerBatch = await call("POST", `/api/projects/${projectId}/package-batches`, {
    kind: "TEST", requestIds: [managerRequest.data.id], title: "软件经理组织的批次",
  });
  assert.equal(managerBatch.status, 201, `软件经理组织批次失败：${JSON.stringify(managerBatch.data)}`);
  assert.match(managerBatch.data.code, /^T-\d{4}-002$/, "应为第二个转测试批次");
  const managerPayload = await call("GET", `/api/projects/${projectId}/packages`);
  assert.equal(managerPayload.data.packages.find((entry) => entry.id === packageId).testVersion, "1.2");
  assert.equal(managerPayload.data.stats.openTest, 1, "新批次进入在测跟踪");
  step("软件经理可提交任意责任组的包并组织批次");

  // 12. 非项目成员访问被拒绝
  cookie = "";
  const outsiderLogin = await call("POST", "/api/auth/login", { employeeNo: "c00000003", password: "Demo1234" });
  assert.equal(outsiderLogin.status, 200);
  const outsiderRead = await call("GET", `/api/projects/${projectId}/packages`);
  assert.equal(outsiderRead.status, 404, `非成员读取应 404，实际 ${outsiderRead.status}`);
  const outsiderWrite = await call("POST", `/api/projects/${projectId}/package-requests`, {
    kind: "TEST", packageId, version: "2.0", changeSummary: "越权", packageUrl: "x",
  });
  assert.equal(outsiderWrite.status, 404, `非成员提交应 404，实际 ${outsiderWrite.status}`);
  step("非项目成员读写均被拒绝");

  // 13. 清理临时项目
  const db = new Database(DB_PATH);
  db.pragma("foreign_keys = ON");
  db.prepare("DELETE FROM projects WHERE id = ?").run(projectId);
  const left = db.prepare("SELECT COUNT(*) AS count FROM projects WHERE id = ?").get(projectId);
  db.close();
  assert.equal(left.count, 0, "临时项目应已删除");
  step("清理临时项目");

  console.log("\n===== PACKAGES API E2E PASSED =====");
} catch (error) {
  console.error("\n===== PACKAGES API E2E FAILED =====");
  console.error(error);
  process.exitCode = 1;
  if (projectId) {
    try {
      const db = new Database(DB_PATH);
      db.pragma("foreign_keys = ON");
      db.prepare("DELETE FROM projects WHERE id = ?").run(projectId);
      db.close();
      console.error(`已清理临时项目 ${projectId}`);
    } catch (cleanupError) {
      console.error("清理临时项目失败：", cleanupError);
    }
  }
}
