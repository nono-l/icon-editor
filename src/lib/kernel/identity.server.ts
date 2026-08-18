import { getSql } from "@/lib/db";

export type StaffRole = {
  userId: string;
  isStaff: boolean;
  isSuper: boolean;
  rootId: string;
};

export async function getRootOperatorId(): Promise<string> {
  const sql = await getSql();
  const rows = await sql<{ value: string }>`
    select value from app_settings where key = ${"root_operator_id"} limit 1
  `;
  return rows[0]?.value || "";
}

/** First signed-in visitor becomes the non-removable root operator. */
export async function ensureRootOperator(userId: string): Promise<string> {
  const existing = await getRootOperatorId();
  if (existing) return existing;
  const sql = await getSql();
  await sql`
    insert into app_settings (key, value) values (${"root_operator_id"}, ${userId})
    on conflict (key) do nothing
  `;
  return (await getRootOperatorId()) || userId;
}

export async function getStaffRole(userId: string): Promise<StaffRole> {
  const rootId = await ensureRootOperator(userId);
  if (userId === rootId) {
    return { userId, isStaff: true, isSuper: true, rootId };
  }
  const sql = await getSql();
  const rows = await sql<{ player_id: string }>`
    select player_id from game_admins where player_id = ${userId} limit 1
  `;
  const isStaff = rows.length > 0;
  return { userId, isStaff, isSuper: false, rootId };
}

export async function requireStaff(userId: string): Promise<StaffRole> {
  const role = await getStaffRole(userId);
  if (!role.isStaff) {
    const err = new Error("Forbidden");
    (err as Error & { status: number }).status = 403;
    throw err;
  }
  return role;
}

export async function requireSuper(userId: string): Promise<StaffRole> {
  const role = await getStaffRole(userId);
  if (!role.isSuper) {
    const err = new Error("Forbidden");
    (err as Error & { status: number }).status = 403;
    throw err;
  }
  return role;
}

export type StaffEntry = {
  playerId: string;
  label: string;
  appointedBy: string;
  createdAt: string;
  fixed: boolean;
};

export async function listStaff(rootId: string): Promise<StaffEntry[]> {
  const sql = await getSql();
  const rows = await sql<{
    player_id: string;
    label: string;
    appointed_by: string;
    created_at: string;
  }>`
    select player_id, label, appointed_by, created_at from game_admins order by created_at asc
  `;
  return [
    { playerId: rootId, label: "根管理者", appointedBy: "", createdAt: "", fixed: true },
    ...rows
      .filter((r) => r.player_id !== rootId)
      .map((r) => ({
        playerId: r.player_id,
        label: r.label || r.player_id,
        appointedBy: r.appointed_by,
        createdAt: r.created_at,
        fixed: false,
      })),
  ];
}
