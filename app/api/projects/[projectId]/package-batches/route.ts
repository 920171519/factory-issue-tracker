import type { NextRequest } from "next/server";
import { z } from "zod";
import { requireApiUser, apiError, json, readJson } from "@/lib/http";
import { createBatch } from "@/lib/packages";

const schema = z.object({
  kind: z.enum(["TEST", "VERIFY"]),
  requestIds: z.array(z.string().min(1)).min(1, "请选择要纳入本批次的申请"),
  title: z.string().trim().max(120).optional(),
  scheduledDate: z.string().trim().max(20).nullable().optional(),
  note: z.string().max(2000).optional(),
  barcodes: z
    .array(z.object({ requestId: z.string().min(1), barcodes: z.array(z.string().max(80)).max(20) }))
    .optional(),
});

export async function POST(request: NextRequest, context: { params: Promise<{ projectId: string }> }) {
  try {
    const user = requireApiUser(request);
    const { projectId } = await context.params;
    const input = await readJson(request, schema);
    return json(createBatch(projectId, user.id, input), 201);
  } catch (error) {
    return apiError(error);
  }
}
