import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { claimBannerInk, recordBannerEvent } from "@/lib/kernel/fns";
import { useCurrentUserState } from "@/lib/auth/use-current-user";

export const Route = createFileRoute("/go")({
  validateSearch: (s: Record<string, unknown>) => ({
    to: typeof s.to === "string" ? s.to : "",
    banner: typeof s.banner === "string" ? s.banner : "",
  }),
  component: GoPage,
});

function safeHttpUrl(raw: string): URL | null {
  try {
    const u = new URL(raw);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u;
  } catch {
    return null;
  }
}

function GoPage() {
  const { to, banner } = Route.useSearch();
  const dest = useMemo(() => safeHttpUrl(to), [to]);
  const { user } = useCurrentUserState();
  const [rated, setRated] = useState(0);
  const [inkNote, setInkNote] = useState("");

  async function open() {
    if (!dest) return;
    if (banner) {
      await recordBannerEvent({ data: { bannerId: banner, kind: "click" } }).catch(() => {});
      if (user) {
        const r = await claimBannerInk({ data: banner }).catch(() => null);
        if (r?.ok && r.granted) {
          setInkNote("インク +1");
          toast.success("インク +1");
        } else if (r?.ok && r.reason === "already") {
          setInkNote("この帯は本日受け取り済みです");
        }
      } else {
        setInkNote("ログインすると、このリンクでインク +1");
      }
    }
    window.open(dest.toString(), "_blank", "noopener,noreferrer");
  }

  async function rate(n: number) {
    if (!user) {
      toast.message("評価にはログインが必要です（課金はありません）");
      return;
    }
    setRated(n);
    if (banner) {
      await recordBannerEvent({
        data: { bannerId: banner, kind: "rate", rating: n },
      }).catch(() => {});
    }
    toast.success("評価を送りました");
  }

  return (
    <main className="grid min-h-dvh place-items-center bg-bg px-6 text-fg">
      <div className="w-full max-w-md space-y-4 rounded-[var(--radius-xl)] border border-border bg-bg-elevated p-6">
        <p className="text-[10px] tracking-[0.2em] text-fg-subtle">OUTBOUND</p>
        <h1 className="text-xl font-semibold">外部サイトを開きます</h1>
        {dest ? (
          <>
            <p className="break-all rounded-[var(--radius-md)] border border-border bg-bg-subtle px-3 py-2 font-mono text-xs text-fg-muted">
              {dest.host}
              {dest.pathname}
            </p>
            <p className="text-xs text-fg-subtle">
              {user
                ? "リンクを開くとインク 1 滴（帯ごと・1日1回）"
                : "ログインしてから開くとインク 1 滴もらえます"}
            </p>
            <Button type="button" className="w-full" onClick={() => void open()}>
              本当に開く
            </Button>
            {inkNote && <p className="text-center text-sm text-primary">{inkNote}</p>}
            <div>
              <p className="mb-1.5 text-xs text-fg-subtle">評価（枠は減りません）</p>
              <div className="flex gap-1">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => void rate(n)}
                    className={
                      rated === n
                        ? "h-11 flex-1 rounded-[var(--radius-md)] bg-primary text-sm font-medium text-primary-fg"
                        : "h-11 flex-1 rounded-[var(--radius-md)] border border-border text-sm text-fg-muted"
                    }
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>
          </>
        ) : (
          <p className="text-sm text-fg-muted">リンクが不正です。</p>
        )}
        <Link to="/" className="block text-center text-sm text-fg-muted hover:text-fg">
          戻る
        </Link>
      </div>
    </main>
  );
}
