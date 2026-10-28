import type { NextRequest } from "next/server";
import { requireApiUser, apiError, json, readJson } from "@/lib/http";
import { errorItemSchema } from "@/lib/api-schemas";
import { updateErrorItem } from "@/lib/issues";

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ projectId: string; issueId: string }> },
) {
  try {
    const user = requireApiUser(request);
    const { projectId, issueId } = await context.params;
    const input = await readJson(request, errorItemSchema);
    updateErrorItem(projectId, issueId, user.id, input.errorItem);
    return json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
