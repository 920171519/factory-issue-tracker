import { NextResponse, type NextRequest } from "next/server";
import { getRequestUser } from "@/lib/auth";
import { readUpload, mimeForExtension } from "@/lib/uploads";

export async function GET(request: NextRequest, context: { params: Promise<{ filename: string }> }) {
  const user = getRequestUser(request);
  if (!user) return new NextResponse("Unauthorized", { status: 401 });
  const { filename } = await context.params;
  const extension = filename.split(".").pop() || "";
  const mime = mimeForExtension(extension);
  if (!mime) return new NextResponse("Not found", { status: 404 });
  const buffer = await readUpload(filename);
  if (!buffer) return new NextResponse("Not found", { status: 404 });
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": mime,
      "Cache-Control": "private, max-age=86400",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
