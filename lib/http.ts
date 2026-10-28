import { NextResponse, type NextRequest } from "next/server";
import type { ZodType } from "zod";
import { AppError } from "@/lib/errors";
import { requireRequestUser, type PublicUser } from "@/lib/auth";

export function json(data: unknown, status = 200): NextResponse {
  return NextResponse.json(data, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export function apiError(error: unknown): NextResponse {
  if (error instanceof AppError) {
    return json({ error: error.message, details: error.details }, error.status);
  }
  if (error && typeof error === "object" && "issues" in error) {
    const issues = (error as { issues?: { message?: string }[] }).issues;
    return json({ error: issues?.[0]?.message || "请求参数不正确" }, 400);
  }
  console.error("[api] unexpected error", error);
  return json({ error: "服务器内部错误，请稍后重试" }, 500);
}

export async function readJson<T>(request: NextRequest, schema: ZodType<T>): Promise<T> {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    throw new AppError(400, "请求体不是有效的 JSON");
  }
  const result = schema.safeParse(payload);
  if (!result.success) {
    throw new AppError(400, result.error.issues[0]?.message || "请求参数不正确");
  }
  return result.data;
}

export function requireApiUser(request: NextRequest): PublicUser {
  return requireRequestUser(request);
}

export function queryInt(value: string | null, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function headerSecret(request: NextRequest): string | null {
  const authorization = request.headers.get("authorization");
  if (authorization?.startsWith("Bearer ")) return authorization.slice("Bearer ".length).trim();
  return request.headers.get("x-cron-secret");
}
