import type { NextRequest } from "next/server";
import { requireApiUser, apiError, json } from "@/lib/http";
import { deleteScheduleOverride } from "@/lib/groups";

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ projectId: string; groupId: string; overrideId: string }> },
) {
  try {
    const user = requireApiUser(request);
    const { projectId, groupId, overrideId } = await context.params;
    deleteScheduleOverride(projectId, groupId, user.id, overrideId);
    return json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
