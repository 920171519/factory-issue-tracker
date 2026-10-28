import type { NextRequest } from "next/server";
import { apiError, headerSecret, json } from "@/lib/http";
import { runShiftHandoff } from "@/lib/handoff";

async function handle(request: NextRequest) {
  try {
    const expected = process.env.CRON_SECRET;
    if (!expected) return json({ error: "未配置 CRON_SECRET，交班接口不可用" }, 503);
    if (headerSecret(request) !== expected) return json({ error: "无效的任务密钥" }, 401);
    const result = runShiftHandoff(new Date());
    return json(result);
  } catch (error) {
    return apiError(error);
  }
}

export async function GET(request: NextRequest) {
  return handle(request);
}

export async function POST(request: NextRequest) {
  return handle(request);
}
