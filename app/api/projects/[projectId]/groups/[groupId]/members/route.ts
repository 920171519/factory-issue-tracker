import type { NextRequest } from "next/server";
import { z } from "zod";
import { requireApiUser, apiError, json, readJson } from "@/lib/http";
import { addGroupMember } from "@/lib/groups";

const schema = z.object({
  userId: z.string().trim().optional(),
  employeeNo: z.string().trim().optional(),
}).refine((data) => Boolean(data.userId || data.employeeNo), { message: "请输入成员工号" });

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ projectId: string; groupId: string }> },
) {
  try {
    const user = requireApiUser(request);
    const { projectId, groupId } = await context.params;
    const input = await readJson(request, schema);
    return json(addGroupMember(projectId, groupId, user.id, input), 201);
  } catch (error) {
    return apiError(error);
  }
}
