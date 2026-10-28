import assert from "node:assert/strict";
import { request } from "@playwright/test";
import * as XLSX from "xlsx";

const BASE = process.env.E2E_BASE_URL || "http://localhost:3000";
const PASSWORD = "E2ePass123";
const stamp = Date.now().toString(36).toUpperCase().slice(-7);
let employeeSequence = Number(String(Date.now()).slice(-7)) % 90000000;
const uid = (tag) => {
  void tag;
  employeeSequence += 1;
  return "e" + String(employeeSequence).padStart(8, "0");
};
const results = [];
function record(name, extra = "") {
  results.push({ name, extra });
  console.log("PASS", name, extra);
}
async function bodyOf(response) {
  const text = await response.text();
  try { return JSON.parse(text); } catch { return text; }
}
async function expectStatus(response, expected, label) {
  const data = await bodyOf(response);
  if (response.status() !== expected) {
    throw new Error(`${label}: expected HTTP ${expected}, got ${response.status()} — ${typeof data === "string" ? data.slice(0, 400) : JSON.stringify(data)}`);
  }
  return data;
}

const admin = await request.newContext({ baseURL: BASE });
const users = {};

async function register(tag, role = "") {
  const user = {
    name: "E2E" + role + stamp.slice(-3) + tag,
    employeeNo: uid(tag),
    password: PASSWORD,
  };
  const ctx = await request.newContext({ baseURL: BASE });
  const response = await ctx.post("/api/auth/register", { data: user });
  const data = await expectStatus(response, 201, "register " + tag);
  users[tag] = { ...user, id: data.user.id, ctx };
  return users[tag];
}

