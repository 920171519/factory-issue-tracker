import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { applySessionCookie, registerAccount } from "@/lib/auth";
import { apiError, readJson } from "@/lib/http";

const schema = z.object({
  name: z.string().trim().min(2, "姓名至少 2 个字符").max(30, "姓名最多 30 个字符"),
  employeeNo: z.string().trim().regex(/^[a-z]\d{8}$/, "工号格式必须为 1 个小写字母 + 8 个数字，例如 a00000001"),
  password: z.string().min(6, "密码至少 6 位").max(72, "密码最多 72 位"),
});

export async function POST(request: NextRequest) {
  try {
    const input = await readJson(request, schema);
    const user = await registerAccount(input);
    const response = NextResponse.json({ user }, { status: 201 });
    applySessionCookie(response, user.id);
    return response;
  } catch (error) {
    return apiError(error);
  }
}
