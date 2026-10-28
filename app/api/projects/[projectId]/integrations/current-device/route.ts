import type { NextRequest } from "next/server";
import { requireApiUser, apiError, json } from "@/lib/http";
import { getStubCurrentDevice } from "@/lib/device-stub";

export async function GET(request: NextRequest, context: { params: Promise<{ projectId: string }> }) {
  try {
    const user = requireApiUser(request);
    const { projectId } = await context.params;
    const locationNo = request.nextUrl.searchParams.get("locationNo") || "";
    return json({ device: getStubCurrentDevice(projectId, user.id, locationNo) });
  } catch (error) {
    return apiError(error);
  }
}
