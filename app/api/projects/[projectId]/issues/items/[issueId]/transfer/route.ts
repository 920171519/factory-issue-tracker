import type { NextRequest } from "next/server";
import { requireApiUser, apiError, json, readJson } from "@/lib/http";
import { transferSchema } from "@/lib/api-schemas";
import { transferResponsibility } from "@/lib/assignments";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ projectId: string; issueId: string }> },
) {
  try {
    const user = requireApiUser(request);
    const { projectId, issueId } = await context.params;
    const input = await readJson(request, transferSchema);
    const result = transferResponsibility({
      projectId,
      userId: user.id,
      selection: { issueId },
      ...input,
    });
    return json(result);
  } catch (error) {
    return apiError(error);
  }
}
