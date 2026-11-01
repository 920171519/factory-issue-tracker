import type { NextRequest } from "next/server";
import { z } from "zod";
import { requireApiUser, apiError, json, readJson } from "@/lib/http";
import { cancelRequest, createRequest } from "@/lib/packages";

const createSchema = z.object({
  kind: z.enum(["TEST", "VERIFY"]),
  packageId: z.string().min(1),
  version: z.string().trim().min(1, "请填写版本号").max(50),
  changeSummary: z.string().max(2000).optional().default(""),
  packageUrl: z.string().max(500).optional(),
  sourceItemId: z.string().optional(),
});

const cancelSchema = z.object({
  requestId: z.string().min(1),
  action: z.literal("cancel"),
});

export async function POST(request: NextRequest, context: { params: Promise<{ projectId: string }> }) {
  try {
    const user = requireApiUser(request);
    const { projectId } = await context.params;
    const input = await readJson(request, createSchema);
    return json(createRequest(projectId, user.id, input), 201);
  } catch (error) {
    return apiError(error);
  }
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ projectId: string }> }) {
  try {
    const user = requireApiUser(request);
    const { projectId } = await context.params;
    const input = await readJson(request, cancelSchema);
    cancelRequest(projectId, user.id, input.requestId);
    return json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
