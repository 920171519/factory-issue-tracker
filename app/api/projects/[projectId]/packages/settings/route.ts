import type { NextRequest } from "next/server";
import { z } from "zod";
import { requireApiUser, apiError, json, readJson } from "@/lib/http";
import { setTesterGroup } from "@/lib/packages";

const schema = z.object({
  testerGroupId: z.string().nullable(),
});

export async function PATCH(request: NextRequest, context: { params: Promise<{ projectId: string }> }) {
  try {
    const user = requireApiUser(request);
    const { projectId } = await context.params;
    const input = await readJson(request, schema);
    setTesterGroup(projectId, user.id, input.testerGroupId);
    return json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
