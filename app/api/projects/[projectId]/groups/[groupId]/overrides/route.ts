import type { NextRequest } from "next/server";
import { z } from "zod";
import { requireApiUser, apiError, json, readJson } from "@/lib/http";
import { addScheduleOverride } from "@/lib/groups";

const schema = z.object({
  overrideDate: z.string().min(1, "请选择调班日期"),
  slotId: z.string().nullable().optional(),
  userId: z.string().min(1, "请选择处理人"),
  kind: z.enum(["TEMP", "HOLIDAY", "PROXY"]).optional(),
  note: z.string().trim().max(200).optional(),
});

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ projectId: string; groupId: string }> },
) {
  try {
    const user = requireApiUser(request);
    const { projectId, groupId } = await context.params;
    const input = await readJson(request, schema);
    return json(addScheduleOverride(projectId, groupId, user.id, input), 201);
  } catch (error) {
    return apiError(error);
  }
}
