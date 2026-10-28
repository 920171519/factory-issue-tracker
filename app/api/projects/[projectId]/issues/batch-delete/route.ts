import type { NextRequest } from "next/server";
import { requireApiUser, apiError, json, readJson } from "@/lib/http";
import { deleteRequestSchema } from "@/lib/api-schemas";
import { requestBarcodeDeletion } from "@/lib/deletion";

export async function POST(request: NextRequest, context: { params: Promise<{ projectId: string }> }) {
  try {
    const user = requireApiUser(request);
    const { projectId } = await context.params;
    const input = await readJson(request, deleteRequestSchema);
    const result = requestBarcodeDeletion(projectId, user.id, input.barcodeIds);
    return json(result);
  } catch (error) {
    return apiError(error);
  }
}
