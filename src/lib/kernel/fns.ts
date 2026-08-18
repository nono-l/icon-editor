import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { getSql } from "@/lib/db";
import {
  BUILTIN_PROMOS,
  findBuiltin,
  formatGrantSummary,
  grantIsEmpty,
  isPromoExpired,
  isPromoSoldOut,
  normalizeExpiresAt,
  normalizeMaxClaims,
  normalizePromoCode,
  parseGrantJson,
  sanitizeGrant,
  UNLOCK_META,
  type GrantBundle,
  type UnlockId,
} from "./grants";
import { getStaffRole, listStaff, requireStaff, requireSuper } from "./identity.server";
import { applyGrant, getInventory, spendInk, spendTickets } from "./wallet.server";
import {
  jstClockHourKey,
  jstDayKey,
  nextPayableDef,
  parseYouTubeVideoId,
  pickWatchVideo,
  sanitizeWatchVideo,
  WATCH_HOURLY_MAX,
  type WatchVideo,
} from "./watch-math";

function nid(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

export const getMyStudio = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const role = await getStaffRole(context.userId);
    const inv = await getInventory(context.userId);
    const sql = await getSql();
    const hourKey = jstClockHourKey();
    const hour = await sql<{ hour_key: string; hour_coins: number }>`
      select hour_key, hour_coins from watch_player where player_id = ${context.userId} limit 1
    `;
    const hourInk = hour[0]?.hour_key === hourKey ? Number(hour[0].hour_coins) || 0 : 0;
    const partner = await sql<{ credit_sec: number }>`
      select credit_sec from partners where player_id = ${context.userId} limit 1
    `;
    const remote = await resolveConnector(context.userId);
    return {
      signedIn: true,
      userId: context.userId,
      ink: inv.ink,
      tickets: inv.tickets,
      unlocks: inv.unlocks,
      unlockUntil: inv.unlockUntil,
      isStaff: role.isStaff,
      isSuper: role.isSuper,
      hourInk,
      hourCap: WATCH_HOURLY_MAX,
      creditSec: Number(partner[0]?.credit_sec) || 0,
      storage: remote ? ("remote" as const) : ("none" as const),
    };
  });

export const claimPromo = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((code: string) => normalizePromoCode(code))
  .handler(async ({ context, data: code }) => {
    if (!code || code.length < 2) return { ok: false as const, reason: "invalid" };
    const sql = await getSql();
    const existing = await sql<{ code: string }>`
      select code from promo_claims where code = ${code} and player_id = ${context.userId} limit 1
    `;
    if (existing.length) return { ok: false as const, reason: "already" };

    const custom = await sql<{
      grant_json: string;
      active: number;
      expires_at: string;
      max_claims: number;
      label: string;
    }>`
      select grant_json, active, expires_at, max_claims, label
      from promo_codes where code = ${code} limit 1
    `;
    let grant: GrantBundle | null = null;
    let label = code;
    let expiresAt = "";
    let maxClaims = 0;
    if (custom[0] && Number(custom[0].active) !== 0) {
      grant = parseGrantJson(custom[0].grant_json);
      label = custom[0].label || code;
      expiresAt = normalizeExpiresAt(custom[0].expires_at);
      maxClaims = normalizeMaxClaims(custom[0].max_claims);
    } else {
      const builtin = findBuiltin(code);
      if (builtin) {
        grant = builtin.grant;
        label = builtin.label;
      }
    }
    if (!grant || grantIsEmpty(grant)) return { ok: false as const, reason: "invalid" };
    if (isPromoExpired(expiresAt)) return { ok: false as const, reason: "expired" };
    const countRows = await sql<{ n: number }>`
      select count(*)::int as n from promo_claims where code = ${code}
    `;
    const claimCount = Number(countRows[0]?.n) || 0;
    if (isPromoSoldOut(maxClaims, claimCount)) return { ok: false as const, reason: "sold_out" };

    const now = new Date().toISOString();
    try {
      await sql`
        insert into promo_claims (code, player_id, claimed_at)
        values (${code}, ${context.userId}, ${now})
      `;
    } catch {
      return { ok: false as const, reason: "already" };
    }
    const inventory = await applyGrant(context.userId, grant);
    return {
      ok: true as const,
      code,
      label,
      summary: formatGrantSummary(grant),
      inventory,
    };
  });

export const buyUnlock = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((id: string) => id as UnlockId)
  .handler(async ({ context, data: id }) => {
    const meta = UNLOCK_META[id];
    if (!meta) return { ok: false as const, reason: "invalid" };
    const inv = await getInventory(context.userId);
    if (inv.unlocks.includes(id)) return { ok: false as const, reason: "owned" };
    const next = await spendInk(context.userId, meta.inkCost);
    if (!next) return { ok: false as const, reason: "broke" };
    const inventory = await applyGrant(context.userId, { unlocks: id });
    return { ok: true as const, inventory };
  });

