import fs from "node:fs/promises";
import path from "node:path";

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

const MIME_EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

const EXTENSION_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
};

export function uploadDir(): string {
  return process.env.UPLOAD_DIR || path.resolve("./data/uploads");
}

export async function ensureUploadDir(): Promise<void> {
  await fs.mkdir(uploadDir(), { recursive: true });
}

export function extensionForMime(mime: string): string | null {
  return MIME_EXTENSIONS[mime] || null;
}

export function mimeForExtension(extension: string): string | null {
  return EXTENSION_TYPES[extension.toLowerCase()] || null;
}

export async function readUpload(filename: string): Promise<Buffer | null> {
  if (!/^[a-f0-9-]{36}\.(png|jpg|jpeg|webp|gif)$/i.test(filename)) return null;
  try {
    return await fs.readFile(path.join(/* turbopackIgnore: true */ uploadDir(), filename));
  } catch {
    return null;
  }
}