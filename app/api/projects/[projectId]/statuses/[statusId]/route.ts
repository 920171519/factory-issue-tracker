import type { NextRequest } from "next/server";
import { z } from "zod";
import { requireApiUser, apiError, json, readJson } from "@/lib/http";
import { deleteStatus, updateStatus } from "@/lib/taxonomy";

const schema = z.object({
  name: z.string().trim().min(1).max(30).optional(),
  color: z.string().optional(),
  countsPending: z.boolean().optional(),
  requiresReason: z.boolean().optional(),
  isIdentified: z.boolean().optional(),
  isDefault: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});

export async function PATCH(request: NextRequest, context: { params: Promise<{ projectId: string; statusId: string }> }) {
  try {
    const user = requireApiUser(request);
    const { projectId, statusId } = await context.params;
    const input = await readJson(request, schema);
    updateStatus(projectId, statusId, user.id, input);
    return json({ ok: true });
  } catch (error) { return apiError(error); }
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ projectId: string; statusId: string }> }) {
  try {
    const user = requireApiUser(request);
    const { projectId, statusId } = await context.params;
    deleteStatus(projectId, statusId, user.id);
    return json({ ok: true });
  } catch (error) { return apiError(error); }
}
