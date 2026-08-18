import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { AppShell, useStudio } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { claimWatch, listWatchCatalog } from "@/lib/kernel/fns";
import {
  MUTE_OFF_RATE,
  formatSec,
  maxInkForVideo,
  nextPayableDef,
  type WatchVideo,
} from "@/lib/kernel/watch-math";

export const Route = createFileRoute("/watch")({ component: WatchPage });

const MUTE_KEY = "icon-studio-watch-mute";

function WatchPage() {
  const [studio, reload] = useStudio();
  const [video, setVideo] = useState<WatchVideo | null>(null);
  const [catalog, setCatalog] = useState<WatchVideo[]>([]);
  const [empty, setEmpty] = useState(false);
  const [watchSec, setWatchSec] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(true);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const acc = useRef(0);
  const last = useRef(0);
  const claimed = useRef(new Set<number>());

  useEffect(() => {
    try {
      const saved = localStorage.getItem(MUTE_KEY);
      if (saved === "0") setMuted(false);
      else if (saved === "1") setMuted(true);
      else setMuted(window.matchMedia("(pointer: coarse)").matches);
    } catch {
      setMuted(true);
    }
  }, []);

  function applyCatalog(r: { videos: WatchVideo[]; picked: WatchVideo | null }, avoidId?: string) {
    const list = r.videos;
    setCatalog(list);
    const next =
      (avoidId && list.find((v) => v.id !== avoidId)) ||
      r.picked ||
      list[0] ||
      null;
    setVideo(next);
    setEmpty(!next);
    setWatchSec(0);
    claimed.current = new Set();
  }

  useEffect(() => {
    void listWatchCatalog().then((r) => applyCatalog(r));
  }, []);

  useEffect(() => {
    function onMsg(ev: MessageEvent) {
      const data = ev.data;
      if (!data || typeof data !== "object") return;
      const evName = (data as { event?: string }).event;
      const info = (data as { info?: number }).info;
      if (evName === "onStateChange" && typeof info === "number") {
        setPlaying(info === 1);
      }
    }
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, []);

  useEffect(() => {
    if (!playing) {
      last.current = 0;
      return;
    }
    last.current = performance.now();
    const t = window.setInterval(() => {
      const now = performance.now();
      const dt = (now - last.current) / 1000;
      last.current = now;
      const rate = muted ? 1 : MUTE_OFF_RATE;
      acc.current += dt * rate;
      if (acc.current >= 0.25) {
        const add = acc.current;
        acc.current = 0;
        setWatchSec((s) => s + add);
      }
    }, 250);
    return () => window.clearInterval(t);
  }, [playing, muted]);

  useEffect(() => {
    if (!video || !studio.signedIn) return;
    const next = nextPayableDef(video.durationSec, claimed.current, { once: video.claimOnce });
    if (!next || watchSec < next.at) return;
    if (claimed.current.has(next.at)) return;
    claimed.current.add(next.at);
    void claimWatch({ data: { videoId: video.id, watchSec: Math.floor(watchSec) } })
      .then((r) => {
        if (r.ok) {
          toast.success(`チケット +${r.reward}`);
          reload();
        } else if (r.reason === "capped") {
          toast.message("この時間の上限に達しました（時が変わるとリセット）");
        } else if (r.reason === "dry") {
          toast.message("この映像の配信枠が尽きました");
        } else {
          claimed.current.delete(next.at);
        }
      })
      .catch(() => {
        claimed.current.delete(next.at);
      });
  }, [watchSec, video, studio.signedIn, reload]);

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const next = video
    ? nextPayableDef(video.durationSec, claimed.current, { once: video.claimOnce })
    : null;

  return (
    <AppShell studio={studio} title="視聴" kicker="WATCH">
      <p className="mb-4 text-sm text-fg-muted">
        カタログの映像を見ると、素材登録用のチケットが貯まります。一時停止中は進みません。音を出すとノルマが 2
        倍速。1 時間（時計の「時」）あたり {studio.hourCap} 枚まで。
      </p>
      {empty && (
        <div className="overflow-hidden rounded-t-[10px] border border-primary/35 bg-[#041008]">
          <div className="flex h-14 items-stretch">
            <div className="flex w-[72px] shrink-0 items-center justify-center bg-[#0a1810] text-[10px] text-fg-subtle">
              なし
            </div>
            <div className="flex min-w-0 flex-1 flex-col justify-center gap-0.5 px-3">
              <p className="text-[9px] font-extrabold tracking-[0.06em] text-primary/80">WATCH AD</p>
              <p className="text-[11px] font-extrabold text-fg">いま再生できる広告はありません</p>
              <p className="text-[9px] text-fg-subtle">広告が登録・配信中になるまでお待ちください</p>
            </div>
          </div>
        </div>
      )}
      {video && (
        <div className="overflow-hidden rounded-[var(--radius-xl)] border border-border bg-bg-elevated">
          <div className="aspect-video bg-black">
            <iframe
              ref={iframeRef}
              title={video.label}
              className="size-full"
              src={`https://www.youtube-nocookie.com/embed/${video.id}?enablejsapi=1&origin=${encodeURIComponent(origin)}&rel=0&modestbranding=1`}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          </div>
          <div className="space-y-3 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="font-medium">{video.label}</h2>
                <p className="text-[11px] text-fg-subtle">
                  最後まで見ると最大 {maxInkForVideo(video.durationSec)} 枚 · 尺{" "}
                  {formatSec(video.durationSec)}
                  {video.paid ? " · パートナー枠" : " · 運営枠"}
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap justify-end gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={catalog.length < 2}
                onClick={() => {
                  const next = catalog.find((v) => v.id !== video.id) ?? video;
                  setVideo(next);
                  setWatchSec(0);
                  claimed.current = new Set();
                }}
              >
                別の映像
              </Button>
              <Button
                type="button"
                size="sm"
                variant={muted ? "outline" : "secondary"}
                onClick={() => {
                  const nextMute = !muted;
                  setMuted(nextMute);
                  try {
                    localStorage.setItem(MUTE_KEY, nextMute ? "1" : "0");
                  } catch {
                    /* ignore */
                  }
                }}
              >
                {muted ? "ミュート中" : "音あり ×2"}
              </Button>
              </div>
            </div>
            <div>
              <div className="mb-1 flex justify-between text-[11px] text-fg-subtle">
                <span>進行 {formatSec(watchSec)}</span>
                <span>
                  次 {next ? formatSec(next.at) : "完了"} · この時 {studio.hourInk}/{studio.hourCap}
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-bg-subtle">
                <div
                  className="h-full bg-primary transition-[width] duration-150"
                  style={{
                    width: `${Math.min(100, (watchSec / (next?.at || video.durationSec || 1)) * 100)}%`,
                  }}
                />
              </div>
            </div>
            {!studio.signedIn && (
              <p className="text-xs text-fg-muted">
                報酬を受け取るには{" "}
                <Link to="/login" className="text-primary underline-offset-2 hover:underline">
                  ログイン
                </Link>
              </p>
            )}
            {video.showChannel && video.channelUrl && (
              <a
                href={video.channelUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="block text-xs text-primary underline-offset-2 hover:underline"
              >
                チャンネル {video.channelName || "を開く"}
              </a>
            )}
            <p className="text-[11px] text-fg-subtle">
              ミュート設定はこの端末にだけ保存されます。iframe は作り直しません。
            </p>
          </div>
        </div>
      )}
    </AppShell>
  );
}
