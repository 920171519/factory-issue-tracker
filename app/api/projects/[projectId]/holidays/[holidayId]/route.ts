import type { NextRequest } from "next/server";
import { requireApiUser, apiError, json } from "@/lib/http";
import { deleteHoliday } from "@/lib/taxonomy";

export async function DELETE(request: NextRequest, context: { params: Promise<{ projectId: string; holidayId: string }> }) {
  try {
    const user = requireApiUser(request);
    const { projectId, holidayId } = await context.params;
    deleteHoliday(projectId, holidayId, user.id);
    return json({ ok: true });
  } catch (error) { return apiError(error); }
}
