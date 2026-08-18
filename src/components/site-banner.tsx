import { useEffect, useRef, useState } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import {
  listPublicBanners,
  listWatchCatalog,
  recordBannerEvent,
  type PublicBanner,
} from "@/lib/kernel/fns";
import { cn } from "@/lib/utils";

function ytThumb(id: string) {
  return `https://i.ytimg.com/vi/${id}/mqdefault.jpg`;
}

export function SiteBanner() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const hideAll = pathname === "/login" || pathname === "/go";
  const hideWatch = hideAll || pathname === "/watch";
  const hideSponsor = hideAll;
  const [banners, setBanners] = useState<PublicBanner[]>([]);
  const [watchLabel, setWatchLabel] = useState<string | null>(null);
  const [watchId, setWatchId] = useState<string | null>(null);
  const seen = useRef(new Set<string>());

  useEffect(() => {
    void listPublicBanners()
      .then((r) => setBanners(r.banners))
      .catch(() => setBanners([]));
    void listWatchCatalog()
      .then((r) => {
        setWatchId(r.picked?.id ?? null);
        setWatchLabel(r.picked?.label ?? null);
      })
      .catch(() => {
        setWatchId(null);
        setWatchLabel(null);
      });
  }, []);

  useEffect(() => {
    for (const b of banners) {
      if (seen.current.has(b.id)) continue;
      seen.current.add(b.id);
      void recordBannerEvent({ data: { bannerId: b.id, kind: "impress" } }).catch(() => {});
    }
  }, [banners]);

  if (hideAll) return null;

  const sponsor = banners[0];
  const dest = sponsor?.href.trim() ?? "";
  const sponsorHref = dest
    ? `/go?to=${encodeURIComponent(dest)}&banner=${encodeURIComponent(sponsor.id)}`
    : sponsor
      ? undefined
      : "/partner";

  return (
    <>
      {!hideWatch && (
        <Link
          to="/watch"
          className={cn(
            "fixed z-50 flex h-14 w-[min(48vw,200px)] overflow-hidden rounded-t-[10px] border border-primary/35 bg-[#041008] text-left shadow-[0_4px_16px_#000c]",
          )}
          style={{
            left: "max(6px, env(safe-area-inset-left, 0px))",
            bottom: "env(safe-area-inset-bottom, 0px)",
          }}
        >
          <div
            className="h-full w-[72px] shrink-0 bg-[#0a1810] bg-cover bg-center"
            style={watchId ? { backgroundImage: `url("${ytThumb(watchId)}")` } : undefined}
          />
          <div className="flex min-w-0 flex-1 flex-col justify-center gap-0.5 px-2 py-1">
            <span className="text-[9px] font-extrabold tracking-[0.06em] text-primary/80">WATCH AD</span>
            <span className="truncate text-[11px] font-extrabold text-fg">
              {watchLabel || "配信開始をお待ちください"}
            </span>
            <span className={cn("text-[9px]", watchId ? "text-primary" : "text-fg-subtle")}>
              {watchId ? "タップで視聴 · チケットGET" : "配信開始をお待ちください"}
            </span>
          </div>
        </Link>
      )}

      {!hideSponsor &&
        (sponsorHref ? (
          <a
            href={sponsorHref}
            className="relative fixed z-50 h-14 w-[min(52vw,220px)] overflow-hidden rounded-b-[10px] border border-[#3a5a6a] bg-[#040810] bg-cover bg-center shadow-[0_4px_16px_#000c]"
            style={{
              right: "max(6px, env(safe-area-inset-right, 0px))",
              top: "var(--grok-banner-h, 0px)",
              backgroundImage: sponsor ? `url("${sponsor.imageUrl}")` : undefined,
            }}
          >
            <SponsorBadge wanted={!sponsor} />
          </a>
        ) : (
          <div
            className="relative fixed z-50 h-14 w-[min(52vw,220px)] overflow-hidden rounded-b-[10px] border border-[#3a5a6a] bg-[#040810] bg-cover bg-center shadow-[0_4px_16px_#000c]"
            style={{
              right: "max(6px, env(safe-area-inset-right, 0px))",
              top: "var(--grok-banner-h, 0px)",
              backgroundImage: sponsor ? `url("${sponsor.imageUrl}")` : undefined,
            }}
          >
            <SponsorBadge wanted={!sponsor} />
          </div>
        ))}
    </>
  );
}

function SponsorBadge({ wanted }: { wanted: boolean }) {
  return (
    <span
      className={cn(
        "absolute bottom-1 left-1.5 rounded px-1.5 py-0.5 text-[9px] font-extrabold tracking-wide",
        wanted
          ? "border border-sky-400/50 bg-black/70 text-sky-200"
          : "border border-sky-400/40 bg-black/70 text-sky-300",
      )}
    >
      {wanted ? "募集中" : "SPONSOR"}
    </span>
  );
}
