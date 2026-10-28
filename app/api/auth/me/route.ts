import type { NextRequest } from "next/server";
import { getRequestUser } from "@/lib/auth";
import { json } from "@/lib/http";
import { unreadNotificationCount } from "@/lib/notifications";

export async function GET(request: NextRequest) {
  const user = getRequestUser(request);
  if (!user) return json({ user: null }, 401);
  return json({ user, unreadNotifications: unreadNotificationCount(user.id) });
}
