import Link from "next/link";
import { Wordmark } from "@/components/wordmark";
import { getUser } from "@/server/session";
import { previewInvite, trackInviteOpened } from "@/server/invites";
import { brand } from "@/config/brand";
import { GROUP_EMOJI, GROUP_TILE } from "@/lib/group-types";
import { Avatar } from "@/components/ui";
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
    <main className="rise mx-auto max-w-xl px-5 pb-16 pt-8">
      <Wordmark href={null} />
      {pre.state !== "ok" ? (
        <div className="card mt-8 text-center">
          <p aria-hidden className="text-4xl">🔗</p>
          <h1 className="mt-2 text-xl">{t(`join.state_${pre.state}`)}</h1>
          <p className="muted mt-2">{t("join.askNew")}</p>
          <Link href="/" className="btn-secondary mt-4">{t("join.home")}</Link>
        </div>
      ) : (
        <>
          <div className="hero mt-6 text-center">
            <div className="flex justify-center"><span className="rounded-full bg-white/15 py-1 pl-1 pr-3 text-sm font-bold"><span className="inline-flex items-center gap-2"><Avatar name={pre.inviterName} size="xs" />{t("join.invitedBy", { name: pre.inviterName })}</span></span></div>
            <span aria-hidden className={`mx-auto mt-5 grid h-20 w-20 animate-pop place-items-center rounded-3xl text-4xl ${GROUP_TILE[pre.groupType]}`}>{GROUP_EMOJI[pre.groupType]}</span>
            <h1 className="mt-4 text-[1.8rem] text-white">{pre.groupName}</h1>
            <p className="mt-1 text-white/75">{t(`groupType.${pre.groupType}` as "groupType.home")} · {t("groups.members", { n: pre.memberCount })}</p>
          </div>
          <p className="muted mt-3 px-1 text-xs">{t("join.previewNote")} {t("join.expires", { date: formatDate(pre.expiresAt) })}</p>
          <JoinForm token={token} groupId={pre.groupId} loggedInName={user?.display_name ?? null} already={pre.already} pendingClaim={pre.pendingClaim}
            targeted={pre.targeted} placeholders={pre.placeholders} />
        </>
      )}
    </main>
  );
}
