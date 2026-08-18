import { createFileRoute, Link } from "@tanstack/react-router";
import { GROK_PROVIDERS, authEnabled, signIn } from "@/lib/auth/client";
import { SignedIn, UserButton } from "@/lib/auth/gates";
import { useCurrentUserState } from "@/lib/auth/use-current-user";

export const Route = createFileRoute("/login")({
  validateSearch: (s: Record<string, unknown>): { next?: string } => ({
    next: typeof s.next === "string" && s.next.startsWith("/") ? s.next : undefined,
  }),
  component: Login,
});

function Login() {
  const { next } = Route.useSearch();
  const dest = next || "/";
  const { user, isPending } = useCurrentUserState();

  return (
    <main className="grid min-h-dvh place-items-center bg-bg px-6 pt-14 text-fg">
      <div className="w-full max-w-sm space-y-5 rounded-[var(--radius-xl)] border border-border bg-bg-elevated p-6">
        <div>
          <p className="text-[10px] tracking-[0.2em] text-fg-subtle">ICON STUDIO</p>
          <h1 className="mt-1 text-xl font-semibold">ログイン</h1>
          <p className="mt-2 text-sm text-fg-muted">
            編集そのものは不要です。プロモ・視聴・配信枠にはアカウントが要ります。
          </p>
        </div>

        {isPending ? (
          <div className="h-11 animate-pulse rounded-[var(--radius-md)] bg-bg-subtle" />
        ) : user ? (
          <div className="space-y-3">
            <SignedIn>
              <UserButton />
            </SignedIn>
            <a
              href={dest}
              className="flex h-11 items-center justify-center rounded-[var(--radius-md)] bg-primary text-sm font-medium text-primary-fg"
            >
              続ける
            </a>
          </div>
        ) : authEnabled ? (
          <div className="space-y-2">
            {GROK_PROVIDERS.map((p) => (
              <button
                key={p.providerId}
                type="button"
                onClick={() => signIn(p.providerId, { callbackURL: dest })}
                className="flex h-11 w-full items-center justify-center rounded-[var(--radius-md)] border border-border bg-bg-subtle text-sm font-medium text-fg hover:bg-border/40"
              >
                {p.label} で続ける
              </button>
            ))}
          </div>
        ) : (
          <p className="text-sm text-fg-subtle">サインインは無効です。</p>
        )}

        <Link to="/" className="block text-center text-sm text-fg-muted hover:text-fg">
          ログインせずに編集する
        </Link>
      </div>
    </main>
  );
}
