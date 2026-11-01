/**
 * 问题跟踪「录入时间筛选 / 同一條码多次录入」浏览器校验（只读）：
 *  1. 默认按「今天 + 仅未闭环」展示，时间筛选栏可见；
 *  2. 列表展示录入时间与录入次数，按最近录入倒序；
 *  3. 打开重复录入的条码详情，能看到每次录入的时间与报错项；
 *  4. 切换到无数据的日期显示空结果，点击「显示全部历史」恢复全部条码。
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { chromium } from "@playwright/test";

const BASE = process.env.E2E_BASE_URL || "http://localhost:3000";
const out = "test-results/ui-issues-history";
await fs.mkdir(out, { recursive: true });

function localDate(offsetDays = 0) {
  const date = new Date(Date.now() + offsetDays * 86_400_000);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

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
page.on("console", (msg) => { if (msg.type() === "error") errors.push(`${msg.text()} @ ${msg.location()?.url || ""}`); });
page.on("pageerror", (error) => errors.push(error.message));
const steps = [];
const pass = (name) => { steps.push(name); console.log("PASS", name); };

try {
  const login = await context.request.post(`${BASE}/api/auth/login`, { data: { employeeNo: "p00000001", password: "Demo1234" } });
  assert.equal(login.status(), 200, "API 登录应成功");
  await page.goto(`${BASE}/projects`, { waitUntil: "networkidle" });
  await page.getByText("星河服务器 NPI 验证项目", { exact: true }).first().click();
  await page.waitForURL(/\/projects\/[^/]+$/);
  const projectId = page.url().split("/").pop();
  await page.goto(`${BASE}/projects/${projectId}/issues`, { waitUntil: "networkidle" });
  await page.waitForSelector(".issue-table tbody tr");
  await page.waitForTimeout(600);

  // 1. 默认筛选
  const fromInput = page.locator('input[aria-label="录入开始日期"]');
  const toInput = page.locator('input[aria-label="录入结束日期"]');
  assert.equal(await fromInput.inputValue(), localDate(0), "默认录入开始日期应为今天");
  assert.equal(await toInput.inputValue(), localDate(0), "默认录入结束日期应为今天");
  const openOnly = page.locator(".issue-timebar .checkbox-line input");
  assert.equal(await openOnly.isChecked(), true, "默认应勾选仅未闭环");
  pass("默认按今天 + 仅未闭环展示");

  // 2. 列表列与录入次数
  const headers = await page.locator(".issue-table thead th").allTextContents();
  assert.ok(headers.includes("录入时间"), "列表应包含录入时间列");
  const rows = page.locator(".issue-table tbody tr");
  const rowCount = await rows.count();
  assert.ok(rowCount >= 4, `默认应展示当天条码，实际 ${rowCount}`);
  const cpuRow = rows.filter({ hasText: "XH-CPU-2601001" });
  const cpuEntryMatch = (await cpuRow.textContent()).match(/(\d+) 次录入/);
  assert.ok(cpuEntryMatch && Number(cpuEntryMatch[1]) >= 2, "重复录入的条码应显示多次录入");
  const firstRowText = await rows.first().textContent();
  assert.ok(/\d{2}-\d{2} \d{2}:\d{2}/.test(firstRowText), "录入时间应显示日期与时间");
  pass("列表展示录入时间与录入次数");

  // 3. 条码详情中的录入历史
  await cpuRow.locator(".barcode-link").click();
  await page.waitForSelector(".issue-detail-card", { timeout: 60000 });
  await page.waitForTimeout(600);
  const detailText = await page.locator(".issue-detail-card").textContent();
  assert.ok(detailText.includes("录入历史"), "详情应展示录入历史");
  assert.ok(detailText.includes("第 1 次录入"), "详情应标出第 1 次录入");
  assert.ok(/第 [23] 次录入/.test(detailText), "详情应标出后续录入次数");
  assert.ok(detailText.includes("复测再次出现"), "详情应展示第二次录入的报错项");
  assert.ok(detailText.includes("首次录入问题"), "详情应保留下首次录入记录");
  await page.screenshot({ path: `${out}/01-repeat-entry-detail.png` });
  pass("条码详情按录入时间区分每次错误");

  // 回到条码列表标签页
  await page.locator(".issue-main-tabs [role=tab]").first().click();
  await page.waitForTimeout(300);

  // 4. 查询无数据日期 → 空结果
  const emptyResponse = page.waitForResponse((response) => response.url().includes("/api/projects/") && response.url().includes("/issues?") && response.status() === 200);
  await fromInput.fill(localDate(-1));
  await toInput.fill(localDate(-1));
  await emptyResponse;
  await page.waitForTimeout(600);
  const emptyState = await page.locator(".issue-list-panel .empty-state").textContent();
  assert.ok(emptyState.includes("没有匹配的问题"), "无数据日期应提示没有匹配");
  await page.screenshot({ path: `${out}/02-empty-range.png` });
  pass("切换到无数据日期显示空结果");

  // 5. 显示全部历史恢复
  const allResponse = page.waitForResponse((response) => response.url().includes("/api/projects/") && response.url().includes("/issues?") && response.status() === 200);
  await page.getByRole("button", { name: "显示全部历史" }).click();
  await allResponse;
  await page.waitForTimeout(600);
  assert.equal(await openOnly.isChecked(), false, "显示全部后应取消仅未闭环");
  assert.equal(await fromInput.inputValue(), "", "显示全部后应清空开始日期");
  assert.ok((await page.locator(".issue-table tbody tr").count()) >= 4, "显示全部后应恢复条码列表");
  await page.screenshot({ path: `${out}/03-all-history.png`, fullPage: false });
  pass("「显示全部历史」恢复正常列表");

  const realErrors = errors.filter((text) => !text.includes("favicon.ico"));
  if (realErrors.length > 0) throw new Error("浏览器出现错误: " + realErrors.join(" | "));
  console.log("\n===== ISSUES HISTORY UI VERIFY PASSED =====");
  console.log(JSON.stringify({ steps, projectId }, null, 2));
} catch (error) {
  await page.screenshot({ path: `${out}/failure.png`, fullPage: true }).catch(() => {});
  console.error("\n===== ISSUES HISTORY UI VERIFY FAILED =====");
  console.error(error);
  console.error(JSON.stringify({ steps, errors, url: page.url() }, null, 2));
  process.exitCode = 1;
} finally {
  await browser.close();
}
