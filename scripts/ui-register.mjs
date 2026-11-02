/**
 * 注册工号自由填写校验：
 *  1. 注册页提示支持不同类型工号，不再限制「1 个字母 + 8 位数字」；
 *  2. 使用自定义工号（E2E-2026-0001）可完成注册并进入工作台，页面显示该工号；
 *  3. 含空格的工号被服务端拒绝；重复工号返回 409；
 *  4. 结束后清理测试账号。
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import Database from "better-sqlite3";
import { chromium } from "@playwright/test";

const BASE = process.env.E2E_BASE_URL || "http://localhost:3000";
const DB_PATH = process.env.DATABASE_PATH || "data/app.db";
const EMPLOYEE_NO = `E2E-${Date.now().toString(36).toUpperCase()}`;
const NAME = "注册校验员";
await fs.mkdir("test-results/ui-register", { recursive: true });

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

function cleanup() {
  try {
    const db = new Database(DB_PATH);
    db.prepare("DELETE FROM users WHERE employee_no = ?").run(EMPLOYEE_NO);
    db.close();
  } catch (error) {
    console.error("清理测试账号失败：", error);
  }
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
  // 1. 服务端拒绝含空格的工号
  const invalid = await context.request.post(`${BASE}/api/auth/register`, {
    data: { name: "空格工号", employeeNo: "A 001", password: "Demo1234" },
  });
  assert.equal(invalid.status(), 400, `含空格工号应返回 400，实际 ${invalid.status()}`);

  // 2. 注册页提示与输入限制
  await page.goto(`${BASE}/register`, { waitUntil: "networkidle" });
  await page.waitForTimeout(300);
  const hint = await page.locator(".field-hint").first().textContent();
  assert.ok((hint || "").includes("支持字母、数字"), "注册页应提示工号支持多种字符");
  const employeeInput = page.locator("#employeeNo");
  assert.equal(await employeeInput.getAttribute("maxlength"), "40", "工号输入应为最多 40 字符");
  pass("注册页不再限制固定工号格式并给出说明");

  // 3. 使用自定义工号注册
  await page.locator("#name").fill(NAME);
  await employeeInput.fill(EMPLOYEE_NO);
  await page.locator("#password").fill("Demo1234");
  await page.getByRole("button", { name: /注册并进入/ }).click();
  await page.waitForURL("**/projects", { timeout: 30000 });
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(500);
  const body = await page.locator("body").textContent();
  assert.ok(body.includes(NAME), "登录后应显示注册姓名");
  assert.ok(body.includes(EMPLOYEE_NO), "登录后应显示自定义工号");
  pass("自定义工号注册成功并可进入工作台");

  // 4. 重复工号被拒绝
  const duplicate = await context.request.post(`${BASE}/api/auth/register`, {
    data: { name: "重复账号", employeeNo: EMPLOYEE_NO, password: "Demo1234" },
  });
  assert.equal(duplicate.status(), 409, `重复工号应返回 409，实际 ${duplicate.status()}`);
  pass("重复工号注册被拒绝");

  await page.screenshot({ path: "test-results/ui-register/registered.png", fullPage: false }).catch(() => {});
  const realErrors = errors.filter((text) => !text.includes("favicon.ico"));
  if (realErrors.length > 0) throw new Error("浏览器出现错误: " + realErrors.join(" | "));
  console.log("\n===== REGISTER UI VERIFY PASSED =====");
  console.log(JSON.stringify({ steps, employeeNo: EMPLOYEE_NO }, null, 2));
} catch (error) {
  console.error("\n===== REGISTER UI VERIFY FAILED =====");
  console.error(error);
  console.error(JSON.stringify({ steps, errors, url: page.url() }, null, 2));
  process.exitCode = 1;
} finally {
  await browser.close();
  cleanup();
}
