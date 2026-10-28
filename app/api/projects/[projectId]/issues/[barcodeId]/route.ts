import type { NextRequest } from "next/server";
import { requireApiUser, apiError, json, readJson } from "@/lib/http";
import { getBarcodeDetail, updateTrackingGroups } from "@/lib/issues";
import { trackingGroupsSchema } from "@/lib/api-schemas";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ projectId: string; barcodeId: string }> },
) {
  try {
    const user = requireApiUser(request);
    const { projectId, barcodeId } = await context.params;
    return json({ barcode: getBarcodeDetail(projectId, barcodeId, user.id) });
  } catch (error) {
    return apiError(error);
  }
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ projectId: string; barcodeId: string }> },
) {
  try {
    const user = requireApiUser(request);
    const { projectId, barcodeId } = await context.params;
    const input = await readJson(request, trackingGroupsSchema);
    const groups = updateTrackingGroups(projectId, barcodeId, user.id, input.trackingGroups);
    return json({ trackingGroups: groups });
  } catch (error) {
    return apiError(error);
  }
}
