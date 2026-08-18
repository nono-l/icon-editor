import { getSql } from "@/lib/db";
import {
  resolveUnlockExpiry,
  sanitizeGrant,
  unlockExpiresAt,
  unlockIsActive,
  type GrantBundle,
  type UnlockId,
  UNLOCK_IDS,
} from "./grants";

export type HostInventory = {
  ink: number;
  tickets: number;
  unlocks: UnlockId[];
  unlockUntil: Partial<Record<UnlockId, string>>;
};

export async function getInventory(playerId: string): Promise<HostInventory> {
  const sql = await getSql();
  const wallet = await sql<{ ink: number; tickets: number }>`
    select ink, tickets from ink_wallets where player_id = ${playerId} limit 1
  `;
  const unlocks = await sql<{ unlock_id: string; granted_at: string; expires_at: string }>`
    select unlock_id, granted_at, expires_at from player_unlocks where player_id = ${playerId}
  `;
  const ok = new Set<string>(UNLOCK_IDS);
  const active: UnlockId[] = [];
  const unlockUntil: Partial<Record<UnlockId, string>> = {};
  const now = Date.now();
  for (const r of unlocks) {
    if (!ok.has(r.unlock_id)) continue;
    const id = r.unlock_id as UnlockId;
    const until = resolveUnlockExpiry(r.expires_at, r.granted_at, now);
    if (!unlockIsActive(until, now)) continue;
    active.push(id);
    unlockUntil[id] = until;
  }
  return {
    ink: Number(wallet[0]?.ink) || 0,
    tickets: Number(wallet[0]?.tickets) || 0,
    unlocks: active,
    unlockUntil,
  };
}

export async function applyGrant(
  playerId: string,
  grant: GrantBundle,
): Promise<HostInventory> {
  const g = sanitizeGrant(grant);
  const sql = await getSql();
  const now = new Date().toISOString();
  if ((g.ink || 0) > 0 || (g.ticket || 0) > 0) {
    await sql`
      insert into ink_wallets (player_id, ink, tickets, updated_at)
      values (${playerId}, ${g.ink || 0}, ${g.ticket || 0}, ${now})
      on conflict (player_id) do update
        set ink = ink_wallets.ink + excluded.ink,
            tickets = ink_wallets.tickets + excluded.tickets,
            updated_at = excluded.updated_at
    `;
  }
  if (g.unlocks) {
    const until = unlockExpiresAt();
    for (const id of g.unlocks.split(",")) {
      if (!id) continue;
      await sql`
        insert into player_unlocks (player_id, unlock_id, granted_at, expires_at)
        values (${playerId}, ${id}, ${now}, ${until})
        on conflict (player_id, unlock_id) do update
          set granted_at = excluded.granted_at,
              expires_at = excluded.expires_at
      `;
    }
  }
  return getInventory(playerId);
}

export async function spendInk(
  playerId: string,
  amount: number,
): Promise<HostInventory | null> {
  const n = Math.max(0, Math.floor(amount));
  if (n <= 0) return getInventory(playerId);
  const sql = await getSql();
  const now = new Date().toISOString();
  const rows = await sql<{ ink: number }>`
    update ink_wallets
       set ink = ink - ${n}, updated_at = ${now}
     where player_id = ${playerId} and ink >= ${n}
     returning ink
  `;
  if (!rows.length) return null;
  return getInventory(playerId);
}

export async function spendTickets(
  playerId: string,
  amount: number,
): Promise<HostInventory | null> {
  const n = Math.max(0, Math.floor(amount));
  if (n <= 0) return getInventory(playerId);
  const sql = await getSql();
  const now = new Date().toISOString();
  const rows = await sql<{ tickets: number }>`
    update ink_wallets
       set tickets = tickets - ${n}, updated_at = ${now}
     where player_id = ${playerId} and tickets >= ${n}
     returning tickets
  `;
  if (!rows.length) return null;
  return getInventory(playerId);
}
