import type { Metadata } from "next";
import { requirePageUser } from "@/lib/auth";
import { listNotifications, unreadNotificationCount } from "@/lib/notifications";
import { NotificationsClient } from "@/components/notifications/NotificationsClient";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "通知中心" };

export default async function NotificationsPage() {
  const user = await requirePageUser();
  const notifications = listNotifications(user.id);
  const unread = unreadNotificationCount(user.id);
  return (
    <div className="container">
      <NotificationsClient notifications={notifications} unread={unread} />
    </div>
  );
}
