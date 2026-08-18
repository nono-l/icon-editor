export const WATCH_FLOOR_SEC = 10;
export const WATCH_FIRST_CAP_SEC = 60;
export const WATCH_LONG_START_SEC = 5 * 60;
export const WATCH_HOUR_SEC = 60 * 60;
export const WATCH_QUARTER_SEC = 15 * 60;
export const WATCH_HOURLY_MAX = 4;
export const MUTE_OFF_RATE = 2;

export type WatchVideo = {
  id: string;
  label: string;
  durationSec: number;
  totalWatchSec?: number;
  createdAt?: string;
  createdAtMs?: number;
  paid?: boolean;
  ownerPlayerId?: string;
  claimOnce?: boolean;
  showChannel?: boolean;
  channelUrl?: string;
  channelName?: string;
};

export type WatchMilestone = { at: number; reward: number; label: string };

export function parseYouTubeVideoId(input: string | null | undefined): string {
  const raw = String(input || "").trim();
  if (!raw) return "";
  if (/^[a-zA-Z0-9_-]{6,20}$/.test(raw)) return raw.slice(0, 20);
  let s = raw.replace(/^[<\['"]+|[>\]'"]+$/g, "").trim();
  try {
    if (!/^https?:\/\//i.test(s) && /youtube|youtu\.be/i.test(s)) {
      s = "https://" + s.replace(/^\/\//, "");
    }
    const u = new URL(s);
    const host = u.hostname.replace(/^www\./, "").toLowerCase();
    if (host === "youtu.be") {
      return sanitizeYtId(u.pathname.split("/").filter(Boolean)[0] || "");
    }
    if (host === "youtube.com" || host.endsWith(".youtube.com") || host === "youtube-nocookie.com") {
      const v = u.searchParams.get("v");
      if (v) return sanitizeYtId(v);
      const parts = u.pathname.split("/").filter(Boolean);
      const markers = new Set(["embed", "live", "shorts", "v", "e"]);
      for (let i = 0; i < parts.length; i++) {
        if (markers.has(parts[i]!.toLowerCase()) && parts[i + 1]) {
          return sanitizeYtId(parts[i + 1]!);
        }
      }
    }
  } catch {
    /* ignore */
  }
  const m = s.match(/(?:v=|youtu\.be\/|\/embed\/|\/shorts\/)([a-zA-Z0-9_-]{6,20})/);
  return m?.[1] ? sanitizeYtId(m[1]) : "";
}

function sanitizeYtId(id: string): string {
  return String(id || "")
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .slice(0, 20);
}

export function formatSec(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m >= 60) {
    const h = Math.floor(m / 60);
    return `${h}時間${m % 60}分`;
  }
  return m > 0 ? `${m}分${r.toString().padStart(2, "0")}秒` : `${r}秒`;
}

export function requiredWatchSec(durationSec: number): number {
  const dur = Math.floor(Number(durationSec) || WATCH_FIRST_CAP_SEC);
  return Math.min(WATCH_FIRST_CAP_SEC, Math.max(WATCH_FLOOR_SEC, dur));
}

export function watchMilestoneDefs(durationSec: number): WatchMilestone[] {
  const dur = Math.max(0, Math.floor(durationSec) || 0);
  const out: WatchMilestone[] = [];
  if (dur <= 0) return out;
  const firstAt = requiredWatchSec(dur);
  out.push({ at: firstAt, reward: 1, label: `1滴@${formatSec(firstAt)}` });
  if (dur >= WATCH_LONG_START_SEC) {
    let t = WATCH_LONG_START_SEC;
    let n = 2;
    for (let i = 0; i < 8 && t < WATCH_HOUR_SEC && t <= dur; i++) {
      if (t > firstAt) {
        out.push({ at: t, reward: 1, label: `${n}滴@${formatSec(t)}` });
        n += 1;
      }
      t *= 2;
    }
  }
  if (dur >= WATCH_HOUR_SEC) {
    for (let at = WATCH_HOUR_SEC, k = 0; at <= dur && k < 48; at += WATCH_QUARTER_SEC, k++) {
      if (!out.some((m) => m.at === at)) {
        out.push({ at, reward: 1, label: `+1滴@${formatSec(at)}` });
      }
    }
  }
  return out;
}

export function maxInkForVideo(durationSec: number): number {
  return watchMilestoneDefs(durationSec).reduce((s, m) => s + m.reward, 0);
}

export function nextPayableDef(
  durationSec: number,
  claimedAts: ReadonlySet<number>,
  opts?: { once?: boolean },
): WatchMilestone | null {
  const defs = watchMilestoneDefs(durationSec);
  for (const m of defs) {
    if (!claimedAts.has(m.at)) return m;
  }
  if (opts?.once) return null;
  const first = defs[0]?.at || WATCH_FIRST_CAP_SEC;
  let last = defs[defs.length - 1]?.at || first;
  for (const at of claimedAts) if (at > last) last = at;
  return { at: last + first, reward: 1, label: `+1@${formatSec(last + first)}` };
}

const JST_OFFSET_MS = 9 * 3600 * 1000;

export function jstClockHourKey(now = Date.now()): string {
  const jst = new Date(now + JST_OFFSET_MS);
  const y = jst.getUTCFullYear();
  const m = String(jst.getUTCMonth() + 1).padStart(2, "0");
  const d = String(jst.getUTCDate()).padStart(2, "0");
  const h = String(jst.getUTCHours()).padStart(2, "0");
  return `${y}-${m}-${d}T${h}`;
}

export function jstDayKey(now = Date.now()): string {
  return jstClockHourKey(now).slice(0, 10);
}

export function pickWatchVideo(list: WatchVideo[], seed = Date.now()): WatchVideo | null {
  if (!list.length) return null;
  if (list.length === 1) return list[0]!;
  const paid = list.filter((v) => v.paid);
  const pool = paid.length && seed % 100 < 96 ? paid : list;
  const axis = seed % 2 === 0 ? "new" : "short";
  const ranked = [...pool].sort((a, b) => {
    if (axis === "new") return (b.createdAtMs || 0) - (a.createdAtMs || 0);
    return (a.totalWatchSec || 0) - (b.totalWatchSec || 0);
  });
  const top = ranked.slice(0, Math.max(2, Math.ceil(ranked.length / 2)));
  return top[seed % top.length]!;
}

export function sanitizeWatchVideo(v: Partial<WatchVideo> | null | undefined): WatchVideo | null {
  const id = parseYouTubeVideoId(String(v?.id || ""));
  if (id.length < 6) return null;
  const ownerPlayerId = String(v?.ownerPlayerId || "").slice(0, 64);
  const showChannel = !!(v?.showChannel && v.channelUrl);
  return {
    id,
    label: String(v?.label || id).slice(0, 40),
    durationSec: Math.max(WATCH_FLOOR_SEC, Math.min(24 * 3600, Math.floor(Number(v?.durationSec) || 60))),
    totalWatchSec: Math.max(0, Math.floor(Number(v?.totalWatchSec) || 0)),
    createdAt: v?.createdAt ? String(v.createdAt) : undefined,
    createdAtMs: v?.createdAtMs || (v?.createdAt ? Date.parse(String(v.createdAt)) || undefined : undefined),
    paid: !!ownerPlayerId,
    ownerPlayerId: ownerPlayerId || undefined,
    claimOnce: !!v?.claimOnce,
    showChannel,
    channelUrl: showChannel ? String(v?.channelUrl || "").slice(0, 240) : undefined,
    channelName: showChannel ? String(v?.channelName || "").slice(0, 80) : undefined,
  };
}
