import Link from "next/link";
import { getUser } from "@/server/session";
import { previewInvite, trackInviteOpened } from "@/server/invites";
import { brand } from "@/config/brand";
import { GROUP_EMOJI } from "@/lib/group-types";
import { formatDate } from "@/lib/format";
import { t } from "@/lib/i18n";
import { JoinForm } from "./form";

export const metadata = { title: "Davet", robots: { index: false } };

export default async function JoinPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const user = await getUser();
  const pre = await previewInvite(token, user?.id);
  if (pre.state === "ok") await trackInviteOpened(token);
  return (
    <main className="mx-auto max-w-xl px-5 pb-16 pt-10">
      <p className="text-lg font-extrabold tracking-tight text-brand-700">{brand.name}</p>
      {pre.state !== "ok" ? (
        <div className="card mt-8 text-center">
          <p aria-hidden className="text-4xl">🔗</p>
          <h1 className="mt-2 text-xl">{t(`join.state_${pre.state}`)}</h1>
          <p className="muted mt-2">{t("join.askNew")}</p>
          <Link href="/" className="btn-secondary mt-4">{t("join.home")}</Link>
        </div>
      ) : (
        <>
          <div className="card mt-8">
            <p className="muted">{t("join.invitedBy", { name: pre.inviterName })}</p>
            <div className="mt-2 flex items-center gap-3">
              <span aria-hidden className="grid h-14 w-14 place-items-center rounded-2xl bg-brand-50 text-3xl">{GROUP_EMOJI[pre.groupType]}</span>
              <div>
                <h1 className="text-xl">{pre.groupName}</h1>
                <p className="muted">{t(`groupType.${pre.groupType}` as "groupType.home")} · {t("groups.members", { n: pre.memberCount })}</p>
              </div>
            </div>
            <p className="muted mt-3 text-xs">{t("join.previewNote")} {t("join.expires", { date: formatDate(pre.expiresAt) })}</p>
          </div>
          <JoinForm token={token} groupId={pre.groupId} loggedInName={user?.display_name ?? null} already={pre.already} pendingClaim={pre.pendingClaim}
            targeted={pre.targeted} placeholders={pre.placeholders} />
        </>
      )}
    </main>
  );
}