try {
  await register("PM", "项目经理");
  await register("SUP", "主管");
  await register("LEAD", "组长");
  await register("MEM", "成员");
  await register("EXTRA", "后备");
  await register("TARGET", "目标");
  await register("OUT", "外部");

  const pm = users.PM.ctx;
  const me = await expectStatus(await pm.get("/api/auth/me"), 200, "me");
  assert.equal(me.user.employeeNo, users.PM.employeeNo);
  record("注册、登录会话、/api/auth/me");

  const wrongContext = await request.newContext({ baseURL: BASE });
  await expectStatus(await wrongContext.post("/api/auth/login", { data: { employeeNo: users.PM.employeeNo, password: "wrong" } }), 401, "wrong password");
  await expectStatus(await wrongContext.post("/api/auth/register", { data: { name: "重复", employeeNo: users.PM.employeeNo, password: PASSWORD } }), 409, "duplicate registration");
  await wrongContext.dispose();
  record("错误密码与重复工号校验");

  await expectStatus(await pm.post("/api/projects", { data: { name: "非管理员禁止创建", code: "DENIED" } }), 403, "normal user cannot create project");
  const adminCtx = await request.newContext({ baseURL: BASE });
  await expectStatus(await adminCtx.post("/api/auth/login", { data: { employeeNo: "a00000001", password: "Demo1234" } }), 200, "admin login");
  users.ADMIN = { id: "seed-admin", name: "系统管理员", employeeNo: "a00000001", password: "Demo1234", ctx: adminCtx };
  const projectName = "E2E 自动化验证项目 " + stamp;
  const projectResp = await adminCtx.post("/api/projects", { data: { name: projectName, code: "E2E-" + stamp, description: "端到端自动化验证项目" } });
  const projectData = await expectStatus(projectResp, 201, "admin create project");
  const projectId = projectData.project.id;
  await expectStatus(await adminCtx.post(`/api/projects/${projectId}/members`, { data: { userId: users.PM.id, isPm: true, isSupervisor: false } }), 201, "add project PM");
  record("仅系统管理员可创建项目，并配置项目 PM", projectId);
  await expectStatus(await pm.post(`/api/projects/${projectId}/members`, { data: { userId: users.SUP.id, isSupervisor: true } }), 201, "add supervisor");
  for (const tag of ["LEAD", "MEM", "EXTRA", "TARGET"]) {
    await expectStatus(await pm.post(`/api/projects/${projectId}/members`, { data: { userId: users[tag].id } }), 201, "add " + tag);
  }
  record("项目成员添加与主管角色");

  const groupA = await expectStatus(await pm.post(`/api/projects/${projectId}/groups`, {
    data: { name: "E2E CPU 组", description: "CPU 测试", leaderIds: [users.LEAD.id], defaultAssigneeId: users.MEM.id },
  }), 201, "create group A");
  const groupB = await expectStatus(await pm.post(`/api/projects/${projectId}/groups`, {
    data: { name: "E2E 风扇组", description: "风扇测试", leaderIds: [users.TARGET.id] },
  }), 201, "create group B");
  const groupC = await expectStatus(await pm.post(`/api/projects/${projectId}/groups`, {
    data: { name: "E2E 无排班组", description: "用于兜底验证", leaderIds: [users.SUP.id] },
  }), 201, "create group C");
  await expectStatus(await pm.post(`/api/projects/${projectId}/groups/${groupA.id}/members`, { data: { userId: users.EXTRA.id } }), 201, "add extra group member");
  record("责任组创建、负责人/默认处理人、组内成员");

  const categories = await expectStatus(await pm.get(`/api/projects/${projectId}/categories`), 200, "categories");
  const categoryData = await expectStatus(await pm.post(`/api/projects/${projectId}/categories`, { data: { name: "E2E 分类 " + stamp.slice(-3), color: "#2563eb" } }), 201, "create category");
  const statuses = await expectStatus(await pm.get(`/api/projects/${projectId}/statuses`), 200, "statuses");
  const slots = await expectStatus(await pm.get(`/api/projects/${projectId}/time-slots`), 200, "slots");
  assert.ok(slots.timeSlots.length >= 2);
  assert.ok(statuses.statuses.length >= 10);
  await expectStatus(await pm.post(`/api/projects/${projectId}/hosts`, { data: { locationNo: "E2E-A-01", hostIp: "10.20.30.41", hostAccount: "root", hostPassword: "host-pass" } }), 201, "create host");
  await expectStatus(await pm.post(`/api/projects/${projectId}/codes`, { data: { code: "E2E-CODE-" + stamp, description: "测试编码", version: "V1", ownerId: users.LEAD.id } }), 201, "create code");
  record("问题分类、状态、班次、云主机、编码清单");

  const nowParts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", weekday: "short" }).formatToParts(new Date());
  const dateStr = `${nowParts.find((p) => p.type === "year").value}-${nowParts.find((p) => p.type === "month").value}-${nowParts.find((p) => p.type === "day").value}`;
  const weekdayMap = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  const currentWeekday = weekdayMap[nowParts.find((p) => p.type === "weekday").value];
  const prevWeekday = currentWeekday === 1 ? 7 : currentWeekday - 1;
  const scheduleUsers = [users.LEAD.id, users.MEM.id];
  for (const weekday of new Set([currentWeekday, prevWeekday])) {
    for (const slot of slots.timeSlots) {
      for (const userId of scheduleUsers) {
        await expectStatus(await pm.post(`/api/projects/${projectId}/groups/${groupA.id}/schedules`, {
          data: { weekday, slotId: slot.id, userId, effectiveFrom: "2020-01-01", effectiveTo: null },
        }), 201, "schedule A");
      }
      await expectStatus(await pm.post(`/api/projects/${projectId}/groups/${groupB.id}/schedules`, {
        data: { weekday, slotId: slot.id, userId: users.TARGET.id, effectiveFrom: "2020-01-01", effectiveTo: null },
      }), 201, "schedule B");
    }
  }
  await expectStatus(await pm.put(`/api/projects/${projectId}/default-groups`, { data: { groupIds: [groupA.id] } }), 200, "default groups");
  record("当前/前一日星期排班与默认责任组");

  const groupListPage = await pm.get(`/api/projects/${projectId}/groups`);
  assert.equal((await expectStatus(groupListPage, 200, "group list")).groups.length, 3);
  const overridesDate = "2026-12-31";
  const override = await expectStatus(await pm.post(`/api/projects/${projectId}/groups/${groupA.id}/overrides`, {
    data: { overrideDate: overridesDate, slotId: slots.timeSlots[0].id, userId: users.MEM.id, kind: "TEMP", note: "E2E 临时调班" },
  }), 201, "create override");
  await expectStatus(await pm.delete(`/api/projects/${projectId}/groups/${groupA.id}/overrides/${override.id}`), 200, "delete override");
  const extraSchedule = await expectStatus(await pm.post(`/api/projects/${projectId}/groups/${groupA.id}/schedules`, {
    data: { weekday: currentWeekday, slotId: slots.timeSlots[0].id, userId: users.EXTRA.id, effectiveFrom: dateStr, effectiveTo: null },
  }), 201, "extra schedule");
  await expectStatus(await pm.delete(`/api/projects/${projectId}/groups/${groupA.id}/schedules/${extraSchedule.id}`), 200, "delete schedule");
  record("临时调班和排班增删");

  const communication = await expectStatus(await pm.get(`/api/projects/${projectId}/communication`), 200, "communication");
  assert.equal(communication.communication.groups.length, 3);
  assert.ok(communication.communication.groups.find((g) => g.id === groupA.id).resolution.handlers.length >= 2);
  record("沟通地图排班模拟接口");

  const barcode1 = "E2E-" + stamp + "-001";
  const device = await expectStatus(await pm.get(`/api/projects/${projectId}/integrations/current-device?locationNo=E2E-A-01`), 200, "device stub");
  assert.ok(device.device.barcode.startsWith("SIM-"));
  assert.equal(device.device.hostIp, "10.20.30.41");
  await expectStatus(await pm.get(`/api/projects/${projectId}/location-host?locationNo=E2E-A-01`), 200, "host lookup");
  record("设备测试接口桩与库位云主机识别");

  const entry = await expectStatus(await users.LEAD.ctx.post(`/api/projects/${projectId}/issues`, {
    data: {
      barcode: barcode1,
      locationNo: "E2E-A-01",
      groupIds: [groupA.id],
      categoryId: categoryData.id,
      priority: "HIGH",
      remark: "端到端问题录入",
      deviceIp: "10.20.30.201",
    },
  }), 201, "create issue");
  const barcodeId1 = entry.barcodeId;
  let detail = await expectStatus(await users.LEAD.ctx.get(`/api/projects/${projectId}/issues/${barcodeId1}`), 200, "detail");
  assert.equal(detail.barcode.barcode, barcode1);
  assert.ok(detail.barcode.issues[0].groups[0].handlers.length >= 2);
  assert.equal(detail.barcode.deviceIp, "10.20.30.201");
  assert.equal(detail.barcode.issues[0].assignmentHistory[0].changeType, "ENTRY");
  record("问题录入、排班责任解析、云主机关联");

  const item = await expectStatus(await users.LEAD.ctx.post(`/api/projects/${projectId}/issues/${barcodeId1}/items`, { data: { errorItem: "CPU 温度超过阈值" } }), 201, "add error item");
  await expectStatus(await users.LEAD.ctx.patch(`/api/projects/${projectId}/issues/items/${item.issueId}`, { data: { errorItem: "CPU 满载温度超过阈值" } }), 200, "edit error item");
  await expectStatus(await users.LEAD.ctx.patch(`/api/projects/${projectId}/issues/${barcodeId1}`, { data: { trackingGroups: ["E2E-定位群-1", "E2E-定位群-2"] } }), 200, "tracking groups");
  detail = await expectStatus(await users.LEAD.ctx.get(`/api/projects/${projectId}/issues/${barcodeId1}`), 200, "detail2");
  assert.equal(detail.barcode.issues.length, 2);
  assert.deepEqual(detail.barcode.trackingGroups, ["E2E-定位群-1", "E2E-定位群-2"]);
  record("报错项追加/编辑与多跟踪群号");

  const identified = statuses.statuses.find((s) => s.name === "已定位");
  const missingReason = await users.LEAD.ctx.post(`/api/projects/${projectId}/issues/${barcodeId1}/status`, {
    data: { statusId: identified.id, reasonHtml: "", confirmed: true },
  });
  await expectStatus(missingReason, 400, "status reason required");
  const statusUpdate = await expectStatus(await users.LEAD.ctx.post(`/api/projects/${projectId}/issues/${barcodeId1}/status`, {
    data: { statusId: identified.id, reasonHtml: "<p>已完成定位，判定为散热接触问题</p>", confirmed: true },
  }), 200, "status update");
  assert.equal(statusUpdate.updatedIssues, 2);
  detail = await expectStatus(await users.LEAD.ctx.get(`/api/projects/${projectId}/issues/${barcodeId1}`), 200, "detail3");
  assert.equal(detail.barcode.issues[0].status.name, "已定位");
  assert.equal(detail.barcode.issues[0].statusHistory[0].newStatus, "已定位");
  record("状态必填原因、二次确认、批量作用于条码");

  const transferIntra = await expectStatus(await users.LEAD.ctx.post(`/api/projects/${projectId}/issues/${barcodeId1}/transfer`, {
    data: { mode: "INTRA", reasonHtml: "<p>指定成员继续定位</p>", groupId: groupA.id, targetUserId: users.EXTRA.id },
  }), 200, "intra transfer");
  assert.equal(transferIntra.transferredIssues, 2);
  detail = await expectStatus(await users.LEAD.ctx.get(`/api/projects/${projectId}/issues/${barcodeId1}`), 200, "detail intra");
  assert.deepEqual(detail.barcode.issues[0].groups[0].handlers.map((h) => h.id), [users.EXTRA.id]);
  assert.equal(detail.barcode.issues[0].groups[0].pinnedUserId, users.EXTRA.id);
  const transferCross = await expectStatus(await users.LEAD.ctx.post(`/api/projects/${projectId}/issues/${barcodeId1}/transfer`, {
    data: { mode: "CROSS", reasonHtml: "<p>CPU 组转风扇组联合确认</p>", targetGroupIds: [groupB.id], retainedGroupIds: [] },
  }), 200, "cross transfer");
  assert.ok(transferCross.transferredIssues > 0);
  detail = await expectStatus(await users.LEAD.ctx.get(`/api/projects/${projectId}/issues/${barcodeId1}`), 200, "detail cross");
  assert.deepEqual(detail.barcode.issues[0].groups.map((g) => g.groupId), [groupB.id]);
  assert.equal(detail.barcode.issues[0].assignmentHistory.at(-1).changeType, "CROSS_GROUP");
  record("组内转交、跨组转接（只选组）、责任历史");

  await expectStatus(await users.LEAD.ctx.post(`/api/projects/${projectId}/issues/${barcodeId1}/transfer`, {
    data: { mode: "INTRA", reasonHtml: "<p>非法跨组个人转交</p>", groupId: groupB.id, targetUserId: users.MEM.id },
  }), 400, "reject intra target from other group");
  record("组内转交目标必须属于本组");

  const excelHeaders = ["条码", "库位号", "参与责任组", "问题分类", "优先级", "备注"];
  const excelRows = [
    ["E2E-" + stamp + "-IMP1", "E2E-A-01", "E2E CPU 组", "", "高", "导入一"],
    ["E2E-" + stamp + "-IMP2", "E2E-A-01", "", "", "中", "使用默认组"],
  ];
  const ws = XLSX.utils.aoa_to_sheet([excelHeaders, ...excelRows]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "问题导入");
  const xlsxBuffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  const importResponse = await pm.post(`/api/projects/${projectId}/issues/import`, {
    multipart: {
      file: { name: "e2e-import.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: xlsxBuffer },
    },
  });
  const importData = await expectStatus(importResponse, 200, "import");
  assert.equal(importData.imported, 2);
  assert.equal(importData.failed, 0);
  const importedId1 = importData.barcodeIds[0];
  const importedId2 = importData.barcodeIds[1];
  const templateResponse = await pm.get(`/api/projects/${projectId}/issues/template`);
  assert.equal(templateResponse.status(), 200);
  assert.ok((await templateResponse.body()).subarray(0, 2).toString() === "PK");
  record("Excel 模板下载与批量导入");

  const pending = statuses.statuses.find((s) => s.name === "挂起");
  const batchStatus = await expectStatus(await pm.post(`/api/projects/${projectId}/issues/batch-status`, {
    data: { barcodeIds: [barcodeId1, importedId1], statusId: pending.id, reasonHtml: "<p>等待现场备件</p>", confirmed: true },
  }), 200, "batch status");
  assert.ok(batchStatus.updatedIssues >= 1);
  record("批量更新状态与二次确认");

  const suspendedStatus = statuses.statuses.find((s) => s.name === "已定位");
  void suspendedStatus;
  const batchTransfer = await expectStatus(await pm.post(`/api/projects/${projectId}/issues/batch-transfer`, {
    data: { barcodeIds: [barcodeId1, importedId1], mode: "CROSS", targetGroupIds: [groupC.id], retainedGroupIds: [], reasonHtml: "<p>统一转无排班组验证兜底</p>" },
  }), 200, "batch transfer");
  assert.equal(batchTransfer.transferredBarcodes, 2);
  detail = await expectStatus(await pm.get(`/api/projects/${projectId}/issues/${barcodeId1}`), 200, "detail fallback");
  assert.ok(detail.barcode.issues[0].groups[0].handlers.some((h) => h.id === users.SUP.id || h.id === users.PM.id));
  const supervisorNotices = await expectStatus(await users.SUP.ctx.get("/api/notifications"), 200, "supervisor notifications");
  assert.ok(supervisorNotices.notifications.some((n) => n.title.includes("跨组转接") || n.title.includes("批量")));
  record("批量跨组转接、无排班兜底、配置主管仍收通知");

  const viewerList = await expectStatus(await users.OUT.ctx.get(`/api/projects/${projectId}/issues`), 404, "outsider denied");
  void viewerList;
  await expectStatus(await users.SUP.ctx.post(`/api/projects/${projectId}/groups`, { data: { name: "越权组", leaderIds: [users.SUP.id] } }), 403, "supervisor cannot create group");
  await expectStatus(await users.LEAD.ctx.post(`/api/projects/${projectId}/groups`, { data: { name: "越权组", leaderIds: [users.LEAD.id] } }), 403, "leader cannot create group");
  record("项目隔离与角色边界");

  const uploadBuffer = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
  const upload = await expectStatus(await pm.post("/api/uploads", {
    multipart: { file: { name: "pixel.png", mimeType: "image/png", buffer: uploadBuffer } },
  }), 201, "upload image");
  assert.ok(upload.url.startsWith("/api/uploads/"));
  const imageResponse = await pm.get(upload.url);
  assert.equal(imageResponse.status(), 200);
  assert.equal(imageResponse.headers()["content-type"], "image/png");
  const anonymous = await request.newContext({ baseURL: BASE });
  await expectStatus(await anonymous.get(upload.url), 401, "image requires auth");
  await anonymous.dispose();
  record("富文本图片上传与访问控制");

  const statusCreate = await expectStatus(await pm.post(`/api/projects/${projectId}/statuses`, {
    data: { name: "E2E 自定义状态", color: "#334155", countsPending: true, requiresReason: false, isIdentified: false, isDefault: false },
  }), 201, "create status");
  await expectStatus(await pm.patch(`/api/projects/${projectId}/statuses/${statusCreate.id}`, { data: { name: "E2E 自定义状态改名" } }), 200, "update status");
  await expectStatus(await pm.delete(`/api/projects/${projectId}/statuses/${statusCreate.id}`), 200, "delete status");
  const categoryCreate = await expectStatus(await pm.post(`/api/projects/${projectId}/categories`, { data: { name: "E2E 临时分类", color: "#0f766e" } }), 201, "create category2");
  await expectStatus(await pm.patch(`/api/projects/${projectId}/categories/${categoryCreate.id}`, { data: { name: "E2E 临时分类改名" } }), 200, "update category");
  await expectStatus(await pm.delete(`/api/projects/${projectId}/categories/${categoryCreate.id}`), 200, "delete category");
  const overlapping = await pm.post(`/api/projects/${projectId}/time-slots`, { data: { name: "E2E 重叠班", start: "09:00", end: "10:00" } });
  await expectStatus(overlapping, 409, "overlap slot");
  const holiday = await expectStatus(await pm.post(`/api/projects/${projectId}/holidays`, { data: { date: "2026-12-31", name: "E2E 节假日" } }), 201, "holiday");
  await expectStatus(await pm.delete(`/api/projects/${projectId}/holidays/${holiday.id}`), 200, "delete holiday");
  const codeCreate = await expectStatus(await pm.post(`/api/projects/${projectId}/codes`, { data: { code: "E2E-TMP-" + stamp, description: "临时", version: "V0" } }), 201, "code2");
  await expectStatus(await pm.patch(`/api/projects/${projectId}/codes/${codeCreate.id}`, { data: { version: "V2" } }), 200, "update code");
  await expectStatus(await pm.delete(`/api/projects/${projectId}/codes/${codeCreate.id}`), 200, "delete code");
  const host = await expectStatus(await pm.post(`/api/projects/${projectId}/hosts`, { data: { locationNo: "E2E-TMP-HOST", hostIp: "10.1.1.1" } }), 201, "host2");
  await expectStatus(await pm.delete(`/api/projects/${projectId}/hosts/${host.id}`), 200, "delete host");
  record("配置维护：分类、状态、班次重叠、节假日、编码、云主机");

  await expectStatus(await pm.patch(`/api/projects/${projectId}`, { data: { description: "项目设置已更新", notifySelfOnStatus: false } }), 200, "project update");
  await expectStatus(await pm.patch(`/api/projects/${projectId}/members/${users.SUP.id}`, { data: { isPm: false, isSupervisor: true } }), 200, "member roles");
  record("项目设置与成员角色");

  const communicationAfter = await expectStatus(await pm.get(`/api/projects/${projectId}/communication?date=${dateStr}&time=09:00`), 200, "communication simulate");
  assert.ok(communicationAfter.communication.groups.length >= 3);
  record("沟通地图指定日期/时间模拟");

  const jobDenied = await pm.get("/api/jobs/handoff");
  assert.equal(jobDenied.status(), 401);
  const job = await pm.get("/api/jobs/handoff", { headers: { "x-cron-secret": process.env.CRON_SECRET || "dev-cron-secret" } });
  assert.equal(job.status(), 200);
  record("交班任务鉴权与手动触发接口");

  const immediateId = (await expectStatus(await users.LEAD.ctx.post(`/api/projects/${projectId}/issues`, {
    data: { barcode: "E2E-" + stamp + "-DEL", locationNo: "E2E-A-01", groupIds: [groupA.id], priority: "LOW" },
  }), 201, "create delete issue")).barcodeId;
  const deleteImmediate = await expectStatus(await pm.post(`/api/projects/${projectId}/issues/batch-delete`, { data: { barcodeIds: [immediateId] } }), 200, "delete immediate");
  assert.equal(deleteImmediate.deleted.length, 1);
  await expectStatus(await pm.get(`/api/projects/${projectId}/issues/${immediateId}`), 404, "deleted issue gone");
  record("无历史条码直接删除");

  const deleteReview = await expectStatus(await pm.post(`/api/projects/${projectId}/issues/batch-delete`, { data: { barcodeIds: [barcodeId1, importedId2] } }), 200, "request review deletion");
  assert.equal(deleteReview.deleted.length, 1);
  assert.ok(deleteReview.requestId);
  await expectStatus(await pm.get(`/api/projects/${projectId}/issues/${barcodeId1}`), 200, "processed barcode retained until approval");
  await expectStatus(await users.SUP.ctx.post(`/api/projects/${projectId}/approvals/${deleteReview.requestId}`, { data: { action: "APPROVE", reasonHtml: "" } }), 403, "supervisor cannot approve");
  const approvalList = await expectStatus(await pm.get(`/api/projects/${projectId}/approvals`), 200, "approval list");
  assert.ok(approvalList.requests.some((r) => r.id === deleteReview.requestId));
  const approved = await expectStatus(await pm.post(`/api/projects/${projectId}/approvals/${deleteReview.requestId}`, { data: { action: "APPROVE", reasonHtml: "<p>确认删除</p>" } }), 200, "approve deletion");
  assert.equal(approved.deletedCount, 1);
  await expectStatus(await pm.get(`/api/projects/${projectId}/issues/${barcodeId1}`), 404, "processed barcode deleted after approval");
  const pmNotifications = await expectStatus(await pm.get("/api/notifications"), 200, "pm notifications");
  assert.ok(pmNotifications.notifications.some((n) => n.title === "删除审批待处理"));
  const supDeletionNotices = (await expectStatus(await users.SUP.ctx.get("/api/notifications"), 200, "sup notifications")).notifications;
  assert.ok(!supDeletionNotices.some((n) => n.title === "删除审批待处理"));
  record("删除审批合并、PM 专属通知、主管可查看但不可审批");

  await expectStatus(await pm.patch("/api/notifications", { data: { all: true } }), 200, "mark notifications");

  const pages = ["", "/issues", "/groups", "/communication", "/statistics", "/approvals", "/members", "/settings", "/info"];
  for (const suffix of pages) {
    const res = await pm.get(`/projects/${projectId}${suffix}`);
    if (res.status() !== 200) throw new Error(`page ${suffix || "/"} status ${res.status()}`);
  }
  const notifPage = await pm.get("/notifications");
  assert.equal(notifPage.status(), 200);
  const outsiderPage = await users.OUT.ctx.get(`/projects/${projectId}/issues`);
  assert.ok([403, 404].includes(outsiderPage.status()));
  record("项目全部页面渲染与项目隔离");

  const logout = await users.EXTRA.ctx.post("/api/auth/logout");
  assert.equal(logout.status(), 200);
  await expectStatus(await users.EXTRA.ctx.get("/api/auth/me"), 401, "logged out");
  record("退出登录");

  console.log("\n===== E2E ALL PASSED =====");
  console.log(`${results.length} groups of checks passed.`);
  console.log(JSON.stringify({ projectId, users, results }, null, 2));
} catch (error) {
  console.error("\n===== E2E FAILED =====");
  console.error(error);
  console.error(JSON.stringify({ results }, null, 2));
  process.exitCode = 1;
} finally {
  await admin.dispose();
  for (const { ctx } of Object.values(users)) await ctx.dispose().catch(() => {});
}
