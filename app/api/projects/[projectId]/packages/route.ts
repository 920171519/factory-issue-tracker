import type { NextRequest } from "next/server";
import { z } from "zod";
import { requireApiUser, apiError, json, readJson } from "@/lib/http";
import { getPackagesPayload, createPackage } from "@/lib/packages";

const createSchema = z.object({
  code: z.string().trim().min(1, "请填写软件包编码").max(80),
  description: z.string().trim().max(300).optional(),
  version: z.string().trim().max(50).optional(),
  ownerId: z.string().nullable().optional(),
  groupId: z.string().nullable().optional(),
});

export async function GET(request: NextRequest, context: { params: Promise<{ projectId: string }> }) {
  try {
    const user = requireApiUser(request);
    const { projectId } = await context.params;
    return json(getPackagesPayload(projectId, user.id));
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: NextRequest, context: { params: Promise<{ projectId: string }> }) {
  try {
    const user = requireApiUser(request);
    const { projectId } = await context.params;
    const input = await readJson(request, createSchema);
    return json(createPackage(projectId, user.id, input), 201);
  } catch (error) {
    return apiError(error);
  }
}
