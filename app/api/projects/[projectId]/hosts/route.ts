import type { NextRequest } from "next/server";
import { z } from "zod";
import { requireApiUser, apiError, json, readJson } from "@/lib/http";
import { requireProjectAccess } from "@/lib/access";
import { listHosts, saveHost } from "@/lib/taxonomy";

const schema = z.object({
  locationNo: z.string().trim().min(1, "请输入库位号").max(50),
  hostIp: z.string().trim().min(1, "请输入云主机 IP").max(100),
  hostAccount: z.string().max(100).optional(),
  hostPassword: z.string().max(200).optional(),
});

export async function GET(request: NextRequest, context: { params: Promise<{ projectId: string }> }) {
  try {
    const user = requireApiUser(request);
    const { projectId } = await context.params;
    requireProjectAccess(user.id, projectId);
    return json({ hosts: listHosts(projectId) });
  } catch (error) { return apiError(error); }
}

export async function POST(request: NextRequest, context: { params: Promise<{ projectId: string }> }) {
  try {
    const user = requireApiUser(request);
    const { projectId } = await context.params;
    const input = await readJson(request, schema);
    return json(saveHost(projectId, user.id, input), 201);
  } catch (error) { return apiError(error); }
}
