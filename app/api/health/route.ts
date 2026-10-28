import { getDb } from "@/lib/db";
import { json } from "@/lib/http";

export async function GET() {
  try {
    getDb().prepare("SELECT 1 AS ok").get();
    return json({ status: "ok", time: new Date().toISOString() });
  } catch {
    return json({ status: "error", time: new Date().toISOString() }, 503);
  }
}
