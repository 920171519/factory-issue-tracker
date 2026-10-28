import { requirePageUser } from "@/lib/auth";
import { unreadNotificationCount } from "@/lib/notifications";
import { AppHeader } from "@/components/AppHeader";

export const dynamic = "force-dynamic";

export default async function AuthenticatedLayout({ children }: { children: React.ReactNode }) {
  const user = await requirePageUser();
  const unread = unreadNotificationCount(user.id);
  return (
    <div className="app-frame">
      <AppHeader user={user} unread={unread} />
      <main className="app-content">{children}</main>
    </div>
  );
}
