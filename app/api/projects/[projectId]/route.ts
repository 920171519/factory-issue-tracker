import type { NextRequest } from "next/server";
import { z } from "zod";
import { requireApiUser, apiError, json, readJson } from "@/lib/http";
import { requireProjectAccess } from "@/lib/access";
import { updateProject } from "@/lib/projects";
import { getProject } from "@/lib/access";

const schema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  code: z.string().trim().max(40).nullable().optional(),
  description: z.string().trim().max(500).nullable().optional(),
  notifySelfOnStatus: z.boolean().optional(),
});

export async function GET(request: NextRequest, context: { params: Promise<{ projectId: string }> }) {
  try {
    const user = requireApiUser(request);
    const { projectId } = await context.params;
    requireProjectAccess(user.id, projectId);
    return json({ project: getProject(projectId) });
  } catch (error) {
    return apiError(error);
  }
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ projectId: string }> }) {
  try {
    const user = requireApiUser(request);
    const { projectId } = await context.params;
    const input = await readJson(request, schema);
    updateProject(projectId, user.id, input);
    return json({ ok: true, project: getProject(projectId) });
  } catch (error) {
    return apiError(error);
  }
}