export const listPromosAdmin = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    await requireStaff(context.userId);
    const sql = await getSql();
    const rows = await sql<{
      code: string;
      label: string;
      grant_json: string;
      active: number;
      expires_at: string;
      max_claims: number;
      created_at: string;
    }>`
      select code, label, grant_json, active, expires_at, max_claims, created_at
      from promo_codes order by created_at desc
    `;
    const counts = await sql<{ code: string; n: number }>`
      select code, count(*)::int as n from promo_claims group by code
    `;
    const countMap = new Map(counts.map((c) => [c.code, Number(c.n) || 0]));
    const custom = rows.map((r) => ({
      code: r.code,
      label: r.label,
      grant: parseGrantJson(r.grant_json),
      custom: true,
      active: Number(r.active) !== 0,
      expiresAt: r.expires_at,
      maxClaims: Number(r.max_claims) || 0,
      claimCount: countMap.get(r.code) || 0,
    }));
    const builtins = BUILTIN_PROMOS.map((b) => ({
      ...b,
      active: true,
      claimCount: countMap.get(b.code) || 0,
    }));
    return { builtins, custom };
  });

export const savePromo = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: {
    code: string;
    label: string;
    ink: number;
    ticket?: number;
    unlocks: string;
    expiresAt?: string;
    maxClaims?: number;
    active?: boolean;
  }) => input)
  .handler(async ({ context, data }) => {
    await requireStaff(context.userId);
    const code = normalizePromoCode(data.code);
    const grant = sanitizeGrant({ ink: data.ink, ticket: data.ticket, unlocks: data.unlocks });
    if (!code || grantIsEmpty(grant)) return { ok: false as const, reason: "invalid" };
    const sql = await getSql();
    const now = new Date().toISOString();
    await sql`
      insert into promo_codes (code, label, grant_json, active, created_by, created_at, updated_at, expires_at, max_claims)
      values (
        ${code},
        ${String(data.label || code).slice(0, 40)},
        ${JSON.stringify(grant)},
        ${data.active === false ? 0 : 1},
        ${context.userId},
        ${now},
        ${now},
        ${normalizeExpiresAt(data.expiresAt)},
        ${normalizeMaxClaims(data.maxClaims)}
      )
      on conflict (code) do update set
        label = excluded.label,
        grant_json = excluded.grant_json,
        active = excluded.active,
        updated_at = excluded.updated_at,
        expires_at = excluded.expires_at,
        max_claims = excluded.max_claims
    `;
    return { ok: true as const, code };
  });

export const getStaffDesk = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const role = await requireStaff(context.userId);
    const staff = await listStaff(role.rootId);
    return { ...role, staff };
  });

export const appointStaff = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { playerId: string; label?: string }) => input)
  .handler(async ({ context, data }) => {
    const role = await requireSuper(context.userId);
    const target = String(data.playerId || "").trim().slice(0, 64);
    if (!target || target === role.rootId) return { ok: false as const, reason: "bad_id" };
    const sql = await getSql();
    const now = new Date().toISOString();
    await sql`
      insert into game_admins (player_id, label, appointed_by, created_at)
      values (${target}, ${String(data.label || target).slice(0, 40)}, ${context.userId}, ${now})
      on conflict (player_id) do update set label = excluded.label
    `;
    return { ok: true as const, staff: await listStaff(role.rootId) };
  });

export const removeStaff = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((playerId: string) => playerId)
  .handler(async ({ context, data: playerId }) => {
    const role = await requireSuper(context.userId);
    if (!playerId || playerId === role.rootId) return { ok: false as const, reason: "fixed" };
    const sql = await getSql();
    await sql`delete from game_admins where player_id = ${playerId}`;
    return { ok: true as const, staff: await listStaff(role.rootId) };
  });

export const listWatchCatalog = createServerFn({ method: "GET" }).handler(async () => {
  const sql = await getSql();
  const existing = await sql<{ id: string }>`select id from watch_videos limit 1`;
  if (!existing.length) {
    const now = new Date().toISOString();
    await sql`
      insert into watch_videos (
        id, label, duration_sec, active, owner_player_id, claim_once,
        show_channel, channel_url, channel_name, created_at
      ) values (
        ${"jNQXAC9IVRw"}, ${"はじめての映像"}, ${19}, 1, ${""}, 0, 0, ${""}, ${""}, ${now}
      )
      on conflict (id) do nothing
    `;
  }
  const rows = await sql<{
    id: string;
    label: string;
    duration_sec: number;
    owner_player_id: string;
    claim_once: number;
    show_channel: number;
    channel_url: string;
    channel_name: string;
    created_at: string;
  }>`
    select v.id, v.label, v.duration_sec, v.owner_player_id, v.claim_once,
           v.show_channel, v.channel_url, v.channel_name, v.created_at
    from watch_videos v
    where v.active = 1
  `;
  const stats = await sql<{ video_id: string; total_watch_sec: number }>`
    select video_id, total_watch_sec from watch_video_stats
  `;
  const credits = await sql<{ player_id: string; credit_sec: number }>`
    select player_id, credit_sec from partners
  `;
  const creditMap = new Map(credits.map((c) => [c.player_id, Number(c.credit_sec) || 0]));
  const statMap = new Map(stats.map((s) => [s.video_id, Number(s.total_watch_sec) || 0]));
  const videos: WatchVideo[] = [];
  for (const r of rows) {
    const owner = r.owner_player_id || "";
    if (owner && (creditMap.get(owner) || 0) <= 0) continue;
    const v = sanitizeWatchVideo({
      id: r.id,
      label: r.label,
      durationSec: r.duration_sec,
      ownerPlayerId: owner,
      claimOnce: Number(r.claim_once) === 1,
      showChannel: Number(r.show_channel) === 1,
      channelUrl: r.channel_url,
      channelName: r.channel_name,
      createdAt: r.created_at,
      totalWatchSec: statMap.get(r.id) || 0,
    });
    if (v) videos.push(v);
  }
  const picked = pickWatchVideo(videos);
  return { videos, picked };
});

