/**
 * 验证「问题跟踪」页的标签页布局改造：
 *  1. 条码列表是第一个标签页，且默认选中；
 *  2. 搜索、筛选、录入入口位于标签页上方（视觉顺序：工具区 → 标签栏 → 列表）；
 *  3. 点击条码在其后追加详情标签页并激活；
 *  4. 在详情标签页上点击「筛选」/修改筛选条件/搜索/切换每页数量，都会跳回第一个标签页（条码列表）；
 *  5. 筛选与搜索确实作用于条码列表数据。
 *
 * 用法：先启动开发服务器，再执行 node scripts/ui-issues-tabs.mjs
 * 可通过 PW_CHANNEL 指定 Playwright 通道（默认 chrome，其次尝试 msedge、内置 chromium）。
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { chromium } from "@playwright/test";

const BASE = process.env.E2E_BASE_URL || "http://localhost:3000";
const out = "test-results/ui-issues-tabs";
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
page.on("console", (msg) => { if (msg.type() === "error") errors.push(`${msg.text()} @ ${msg.location()?.url || "unknown"}`); });
page.on("pageerror", (error) => errors.push(error.message));
page.on("response", (response) => { if (response.status() >= 400) failedResources.push(`${response.status()} ${response.url()}`); });
const steps = [];
const pass = (name) => { steps.push(name); console.log("PASS", name); };

const listTab = page.locator('.issue-main-tabs [role="tab"]').first();
const activeTabLabel = async () => (await page.locator('.issue-main-tabs [role="tab"][aria-selected="true"]').first().textContent())?.trim();
const listRequests = [];
page.on("request", (request) => {
  if (request.method() === "GET" && /\/api\/projects\/[^/]+\/issues\?/.test(request.url())) listRequests.push(request.url());
});

try {
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.locator("#employeeNo").fill("c00000003");
  await page.locator("#password").fill("Demo1234");
  await page.getByRole("button", { name: /进入工作台/ }).click();
  await page.waitForURL("**/projects");
  await page.waitForLoadState("networkidle");
  await page.getByText("星河服务器 NPI 验证项目", { exact: true }).first().click();
  await page.waitForURL(/\/projects\/[^/]+$/);
  await page.waitForLoadState("networkidle");
  const projectId = page.url().split("/").pop();

  await page.goto(`${BASE}/projects/${projectId}/issues`, { waitUntil: "networkidle" });
  await page.waitForTimeout(600);

  // 1. 布局顺序：工具区 → 标签栏 → 列表表格
  const toolbarBox = await page.locator(".issues-toolbar-card").boundingBox();
  const tabsBox = await page.locator(".issue-main-tabs").boundingBox();
  const tableBox = await page.locator(".issue-list-panel .issue-table").boundingBox();
  assert.ok(toolbarBox && tabsBox && tableBox, "工具区/标签栏/列表应有布局尺寸");
  assert.ok(toolbarBox.y + toolbarBox.height <= tabsBox.y + 1, `工具区应在标签栏上方：toolbar底=${toolbarBox.y + toolbarBox.height} tabs顶=${tabsBox.y}`);
  assert.ok(tabsBox.y + tabsBox.height <= tableBox.y + 1, `标签栏应在列表上方：tabs底=${tabsBox.y + tabsBox.height} 表格顶=${tableBox.y}`);
  assert.ok(await page.locator(".issues-toolbar-card .issue-toolbar input.input").isVisible(), "搜索框应在工具区");
  assert.ok(await page.locator(".issues-toolbar-card").getByRole("button", { name: /录入问题/ }).isVisible(), "录入入口应在工具区");
  pass("工具区（搜索/筛选/录入/导入/模板）位于标签栏上方");

  // 2. 条码列表是第一个标签页且默认选中
  assert.ok((await listTab.textContent()).includes("条码列表"), "第一个标签页应为条码列表");
  assert.equal(await listTab.getAttribute("aria-selected"), "true", "默认应选中条码列表");
  assert.equal(await page.locator(".issue-main-tabs .issue-main-barcode-tab").count(), 0, "初始不应有详情标签页");
  assert.ok(await page.locator(".issue-list-panel").isVisible(), "条码列表面板应可见");
  pass("条码列表是第一个标签页并默认激活");

  // 3. 点击条码在其后追加详情标签页
  const firstBarcode = (await page.locator(".issue-list-panel .barcode-link").first().textContent()).trim();
  await page.locator(".issue-list-panel .barcode-link").first().click();
  await page.waitForSelector(".issue-detail-card", { state: "visible" });
  await page.waitForTimeout(500);
  let barcodeTabs = page.locator(".issue-main-tabs .issue-main-barcode-tab");
  assert.equal(await barcodeTabs.count(), 1, "应追加 1 个详情标签页");
  assert.equal((await barcodeTabs.first().textContent()).trim().startsWith(firstBarcode), true, "标签页标题应为条码号");
  assert.equal(await barcodeTabs.first().getAttribute("aria-selected"), "true", "新开的详情标签页应激活");
  assert.equal(await listTab.getAttribute("aria-selected"), "false", "打开详情后条码列表应变为非激活");
  pass("点击条码在列表标签页之后追加并激活详情标签页");

  // 4. 再开一个条码 → 追加在末尾，顺序保持
  const secondBarcode = (await page.locator(".issue-list-panel .barcode-link").nth(1).textContent()).trim();
  await page.locator(".issue-main-tabs [role=tab]").first().click();
  await page.waitForTimeout(200);
  await page.locator(".issue-list-panel .barcode-link").nth(1).click();
  await page.waitForTimeout(400);
  barcodeTabs = page.locator(".issue-main-tabs .issue-main-barcode-tab");
  assert.equal(await barcodeTabs.count(), 2, "应有 2 个详情标签页");
  assert.equal((await barcodeTabs.nth(1).textContent()).trim().startsWith(secondBarcode), true, "新标签页应追加在已有详情之后");
  pass("详情标签页按点击顺序追加在列表标签页之后");

  // 5. 在详情标签页上点击「筛选」→ 跳回第一个标签页
  assert.equal(await listTab.getAttribute("aria-selected"), "false");
  await page.locator(".issues-toolbar-card").getByRole("button", { name: /筛选/ }).click();
  await page.waitForTimeout(400);
  assert.equal(await listTab.getAttribute("aria-selected"), "true", "点击筛选后应回到条码列表");
  assert.ok(await page.locator(".filters-panel").isVisible(), "筛选面板应展开");
  pass("在详情标签页点击「筛选」自动跳回第一个标签页");

  // 6. 切换筛选条件 → 仍停留在条码列表，并真实请求带筛选参数
  const groupSelect = page.locator(".filters-panel select").first();
  const groupOptions = await groupSelect.locator("option").count();
  assert.ok(groupOptions > 1, "应至少有一个责任组可筛选");
  listRequests.length = 0;
  const filterResponse = page.waitForResponse((response) => /\/api\/projects\/[^/]+\/issues\?/.test(response.url()) && response.status() === 200);
  await groupSelect.selectOption({ index: 1 });
  await filterResponse;
  await page.waitForTimeout(500);
  assert.equal(await listTab.getAttribute("aria-selected"), "true", "修改筛选条件后应停留在条码列表");
  assert.ok(listRequests.some((url) => /[?&]groupId=[^&]+/.test(url)), `请求应带 groupId：${listRequests.join(" | ")}`);
  assert.ok(await page.locator(".issue-detail-panel:not([hidden])").count() === 0, "条码列表激活时详情面板应隐藏");
  pass("修改筛选条件后仍停留在条码列表且请求带筛选参数");

  // 7. 在详情标签页搜索 → 跳回第一个标签页
  await page.locator(".issue-main-tabs .issue-main-barcode-tab").first().click();
  await page.waitForTimeout(300);
  assert.equal(await listTab.getAttribute("aria-selected"), "false");
  listRequests.length = 0;
  const searchResponse = page.waitForResponse((response) => /\/api\/projects\/[^/]+\/issues\?/.test(response.url()) && response.status() === 200);
  await page.locator(".issues-toolbar-card input.input").fill(firstBarcode);
  await page.locator(".issues-toolbar-card").getByRole("button", { name: "搜索" }).click();
  await searchResponse;
  await page.waitForTimeout(600);
  assert.equal(await listTab.getAttribute("aria-selected"), "true", "搜索后应回到条码列表");
  assert.ok(listRequests.some((url) => url.includes(`search=${encodeURIComponent(firstBarcode)}`)), "请求应带搜索词");
  const visibleBarcodes = await page.locator(".issue-list-panel .barcode-link").allTextContents();
  assert.ok(visibleBarcodes.length >= 1, "搜索应至少命中一条");
  assert.ok(visibleBarcodes.every((text) => text.includes(firstBarcode)), `搜索结果应全部匹配：${visibleBarcodes.join(",")}`);
  await page.screenshot({ path: `${out}/01-toolbar-above-tabs-and-searched.png`, fullPage: false });
  pass("在详情标签页搜索自动跳回条码列表且结果匹配");

  // 8. 清除筛选回到全部数据，仍然停留在第一个标签页
  const resetResponse = page.waitForResponse((response) => /\/api\/projects\/[^/]+\/issues\?/.test(response.url()) && response.status() === 200);
  await page.getByRole("button", { name: /清除筛选/ }).click();
  await resetResponse;
  await page.waitForTimeout(600);
  assert.equal(await listTab.getAttribute("aria-selected"), "true");
  assert.equal(await page.locator(".issues-toolbar-card input.input").inputValue(), "", "清除后搜索框应为空");
  pass("清除筛选恢复全部条码并停留在第一个标签页");

  // 9. 每页数量变化同样回到第一个标签页
  await page.locator(".issue-main-tabs .issue-main-barcode-tab").first().click();
  await page.waitForTimeout(250);
  const sizeResponse = page.waitForResponse((response) => /\/api\/projects\/[^/]+\/issues\?/.test(response.url()) && response.status() === 200);
  await page.locator(".issues-toolbar-card select[aria-label='每页显示数量']").selectOption("10");
  await sizeResponse;
  await page.waitForTimeout(400);
  assert.equal(await listTab.getAttribute("aria-selected"), "true", "切换每页数量后应回到条码列表");
  pass("切换每页数量回到第一个标签页");

  // 10. 关闭全部标签页后仍停留在条码列表
  await page.locator(".issue-tabbar-action").click();
  await page.waitForTimeout(300);
  assert.equal(await page.locator(".issue-main-tabs .issue-main-barcode-tab").count(), 0);
  assert.equal(await listTab.getAttribute("aria-selected"), "true");
  assert.ok(await page.locator(".issue-list-panel").isVisible());
  pass("关闭全部详情标签页后回到条码列表");

  // 11. 深链接 ?barcode=<id> 仍然打开详情标签页，且条码列表仍在第一位
  const deepLinkId = await page.evaluate(async (pid) => {
    const response = await fetch(`/api/projects/${pid}/issues?page=1&pageSize=1`);
    const json = await response.json();
    return json.rows?.[0]?.id;
  }, projectId);
  assert.ok(deepLinkId, "应能取到条码 id");
  await page.goto(`${BASE}/projects/${projectId}/issues?barcode=${deepLinkId}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  assert.equal((await page.locator(".issue-main-tabs [role=tab]").first().textContent()).includes("条码列表"), true, "深链接场景下条码列表仍应是第一个标签页");
  assert.equal(await page.locator(".issue-main-tabs .issue-main-barcode-tab").count(), 1, "深链接应自动打开 1 个详情标签页");
  assert.equal(await page.locator(".issue-main-tabs .issue-main-barcode-tab").first().getAttribute("aria-selected"), "true", "深链接的详情标签页应激活");
  assert.ok(await page.locator(".issues-toolbar-card").isVisible(), "深链接场景下工具区仍应可见");
  pass("深链接 ?barcode= 打开详情标签页且条码列表仍为第一个");

  await page.screenshot({ path: `${out}/02-issues-default.png`, fullPage: true });

  // 12. 移动端宽度下工具区仍位于标签栏上方（仅截图留证，不做像素断言）
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE}/projects/${projectId}/issues`, { waitUntil: "networkidle" });
  await page.waitForTimeout(700);
  const mobileToolbar = await page.locator(".issues-toolbar-card").boundingBox();
  const mobileTabs = await page.locator(".issue-main-tabs").boundingBox();
  assert.ok(mobileToolbar && mobileTabs && mobileToolbar.y + mobileToolbar.height <= mobileTabs.y + 1, "移动端工具区仍应在标签栏上方");
  await page.screenshot({ path: `${out}/03-mobile-toolbar.png`, fullPage: true });
  pass("移动端宽度下工具区仍在标签栏上方");
  if (failedResources.length > 0) throw new Error("出现失败请求: " + failedResources.join(" | "));
  // 项目本身未提供 favicon，浏览器会报一条 favicon.ico 404，与本页面无关。
  const realErrors = errors.filter((text) => !text.includes("favicon.ico"));
  if (realErrors.length > 0) throw new Error("浏览器出现错误: " + realErrors.join(" | "));
  console.log("\n===== ISSUES TABS VERIFY PASSED =====");
  console.log(JSON.stringify({ steps, errors, projectId }, null, 2));
} catch (error) {
  await page.screenshot({ path: `${out}/failure.png`, fullPage: true }).catch(() => {});
  console.error("\n===== ISSUES TABS VERIFY FAILED =====");
  console.error(error);
  console.error(JSON.stringify({ steps, errors, failedResources, url: page.url() }, null, 2));
  process.exitCode = 1;
} finally {
  await browser.close();
}
