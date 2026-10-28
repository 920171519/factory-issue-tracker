import type { NextRequest } from "next/server";
import { z } from "zod";
import { requireApiUser, apiError, json, readJson } from "@/lib/http";
import { reviewDeletionRequest } from "@/lib/deletion";

const schema = z.object({
  action: z.enum(["APPROVE", "REJECT"]),
  reasonHtml: z.string().max(50000).optional().default(""),
});

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ projectId: string; requestId: string }> },
) {
  try {
    const user = requireApiUser(request);
    const { projectId, requestId } = await context.params;
    const input = await readJson(request, schema);
    const result = reviewDeletionRequest(projectId, requestId, user.id, input.action, input.reasonHtml);
    return json(result);
  } catch (error) {
    return apiError(error);
  }
}
