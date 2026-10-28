import type { NextRequest } from "next/server";
import { z } from "zod";
import { requireApiUser, apiError, json, readJson } from "@/lib/http";
import { deleteCode, updateCode } from "@/lib/taxonomy";

const schema = z.object({
  code: z.string().trim().min(1).max(80).optional(),
  description: z.string().trim().max(300).nullable().optional(),
  version: z.string().trim().max(50).nullable().optional(),
  ownerId: z.string().nullable().optional(),
});

export async function PATCH(request: NextRequest, context: { params: Promise<{ projectId: string; codeId: string }> }) {
  try {
    const user = requireApiUser(request);
    const { projectId, codeId } = await context.params;
    const input = await readJson(request, schema);
    updateCode(projectId, codeId, user.id, input);
    return json({ ok: true });
  } catch (error) { return apiError(error); }
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ projectId: string; codeId: string }> }) {
  try {
    const user = requireApiUser(request);
    const { projectId, codeId } = await context.params;
    deleteCode(projectId, codeId, user.id);
    return json({ ok: true });
  } catch (error) { return apiError(error); }
}
