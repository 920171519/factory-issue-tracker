import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { applySessionCookie, authenticate } from "@/lib/auth";
import { apiError, readJson } from "@/lib/http";

const schema = z.object({
  employeeNo: z.string().trim().min(1, "请输入工号"),
  password: z.string().min(1, "请输入密码"),
});

export async function POST(request: NextRequest) {
  try {
    const input = await readJson(request, schema);
    const user = await authenticate(input.employeeNo, input.password);
    const response = NextResponse.json({ user });
    applySessionCookie(response, user.id);
    return response;
  } catch (error) {
    return apiError(error);
  }
}
