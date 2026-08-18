/** Host grant language for the icon editor. Kernel stores JSON only. */

export const UNLOCK_IDS = ["size512", "size1024", "apple", "palette"] as const;
export type UnlockId = (typeof UNLOCK_IDS)[number];

export const UNLOCK_TTL_DAYS = 90;

export type GrantBundle = {
  ink?: number;
  ticket?: number;
  unlocks?: string;
};

export const UNLOCK_META: Record<
  UnlockId,
  { label: string; hint: string; inkCost: number }
> = {
  size512: { label: "512×512", hint: "大きなアイコン", inkCost: 5 },
  size1024: { label: "1024×1024", hint: "高解像度", inkCost: 10 },
  apple: { label: "Apple 180", hint: "ホーム画面用", inkCost: 4 },
  palette: { label: "拡張パレット", hint: "背景色を追加", inkCost: 3 },
};

export function unlockExpiresAt(from = Date.now()): string {
  return new Date(from + UNLOCK_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

export function resolveUnlockExpiry(expiresAt: string, grantedAt: string, now = Date.now()): string {
  const exp = Date.parse(expiresAt || "");
  if (Number.isFinite(exp)) return new Date(exp).toISOString();
  const g = Date.parse(grantedAt || "");
  if (Number.isFinite(g)) return unlockExpiresAt(g);
  return unlockExpiresAt(now);
}

export function unlockIsActive(expiresAt: string, now = Date.now()): boolean {
  const t = Date.parse(expiresAt || "");
  return Number.isFinite(t) && t > now;
}

export function unlockRemainingLabel(expiresAt: string, now = Date.now()): string {
  const t = Date.parse(expiresAt || "");
  if (!Number.isFinite(t)) return "";
  const ms = t - now;
  if (ms <= 0) return "期限切れ";
  const days = Math.floor(ms / 86_400_000);
  if (days >= 1) return `残り${days}日`;
  const hours = Math.floor(ms / 3_600_000);
  if (hours >= 1) return `残り${hours}時間`;
  return `残り${Math.max(1, Math.floor(ms / 60_000))}分`;
}

export function normalizePromoCode(raw: string | null | undefined): string {
  return String(raw || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 24);
}

export function normalizeUnlocksField(raw: unknown): string {
  let parts: string[] = [];
  if (typeof raw === "string") parts = raw.split(/[\s,|+/]+/);
  else if (Array.isArray(raw)) parts = raw.map(String);
  else if (raw && typeof raw === "object") {
    parts = Object.keys(raw as object).filter((k) => !!(raw as Record<string, unknown>)[k]);
  }
  const ok = new Set<string>(UNLOCK_IDS);
  const out: string[] = [];
  for (const p of parts) {
    const id = String(p || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, "");
    if (ok.has(id) && !out.includes(id)) out.push(id);
  }
  return out.join(",");
}

function clampQty(n: unknown, max = 999): number {
  const v = Math.floor(Number(n) || 0);
  return Math.max(0, Math.min(max, v));
}

export function sanitizeGrant(g: GrantBundle | null | undefined): GrantBundle {
  const out: GrantBundle = {};
  const ink = clampQty(g?.ink);
  const ticket = clampQty(g?.ticket);
  const unlocks = normalizeUnlocksField(g?.unlocks);
  if (ink) out.ink = ink;
  if (ticket) out.ticket = ticket;
  if (unlocks) out.unlocks = unlocks;
  return out;
}

export function grantIsEmpty(g: GrantBundle): boolean {
  return !((g.ink || 0) > 0 || (g.ticket || 0) > 0 || (g.unlocks && g.unlocks.length > 0));
}

export function parseGrantJson(raw: string | null | undefined): GrantBundle {
  try {
    return sanitizeGrant(JSON.parse(raw || "{}") as GrantBundle);
  } catch {
    return {};
  }
}

export function formatGrantSummary(g: GrantBundle): string {
  const parts: string[] = [];
  if (g.ink) parts.push(`インク×${g.ink}`);
  if (g.ticket) parts.push(`チケット×${g.ticket}`);
  if (g.unlocks) {
    const labels = g.unlocks
      .split(",")
      .map((id) => UNLOCK_META[id as UnlockId]?.label ?? id)
      .filter(Boolean);
    if (labels.length) parts.push(labels.join("・"));
  }
  return parts.length ? parts.join(" / ") : "なし";
}

export function normalizeExpiresAt(raw: unknown): string {
  const s = String(raw || "").trim();
  if (!s) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const t = Date.parse(`${s}T23:59:59.999Z`);
    return Number.isFinite(t) ? new Date(t).toISOString() : "";
  }
  const t = Date.parse(s);
  return Number.isFinite(t) ? new Date(t).toISOString() : "";
}

export function normalizeMaxClaims(raw: unknown): number {
  const n = Math.floor(Number(raw) || 0);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(1_000_000, n);
}

export function isPromoExpired(expiresAt: string | null | undefined, now = Date.now()): boolean {
  const exp = String(expiresAt || "").trim();
  if (!exp) return false;
  const t = Date.parse(exp);
  return Number.isFinite(t) && now > t;
}

export function isPromoSoldOut(
  maxClaims: number | null | undefined,
  claimCount: number | null | undefined,
): boolean {
  const max = normalizeMaxClaims(maxClaims);
  if (max <= 0) return false;
  return (Number(claimCount) || 0) >= max;
}

export type PromoDef = {
  code: string;
  label: string;
  grant: GrantBundle;
  custom: boolean;
  active?: boolean;
  expiresAt?: string;
  maxClaims?: number;
  claimCount?: number;
};

export const BUILTIN_PROMOS: PromoDef[] = [
  {
    code: "WELCOME",
    label: "はじめの一滴",
    grant: { ink: 3, unlocks: "size512" },
    custom: false,
  },
  {
    code: "STUDIO",
    label: "スタジオキット",
    grant: { ink: 8, unlocks: "size512,size1024,apple,palette" },
    custom: false,
  },
  {
    code: "INK5",
    label: "インク補給",
    grant: { ink: 5 },
    custom: false,
  },
];

export function findBuiltin(code: string): PromoDef | null {
  const c = normalizePromoCode(code);
  return BUILTIN_PROMOS.find((d) => d.code === c) ?? null;
}
