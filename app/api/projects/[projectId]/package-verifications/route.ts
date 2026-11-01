import type { NextRequest } from "next/server";
import { z } from "zod";
import { requireApiUser, apiError, json, readJson } from "@/lib/http";
import { handleVerification, promoteVerifications } from "@/lib/packages";

const handleSchema = z.object({
  requestId: z.string().min(1),
  processUrl: z.string().trim().min(1, "请填写电子流程链接").max(500),
  barcodes: z.array(z.string().max(80)).min(1, "请填写至少一个验证条码").max(20),
});

const promoteSchema = z.object({
  action: z.literal("promote"),
  verificationIds: z.array(z.string().min(1)).min(1, "请选择要转正的软件包"),
});

export async function POST(request: NextRequest, context: { params: Promise<{ projectId: string }> }) {
  try {
    const user = requireApiUser(request);
    const { projectId } = await context.params;
    const input = await readJson(request, handleSchema);
    return json(handleVerification(projectId, user.id, input), 201);
  } catch (error) {
    return apiError(error);
  }
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ projectId: string }> }) {
  try {
    const user = requireApiUser(request);
    const { projectId } = await context.params;
    const input = await readJson(request, promoteSchema);
    return json(promoteVerifications(projectId, user.id, input.verificationIds));
  } catch (error) {
    return apiError(error);
  }
}
