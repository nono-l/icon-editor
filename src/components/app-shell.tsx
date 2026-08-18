import { Link, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Droplets, Ticket } from "lucide-react";
import { SiteBanner } from "@/components/site-banner";
import { UserButton } from "@/lib/auth/gates";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { getMyStudio } from "@/lib/kernel/fns";
import { cn } from "@/lib/utils";

export type StudioState = {
  signedIn: boolean;
  userId?: string;
  ink: number;
  tickets: number;
  unlocks: string[];
  unlockUntil: Partial<Record<string, string>>;
  isStaff: boolean;
  isSuper: boolean;
  hourInk: number;
  hourCap: number;
  creditSec: number;
  storage?: "remote" | "none" | "local";
};

export const GUEST_STUDIO: StudioState = {
  signedIn: false,
  ink: 0,
  tickets: 0,
  unlocks: [],
  unlockUntil: {},
  isStaff: false,
  isSuper: false,
  hourInk: 0,
  hourCap: 4,
  creditSec: 0,
};

export function useStudio(): [StudioState, () => void, boolean] {
  const { user, isPending } = useCurrentUserState();
  const [studio, setStudio] = useState<StudioState>(GUEST_STUDIO);
  const [ready, setReady] = useState(false);

  const reload = () => {
    if (!user) {
      setStudio(GUEST_STUDIO);
      setReady(!isPending);
      return;
    }
    void getMyStudio()
      .then((s) => {
        setStudio(s);
        setReady(true);
      })
      .catch(() => {
        setStudio(GUEST_STUDIO);
        setReady(true);
      });
  };

  useEffect(() => {
    if (isPending) return;
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, isPending]);

  return [studio, reload, ready && !isPending];
}

const NAV = [
  { to: "/", label: "編集" },
  { to: "/watch", label: "視聴" },
  { to: "/library", label: "素材" },
  { to: "/partner", label: "パートナー" },
  { to: "/banner", label: "帯" },
] as const;

export function AppShell({
  children,
  studio,
  title,
  kicker,
}: {
  children: React.ReactNode;
  studio: StudioState;
  title: string;
  kicker?: string;
}) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { user, isPending } = useCurrentUserState();

  return (
    <div className="min-h-dvh bg-bg px-4 pb-24 pt-14 text-fg sm:px-6 sm:pb-24 sm:pt-16">
      <div className="mx-auto max-w-2xl">
        <header className="mb-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[10px] tracking-[0.2em] text-fg-subtle">
                {kicker ?? "ICON STUDIO"}
              </p>
              <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
            </div>
            <div className="flex shrink-0 items-center gap-2 pt-1">
              <div className="inline-flex h-8 items-center gap-1.5 rounded-full border border-border bg-bg-subtle px-2.5 text-xs text-fg">
                <Ticket className="size-3.5 text-primary" />
                <span className="tabular-nums">{studio.tickets}</span>
              </div>
              <div className="inline-flex h-8 items-center gap-1.5 rounded-full border border-border bg-bg-subtle px-2.5 text-xs text-fg">
                <Droplets className="size-3.5 text-primary" />
                <span className="tabular-nums">{studio.ink}</span>
              </div>
              {isPending ? (
                <div className="h-8 w-16 animate-pulse rounded-full bg-bg-subtle" />
              ) : user ? (
                <UserButton />
              ) : (
                <Link
                  to="/login"
                  className="inline-flex h-8 items-center rounded-[var(--radius-md)] border border-border px-3 text-xs text-fg-muted hover:bg-bg-subtle hover:text-fg"
                >
                  ログイン
                </Link>
              )}
            </div>
          </div>
          <nav className="mt-4 flex flex-wrap gap-1.5">
            {NAV.map((n) => (
              <Link
                key={n.to}
                to={n.to}
                className={cn(
                  "inline-flex h-9 items-center rounded-[var(--radius-sm)] px-3 text-xs font-medium",
                  pathname === n.to
                    ? "bg-primary/15 text-primary"
                    : "text-fg-muted hover:bg-bg-subtle hover:text-fg",
                )}
              >
                {n.label}
              </Link>
            ))}
            {studio.isStaff && (
              <Link
                to="/ops"
                className={cn(
                  "inline-flex h-9 items-center rounded-[var(--radius-sm)] px-3 text-xs font-medium",
                  pathname === "/ops"
                    ? "bg-primary/15 text-primary"
                    : "text-fg-muted hover:bg-bg-subtle hover:text-fg",
                )}
              >
                管理者
              </Link>
            )}
          </nav>
        </header>
        {children}
      </div>
      <SiteBanner />
    </div>
  );
}
