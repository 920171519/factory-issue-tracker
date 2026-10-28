import type { NextRequest } from "next/server";
import { z } from "zod";
import { requireApiUser, apiError, json, readJson } from "@/lib/http";
import { requireProjectAccess } from "@/lib/access";
import { listDefaultGroupIds, setDefaultGroups } from "@/lib/taxonomy";

const schema = z.object({ groupIds: z.array(z.string()).max(20) });

export async function GET(request: NextRequest, context: { params: Promise<{ projectId: string }> }) {
  try {
    const user = requireApiUser(request);
    const { projectId } = await context.params;
    requireProjectAccess(user.id, projectId);
    return json({ groupIds: listDefaultGroupIds(projectId) });
  } catch (error) { return apiError(error); }
}

export async function PUT(request: NextRequest, context: { params: Promise<{ projectId: string }> }) {
  try {
    const user = requireApiUser(request);
    const { projectId } = await context.params;
    const input = await readJson(request, schema);
    setDefaultGroups(projectId, user.id, input.groupIds);
    return json({ groupIds: listDefaultGroupIds(projectId) });
  } catch (error) { return apiError(error); }
}
