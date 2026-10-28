import type { NextRequest } from "next/server";
import { z } from "zod";
import { requireApiUser, apiError, json, readJson } from "@/lib/http";
import { requireProjectAccess } from "@/lib/access";
import { createTimeSlot, listTimeSlotViews } from "@/lib/taxonomy";

const schema = z.object({
  name: z.string().trim().min(1, "请输入班次名称"),
  start: z.string().regex(/^\d{2}:\d{2}$/, "开始时间格式为 HH:mm"),
  end: z.string().regex(/^\d{2}:\d{2}$/, "结束时间格式为 HH:mm"),
});

export async function GET(request: NextRequest, context: { params: Promise<{ projectId: string }> }) {
  try {
    const user = requireApiUser(request);
    const { projectId } = await context.params;
    requireProjectAccess(user.id, projectId);
    return json({ timeSlots: listTimeSlotViews(projectId) });
  } catch (error) { return apiError(error); }
}

export async function POST(request: NextRequest, context: { params: Promise<{ projectId: string }> }) {
  try {
    const user = requireApiUser(request);
    const { projectId } = await context.params;
    const input = await readJson(request, schema);
    return json(createTimeSlot(projectId, user.id, input), 201);
  } catch (error) { return apiError(error); }
}
