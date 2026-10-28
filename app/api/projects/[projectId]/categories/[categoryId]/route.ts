import type { NextRequest } from "next/server";
import { z } from "zod";
import { requireApiUser, apiError, json, readJson } from "@/lib/http";
import { deleteCategory, updateCategory } from "@/lib/taxonomy";

const schema = z.object({ name: z.string().trim().min(1).max(40).optional(), color: z.string().optional() });

export async function PATCH(request: NextRequest, context: { params: Promise<{ projectId: string; categoryId: string }> }) {
  try {
    const user = requireApiUser(request);
    const { projectId, categoryId } = await context.params;
    const input = await readJson(request, schema);
    updateCategory(projectId, categoryId, user.id, input);
    return json({ ok: true });
  } catch (error) { return apiError(error); }
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ projectId: string; categoryId: string }> }) {
  try {
    const user = requireApiUser(request);
    const { projectId, categoryId } = await context.params;
    deleteCategory(projectId, categoryId, user.id);
    return json({ ok: true });
  } catch (error) { return apiError(error); }
}
