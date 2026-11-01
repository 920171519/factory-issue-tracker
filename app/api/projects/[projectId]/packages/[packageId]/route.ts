import type { NextRequest } from "next/server";
import { z } from "zod";
import { requireApiUser, apiError, json, readJson } from "@/lib/http";
import { deletePackage, getPackageHistory, updatePackage } from "@/lib/packages";

const updateSchema = z.object({
  code: z.string().trim().min(1, "请填写软件包编码").max(80).optional(),
  description: z.string().max(300).nullable().optional(),
  version: z.string().max(50).nullable().optional(),
  ownerId: z.string().nullable().optional(),
  groupId: z.string().nullable().optional(),
});

export async function GET(request: NextRequest, context: { params: Promise<{ projectId: string; packageId: string }> }) {
  try {
    const user = requireApiUser(request);
    const { projectId, packageId } = await context.params;
    return json(getPackageHistory(projectId, packageId, user.id));
  } catch (error) {
    return apiError(error);
  }
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ projectId: string; packageId: string }> }) {
  try {
    const user = requireApiUser(request);
    const { projectId, packageId } = await context.params;
    const input = await readJson(request, updateSchema);
    updatePackage(projectId, packageId, user.id, input);
    return json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ projectId: string; packageId: string }> }) {
  try {
    const user = requireApiUser(request);
    const { projectId, packageId } = await context.params;
    deletePackage(projectId, packageId, user.id);
    return json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
