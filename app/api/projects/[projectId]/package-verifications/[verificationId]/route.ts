import type { NextRequest } from "next/server";
import { z } from "zod";
import { requireApiUser, apiError, json, readJson } from "@/lib/http";
import { concludeVerification, updateVerification } from "@/lib/packages";

const schema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("update"),
    processUrl: z.string().trim().max(500).optional(),
    barcodes: z.array(z.string().max(80)).max(20).optional(),
  }),
  z.object({
    action: z.literal("conclude"),
    conclusion: z.enum(["PENDING", "PASS", "FAIL", "CONDITIONAL"]),
    note: z.string().max(2000).optional(),
  }),
]);

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ projectId: string; verificationId: string }> },
) {
  try {
    const user = requireApiUser(request);
    const { projectId, verificationId } = await context.params;
    const input = await readJson(request, schema);
    if (input.action === "update") {
      updateVerification(projectId, user.id, verificationId, { processUrl: input.processUrl, barcodes: input.barcodes });
      return json({ ok: true });
    }
    concludeVerification(projectId, user.id, verificationId, { conclusion: input.conclusion, note: input.note });
    return json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
