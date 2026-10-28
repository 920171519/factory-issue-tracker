import type { NextRequest } from "next/server";
import { requireApiUser, apiError, json } from "@/lib/http";
import { requireProjectManagerOrSupervisor } from "@/lib/access";
import { listDeletionRequests } from "@/lib/deletion";

export async function GET(request: NextRequest, context: { params: Promise<{ projectId: string }> }) {
  try {
    const user = requireApiUser(request);
    const { projectId } = await context.params;
    requireProjectManagerOrSupervisor(user.id, projectId);
    const status = request.nextUrl.searchParams.get("status") || "";
    return json({ requests: listDeletionRequests(projectId, status) });
  } catch (error) {
    return apiError(error);
  }
}
