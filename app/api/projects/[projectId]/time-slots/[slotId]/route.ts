import type { NextRequest } from "next/server";
import { z } from "zod";
import { requireApiUser, apiError, json, readJson } from "@/lib/http";
import { deleteTimeSlot, updateTimeSlot } from "@/lib/taxonomy";

const schema = z.object({
  name: z.string().trim().min(1).optional(),
  start: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  end: z.string().regex(/^\d{2}:\d{2}$/).optional(),
});

export async function PATCH(request: NextRequest, context: { params: Promise<{ projectId: string; slotId: string }> }) {
  try {
    const user = requireApiUser(request);
    const { projectId, slotId } = await context.params;
    const input = await readJson(request, schema);
    updateTimeSlot(projectId, slotId, user.id, input);
    return json({ ok: true });
  } catch (error) { return apiError(error); }
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ projectId: string; slotId: string }> }) {
  try {
    const user = requireApiUser(request);
    const { projectId, slotId } = await context.params;
    deleteTimeSlot(projectId, slotId, user.id);
    return json({ ok: true });
  } catch (error) { return apiError(error); }
}
