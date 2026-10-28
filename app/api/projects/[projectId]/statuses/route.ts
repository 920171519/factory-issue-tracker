import type { NextRequest } from "next/server";
import { z } from "zod";
import { requireApiUser, apiError, json, readJson } from "@/lib/http";
import { requireProjectAccess } from "@/lib/access";
import { createStatus, listStatuses } from "@/lib/taxonomy";

const schema = z.object({
  name: z.string().trim().min(1, "请输入状态名称").max(30),
  color: z.string().optional(),
  countsPending: z.boolean().optional(),
  requiresReason: z.boolean().optional(),
  isIdentified: z.boolean().optional(),
  isDefault: z.boolean().optional(),
});

export async function GET(request: NextRequest, context: { params: Promise<{ projectId: string }> }) {
  try {
    const user = requireApiUser(request);
    const { projectId } = await context.params;
    requireProjectAccess(user.id, projectId);
    return json({ statuses: listStatuses(projectId) });
  } catch (error) { return apiError(error); }
}

export async function POST(request: NextRequest, context: { params: Promise<{ projectId: string }> }) {
  try {
    const user = requireApiUser(request);
    const { projectId } = await context.params;
    const input = await readJson(request, schema);
    return json(createStatus(projectId, user.id, input), 201);
  } catch (error) { return apiError(error); }
}
