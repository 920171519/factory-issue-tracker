import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import type { NextRequest } from "next/server";
import { requireApiUser, apiError, json } from "@/lib/http";
import { ensureUploadDir, extensionForMime, MAX_UPLOAD_BYTES, uploadDir } from "@/lib/uploads";

export async function POST(request: NextRequest) {
  try {
    requireApiUser(request);
    const formData = await request.formData();
    const file = formData.get("file");
    if (!file || typeof file === "string") return json({ error: "请选择图片" }, 400);
    if (file.size > MAX_UPLOAD_BYTES) return json({ error: "图片不能超过 5MB" }, 400);
    const extension = extensionForMime(file.type);
    if (!extension) return json({ error: "仅支持 PNG、JPG、WEBP、GIF 图片" }, 400);
    await ensureUploadDir();
    const filename = `${randomUUID()}.${extension}`;
    const buffer = Buffer.from(await file.arrayBuffer());
    await writeFile(path.join(/* turbopackIgnore: true */ uploadDir(), filename), buffer);
    return json({ url: `/api/uploads/${filename}`, name: file.name || filename }, 201);
  } catch (error) {
    return apiError(error);
  }
}