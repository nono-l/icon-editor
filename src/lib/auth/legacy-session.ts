import { useEffect, useState } from "react";
import type { AppUser, CurrentUserState } from "./use-current-user";

export const authEnabled = true;
export const GROK_PROVIDERS: { id: string; label: string }[] = [];

async function authOp(op: string, body?: Record<string, unknown>) {
  const res = await fetch(`api/auth.php?op=${encodeURIComponent(op)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ op, ...body }),
  });
  return res.json() as Promise<{ user?: AppUser | null; error?: string }>;
}

export async function signInEmail(email: string, password: string, name?: string) {
  return authOp("login", { email, password, name });
}

export async function registerEmail(email: string, password: string, name?: string) {
  return authOp("register", { email, password, name });
}

export async function signOut() {
  await authOp("logout");
}

export function useCurrentUserState(): CurrentUserState {
  const [user, setUser] = useState<AppUser | null>(null);
  const [isPending, setPending] = useState(true);
  useEffect(() => {
    let live = true;
    void fetch("api/auth.php?op=me", { credentials: "include" })
      .then((r) => r.json())
      .then((j: { user?: AppUser | null }) => {
        if (live) {
          setUser(j.user ?? null);
          setPending(false);
        }
      })
      .catch(() => {
        if (live) {
          setUser(null);
          setPending(false);
        }
      });
    return () => {
      live = false;
    };
  }, []);
  return { user, isPending };
}

export function useCurrentUser(): AppUser | null {
  return useCurrentUserState().user;
}

export const DEV_USER: AppUser = {
  id: "dev-user",
  displayName: "Dev User",
  primaryEmail: "dev@example.com",
  profileImageUrl: null,
  isDevFallback: true,
};
