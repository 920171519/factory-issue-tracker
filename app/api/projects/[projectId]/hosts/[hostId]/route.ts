import type { NextRequest } from "next/server";
import { requireApiUser, apiError, json } from "@/lib/http";
import { deleteHost } from "@/lib/taxonomy";

export async function DELETE(request: NextRequest, context: { params: Promise<{ projectId: string; hostId: string }> }) {
  try {
    const user = requireApiUser(request);
    const { projectId, hostId } = await context.params;
    deleteHost(projectId, hostId, user.id);
    return json({ ok: true });
  } catch (error) { return apiError(error); }
}
