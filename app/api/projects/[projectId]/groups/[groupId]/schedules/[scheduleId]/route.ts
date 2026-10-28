import type { NextRequest } from "next/server";
import { requireApiUser, apiError, json } from "@/lib/http";
import { deleteSchedule } from "@/lib/groups";

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ projectId: string; groupId: string; scheduleId: string }> },
) {
  try {
    const user = requireApiUser(request);
    const { projectId, groupId, scheduleId } = await context.params;
    deleteSchedule(projectId, groupId, user.id, scheduleId);
    return json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
