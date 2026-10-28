import type { NextRequest } from "next/server";
import { z } from "zod";
import { requireApiUser, apiError, json, readJson } from "@/lib/http";
import { createGroup, listGroupCards } from "@/lib/groups";

const schema = z.object({
  name: z.string().trim().min(1, "请输入责任组名称").max(50),
  description: z.string().trim().max(300).optional(),
  leaderIds: z.array(z.string()).min(1, "至少配置一名组负责人"),
  defaultAssigneeId: z.string().nullable().optional(),
  fallbackAssigneeId: z.string().nullable().optional(),
});

export async function GET(request: NextRequest, context: { params: Promise<{ projectId: string }> }) {
  try {
    const user = requireApiUser(request);
    const { projectId } = await context.params;
    return json({ groups: listGroupCards(projectId, user.id) });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: NextRequest, context: { params: Promise<{ projectId: string }> }) {
  try {
    const user = requireApiUser(request);
    const { projectId } = await context.params;
    const input = await readJson(request, schema);
    return json(createGroup(projectId, user.id, input), 201);
  } catch (error) {
    return apiError(error);
  }
}
