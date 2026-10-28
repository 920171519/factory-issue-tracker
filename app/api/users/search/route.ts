import type { NextRequest } from "next/server";
import { requireApiUser } from "@/lib/http";
import { apiError, json } from "@/lib/http";
import { searchDirectoryUsers } from "@/lib/groups";

export async function GET(request: NextRequest) {
  try {
    requireApiUser(request);
    const query = request.nextUrl.searchParams.get("q") || "";
    return json({ users: searchDirectoryUsers(query) });
  } catch (error) {
    return apiError(error);
  }
}
