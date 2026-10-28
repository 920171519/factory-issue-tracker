import type { NextRequest } from "next/server";
import { requireApiUser, apiError, json, readJson } from "@/lib/http";
import { addErrorIssue } from "@/lib/issues";
import { errorItemSchema } from "@/lib/api-schemas";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ projectId: string; barcodeId: string }> },
) {
  try {
    const user = requireApiUser(request);
    const { projectId, barcodeId } = await context.params;
    const input = await readJson(request, errorItemSchema);
    const result = addErrorIssue(projectId, barcodeId, user.id, input);
    return json({ issueId: result.issueId }, 201);
  } catch (error) {
    return apiError(error);
  }
}
