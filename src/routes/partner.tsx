import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { AppShell, useStudio } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  fetchYoutubeMeta,
  listMyVideos,
  redeemPrepaid,
  upsertWatchVideo,
} from "@/lib/kernel/fns";
import { RedirectToSignIn } from "@/lib/auth/gates";
import { useCurrentUserState } from "@/lib/auth/use-current-user";

export const Route = createFileRoute("/partner")({ component: PartnerPage });

function PartnerPage() {
  const { user, isPending } = useCurrentUserState();
  const [studio, reload] = useStudio();
  const [url, setUrl] = useState("");
  const [label, setLabel] = useState("");
  const [duration, setDuration] = useState(60);
  const [claimOnce, setClaimOnce] = useState(false);
  const [showChannel, setShowChannel] = useState(false);
  const [prepaid, setPrepaid] = useState("");
  const [mine, setMine] = useState<Awaited<ReturnType<typeof listMyVideos>> | null>(null);
  const [busy, setBusy] = useState(false);

  function load() {
    void listMyVideos()
      .then(setMine)
      .catch(() => setMine(null));
  }

  useEffect(() => {
    if (user) load();
  }, [user?.id]);

  if (isPending) {
    return (
      <AppShell studio={studio} title="パートナー" kicker="PARTNER">
        <div className="h-40 animate-pulse rounded-[var(--radius-xl)] bg-bg-elevated" />
      </AppShell>
    );
  }
  if (!user) return <RedirectToSignIn to="/login" />;

  async function lookup() {
    setBusy(true);
    try {
      const m = await fetchYoutubeMeta({ data: url });
      if (!m.ok) {
        toast.error("URL を読めませんでした");
        return;
      }
      if (m.title) setLabel(m.title.slice(0, 40));
      toast.success("タイトルを取得しました");
    } finally {
      setBusy(false);
    }
  }

  async function addVideo() {
    setBusy(true);
    try {
      const r = await upsertWatchVideo({
        data: {
          url,
          label,
          durationSec: duration,
          claimOnce,
          showChannel,
          asPartner: true,
        },
      });
      if (!r.ok) {
        toast.error(r.reason === "taken" ? "別の人が登録済みです" : "追加できません");
        return;
      }
      toast.success("カタログに載せました");
      setUrl("");
      load();
    } finally {
      setBusy(false);
    }
  }

  async function redeem() {
    setBusy(true);
    try {
      const r = await redeemPrepaid({ data: prepaid });
      if (!r.ok) {
        const msg: Record<string, string> = {
          already: "使用済みです",
          expired: "期限切れです",
          sold_out: "上限です",
          invalid: "コードが無効です",
        };
        toast.error(msg[r.reason] ?? "使えません");
        return;
      }
      toast.success(`枠 +${Math.round(r.added / 3600)} 時間`);
      setPrepaid("");
      reload();
      load();
    } finally {
      setBusy(false);
    }
  }

  const credit = mine?.creditSec ?? studio.creditSec;

  return (
    <AppShell studio={studio} title="パートナー" kicker="PARTNER">
      <p className="mb-4 text-sm text-fg-muted">
        自分の映像だけが見えます。1 秒視聴 = 枠 1 秒。残高が 0 の映像は流れません。
      </p>
      <section className="mb-4 rounded-[var(--radius-xl)] border border-border bg-bg-elevated p-4">
        <p className="text-xs font-medium text-fg-subtle">配信枠</p>
        <p className="mt-1 text-2xl font-semibold tabular-nums">
          {Math.floor(credit / 3600)}
          <span className="ml-1 text-sm font-normal text-fg-muted">時間</span>
          <span className="ml-2 text-sm font-normal text-fg-subtle">
            （{credit} 秒）
          </span>
        </p>
        <div className="mt-3 flex gap-2">
          <Input
            value={prepaid}
            onChange={(e) => setPrepaid(e.target.value.toUpperCase())}
            placeholder="プリペイドコード"
            className="font-mono"
          />
          <Button type="button" onClick={() => void redeem()} disabled={busy || !prepaid}>
            チャージ
          </Button>
        </div>
        <p className="mt-2 text-[11px] text-fg-subtle">コードは運営が発行します。</p>
      </section>

      <section className="mb-4 rounded-[var(--radius-xl)] border border-border bg-bg-elevated p-4">
        <p className="mb-2 text-xs font-medium text-fg-subtle">映像を載せる</p>
        <div className="space-y-2">
          <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="YouTube URL" />
          <div className="flex gap-2">
            <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="表示名" />
            <Button type="button" variant="outline" onClick={() => void lookup()} disabled={busy}>
              取得
            </Button>
          </div>
          <label className="block text-xs text-fg-subtle">
            尺（秒）
            <Input
              type="number"
              min={10}
              max={86400}
              value={duration}
              onChange={(e) => setDuration(Number(e.target.value))}
              className="mt-1"
            />
          </label>
          <label className="flex min-h-11 items-center gap-2 text-xs text-fg-muted">
            <input
              type="checkbox"
              checked={claimOnce}
              onChange={(e) => setClaimOnce(e.target.checked)}
              className="size-5 accent-[var(--color-primary)]"
            />
            1 人 1 回だけ報酬
          </label>
          <label className="flex min-h-11 items-center gap-2 text-xs text-fg-muted">
            <input
              type="checkbox"
              checked={showChannel}
              onChange={(e) => setShowChannel(e.target.checked)}
              className="size-5 accent-[var(--color-primary)]"
            />
            視聴後にチャンネルリンクを出す
          </label>
          <Button type="button" onClick={() => void addVideo()} disabled={busy || !url}>
            登録
          </Button>
        </div>
      </section>

      <section className="rounded-[var(--radius-xl)] border border-border bg-bg-elevated p-4">
        <p className="mb-2 text-xs font-medium text-fg-subtle">自分の映像</p>
        {!mine?.videos.length ? (
          <p className="text-xs text-fg-subtle">まだありません</p>
        ) : (
          <ul className="space-y-1.5">
            {mine.videos.map((v) => (
              <li
                key={v.id}
                className="rounded-[var(--radius-md)] border border-border bg-bg-subtle px-3 py-2 text-sm"
              >
                <div className="font-medium">{v.label}</div>
                <div className="text-[11px] text-fg-subtle">
                  {v.id} · {v.duration_sec}秒 · {v.active ? "配信中" : "停止"}
                  {v.claim_once ? " · 1人1回" : ""}
                </div>
              </li>
            ))}
          </ul>
        )}
        <Link
          to="/banner"
          className="mt-3 inline-flex text-xs text-primary underline-offset-2 hover:underline"
        >
          帯エディタで配信画像を作る
        </Link>
      </section>
    </AppShell>
  );
}
