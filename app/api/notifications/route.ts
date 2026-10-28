import type { NextRequest } from "next/server";
import { z } from "zod";
import { requireApiUser, apiError, json, readJson } from "@/lib/http";
import { listNotifications, markNotificationsRead, unreadNotificationCount } from "@/lib/notifications";

const schema = z.object({
  all: z.boolean().optional(),
  ids: z.array(z.string()).max(500).optional(),
}).refine((data) => data.all || (data.ids && data.ids.length > 0), { message: "请选择要标记的通知" });

export async function GET(request: NextRequest) {
  try {
    const user = requireApiUser(request);
    return json({
      notifications: listNotifications(user.id),
      unread: unreadNotificationCount(user.id),
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const user = requireApiUser(request);
    const input = await readJson(request, schema);
    markNotificationsRead(user.id, input);
    return json({ ok: true, unread: unreadNotificationCount(user.id) });
  } catch (error) {
    return apiError(error);
  }
}
