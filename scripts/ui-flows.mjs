import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
import fs from "node:fs/promises";

const out = "test-results/ui-flows";
await fs.mkdir(out, { recursive: true });
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: "zh-CN", timezoneId: "Asia/Shanghai" });
const page = await context.newPage();
const errors = [];
page.on("console", (msg) => { if (msg.type() === "error") errors.push(msg.text()); });
page.on("pageerror", (error) => errors.push(error.message));
const steps = [];
const pass = (name) => { steps.push(name); console.log("PASS", name); };

try {
  await page.goto("http://localhost:3000/login", { waitUntil: "networkidle" });
  await page.locator("#employeeNo").fill("c00000003");
  await page.locator("#password").fill("Demo1234");
  await page.getByRole("button", { name: /进入工作台/ }).click();
  await page.waitForURL("**/projects");
  await page.waitForLoadState("networkidle");
  assert.ok((await page.textContent("body")).includes("星河服务器 NPI 验证项目"));
  pass("工号登录并渲染项目列表");

  await page.getByText("星河服务器 NPI 验证项目", { exact: true }).first().click();
  await page.waitForURL(/\/projects\/[^/]+$/);
  await page.waitForLoadState("networkidle");
  const projectId = page.url().split("/").pop();
  assert.ok((await page.textContent("body")).includes("项目概览"));
  pass("进入项目概览");

  await page.goto(`http://localhost:3000/projects/${projectId}/issues`, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  await page.getByRole("button", { name: "XH-CPU-2601001" }).click();
  await page.waitForSelector(".detail-pane");
  await page.waitForTimeout(900);
  assert.ok((await page.locator(".detail-pane").textContent()).includes("首次录入问题"));

  await page.getByRole("button", { name: /更新全部状态/ }).click();
  await page.waitForSelector(".modal");
  await page.locator(".modal select").selectOption({ index: 1 });
  await page.locator(".modal .rich-area").fill("UI 验证：已定位到散热接触问题，等待复测。");
  await page.screenshot({ path: out + "/01-status-modal.png", fullPage: false });
  const statusResponse = page.waitForResponse((response) => response.url().includes("/status") && response.request().method() === "POST");
  await page.getByRole("button", { name: /确认更新状态/ }).click();
  const statusResult = await statusResponse;
  assert.equal(statusResult.status(), 200);
  await page.waitForSelector(".modal", { state: "detached" });
  await page.waitForTimeout(900);
  assert.ok((await page.textContent("body")).includes("状态已更新"));
  assert.ok((await page.locator(".detail-pane").textContent()).includes("已定位"));
  pass("界面内状态更新（必填原因/二次确认/刷新详情）");

  await page.getByRole("button", { name: /转移整码责任/ }).click();
  await page.waitForSelector(".modal");
  const selects = page.locator(".modal select");
  if (await selects.count() >= 2) {
    const groupLabels = await selects.nth(0).locator("option").allTextContents();
    const groupIndex = groupLabels.findIndex((label) => label.includes("CPU 测试组"));
    if (groupIndex >= 0) await selects.nth(0).selectOption({ index: groupIndex });
    const memberSelect = selects.nth(1);
    const memberLabels = await memberSelect.locator("option").allTextContents();
    const memberIndex = memberLabels.findIndex((label) => label.includes("刘洋"));
    assert.ok(memberIndex >= 0, "找不到组内成员刘洋");
    await memberSelect.selectOption({ index: memberIndex });
  }
  await page.locator(".modal .rich-area").fill("UI 验证：组内转交给刘洋继续跟进。");
  await page.screenshot({ path: out + "/02-transfer-modal.png", fullPage: false });
  const transferResponse = page.waitForResponse((response) => response.url().includes("/transfer") && response.request().method() === "POST");
  await page.getByRole("button", { name: /确认转移/ }).click();
  const transferResult = await transferResponse;
  if (transferResult.status() !== 200) {
    const errorText = await page.locator(".modal .alert-error").textContent().catch(() => "");
    throw new Error("转移失败 HTTP " + transferResult.status() + " " + errorText);
  }
  await page.waitForSelector(".modal", { state: "detached" });
  await page.waitForTimeout(800);
  assert.ok((await page.textContent("body")).includes("已完成组内转交"));
  pass("界面内组内转交并刷新责任历史");

  await page.getByRole("button", { name: /录入问题/ }).first().click();
  await page.waitForSelector(".modal");
  await page.screenshot({ path: out + "/03-entry-modal.png", fullPage: false });
  await page.locator(".modal input").nth(0).fill("A-01");
  const stubResponse = page.waitForResponse((response) => response.url().includes("/integrations/current-device"));
  await page.getByRole("button", { name: /从设备接口读取/ }).click();
  const stub = await stubResponse;
  assert.equal(stub.status(), 200);
  await page.waitForTimeout(400);
  assert.ok((await page.locator(".modal input").nth(1).inputValue()).startsWith("SIM-"));
  const createResponse = page.waitForResponse((response) => response.url().endsWith("/issues") && response.request().method() === "POST");
  await page.getByRole("button", { name: /确认录入并分配/ }).click();
  const created = await createResponse;
  assert.equal(created.status(), 201);
  await page.waitForSelector(".modal", { state: "detached" });
  await page.waitForTimeout(1100);
  assert.ok((await page.locator(".detail-tab").count()) >= 2);
  assert.ok((await page.textContent("body")).includes("问题已录入并按当前排班完成责任分配"));
  pass("界面录入问题、设备接口桩、条码详情标签页");

  await page.getByRole("button", { name: /批量导入/ }).click();
  await page.waitForSelector(".modal");
  assert.ok((await page.textContent(".modal")).includes("下载 Excel 模板"));
  await page.keyboard.press("Escape");
  await page.waitForSelector(".modal", { state: "detached" });
  pass("批量导入弹窗与模板入口");

  await page.goto(`http://localhost:3000/projects/${projectId}/groups`, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  await page.locator(".group-card").filter({ hasText: "CPU 测试组" }).locator(".group-card-foot a").click();
  await page.waitForURL(/\/groups\/[^/]+$/);
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: /星期排班/ }).click();
  await page.waitForTimeout(400);
  assert.ok((await page.textContent("body")).includes("白班"));
  await page.getByRole("button", { name: /临时调班/ }).click();
  await page.waitForTimeout(300);
  assert.ok((await page.textContent("body")).includes("节假日覆盖"));
  await page.screenshot({ path: out + "/04-group-schedules.png", fullPage: true });
  pass("责任组详情：成员、星期排班、临时调班标签页");

  await page.goto(`http://localhost:3000/projects/${projectId}/communication`, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  const simResponse = page.waitForResponse((response) => response.url().includes("/communication?") && response.request().method() === "GET");
  await page.getByRole("button", { name: /模拟查看/ }).click();
  assert.equal((await simResponse).status(), 200);
  await page.waitForTimeout(500);
  await page.locator(".sim-form input[placeholder*='责任组']").fill("CPU");
  assert.ok((await page.textContent(".comm-grid")).includes("CPU 测试组"));
  pass("沟通地图模拟与责任组筛选");

  await page.goto(`http://localhost:3000/projects/${projectId}/statistics`, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  await page.getByRole("link", { name: /时间线/ }).first().click();
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(500);
  assert.ok((await page.textContent("body")).includes("出现频率时间线"));
  pass("高频报错统计与单项时间线");

  await page.goto("http://localhost:3000/notifications", { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  assert.ok((await page.textContent("body")).includes("通知中心"));
  const markAll = page.getByRole("button", { name: /全部已读/ });
  if (await markAll.count()) {
    const markResponse = page.waitForResponse((response) => response.url().endsWith("/api/notifications") && response.request().method() === "PATCH");
    await markAll.click();
    assert.equal((await markResponse).status(), 200);
    await page.waitForTimeout(600);
  }
  pass("通知中心与全部已读");

  await page.screenshot({ path: out + "/05-final-notifications.png", fullPage: false });
  await page.locator(".user-chip button").first().click();
  await page.getByRole("button", { name: /退出登录/ }).click();
  await page.waitForURL("**/login");
  pass("退出登录");

  if (errors.length > 0) throw new Error("浏览器出现错误: " + errors.join(" | "));
  console.log("\n===== UI FLOWS ALL PASSED =====");
  console.log(steps.length + " UI flows passed");
  console.log(JSON.stringify({ steps, errors, projectId }, null, 2));
} catch (error) {
  await page.screenshot({ path: out + "/failure.png", fullPage: true }).catch(() => {});
  console.error("\n===== UI FLOW FAILED =====");
  console.error(error);
  console.error(JSON.stringify({ steps, errors, url: page.url() }, null, 2));
  process.exitCode = 1;
} finally {
  await browser.close();
}