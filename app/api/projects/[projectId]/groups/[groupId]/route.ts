import type { NextRequest } from "next/server";
import { z } from "zod";
import { requireApiUser, apiError, json, readJson } from "@/lib/http";
import { deleteGroup, updateGroup } from "@/lib/groups";

const schema = z.object({
  name: z.string().trim().min(1).max(50).optional(),
  description: z.string().trim().max(300).nullable().optional(),
  enabled: z.boolean().optional(),
});

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ projectId: string; groupId: string }> },
) {
  try {
    const user = requireApiUser(request);
    const { projectId, groupId } = await context.params;
    const input = await readJson(request, schema);
    updateGroup(projectId, groupId, user.id, input);
    return json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ projectId: string; groupId: string }> },
) {
  try {
    const user = requireApiUser(request);
    const { projectId, groupId } = await context.params;
    deleteGroup(projectId, groupId, user.id);
    return json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
