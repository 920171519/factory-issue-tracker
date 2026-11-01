import type { NextRequest } from "next/server";
import { z } from "zod";
import { requireApiUser, apiError, json, readJson } from "@/lib/http";
import { concludeItem } from "@/lib/packages";

const schema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("conclude"),
    itemId: z.string().min(1),
    conclusion: z.enum(["PENDING", "PASS", "FAIL", "CONDITIONAL"]),
    note: z.string().max(2000).optional(),
  }),
]);

export async function PATCH(request: NextRequest, context: { params: Promise<{ projectId: string; batchId: string }> }) {
  try {
    const user = requireApiUser(request);
    const { projectId, batchId } = await context.params;
    const input = await readJson(request, schema);
    concludeItem(projectId, batchId, input.itemId, user.id, { conclusion: input.conclusion, note: input.note });
    return json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
