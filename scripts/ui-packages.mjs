/**
 * 软件包管理页面（转测试 / 逐包转验证 / 转正）浏览器校验（只读，不写业务数据）：
 *  1. 左侧导航「软件包管理」可进入；
 *  2. 总览展示三版本、归属节点说明与状态；已出测试结论的包不再显示测试版本；
 *  3. 关键词、责任组、归属节点筛选生效；
 *  4. 变更历史包含转测、逐包转验证处理、结论（时间精确到秒）；
 *  5. 在测跟踪展示跨批次未完成测试的配套包；
 *  6. 转测试批次配套表与版本差异；
 *  7. 转验证为逐包处理：待处理申请可打开处理弹窗（电子流程 + 条码）、验证记录与条码台账；
 *  8. 测试责任组在责任组页配置；成员页支持软件经理角色；
 *  9. 问题跟踪按「问题归属节点」筛选时可看到该节点使用的软件包；
 * 10. 基础信息页不再有编码清单。
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { chromium } from "@playwright/test";

const BASE = process.env.E2E_BASE_URL || "http://localhost:3000";
const out = "test-results/ui-packages";
await fs.mkdir(out, { recursive: true });

async function launchBrowser() {
  const channels = process.env.PW_CHANNEL ? [process.env.PW_CHANNEL] : ["chrome", "msedge", undefined];
  let lastError;
  for (const channel of channels) {
    try {
      return await chromium.launch(channel ? { channel } : {});
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

const browser = await launchBrowser();
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: "zh-CN", timezoneId: "Asia/Shanghai" });
const page = await context.newPage();
const errors = [];
const failedResources = [];
page.on("console", (msg) => { if (msg.type() === "error") errors.push(`${msg.text()} @ ${msg.location()?.url || ""}`); });
page.on("pageerror", (error) => errors.push(error.message));
page.on("response", (response) => { if (response.status() >= 400) failedResources.push(`${response.status()} ${response.url()}`); });
const steps = [];
const pass = (name) => { steps.push(name); console.log("PASS", name); };

try {
  const loginResponse = await context.request.post(`${BASE}/api/auth/login`, {
    data: { employeeNo: "p00000001", password: "Demo1234" },
  });
  assert.equal(loginResponse.status(), 200, "API 登录应成功");
  await page.goto(`${BASE}/projects`, { waitUntil: "networkidle" });
  await page.waitForLoadState("networkidle");
  await page.getByText("星河服务器 NPI 验证项目", { exact: true }).first().click();
  await page.waitForURL(/\/projects\/[^/]+$/);
  await page.waitForLoadState("networkidle");
  const projectId = page.url().split("/").pop();

  // 1. 导航入口
  const navLink = page.locator(".project-sidebar a", { hasText: "软件包管理" });
  assert.equal(await navLink.count(), 1, "工作台导航应包含「软件包管理」");
  await navLink.click();
  await page.waitForURL(`**/projects/${projectId}/packages`);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(800);
  assert.ok((await page.locator(".page-title").textContent()).includes("软件包管理"), "页面标题应为软件包管理");
  pass("左侧工作台新增「软件包管理」入口并可进入");

  // 2. 统计卡与总览
  const metrics = await page.locator(".packages-metrics .metric-value").allTextContents();
  assert.deepEqual(metrics.map((value) => value.trim()), ["6", "1", "0", "1", "2"], `统计卡应显示 6/1/0/1/2，实际 ${metrics.join(",")}`);
  const overviewRows = page.locator(".packages-table tbody tr");
  assert.equal(await overviewRows.count(), 6, "软件包总览应有 6 个软件包");
  const pcbRow = overviewRows.filter({ hasText: "XH-SYS-PCB-A01" });
  const pcbText = await pcbRow.textContent();
  assert.ok(pcbText.includes("可转正"), "PCB 包应为可转正状态");
  assert.ok(pcbText.includes("Rev.B3"), "PCB 包应展示验证版本 Rev.B3");
  assert.ok(pcbText.includes("节点：整机结构节点"), "PCB 包应展示归属节点");
  assert.ok(!pcbText.includes("Rev.C1"), "PCB 已出测试结论，不应再显示测试版本");
  const biosRow = overviewRows.filter({ hasText: "XH-BIOS-FW" });
  const biosText = await biosRow.textContent();
  assert.ok(biosText.includes("待处理验证"), "BIOS 包应待处理验证");
  assert.ok(!biosText.includes("Rev.C1"), "BIOS 已出测试结论，不应再显示测试版本");
  assert.ok(biosText.includes("星河服务器 NPI · 整机功能测试"), "说明列应展示使用项目/节点补充");
  const cpldRow = overviewRows.filter({ hasText: "XH-CPLD-LOGIC" });
  assert.ok((await cpldRow.textContent()).includes("测试中"), "CPLD 包应处于测试中");
  assert.equal(await page.locator(".packages-settings").count(), 0, "软件包总览不应再展示测试责任组设置");
  await page.screenshot({ path: `${out}/01-overview.png`, fullPage: true });
  pass("总览展示三版本、归属节点说明，已出结论的包不显示测试版本");

  // 3. 筛选：关键词 / 责任组 / 归属节点
  await page.locator(".packages-filter-bar input.input").fill("BIOS");
  await page.waitForTimeout(300);
  assert.equal(await page.locator(".packages-table tbody tr").count(), 1, "关键词筛选应只保留 1 行");
  await page.locator(".packages-filter-bar input.input").fill("");
  await page.locator('select[aria-label="按责任组筛选"]').selectOption({ label: "风扇测试组" });
  await page.waitForTimeout(300);
  const filteredCodes = await page.locator(".packages-table tbody tr .main-cell").allTextContents();
  assert.deepEqual(filteredCodes.sort(), ["XH-BMC-FW", "XH-FAN-4020"], `责任组筛选结果不符：${filteredCodes.join(",")}`);
  await page.locator('select[aria-label="按责任组筛选"]').selectOption({ label: "全部责任组" });
  await page.locator('select[aria-label="按归属节点筛选"]').selectOption({ label: "CPU 测试节点" });
  await page.waitForTimeout(300);
  const nodeCodes = await page.locator(".packages-table tbody tr .main-cell").allTextContents();
  assert.deepEqual(nodeCodes.sort(), ["XH-BIOS-FW"], `节点筛选结果不符：${nodeCodes.join(",")}`);
  await page.locator('select[aria-label="按归属节点筛选"]').selectOption({ label: "全部节点" });
  await page.waitForTimeout(300);
  pass("关键词、责任组与归属节点筛选生效");

  // 4. 变更历史（含逐包转验证，时间精确到秒）
  await overviewRows.filter({ hasText: "XH-SYS-PCB-A01" }).getByRole("button", { name: "历史" }).click();
  await page.waitForSelector(".modal .pkg-history-timeline", { timeout: 15000 });
  await page.waitForTimeout(300);
  const historyText = await page.locator(".modal").textContent();
  assert.ok(historyText.includes("转测试批次"), "历史应包含转测试批次");
  assert.ok(historyText.includes("转验证处理"), "历史应包含逐包转验证处理");
  assert.ok(historyText.includes("电子流程"), "历史应包含电子流程链接");
  assert.ok(historyText.includes("测试结论"), "历史应包含测试结论");
  assert.ok((await page.locator(".pkg-history-item").count()) >= 5, "历史事件应不少于 5 条");
  const historyMeta = await page.locator(".pkg-history-meta").allTextContents();
  assert.ok(historyMeta.some((text) => /\d{2}:\d{2}:\d{2}/.test(text)), "历史时间应精确到秒");
  await page.screenshot({ path: `${out}/02-history.png` });
  await page.locator(".modal-close").click();
  await page.waitForTimeout(300);
  pass("变更历史按时间线展示（含电子流程，时间精确到秒）");

  // 5. 在测跟踪
  await page.getByRole("tab", { name: /在测跟踪/ }).click();
  await page.waitForTimeout(500);
  const trackingRows = page.locator(".packages-tracking-table tbody tr");
  assert.equal(await trackingRows.count(), 1, "在测跟踪应有 1 个未出结论的包");
  const trackingText = await trackingRows.first().textContent();
  assert.ok(trackingText.includes("XH-CPLD-LOGIC"), "在测跟踪应包含 CPLD 包");
  assert.ok(trackingText.includes("T-2026-002"), "在测跟踪应显示所属批次");
  const trackingTimes = await page.locator(".packages-tracking-table .mini-meta.mono").allTextContents();
  assert.ok(trackingTimes.some((text) => /\d{2}:\d{2}:\d{2}/.test(text)), "转测时间应精确到秒");
  await page.screenshot({ path: `${out}/03-tracking.png`, fullPage: true });
  pass("在测跟踪展示跨批次未完成测试的配套包（秒级时间）");

  // 6. 转测试
  await page.getByRole("tab", { name: /转测试/ }).click();
  await page.waitForTimeout(500);
  const pendingTable = page.locator(".packages-request-table");
  const pendingText = await pendingTable.textContent();
  assert.ok(pendingText.includes("XH-BIOS-FW"), "待组织队列应包含 BIOS 包");
  assert.ok(pendingText.includes("Rev.C2"), "待组织队列应展示申请版本 Rev.C2");
  assert.equal(await page.locator(".batch-card").count(), 2, "应有两个转测试批次");
  const batchCard = page.locator(".batch-card").first();
  assert.ok((await batchCard.locator(".batch-code").textContent()).includes("T-"), "批次号应以 T- 开头");
  const matrixRows = batchCard.locator(".packages-matrix tbody tr");
  assert.equal(await matrixRows.count(), 6, "配套表应包含全部 6 个软件包");
  const cpldMatrix = matrixRows.filter({ hasText: "XH-CPLD-LOGIC" });
  const cpldMatrixText = await cpldMatrix.textContent();
  assert.ok(cpldMatrixText.includes("有更新"), "CPLD 转测行应标记有更新");
  assert.ok(cpldMatrixText.includes("待结论"), "CPLD 转测行应展示待结论");
  const fanMatrix = matrixRows.filter({ hasText: "XH-FAN-4020" });
  assert.ok((await fanMatrix.textContent()).includes("未变更"), "未转测行应提示未变更");
  await page.screenshot({ path: `${out}/04-test-batches.png`, fullPage: true });
  pass("转测试批次展示全量配套表、版本差异与待结论状态");

  // 7. 逐包转验证
  await page.getByRole("tab", { name: /转验证/ }).click();
  await page.waitForTimeout(500);
  const verifySections = page.locator(".packages-panel");
  const verifyText = await verifySections.first().textContent();
  assert.ok(verifyText.includes("待处理的转验证申请"), "应有待处理转验证申请区块");
  assert.ok(verifyText.includes("转验证记录（逐包）"), "应有逐包验证记录区块");
  const pendingVerifyRow = page.locator("table").filter({ hasText: "待处理的转验证申请" });
  void pendingVerifyRow;
  const handleButton = page.getByRole("button", { name: "处理" }).first();
  assert.ok(await handleButton.count() >= 1, "待处理申请应有「处理」按钮");
  await handleButton.click();
  await page.waitForSelector(".modal");
  content: {
    const modalText = await page.locator(".modal").textContent();
    assert.ok(modalText.includes("电子流程链接"), "处理弹窗应要求填写电子流程链接");
    assert.ok(modalText.includes("验证条码"), "处理弹窗应要求填写验证条码");
    assert.ok(await page.locator('.modal input[aria-label="验证条码"]').count() === 1, "处理弹窗应有条码输入框");
    await page.screenshot({ path: `${out}/05-handle-modal.png` });
    await page.locator(".modal-close").click();
    await page.waitForTimeout(300);
  }
  const verifyRecordRows = page.locator(".packages-matrix tbody tr");
  assert.equal(await verifyRecordRows.count(), 1, "应有一条逐包验证记录");
  const recordText = await verifyRecordRows.first().textContent();
  assert.ok(recordText.includes("XH-SYS-PCB-A01"), "验证记录应包含主板包");
  assert.ok(recordText.includes("电子流程"), "验证记录应展示电子流程入口");
  assert.ok(recordText.includes("XH-CPU-2601001"), "验证记录应展示验证条码");
  assert.ok(recordText.includes("待转正"), "验证通过后应可勾选转正");
  const ledgerRows = page.locator(".packages-barcode-table tbody tr");
  assert.equal(await ledgerRows.count(), 2, "条码台账应有两条条码");
  assert.ok((await ledgerRows.first().textContent()).includes("XH-SYS-PCB-A01"), "条码台账应关联软件包");
  await page.locator('input[aria-label="搜索验证条码"]').fill("MIX");
  await page.waitForTimeout(300);
  assert.equal(await page.locator(".packages-barcode-table tbody tr").count(), 1, "条码搜索应只保留匹配项");
  await page.screenshot({ path: `${out}/06-verify.png`, fullPage: true });
  pass("转验证逐包处理：电子流程+条码弹窗、逐包记录与条码台账");

  // 8. 测试责任组在责任组页配置
  await page.goto(`${BASE}/projects/${projectId}/groups`, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  const testerSelect = page.locator('select[aria-label="测试责任组"]');
  assert.equal(await testerSelect.count(), 1, "责任组页面应有测试责任组配置");
  assert.ok(await testerSelect.inputValue(), "测试责任组应有默认值");
  const testerGroupName = await testerSelect.locator("option:checked").textContent();
  assert.ok((testerGroupName || "").includes("复测组"), `测试责任组应为复测组，实际 ${testerGroupName}`);
  pass("测试责任组在责任组页面配置");

  // 9. 成员页软件经理角色
  await page.goto(`${BASE}/projects/${projectId}/members`, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  const memberText = await page.locator("body").textContent();
  assert.ok(memberText.includes("周敏"), "成员页应包含演示软件经理账号");
  assert.ok(await page.getByRole("button", { name: /软件经理/ }).count() >= 1, "成员页应可授予软件经理角色");
  assert.ok(memberText.includes("m00000012"), "应展示软件经理工号");
  pass("项目成员页支持软件经理角色");

  // 10. 问题跟踪按节点反查软件包
  await page.goto(`${BASE}/projects/${projectId}/issues`, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  await page.locator(".issues-toolbar-card").getByRole("button", { name: /筛选/ }).click();
  await page.waitForTimeout(300);
  await page.locator(".filters-panel select").nth(2).selectOption({ label: "CPU 测试节点" });
  await page.waitForTimeout(600);
  const nodeHint = page.locator(".node-package-hint");
  assert.equal(await nodeHint.count(), 1, "按节点筛选时应展示该节点使用的软件包");
  const nodeHintText = await nodeHint.textContent();
  assert.ok(nodeHintText.includes("CPU 测试节点"), "节点提示应包含节点名称");
  assert.ok(nodeHintText.includes("XH-BIOS-FW"), "节点提示应包含该节点下的软件包编码");
  await page.screenshot({ path: `${out}/07-node-packages.png` });
  pass("问题跟踪按问题归属节点筛选可反查该节点使用的软件包");

  // 11. 基础信息页不再有编码清单
  await page.goto(`${BASE}/projects/${projectId}/info`, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  const infoText = await page.locator("body").textContent();
  assert.equal(await page.locator("h2.section-title", { hasText: "编码清单" }).count(), 0, "基础信息页不应再有编码清单区块");
  assert.ok(infoText.includes("软件包管理"), "基础信息页应提供软件包管理入口");
  pass("编码清单已从基础信息页迁移");

  // 移动端截图
  await page.goto(`${BASE}/projects/${projectId}/packages`, { waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${out}/08-mobile.png`, fullPage: true });

  const realErrors = errors.filter((text) => !text.includes("favicon.ico"));
  const realFailed = failedResources.filter((text) => !text.includes("favicon.ico"));
  if (realFailed.length > 0) throw new Error("出现失败请求: " + realFailed.join(" | "));
  if (realErrors.length > 0) throw new Error("浏览器出现错误: " + realErrors.join(" | "));
  console.log("\n===== PACKAGES UI VERIFY PASSED =====");
  console.log(JSON.stringify({ steps, projectId }, null, 2));
} catch (error) {
  await page.screenshot({ path: `${out}/failure.png`, fullPage: true }).catch(() => {});
  console.error("\n===== PACKAGES UI VERIFY FAILED =====");
  console.error(error);
  console.error(JSON.stringify({ steps, errors, failedResources, url: page.url() }, null, 2));
  process.exitCode = 1;
} finally {
  await browser.close();
}
