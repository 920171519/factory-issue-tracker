import type { NextRequest } from "next/server";
import { requireApiUser, apiError, json } from "@/lib/http";
import { requireProjectAccess } from "@/lib/access";
import { importIssuesFromExcel } from "@/lib/import";

export async function POST(request: NextRequest, context: { params: Promise<{ projectId: string }> }) {
  try {
    const user = requireApiUser(request);
    const { projectId } = await context.params;
    requireProjectAccess(user.id, projectId);
    const formData = await request.formData();
    const file = formData.get("file");
    if (!file || typeof file === "string") return json({ error: "请选择 Excel 文件" }, 400);
    const arrayBuffer = await file.arrayBuffer();
    const result = importIssuesFromExcel(projectId, user.id, Buffer.from(arrayBuffer));
    return json(result);
  } catch (error) {
    return apiError(error);
  }
}
