import type { NextRequest } from "next/server";
import { z } from "zod";
import { requireApiUser } from "@/lib/http";
import { apiError, json, readJson } from "@/lib/http";
import { createProject, listProjectsForUser } from "@/lib/projects";
import { AppError } from "@/lib/errors";

const schema = z.object({
  name: z.string().trim().min(1, "请输入项目名称").max(80, "项目名称不能超过 80 个字符"),
  code: z.string().trim().max(40, "项目编码不能超过 40 个字符").optional(),
  description: z.string().trim().max(500, "项目简介不能超过 500 个字符").optional(),
});

export async function GET(request: NextRequest) {
  try {
    const user = requireApiUser(request);
    return json({ projects: listProjectsForUser(user.id) });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = requireApiUser(request);
    if (!user.isSystemAdmin) throw new AppError(403, "仅系统管理员可创建项目");
    const input = await readJson(request, schema);
    const project = createProject(user.id, input);
    return json({ project }, 201);
  } catch (error) {
    return apiError(error);
  }
}
