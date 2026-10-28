import type { NextRequest } from "next/server";
import { requireApiUser, apiError } from "@/lib/http";
import { requireProjectAccess } from "@/lib/access";
import { buildImportTemplate } from "@/lib/import";
import { NextResponse } from "next/server";

export async function GET(request: NextRequest, context: { params: Promise<{ projectId: string }> }) {
  try {
    const user = requireApiUser(request);
    const { projectId } = await context.params;
    requireProjectAccess(user.id, projectId);
    const buffer = buildImportTemplate(projectId);
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": 'attachment; filename="issue-import-template.xlsx"',
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return apiError(error);
  }
}
