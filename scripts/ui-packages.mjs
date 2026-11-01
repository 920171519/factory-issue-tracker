/**
 * 软件包管理页面（转测试 / 转验证 / 转正）浏览器校验（只读，不写业务数据）：
 *  1. 左侧导航新增「软件包管理」并可进入；
 *  2. 总览展示正式/验证/测试版本与当前状态，统计卡与实际状态一致；
 *  3. 责任组、状态、关键词筛选生效；
 *  4. 变更历史弹窗按时间线展示转测、结论、条码、验证结论；
 *  5. 转测试批次展示全量配套表，标注较正式/较上批差异，未转测行提示未变更；
 *  6. 转验证批次展示多條码绑定与验证结论、可转正勾选；
 *  7. 基础信息页不再展示编码清单，改为跳转软件包管理；浏览器无异常请求。
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
  // 用 API 登录（与浏览器上下文共享 Cookie），避免登录页受浏览器扩展注入影响。
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
  assert.deepEqual(metrics.map((value) => value.trim()), ["6", "0", "0", "1", "1"], `统计卡应显示 6/0/0/1/1，实际 ${metrics.join(",")}`);
  const overviewRows = page.locator(".packages-table tbody tr");
  assert.equal(await overviewRows.count(), 6, "软件包总览应有 6 个软件包");
  const pcbRow = overviewRows.filter({ hasText: "XH-SYS-PCB-A01" });
  assert.ok((await pcbRow.textContent()).includes("可转正"), "PCB 包应为可转正状态");
  assert.ok((await pcbRow.textContent()).includes("Rev.B3"), "PCB 包应展示验证版本 Rev.B3");
  const biosRow = overviewRows.filter({ hasText: "XH-BIOS-FW" });
  assert.ok((await biosRow.textContent()).includes("待提交转验证"), "BIOS 包应待提交转验证");
  assert.ok((await biosRow.textContent()).includes("Rev.C1"), "BIOS 包应展示测试版本 Rev.C1");
  await page.screenshot({ path: `${out}/01-overview.png`, fullPage: true });
  pass("软件包总览展示正式/验证/测试版本与当前状态");

  // 3. 筛选
  await page.locator(".packages-filter-bar input.input").fill("BIOS");
  await page.waitForTimeout(300);
  assert.equal(await page.locator(".packages-table tbody tr").count(), 1, "关键词筛选应只保留 1 行");
  await page.locator(".packages-filter-bar input.input").fill("");
  await page.locator(".packages-filter-bar select").first().selectOption({ label: "风扇测试组" });
  await page.waitForTimeout(300);
  const filteredCodes = await page.locator(".packages-table tbody tr .main-cell").allTextContents();
  assert.deepEqual(filteredCodes.sort(), ["XH-BMC-FW", "XH-FAN-4020"], `责任组筛选结果不符：${filteredCodes.join(",")}`);
  await page.locator(".packages-filter-bar select").first().selectOption({ label: "全部责任组" });
  await page.waitForTimeout(300);
  pass("关键词与责任组筛选生效");

  // 4. 变更历史
  await overviewRows.filter({ hasText: "XH-SYS-PCB-A01" }).getByRole("button", { name: "历史" }).click();
  await page.waitForSelector(".modal .pkg-history-timeline", { timeout: 15000 });
  await page.waitForTimeout(300);
  const historyText = await page.locator(".modal").textContent();
  assert.ok(historyText.includes("转测试批次"), "历史应包含转测试批次");
  assert.ok(historyText.includes("转验证批次"), "历史应包含转验证批次");
  assert.ok(historyText.includes("绑定验证条码"), "历史应包含条码记录");
  assert.ok(historyText.includes("测试结论"), "历史应包含测试结论");
  assert.ok((await page.locator(".pkg-history-item").count()) >= 6, "历史事件应不少于 6 条");
  await page.screenshot({ path: `${out}/02-history.png` });
  await page.locator(".modal-close").click();
  await page.waitForTimeout(300);
  pass("变更历史按时间线展示转测、结论、条码与验证结论");

  // 5. 转测试
  await page.getByRole("tab", { name: /转测试/ }).click();
  await page.waitForTimeout(500);
  const pendingTable = page.locator(".packages-request-table");
  assert.ok((await pendingTable.textContent()).includes("XH-CPLD-LOGIC"), "待组织队列应包含 CPLD 包");
  const batchCard = page.locator(".batch-card").first();
  assert.ok((await batchCard.locator(".batch-code").textContent()).includes("T-"), "批次号应以 T- 开头");
  const matrixRows = batchCard.locator(".packages-matrix tbody tr");
  assert.equal(await matrixRows.count(), 6, "配套表应包含全部 6 个软件包");
  const biosMatrix = matrixRows.filter({ hasText: "XH-BIOS-FW" });
  const biosMatrixText = await biosMatrix.textContent();
  assert.ok(biosMatrixText.includes("有更新"), "BIOS 转测行应标记有更新");
  assert.ok(biosMatrixText.includes("通过"), "BIOS 转测行应展示通过结论");
  const fanMatrix = matrixRows.filter({ hasText: "XH-FAN-4020" });
  assert.ok((await fanMatrix.textContent()).includes("未变更"), "未转测行应提示未变更");
  await page.screenshot({ path: `${out}/03-test-batches.png`, fullPage: true });
  pass("转测试批次展示全量配套表与版本差异标记");

  // 6. 转验证与转正
  await page.getByRole("tab", { name: /转验证/ }).click();
  await page.waitForTimeout(500);
  const verifyPanel = page.locator(".packages-panel");
  const verifyText = await verifyPanel.first().textContent();
  assert.ok(verifyText.includes("XH-BIOS-FW"), "测试通过待转验证应包含 BIOS");
  assert.ok(verifyText.includes("XH-CPU-2601001"), "验证批次应展示条码");
  assert.ok(verifyText.includes("XH-MIX-2601003"), "验证批次应展示第二个条码");
  const verifyRows = page.locator(".batch-card .packages-matrix tbody tr");
  const pcbVerifyRow = verifyRows.filter({ hasText: "XH-SYS-PCB-A01" });
  assert.ok((await pcbVerifyRow.textContent()).includes("已转正") === false, "PCB 尚未转正");
  assert.ok(await pcbVerifyRow.locator("input[type=checkbox]").count() >= 1, "验证通过后可勾选转正");
  await page.screenshot({ path: `${out}/04-verify.png`, fullPage: true });
  pass("转验证批次展示多条码、结论与转正入口");

  // 7. 基础信息页不再有编码清单
  await page.goto(`${BASE}/projects/${projectId}/info`, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  const infoText = await page.locator("body").textContent();
  assert.equal(await page.locator("h2.section-title", { hasText: "编码清单" }).count(), 0, "基础信息页不应再有编码清单区块");
  assert.ok(infoText.includes("软件包管理"), "基础信息页应提供软件包管理入口");
  pass("编码清单已从基础信息页迁移");

  // 截图移动端总览
  await page.goto(`${BASE}/projects/${projectId}/packages`, { waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${out}/05-mobile.png`, fullPage: true });

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
