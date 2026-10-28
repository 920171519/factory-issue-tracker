import type { NextRequest } from "next/server";
import { requireApiUser, apiError, json } from "@/lib/http";
import { getCommunicationData } from "@/lib/groups";

export async function GET(request: NextRequest, context: { params: Promise<{ projectId: string }> }) {
  try {
    const user = requireApiUser(request);
    const { projectId } = await context.params;
    const date = request.nextUrl.searchParams.get("date") || undefined;
    const time = request.nextUrl.searchParams.get("time") || undefined;
    const data = getCommunicationData(projectId, user.id, { date, time });
    const serializable = {
      ...data,
      groups: data.groups.map((group) => ({
        ...group,
        resolution: group.resolution
          ? {
              ...group.resolution,
              primaryCounts: group.resolution.primaryCounts,
            }
          : null,
      })),
    };
    return json({ communication: serializable });
  } catch (error) {
    return apiError(error);
  }
}