export const claimWatch = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { videoId: string; watchSec: number }) => input)
  .handler(async ({ context, data }) => {
    const videoId = parseYouTubeVideoId(data.videoId);
    const watchSec = Math.max(0, Math.min(24 * 3600, Math.floor(Number(data.watchSec) || 0)));
    if (!videoId) return { ok: false as const, reason: "invalid" };
    const sql = await getSql();
    const vids = await sql<{
      id: string;
      duration_sec: number;
      owner_player_id: string;
      claim_once: number;
      active: number;
    }>`
      select id, duration_sec, owner_player_id, claim_once, active
      from watch_videos where id = ${videoId} limit 1
    `;
    const row = vids[0];
    if (!row || Number(row.active) === 0) return { ok: false as const, reason: "missing" };
    const owner = row.owner_player_id || "";
    if (owner) {
      const bal = await sql<{ credit_sec: number }>`
        select credit_sec from partners where player_id = ${owner} limit 1
      `;
      if ((Number(bal[0]?.credit_sec) || 0) <= 0) return { ok: false as const, reason: "dry" };
    }

    const claimed = await sql<{ milestone_sec: number }>`
      select milestone_sec from watch_claims
      where player_id = ${context.userId} and video_id = ${videoId}
    `;
    const claimedAts = new Set(claimed.map((c) => Number(c.milestone_sec)));
    const next = nextPayableDef(row.duration_sec, claimedAts, {
      once: Number(row.claim_once) === 1,
    });
    if (!next || watchSec < next.at) {
      return { ok: false as const, reason: "short", need: next?.at ?? 0 };
    }

    const hourKey = jstClockHourKey();
    const slot = await sql<{ hour_key: string; hour_coins: number }>`
      select hour_key, hour_coins from watch_player where player_id = ${context.userId} limit 1
    `;
    const hourInk =
      slot[0]?.hour_key === hourKey ? Number(slot[0].hour_coins) || 0 : 0;
    if (hourInk + next.reward > WATCH_HOURLY_MAX) {
      return { ok: false as const, reason: "capped", hourInk, hourCap: WATCH_HOURLY_MAX };
    }

    const now = new Date().toISOString();
    try {
      await sql`
        insert into watch_claims (player_id, video_id, watch_sec, milestone_sec, reward, day_jst, claimed_at)
        values (${context.userId}, ${videoId}, ${watchSec}, ${next.at}, ${next.reward}, ${jstDayKey()}, ${now})
      `;
    } catch {
      return { ok: false as const, reason: "already" };
    }

    await applyGrant(context.userId, { ticket: next.reward });
    await sql`
      insert into watch_player (player_id, last_claimed_at, last_video_id, last_watch_sec, total_watch_sec, hour_key, hour_coins)
      values (${context.userId}, ${now}, ${videoId}, ${watchSec}, ${watchSec}, ${hourKey}, ${next.reward})
      on conflict (player_id) do update set
        last_claimed_at = excluded.last_claimed_at,
        last_video_id = excluded.last_video_id,
        last_watch_sec = excluded.last_watch_sec,
        total_watch_sec = watch_player.total_watch_sec + excluded.last_watch_sec,
        hour_key = ${hourKey},
        hour_coins = ${hourInk + next.reward}
    `;
    await sql`
      insert into watch_video_stats (video_id, total_watch_sec, claim_count)
      values (${videoId}, ${watchSec}, 1)
      on conflict (video_id) do update set
        total_watch_sec = watch_video_stats.total_watch_sec + ${watchSec},
        claim_count = watch_video_stats.claim_count + 1
    `;

    if (owner) {
      const billed = await sql<{ billed_sec: number }>`
        select billed_sec from watch_billing
        where player_id = ${context.userId} and video_id = ${videoId} limit 1
      `;
      const prev = Number(billed[0]?.billed_sec) || 0;
      const delta = Math.max(0, watchSec - prev);
      if (delta > 0) {
        await sql`
          update partners set credit_sec = greatest(0, credit_sec - ${delta}), updated_at = ${now}
          where player_id = ${owner}
        `;
        await sql`
          insert into watch_billing (player_id, video_id, billed_sec, updated_at)
          values (${context.userId}, ${videoId}, ${watchSec}, ${now})
          on conflict (player_id, video_id) do update set
            billed_sec = excluded.billed_sec, updated_at = excluded.updated_at
        `;
      }
    }

    const inventory = await getInventory(context.userId);
    return {
      ok: true as const,
      reward: next.reward,
      at: next.at,
      inventory,
      hourInk: hourInk + next.reward,
      hourCap: WATCH_HOURLY_MAX,
    };
  });

