import type { NextRequest } from "next/server";
import { z } from "zod";
import { requireApiUser, apiError, json, readJson } from "@/lib/http";
import { removeGroupMember, updateGroupMember } from "@/lib/groups";

const schema = z.object({
  isLeader: z.boolean().optional(),
  isDefaultAssignee: z.boolean().optional(),
  isFallbackAssignee: z.boolean().optional(),
});

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ projectId: string; groupId: string; userId: string }> },
) {
  try {
    const user = requireApiUser(request);
    const { projectId, groupId, userId } = await context.params;
    const input = await readJson(request, schema);
    updateGroupMember(projectId, groupId, user.id, userId, input);
    return json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ projectId: string; groupId: string; userId: string }> },
) {
  try {
    const user = requireApiUser(request);
    const { projectId, groupId, userId } = await context.params;
    return json(removeGroupMember(projectId, groupId, user.id, userId));
  } catch (error) {
    return apiError(error);
  }
}
