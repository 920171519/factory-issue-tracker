import type { NextRequest } from "next/server";
import { requireApiUser, apiError, json } from "@/lib/http";
import { requireProjectAccess } from "@/lib/access";
import { getLocationHost } from "@/lib/taxonomy";

export async function GET(request: NextRequest, context: { params: Promise<{ projectId: string }> }) {
  try {
    const user = requireApiUser(request);
    const { projectId } = await context.params;
    requireProjectAccess(user.id, projectId);
    const locationNo = request.nextUrl.searchParams.get("locationNo")?.trim() || "";
    if (!locationNo) return json({ host: null });
    const host = getLocationHost(projectId, locationNo);
    return json({ host: host ? { hostIp: host.hostIp, hostAccount: host.hostAccount } : null });
  } catch (error) {
    return apiError(error);
  }
}
