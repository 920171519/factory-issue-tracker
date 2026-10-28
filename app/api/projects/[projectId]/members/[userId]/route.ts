import type { NextRequest } from "next/server";
import { z } from "zod";
import { requireApiUser, apiError, json, readJson } from "@/lib/http";
import { removeProjectMember, updateProjectMemberRoles } from "@/lib/projects";

const schema = z.object({
  isPm: z.boolean(),
  isSupervisor: z.boolean(),
});

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ projectId: string; userId: string }> },
) {
  try {
    const user = requireApiUser(request);
    const { projectId, userId } = await context.params;
    const input = await readJson(request, schema);
    updateProjectMemberRoles(projectId, user.id, userId, input);
    return json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ projectId: string; userId: string }> },
) {
  try {
    const user = requireApiUser(request);
    const { projectId, userId } = await context.params;
    removeProjectMember(projectId, user.id, userId);
    return json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
