import { createHmac, timingSafeEqual } from "node:crypto";
import bcrypt from "bcryptjs";
import type { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { newId } from "@/lib/ids";

export const SESSION_COOKIE = "fit_session";
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

export interface UserRow {
  id: string;
  name: string;
  employee_no: string;
  password_hash: string;
  is_system_admin: number;
  created_at: string;
}

export interface PublicUser {
  id: string;
  name: string;
  employeeNo: string;
  isSystemAdmin: boolean;
}

export function publicUser(user: Pick<UserRow, "id" | "name" | "employee_no" | "is_system_admin">): PublicUser {
  return {
    id: user.id,
    name: user.name,
    employeeNo: user.employee_no,
    isSystemAdmin: user.is_system_admin === 1,
  };
}

function sessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (secret && secret.length >= 16) return secret;
  if (process.env.NODE_ENV !== "production") {
    return "factory-issue-tracker-development-secret";
  }
  throw new AppError(500, "缺少 SESSION_SECRET 环境变量");
}

function b64url(value: string | Buffer): string {
  return Buffer.from(value).toString("base64url");
}

export function signSessionToken(userId: string, now = Date.now()): string {
  const payload = b64url(JSON.stringify({ uid: userId, iat: Math.floor(now / 1000), exp: Math.floor(now / 1000) + SESSION_TTL_SECONDS }));
  const signature = createHmac("sha256", sessionSecret()).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

export function verifySessionToken(token: string, now = Date.now()): string | null {
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;
  const expected = createHmac("sha256", sessionSecret()).update(payload).digest("base64url");
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length) return null;
  if (!timingSafeEqual(actualBuffer, expectedBuffer)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { uid?: string; exp?: number };
    if (!data.uid || !data.exp || data.exp * 1000 < now) return null;
    return data.uid;
  } catch {
    return null;
  }
}

export function getUserById(id: string): UserRow | null {
  return (getDb().prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow | undefined) ?? null;
}

export function getUserByEmployeeNo(employeeNo: string): UserRow | null {
  return (getDb().prepare("SELECT * FROM users WHERE employee_no = ?").get(employeeNo) as UserRow | undefined) ?? null;
}

export async function registerAccount(input: { name: string; employeeNo: string; password: string }): Promise<PublicUser> {
  const name = input.name.trim();
  const employeeNo = input.employeeNo.trim();
  const password = input.password;
  if (name.length < 2 || name.length > 30) throw new AppError(400, "姓名长度应为 2–30 个字符");
  if (!/^[a-z]\d{8}$/.test(employeeNo)) throw new AppError(400, "工号格式必须为 1 个小写字母 + 8 个数字，例如 a00000001");
  if (password.length < 6 || password.length > 72) throw new AppError(400, "密码长度应为 6–72 位");
  if (getUserByEmployeeNo(employeeNo)) throw new AppError(409, "该工号已注册");

  const passwordHash = await bcrypt.hash(password, 11);
  const user: UserRow = {
    id: newId("usr"),
    name,
    employee_no: employeeNo,
    password_hash: passwordHash,
    is_system_admin: 0,
    created_at: new Date().toISOString(),
  };
  getDb()
    .prepare("INSERT INTO users (id, name, employee_no, password_hash, is_system_admin, created_at) VALUES (?, ?, ?, ?, 0, ?)")
    .run(user.id, user.name, user.employee_no, user.password_hash, user.created_at);
  return publicUser(user);
}

export async function authenticate(employeeNo: string, password: string): Promise<PublicUser> {
  const user = getUserByEmployeeNo(employeeNo.trim());
  if (!user) throw new AppError(401, "账号不存在，请检查工号");
  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) throw new AppError(401, "密码错误，请重新输入");
  return publicUser(user);
}

export function getRequestUser(req: NextRequest): PublicUser | null {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const userId = verifySessionToken(token);
  if (!userId) return null;
  const user = getUserById(userId);
  return user ? publicUser(user) : null;
}

export function requireRequestUser(req: NextRequest): PublicUser {
  const user = getRequestUser(req);
  if (!user) throw new AppError(401, "请先登录");
  return user;
}

function secureCookies(): boolean {
  if (process.env.COOKIE_SECURE === "false") return false;
  return process.env.NODE_ENV === "production";
}

export function applySessionCookie(response: NextResponse, userId: string): void {
  response.cookies.set(SESSION_COOKIE, signSessionToken(userId), {
    httpOnly: true,
    sameSite: "lax",
    secure: secureCookies(),
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
}

export function clearSessionCookie(response: NextResponse): void {
  response.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: secureCookies(),
    path: "/",
    maxAge: 0,
  });
}

export async function getPageUser(): Promise<PublicUser | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const userId = verifySessionToken(token);
  if (!userId) return null;
  const user = getUserById(userId);
  return user ? publicUser(user) : null;
}

export async function requirePageUser(): Promise<PublicUser> {
  const user = await getPageUser();
  if (!user) redirect("/login");
  return user;
}