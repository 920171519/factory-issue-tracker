import type { NextRequest } from "next/server";
import { requireApiUser, apiError, json, readJson } from "@/lib/http";
import { transferBulkSchema } from "@/lib/api-schemas";
import { transferResponsibility } from "@/lib/assignments";

export async function POST(request: NextRequest, context: { params: Promise<{ projectId: string }> }) {
  try {
    const user = requireApiUser(request);
    const { projectId } = await context.params;
    const input = await readJson(request, transferBulkSchema);
    const { barcodeIds, ...transfer } = input;
    const result = transferResponsibility({
      projectId,
      userId: user.id,
      selection: { barcodeIds },
      ...transfer,
    });
    return json(result);
  } catch (error) {
    return apiError(error);
  }
}
