import { chromium } from "@playwright/test";
import fs from "node:fs/promises";

const out = "test-results/ui";
await fs.mkdir(out, { recursive: true });
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: "zh-CN", timezoneId: "Asia/Shanghai" });
const page = await context.newPage();
const errors = [];
page.on("console", (msg) => { if (msg.type() === "error") errors.push("console: " + msg.text()); });
page.on("pageerror", (error) => errors.push("pageerror: " + error.message));

async function settle() {
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(650);
}

try {
  await page.goto("http://localhost:3000/login", { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  await page.screenshot({ path: out + "/01-login.png", fullPage: true });
  await page.locator("#employeeNo").fill("a00000001");
  await page.locator("#password").fill("Demo1234");
  await page.getByRole("button", { name: /进入工作台/ }).click();
  await page.waitForURL("**/projects", { timeout: 20000 });
  await settle();
  await page.screenshot({ path: out + "/02-projects.png", fullPage: true });
  await page.getByText("星河服务器 NPI 验证项目", { exact: true }).first().click();
  await page.waitForURL(/\/projects\/[^/]+$/);
  await settle();
  const projectId = page.url().split("/").pop();
  await page.screenshot({ path: out + "/03-home.png", fullPage: true });

  await page.goto("http://localhost:3000/projects/" + projectId + "/issues", { waitUntil: "networkidle" });
  await settle();
  await page.screenshot({ path: out + "/04-issues.png", fullPage: true });
  await page.locator(".barcode-link").first().click();
  await page.waitForTimeout(1500);
  await page.locator(".detail-pane").screenshot({ path: out + "/05-issue-detail.png" });

  await page.goto("http://localhost:3000/projects/" + projectId + "/groups", { waitUntil: "networkidle" });
  await settle();
  await page.screenshot({ path: out + "/06-groups.png", fullPage: true });
  const groupHref = await page.locator(".group-card .link-btn").first().getAttribute("href");
  await page.goto("http://localhost:3000" + groupHref, { waitUntil: "networkidle" });
  await settle();
  await page.screenshot({ path: out + "/07-group-detail.png", fullPage: true });

  await page.goto("http://localhost:3000/projects/" + projectId + "/communication", { waitUntil: "networkidle" });
  await settle();
  await page.screenshot({ path: out + "/08-communication.png", fullPage: true });

  await page.goto("http://localhost:3000/projects/" + projectId + "/settings", { waitUntil: "networkidle" });
  await settle();
  await page.screenshot({ path: out + "/09-settings.png", fullPage: true });

  await page.goto("http://localhost:3000/projects/" + projectId + "/statistics", { waitUntil: "networkidle" });
  await settle();
  await page.screenshot({ path: out + "/10-stats.png", fullPage: true });

  await page.goto("http://localhost:3000/projects/" + projectId + "/approvals", { waitUntil: "networkidle" });
  await settle();
  await page.screenshot({ path: out + "/11-approvals.png", fullPage: true });

  await page.goto("http://localhost:3000/projects/" + projectId + "/info", { waitUntil: "networkidle" });
  await settle();
  await page.screenshot({ path: out + "/12-info.png", fullPage: true });

  await page.goto("http://localhost:3000/projects/" + projectId + "/members", { waitUntil: "networkidle" });
  await settle();
  await page.screenshot({ path: out + "/13-members.png", fullPage: true });

  await page.goto("http://localhost:3000/notifications", { waitUntil: "networkidle" });
  await settle();
  await page.screenshot({ path: out + "/14-notifications.png", fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("http://localhost:3000/projects/" + projectId + "/issues", { waitUntil: "networkidle" });
  await settle();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: out + "/15-mobile-issues.png", fullPage: true });

  console.log(JSON.stringify({ errors, projectId, url: page.url() }, null, 2));
} catch (error) {
  await page.screenshot({ path: out + "/failure.png", fullPage: true }).catch(() => {});
  console.error("SMOKE FAILED", error);
  console.log(JSON.stringify({ errors }, null, 2));
  process.exitCode = 1;
} finally {
  await browser.close();
}