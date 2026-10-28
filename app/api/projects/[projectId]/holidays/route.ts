import type { NextRequest } from "next/server";
import { z } from "zod";
import { requireApiUser, apiError, json, readJson } from "@/lib/http";
import { requireProjectAccess } from "@/lib/access";
import { addHoliday, listHolidays } from "@/lib/taxonomy";

const schema = z.object({ date: z.string().min(1, "请选择日期"), name: z.string().trim().min(1, "请输入节假日名称").max(50) });

export async function GET(request: NextRequest, context: { params: Promise<{ projectId: string }> }) {
  try {
    const user = requireApiUser(request);
    const { projectId } = await context.params;
    requireProjectAccess(user.id, projectId);
    return json({ holidays: listHolidays(projectId) });
  } catch (error) { return apiError(error); }
}

export async function POST(request: NextRequest, context: { params: Promise<{ projectId: string }> }) {
  try {
    const user = requireApiUser(request);
    const { projectId } = await context.params;
    const input = await readJson(request, schema);
    return json(addHoliday(projectId, user.id, input), 201);
  } catch (error) { return apiError(error); }
}
