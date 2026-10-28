import type { NextRequest } from "next/server";
import { z } from "zod";
import { requireApiUser, apiError, json, readJson } from "@/lib/http";
import { requireProjectAccess, requireProjectManager } from "@/lib/access";
import { addProjectMember, listProjectMembers } from "@/lib/projects";

const schema = z.object({
  employeeNo: z.string().trim().optional(),
  userId: z.string().trim().optional(),
  isPm: z.boolean().optional(),
  isSupervisor: z.boolean().optional(),
}).refine((data) => Boolean(data.employeeNo || data.userId), { message: "请输入工号" });

export async function GET(request: NextRequest, context: { params: Promise<{ projectId: string }> }) {
  try {
    const user = requireApiUser(request);
    const { projectId } = await context.params;
    requireProjectAccess(user.id, projectId);
    return json({ members: listProjectMembers(projectId) });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: NextRequest, context: { params: Promise<{ projectId: string }> }) {
  try {
    const user = requireApiUser(request);
    const { projectId } = await context.params;
    requireProjectManager(user.id, projectId);
    const input = await readJson(request, schema);
    return json({ member: addProjectMember(projectId, user.id, input) }, 201);
  } catch (error) {
    return apiError(error);
  }
}
