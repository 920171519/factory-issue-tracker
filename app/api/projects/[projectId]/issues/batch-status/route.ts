import type { NextRequest } from "next/server";
import { requireApiUser, apiError, json, readJson } from "@/lib/http";
import { batchStatusSchema } from "@/lib/api-schemas";
import { updateStatusForSelection } from "@/lib/status-actions";

export async function POST(request: NextRequest, context: { params: Promise<{ projectId: string }> }) {
  try {
    const user = requireApiUser(request);
    const { projectId } = await context.params;
    const input = await readJson(request, batchStatusSchema);
    const result = updateStatusForSelection({
      projectId,
      userId: user.id,
      selection: { barcodeIds: input.barcodeIds },
      statusId: input.statusId,
      reasonHtml: input.reasonHtml,
      confirmed: input.confirmed,
    });
    return json(result);
  } catch (error) {
    return apiError(error);
  }
}
