import type { NextRequest } from "next/server";
import { z } from "zod";
import { requireApiUser, apiError, json, readJson } from "@/lib/http";
import { addSchedule } from "@/lib/groups";

const schema = z.object({
  weekday: z.number().int().min(1).max(7),
  slotId: z.string().min(1, "请选择班次"),
  userId: z.string().min(1, "请选择处理人"),
  effectiveFrom: z.string().optional(),
  effectiveTo: z.string().nullable().optional(),
});

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ projectId: string; groupId: string }> },
) {
  try {
    const user = requireApiUser(request);
    const { projectId, groupId } = await context.params;
    const input = await readJson(request, schema);
    return json(addSchedule(projectId, groupId, user.id, input), 201);
  } catch (error) {
    return apiError(error);
  }
}
