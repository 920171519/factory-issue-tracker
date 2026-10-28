import type { NextRequest } from "next/server";
import { requireApiUser, apiError, json, readJson } from "@/lib/http";
import { transferSchema } from "@/lib/api-schemas";
import { transferResponsibility } from "@/lib/assignments";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ projectId: string; barcodeId: string }> },
) {
  try {
    const user = requireApiUser(request);
    const { projectId, barcodeId } = await context.params;
    const input = await readJson(request, transferSchema);
    const result = transferResponsibility({
      projectId,
      userId: user.id,
      selection: { barcodeId },
      ...input,
    });
    return json(result);
  } catch (error) {
    return apiError(error);
  }
}
