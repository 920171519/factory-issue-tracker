import type { NextRequest } from "next/server";
import { requireApiUser, apiError, json, readJson } from "@/lib/http";
import { requireProjectAccess } from "@/lib/access";
import { createBarcode, listBarcodes } from "@/lib/issues";
import { createIssueSchema } from "@/lib/api-schemas";

export async function GET(request: NextRequest, context: { params: Promise<{ projectId: string }> }) {
  try {
    const user = requireApiUser(request);
    const { projectId } = await context.params;
    const params = request.nextUrl.searchParams;
    const result = listBarcodes(projectId, user.id, {
      page: Number(params.get("page") || 1),
      pageSize: Number(params.get("pageSize") || 20),
      search: params.get("search") || "",
      groupId: params.get("groupId") || "",
      statusId: params.get("statusId") || "",
      categoryId: params.get("categoryId") || "",
      priority: params.get("priority") || "",
    });
    return json(result);
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: NextRequest, context: { params: Promise<{ projectId: string }> }) {
  try {
    const user = requireApiUser(request);
    const { projectId } = await context.params;
    requireProjectAccess(user.id, projectId);
    const input = await readJson(request, createIssueSchema);
    const result = createBarcode(projectId, user.id, input);
    return json({ barcodeId: result.barcodeId, issueId: result.issueId }, 201);
  } catch (error) {
    return apiError(error);
  }
}