export const fetchYoutubeMeta = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((url: string) => url)
  .handler(async ({ data: url }) => {
    const id = parseYouTubeVideoId(url);
    if (!id) return { ok: false as const, reason: "invalid" };
    try {
      const res = await fetch(
        `https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${id}`)}&format=json`,
      );
      if (!res.ok) return { ok: true as const, id, title: id, channelName: "", channelUrl: "" };
      const j = (await res.json()) as { title?: string; author_name?: string; author_url?: string };
      return {
        ok: true as const,
        id,
        title: String(j.title || id).slice(0, 80),
        channelName: String(j.author_name || "").slice(0, 80),
        channelUrl: String(j.author_url || "").slice(0, 240),
      };
    } catch {
      return { ok: true as const, id, title: id, channelName: "", channelUrl: "" };
    }
  });

export const upsertWatchVideo = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: {
    url: string;
    label?: string;
    durationSec?: number;
    claimOnce?: boolean;
    showChannel?: boolean;
    asPartner?: boolean;
    active?: boolean;
  }) => input)
  .handler(async ({ context, data }) => {
    const id = parseYouTubeVideoId(data.url);
    if (!id) return { ok: false as const, reason: "invalid" };
    let owner = "";
    if (data.asPartner) {
      owner = context.userId;
    } else {
      await requireStaff(context.userId);
    }
    const sql = await getSql();
    const now = new Date().toISOString();
    const existing = await sql<{ owner_player_id: string }>`
      select owner_player_id from watch_videos where id = ${id} limit 1
    `;
    if (existing[0] && data.asPartner && existing[0].owner_player_id !== context.userId) {
      return { ok: false as const, reason: "taken" };
    }
    await sql`
      insert into watch_videos (
        id, label, duration_sec, active, owner_player_id, claim_once,
        show_channel, channel_url, channel_name, created_at
      ) values (
        ${id},
        ${String(data.label || id).slice(0, 40)},
        ${Math.max(10, Math.min(24 * 3600, Math.floor(Number(data.durationSec) || 60)))},
        ${data.active === false ? 0 : 1},
        ${owner},
        ${data.claimOnce ? 1 : 0},
        ${data.showChannel ? 1 : 0},
        ${""},
        ${""},
        ${now}
      )
      on conflict (id) do update set
        label = excluded.label,
        duration_sec = excluded.duration_sec,
        active = excluded.active,
        claim_once = excluded.claim_once,
        show_channel = excluded.show_channel
    `;
    return { ok: true as const, id };
  });

export const listWatchAdmin = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    await requireStaff(context.userId);
    const sql = await getSql();
    return sql<{
      id: string;
      label: string;
      duration_sec: number;
      active: number;
      owner_player_id: string;
      claim_once: number;
      show_channel: number;
      total_watch_sec: number;
      claim_count: number;
      credit_sec: number | null;
    }>`
      select v.id, v.label, v.duration_sec, v.active, v.owner_player_id,
             v.claim_once, v.show_channel,
             coalesce(s.total_watch_sec, 0)::int as total_watch_sec,
             coalesce(s.claim_count, 0)::int as claim_count,
             p.credit_sec
      from watch_videos v
      left join watch_video_stats s on s.video_id = v.id
      left join partners p on p.player_id = v.owner_player_id
      order by v.created_at desc
    `;
  });

export const listMyVideos = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    const videos = await sql<{
      id: string;
      label: string;
      duration_sec: number;
      active: number;
      claim_once: number;
      show_channel: number;
    }>`
      select id, label, duration_sec, active, claim_once, show_channel
      from watch_videos where owner_player_id = ${context.userId}
      order by created_at desc
    `;
    const partner = await sql<{ credit_sec: number; total_credited: number }>`
      select credit_sec, total_credited from partners where player_id = ${context.userId} limit 1
    `;
    return {
      videos,
      creditSec: Number(partner[0]?.credit_sec) || 0,
      totalCredited: Number(partner[0]?.total_credited) || 0,
    };
  });

export const redeemPrepaid = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((code: string) => normalizePromoCode(code))
  .handler(async ({ context, data: code }) => {
    if (!code) return { ok: false as const, reason: "invalid" };
    const sql = await getSql();
    const rows = await sql<{
      hours: number;
      active: number;
      max_claims: number;
      claim_count: number;
      expires_at: string;
    }>`
      select hours, active, max_claims, claim_count, expires_at
      from prepaid_codes where code = ${code} limit 1
    `;
    const row = rows[0];
    if (!row || Number(row.active) === 0) return { ok: false as const, reason: "invalid" };
    if (isPromoExpired(row.expires_at)) return { ok: false as const, reason: "expired" };
    if (row.max_claims > 0 && row.claim_count >= row.max_claims) {
      return { ok: false as const, reason: "sold_out" };
    }
    const now = new Date().toISOString();
    try {
      await sql`
        insert into prepaid_claims (code, player_id, claimed_at)
        values (${code}, ${context.userId}, ${now})
      `;
    } catch {
      return { ok: false as const, reason: "already" };
    }
    const add = Math.max(0, Math.floor(row.hours)) * 3600;
    await sql`
      update prepaid_codes set claim_count = claim_count + 1 where code = ${code}
    `;
    await sql`
      insert into partners (player_id, credit_sec, total_credited, updated_at)
      values (${context.userId}, ${add}, ${add}, ${now})
      on conflict (player_id) do update set
        credit_sec = partners.credit_sec + excluded.credit_sec,
        total_credited = partners.total_credited + excluded.total_credited,
        updated_at = excluded.updated_at
    `;
    const bal = await sql<{ credit_sec: number }>`
      select credit_sec from partners where player_id = ${context.userId} limit 1
    `;
    return { ok: true as const, creditSec: Number(bal[0]?.credit_sec) || 0, added: add };
  });

export const issuePrepaid = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { hours: number; label?: string; maxClaims?: number }) => input)
  .handler(async ({ context, data }) => {
    await requireStaff(context.userId);
    const hours = Math.max(1, Math.min(240, Math.floor(Number(data.hours) || 1)));
    const code = normalizePromoCode(`P${Math.random().toString(36).slice(2, 8)}`);
    const sql = await getSql();
    const now = new Date().toISOString();
    await sql`
      insert into prepaid_codes (code, hours, label, active, max_claims, claim_count, expires_at, created_by, created_at)
      values (
        ${code}, ${hours}, ${String(data.label || `${hours}時間`).slice(0, 40)},
        1, ${normalizeMaxClaims(data.maxClaims ?? 1)}, 0, ${""}, ${context.userId}, ${now}
      )
    `;
    return { ok: true as const, code, hours };
  });

export const listPrepaidAdmin = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    await requireStaff(context.userId);
    const sql = await getSql();
    return sql<{
      code: string;
      hours: number;
      label: string;
      claim_count: number;
      max_claims: number;
      created_at: string;
    }>`
      select code, hours, label, claim_count, max_claims, created_at
      from prepaid_codes order by created_at desc
    `;
  });

export type PublicBanner = {
  id: string;
  imageUrl: string;
  width: number;
  height: number;
  href: string;
};

export const listPublicBanners = createServerFn({ method: "GET" }).handler(async () => {
  const sql = await getSql();
  const rows = await sql<{
    id: string;
    image_url: string;
    width: number;
    height: number;
    href: string;
    owner_player_id: string;
  }>`
    select id, image_url, width, height, href, owner_player_id
    from banner_assets where active = 1
    order by priority desc, created_at desc
  `;
  const credits = await sql<{ player_id: string; credit_sec: number }>`
    select player_id, credit_sec from partners
  `;
  const creditMap = new Map(credits.map((c) => [c.player_id, Number(c.credit_sec) || 0]));
  const banners: PublicBanner[] = [];
  for (const r of rows) {
    if ((creditMap.get(r.owner_player_id) || 0) <= 0) continue;
    banners.push({
      id: r.id,
      imageUrl: r.image_url,
      width: r.width,
      height: r.height,
      href: r.href,
    });
  }
  return { banners };
});

export const recordBannerEvent = createServerFn({ method: "POST" })
  .validator((input: { bannerId: string; kind: "impress" | "click" | "rate"; rating?: number }) => input)
  .handler(async ({ data }) => {
    const sql = await getSql();
    const rows = await sql<{ owner_player_id: string; href: string }>`
      select owner_player_id, href from banner_assets where id = ${data.bannerId} and active = 1 limit 1
    `;
    const row = rows[0];
    if (!row) return { ok: false as const };
    const bill = data.kind === "impress" ? 1 : data.kind === "click" ? 20 * 60 : 0;
    const now = new Date().toISOString();
    if (bill > 0) {
      await sql`
        update partners set credit_sec = greatest(0, credit_sec - ${bill}), updated_at = ${now}
        where player_id = ${row.owner_player_id} and credit_sec >= ${bill}
      `;
    }
    await sql`
      insert into banner_events (id, banner_id, kind, player_id, billed_sec, created_at)
      values (${nid("ev")}, ${data.bannerId}, ${data.kind}, ${""}, ${bill}, ${now})
    `;
    return { ok: true as const, href: row.href };
  });

export const claimBannerInk = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((bannerId: string) => String(bannerId || "").slice(0, 40))
  .handler(async ({ context, data: bannerId }) => {
    if (!bannerId) return { ok: false as const, reason: "invalid" };
    const sql = await getSql();
    const rows = await sql<{ id: string; href: string }>`
      select id, href from banner_assets where id = ${bannerId} and active = 1 limit 1
    `;
    if (!rows[0] || !String(rows[0].href || "").trim()) {
      return { ok: false as const, reason: "missing" };
    }
    const day = jstDayKey();
    const now = new Date().toISOString();
    try {
      await sql`
        insert into banner_ink_claims (player_id, banner_id, day_jst, claimed_at)
        values (${context.userId}, ${bannerId}, ${day}, ${now})
      `;
    } catch {
      const inv = await getInventory(context.userId);
      return { ok: true as const, granted: false as const, reason: "already", ink: inv.ink };
    }
    const inventory = await applyGrant(context.userId, { ink: 1 });
    return { ok: true as const, granted: true as const, ink: inventory.ink };
  });


export const listMyBanners = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    const banners = await sql<{
      id: string;
      image_url: string;
      width: number;
      height: number;
      href: string;
      active: number;
      created_at: string;
    }>`
      select id, image_url, width, height, href, active, created_at
      from banner_assets where owner_player_id = ${context.userId}
      order by created_at desc
    `;
    const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
    const used = await sql<{ n: number }>`
      select count(*)::int as n from banner_upload_log
      where player_id = ${context.userId} and created_at >= ${weekAgo}
    `;
    const events = await sql<{ banner_id: string; kind: string; n: number }>`
      select e.banner_id, e.kind, count(*)::int as n
      from banner_events e
      join banner_assets b on b.id = e.banner_id
      where b.owner_player_id = ${context.userId}
      group by e.banner_id, e.kind
    `;
    return {
      banners,
      weekUsed: Number(used[0]?.n) || 0,
      weekLimit: 8,
      events,
    };
  });

export const publishBanner = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { imageUrl: string; width: number; height: number; href?: string }) => input)
  .handler(async ({ context, data }) => {
    if (!data.imageUrl.startsWith("data:image/")) return { ok: false as const, reason: "bad_image" };
    if (data.imageUrl.length > 700_000) return { ok: false as const, reason: "too_big" };
    const sql = await getSql();
    const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
    const used = await sql<{ n: number }>`
      select count(*)::int as n from banner_upload_log
      where player_id = ${context.userId} and created_at >= ${weekAgo}
    `;
    if ((Number(used[0]?.n) || 0) >= 8) return { ok: false as const, reason: "week_cap" };
    const now = new Date().toISOString();
    const id = nid("bn");
    await sql`
      insert into banner_assets (id, owner_player_id, image_url, width, height, href, active, priority, created_at)
      values (
        ${id}, ${context.userId}, ${data.imageUrl},
        ${Math.max(80, Math.min(800, Math.floor(data.width)))},
        ${Math.max(32, Math.min(85, Math.floor(data.height)))},
        ${String(data.href || "").slice(0, 400)},
        1, 0, ${now}
      )
    `;
    await sql`
      insert into banner_upload_log (id, player_id, created_at)
      values (${nid("up")}, ${context.userId}, ${now})
    `;
    await sql`
      insert into partners (player_id, credit_sec, total_credited, updated_at)
      values (${context.userId}, 0, 0, ${now})
      on conflict (player_id) do nothing
    `;
    return { ok: true as const, id };
  });

export const setBannerActive = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { id: string; active: boolean }) => input)
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    await sql`
      update banner_assets set active = ${data.active ? 1 : 0}
      where id = ${data.id} and owner_player_id = ${context.userId}
    `;
    return { ok: true as const };
  });

export const deleteBanner = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((id: string) => id)
  .handler(async ({ context, data: id }) => {
    const sql = await getSql();
    await sql`
      delete from banner_assets where id = ${id} and owner_player_id = ${context.userId}
    `;
    return { ok: true as const };
  });

export const saveBannerHref = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { id: string; href: string }) => input)
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    await sql`
      update banner_assets set href = ${String(data.href || "").slice(0, 400)}
      where id = ${data.id} and owner_player_id = ${context.userId}
    `;
    return { ok: true as const };
  });

const STUDIO_APP = "icon-studio";
const STUDIO_OWNER = "_studio";

type ConnectorRow = {
  proxy_url: string;
  api_key: string;
  basic_user: string;
  basic_pass: string;
  namespace: string;
  setup_url: string;
  enabled: boolean;
};

function rowToConfig(row: ConnectorRow, tenant: string) {
  return {
    proxyUrl: row.proxy_url,
    apiKey: row.api_key,
    basicUser: row.basic_user,
    basicPass: row.basic_pass,
    namespace: tenant || row.namespace || "default",
    appId: STUDIO_APP,
    setupUrl: row.setup_url,
    enabled: !!row.enabled,
  };
}

async function resolveConnector(userId: string) {
  const sql = await getSql();
  const own = await sql<ConnectorRow>`
    select proxy_url, api_key, basic_user, basic_pass, namespace, setup_url, enabled
    from grokbuild_external_connector
    where user_id = ${userId} and app_id = ${STUDIO_APP} limit 1
  `;
  if (own[0]?.enabled && own[0].proxy_url && own[0].api_key) {
    return { config: rowToConfig(own[0], own[0].namespace || userId), source: "own" as const };
  }
  const shared = await sql<ConnectorRow>`
    select proxy_url, api_key, basic_user, basic_pass, namespace, setup_url, enabled
    from grokbuild_external_connector
    where user_id = ${STUDIO_OWNER} and app_id = ${STUDIO_APP} limit 1
  `;
  if (shared[0]?.enabled && shared[0].proxy_url && shared[0].api_key) {
    return { config: rowToConfig(shared[0], userId), source: "studio" as const };
  }
  return null;
}

export const getConnectorSettings = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((scope: "own" | "studio") => scope)
  .handler(async ({ context, data: scope }) => {
    if (scope === "studio") await requireStaff(context.userId);
    const owner = scope === "studio" ? STUDIO_OWNER : context.userId;
    const sql = await getSql();
    const rows = await sql<ConnectorRow>`
      select proxy_url, api_key, basic_user, basic_pass, namespace, setup_url, enabled
      from grokbuild_external_connector
      where user_id = ${owner} and app_id = ${STUDIO_APP} limit 1
    `;
    const r = rows[0];
    return {
      proxyUrl: r?.proxy_url || "",
      apiKey: r?.api_key || "",
      basicUser: r?.basic_user || "",
      basicPass: r?.basic_pass || "",
      namespace: r?.namespace || "default",
      appId: STUDIO_APP,
      setupUrl: r?.setup_url || "",
      enabled: !!r?.enabled,
    };
  });

export const saveConnectorSettings = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: {
    scope: "own" | "studio";
    proxyUrl: string;
    apiKey: string;
    basicUser?: string;
    basicPass?: string;
    namespace?: string;
    setupUrl?: string;
    enabled: boolean;
  }) => input)
  .handler(async ({ context, data }) => {
    if (data.scope === "studio") await requireStaff(context.userId);
    const owner = data.scope === "studio" ? STUDIO_OWNER : context.userId;
    const sql = await getSql();
    await sql`
      insert into grokbuild_external_connector (
        user_id, app_id, proxy_url, api_key, basic_user, basic_pass,
        namespace, setup_url, enabled, updated_at
      ) values (
        ${owner}, ${STUDIO_APP},
        ${data.proxyUrl.trim()}, ${data.apiKey},
        ${String(data.basicUser || "").trim()}, ${data.basicPass || ""},
        ${String(data.namespace || "default").trim() || "default"},
        ${String(data.setupUrl || "").trim()},
        ${data.enabled}, now()
      )
      on conflict (user_id, app_id) do update set
        proxy_url = excluded.proxy_url,
        api_key = excluded.api_key,
        basic_user = excluded.basic_user,
        basic_pass = excluded.basic_pass,
        namespace = excluded.namespace,
        setup_url = excluded.setup_url,
        enabled = excluded.enabled,
        updated_at = now()
    `;
    return { ok: true as const };
  });

export const beginMaterialRegister = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: {
    kind: "icon" | "strip";
    title: string;
    width: number;
    height: number;
    thumbUrl: string;
  }) => input)
  .handler(async ({ context, data }) => {
    if (!data.thumbUrl.startsWith("data:image/")) return { ok: false as const, reason: "bad_image" };
    if (data.thumbUrl.length > 80_000) return { ok: false as const, reason: "thumb" };
    const remote = await resolveConnector(context.userId);
    if (!remote) return { ok: false as const, reason: "no_store" };
    const spent = await spendTickets(context.userId, 1);
    if (!spent) return { ok: false as const, reason: "no_ticket" };
    const sql = await getSql();
    const id = nid("mt");
    const now = new Date().toISOString();
    await sql`
      insert into studio_materials (
        id, owner_id, kind, title, width, height, thumb_url, storage, status, created_at
      ) values (
        ${id}, ${context.userId}, ${data.kind},
        ${String(data.title || "素材").slice(0, 80)},
        ${Math.max(1, Math.floor(data.width))},
        ${Math.max(1, Math.floor(data.height))},
        ${data.thumbUrl},
        ${"remote"},
        ${"pending"},
        ${now}
      )
    `;
    return {
      ok: true as const,
      id,
      mode: "remote" as const,
      remote: remote.config,
      tickets: spent.tickets,
    };
  });

export const finishMaterialRegister = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { id: string; remoteSnapId?: number; imageUrl?: string }) => input)
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const rows = await sql<{ id: string; storage: string; status: string }>`
      select id, storage, status from studio_materials
      where id = ${data.id} and owner_id = ${context.userId} limit 1
    `;
    const row = rows[0];
    if (!row || row.status !== "pending") return { ok: false as const, reason: "missing" };
    if (row.storage !== "remote" || !data.remoteSnapId) {
      return { ok: false as const, reason: "no_store" };
    }
    const now = new Date().toISOString();
    await sql`
      update studio_materials
         set status = ${"ready"},
             remote_snap_id = ${data.remoteSnapId}
       where id = ${data.id} and owner_id = ${context.userId}
    `;
    return { ok: true as const };
  });

export const cancelMaterialRegister = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((id: string) => id)
  .handler(async ({ context, data: id }) => {
    const sql = await getSql();
    const rows = await sql<{ status: string }>`
      select status from studio_materials
      where id = ${id} and owner_id = ${context.userId} limit 1
    `;
    if (!rows[0] || rows[0].status !== "pending") return { ok: false as const };
    await sql`delete from studio_materials where id = ${id} and owner_id = ${context.userId}`;
    await applyGrant(context.userId, { ticket: 1 });
    return { ok: true as const };
  });

export const listMaterials = createServerFn({ method: "GET" }).handler(async () => {
  const sql = await getSql();
  return sql<{
    id: string;
    owner_id: string;
    kind: string;
    title: string;
    width: number;
    height: number;
    thumb_url: string;
    storage: string;
    created_at: string;
  }>`
    select id, owner_id, kind, title, width, height, thumb_url, storage, created_at
    from studio_materials
    where status = ${"ready"}
    order by created_at desc
    limit 80
  `;
});

export const getMaterialImage = createServerFn({ method: "GET" })
  .validator((id: string) => id)
  .handler(async ({ data: id }) => {
    const sql = await getSql();
    const meta = await sql<{ storage: string; remote_snap_id: number | null; owner_id: string }>`
      select storage, remote_snap_id, owner_id from studio_materials
      where id = ${id} and status = ${"ready"} limit 1
    `;
    const row = meta[0];
    if (!row) return { ok: false as const };
    if (row.storage === "local") {
      const blob = await sql<{ image_url: string }>`
        select image_url from material_blobs where id = ${id} limit 1
      `;
      if (!blob[0]) return { ok: false as const };
      return { ok: true as const, imageUrl: blob[0].image_url };
    }
    return { ok: false as const, reason: "remote" };
  });

export const setWatchActive = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { id: string; active: boolean }) => input)
  .handler(async ({ context, data }) => {
    await requireStaff(context.userId);
    const sql = await getSql();
    await sql`
      update watch_videos set active = ${data.active ? 1 : 0}
      where id = ${data.id}
    `;
    return { ok: true as const };
  });

export const setPromoActive = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { code: string; active: boolean }) => input)
  .handler(async ({ context, data }) => {
    await requireStaff(context.userId);
    const code = normalizePromoCode(data.code);
    if (!code) return { ok: false as const };
    const sql = await getSql();
    await sql`
      update promo_codes set active = ${data.active ? 1 : 0}, updated_at = ${new Date().toISOString()}
      where code = ${code}
    `;
    return { ok: true as const };
  });

export const getOpsOverview = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    await requireStaff(context.userId);
    const sql = await getSql();
    const today = jstDayKey();
    const videos = await sql<{ n: number; active: number; partner: number }>`
      select count(*)::int as n,
             coalesce(sum(case when active = 1 then 1 else 0 end), 0)::int as active,
             coalesce(sum(case when owner_player_id <> '' then 1 else 0 end), 0)::int as partner
      from watch_videos
    `;
    const claims = await sql<{ n: number; tickets: number }>`
      select count(*)::int as n, coalesce(sum(reward), 0)::int as tickets
      from watch_claims where day_jst = ${today}
    `;
    const prepaid = await sql<{ n: number; unused: number }>`
      select count(*)::int as n,
             coalesce(sum(case when claim_count = 0 then 1 else 0 end), 0)::int as unused
      from prepaid_codes
    `;
    const materials = await sql<{ n: number; remote: number }>`
      select count(*)::int as n,
             coalesce(sum(case when storage = 'remote' then 1 else 0 end), 0)::int as remote
      from studio_materials where status = ${"ready"}
    `;
    const store = await sql<{ enabled: boolean }>`
      select enabled from grokbuild_external_connector
      where user_id = ${"_studio"} and app_id = ${"icon-studio"} limit 1
    `;
    return {
      videos: videos[0] ?? { n: 0, active: 0, partner: 0 },
      todayClaims: Number(claims[0]?.n) || 0,
      todayTickets: Number(claims[0]?.tickets) || 0,
      prepaid: prepaid[0] ?? { n: 0, unused: 0 },
      materials: materials[0] ?? { n: 0, remote: 0 },
      storageOn: !!store[0]?.enabled,
    };
  });
