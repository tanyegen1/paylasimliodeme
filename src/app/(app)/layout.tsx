import { requireUser } from "@/server/session";
import { unreadCount } from "@/server/activity";
import { BottomNav } from "@/components/nav";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  return (
    <>
      {children}
      <BottomNav unread={await unreadCount(user.id)} addHref="/add" />
    </>
  );
}
