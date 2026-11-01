import type { NextRequest } from "next/server";
import { z } from "zod";
import { requireApiUser, apiError, json, readJson } from "@/lib/http";
import { concludeItem, promoteItems, setItemBarcodes } from "@/lib/packages";

const schema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("conclude"),
    itemId: z.string().min(1),
    conclusion: z.enum(["PENDING", "PASS", "FAIL", "CONDITIONAL"]),
    note: z.string().max(2000).optional(),
  }),
  z.object({
    action: z.literal("barcodes"),
    itemId: z.string().min(1),
    barcodes: z.array(z.string().max(80)).max(20),
  }),
  z.object({
    action: z.literal("promote"),
    itemIds: z.array(z.string().min(1)).min(1, "请选择要转正的软件包"),
  }),
]);

export async function PATCH(request: NextRequest, context: { params: Promise<{ projectId: string; batchId: string }> }) {
  try {
    const user = requireApiUser(request);
    const { projectId, batchId } = await context.params;
    const input = await readJson(request, schema);
    if (input.action === "conclude") {
      concludeItem(projectId, batchId, input.itemId, user.id, { conclusion: input.conclusion, note: input.note });
      return json({ ok: true });
    }
    if (input.action === "barcodes") {
      setItemBarcodes(projectId, batchId, input.itemId, user.id, input.barcodes);
      return json({ ok: true });
    }
    return json(promoteItems(projectId, user.id, batchId, input.itemIds));
  } catch (error) {
    return apiError(error);
  }
}
