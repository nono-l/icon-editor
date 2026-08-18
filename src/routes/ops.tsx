import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { AppShell, useStudio } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RedirectToSignIn } from "@/lib/auth/gates";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import {
  remoteLogIps,
  remoteLogRecent,
  remotePing,
  remoteSnapList,
  type AccessIpItem,
  type AccessLogItem,
} from "@/lib/external-storage/client";
import { DEFAULT_REMOTE_CONFIG, type RemoteStoreConfig } from "@/lib/external-storage/types";
import type { RemoteSnapshotMeta } from "@/lib/external-storage/types";
import { formatGrantSummary } from "@/lib/kernel/grants";
import {
  appointStaff,
  getConnectorSettings,
  getOpsOverview,
  getStaffDesk,
  issuePrepaid,
  listPrepaidAdmin,
  listPromosAdmin,
  listWatchAdmin,
  removeStaff,
  saveConnectorSettings,
  savePromo,
  setPromoActive,
  setWatchActive,
  upsertWatchVideo,
} from "@/lib/kernel/fns";

export const Route = createFileRoute("/ops")({ component: OpsPage });

type Tab = "promo" | "watch" | "credit" | "store" | "staff";

function OpsPage() {
  const { user, isPending } = useCurrentUserState();
  const [studio, reloadStudio] = useStudio();
  const [tab, setTab] = useState<Tab>("promo");

  if (isPending) {
    return (
      <AppShell studio={studio} title="管理者" kicker="ADMIN">
        <div className="h-40 animate-pulse rounded-[var(--radius-xl)] bg-bg-elevated" />
      </AppShell>
    );
  }
  if (!user) return <RedirectToSignIn to="/login" />;
  if (!studio.isStaff) {
    return (
      <AppShell studio={studio} title="管理者" kicker="ADMIN">
        <p className="text-sm text-fg-muted">スタッフだけが入れます。</p>
      </AppShell>
    );
  }

  return (
    <AppShell studio={studio} title="管理者" kicker="ADMIN">
      <Overview />
      <div className="mb-4 flex flex-wrap gap-1.5">
        {(
          [
            ["promo", "プロモコード"],
            ["watch", "広告の状態"],
            ["credit", "広告コード"],
            ["store", "外部ストレージ"],
            ["staff", "スタッフ"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={
              tab === id
                ? "h-9 rounded-[var(--radius-sm)] bg-primary/15 px-3 text-xs font-medium text-primary"
                : "h-9 rounded-[var(--radius-sm)] px-3 text-xs text-fg-muted hover:bg-bg-subtle"
            }
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "promo" && <PromoOps />}
      {tab === "watch" && <WatchOps />}
      {tab === "credit" && <CreditOps />}
      {tab === "store" && <StoreOps />}
      {tab === "staff" && <StaffOps isSuper={studio.isSuper} onChange={reloadStudio} />}
    </AppShell>
  );
}

function Overview() {
  const [d, setD] = useState<Awaited<ReturnType<typeof getOpsOverview>> | null>(null);
  useEffect(() => {
    void getOpsOverview().then(setD).catch(() => {});
  }, []);
  if (!d) return null;
  const cards = [
    { k: "本日の視聴", v: `${d.todayClaims} 件` },
    { k: "本日のチケット", v: `${d.todayTickets} 枚` },
    { k: "映像", v: `${d.videos.active}/${d.videos.n} 公開` },
    { k: "広告コード", v: `${d.prepaid.unused} 未使用` },
    { k: "素材", v: `${d.materials.n} 件` },
    { k: "外部保存", v: d.storageOn ? "接続中" : "未接続" },
  ];
  return (
    <ul className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
      {cards.map((c) => (
        <li
          key={c.k}
          className="rounded-[var(--radius-lg)] border border-border bg-bg-elevated px-3 py-2"
        >
          <div className="text-[11px] text-fg-subtle">{c.k}</div>
          <div className="text-sm font-semibold">{c.v}</div>
        </li>
      ))}
    </ul>
  );
}

function copyText(s: string) {
  void navigator.clipboard.writeText(s).then(
    () => toast.success("コピーしました"),
    () => toast.message(s),
  );
}

function PromoOps() {
  const [list, setList] = useState<Awaited<ReturnType<typeof listPromosAdmin>> | null>(null);
  const [code, setCode] = useState("");
  const [label, setLabel] = useState("");
  const [ink, setInk] = useState(0);
  const [ticket, setTicket] = useState(0);
  const [unlocks, setUnlocks] = useState("");
  const [maxClaims, setMaxClaims] = useState(0);

  function load() {
    void listPromosAdmin().then(setList);
  }
  useEffect(load, []);

  return (
    <div className="space-y-3">
      <form
        className="space-y-2 rounded-[var(--radius-xl)] border border-border bg-bg-elevated p-4"
        onSubmit={(e) => {
          e.preventDefault();
          void savePromo({
            data: { code, label, ink, ticket, unlocks, maxClaims },
          }).then((r) => {
            if (r.ok) {
              toast.success(`発行 ${r.code}`);
              copyText(r.code);
              setCode("");
              load();
            } else toast.error("発行できません（報酬を1つ以上入れてください）");
          });
        }}
      >
        <p className="text-xs font-medium text-fg-subtle">プロモコード発行</p>
        <p className="text-[11px] text-fg-subtle">
          インクはキャンバス解除、チケットは素材登録の権利です。チケットは通常、視聴で渡します。
        </p>
        <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="CODE" required />
        <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="表示名" />
        <div className="grid grid-cols-2 gap-2">
          <label className="block text-xs text-fg-subtle">
            インク
            <Input type="number" min={0} value={ink} onChange={(e) => setInk(Number(e.target.value))} />
          </label>
          <label className="block text-xs text-fg-subtle">
            チケット
            <Input
              type="number"
              min={0}
              value={ticket}
              onChange={(e) => setTicket(Number(e.target.value))}
            />
          </label>
        </div>
        <Input
          value={unlocks}
          onChange={(e) => setUnlocks(e.target.value)}
          placeholder="解除: size512,size1024,apple,palette"
        />
        <label className="block text-xs text-fg-subtle">
          利用上限（0 = 無制限）
          <Input
            type="number"
            min={0}
            value={maxClaims}
            onChange={(e) => setMaxClaims(Number(e.target.value))}
          />
        </label>
        <Button type="submit">発行</Button>
      </form>
      <ul className="space-y-1.5">
        {[...(list?.builtins ?? []), ...(list?.custom ?? [])].map((p) => (
          <li
            key={p.code}
            className="flex items-start justify-between gap-2 rounded-[var(--radius-md)] border border-border bg-bg-elevated px-3 py-2 text-sm"
          >
            <div>
              <button
                type="button"
                className="font-mono text-primary"
                onClick={() => copyText(p.code)}
              >
                {p.code}
              </button>{" "}
              <span className="text-fg-muted">{p.label}</span>
              <div className="text-[11px] text-fg-subtle">
                {formatGrantSummary(p.grant)} · 使用 {p.claimCount ?? 0}
                {p.maxClaims ? `/${p.maxClaims}` : ""}
                {p.custom ? "" : " · 組み込み"}
                {p.custom && !p.active ? " · 停止中" : ""}
              </div>
            </div>
            {p.custom && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  void setPromoActive({ data: { code: p.code, active: !p.active } }).then(() =>
                    load(),
                  );
                }}
              >
                {p.active ? "停止" : "再開"}
              </Button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function fmtSec(n: number) {
  const s = Math.max(0, Math.floor(n));
  if (s < 60) return `${s}秒`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}分`;
  return `${Math.floor(m / 60)}時間${m % 60}分`;
}

function WatchOps() {
  const [rows, setRows] = useState<Awaited<ReturnType<typeof listWatchAdmin>>>([]);
  const [url, setUrl] = useState("");
  const [label, setLabel] = useState("");
  const [duration, setDuration] = useState(60);

  function load() {
    void listWatchAdmin().then(setRows);
  }
  useEffect(load, []);

  const live = rows.filter((v) => Number(v.active) === 1);
  const dry = rows.filter(
    (v) => v.owner_player_id && Number(v.credit_sec || 0) <= 0,
  );

  return (
    <div className="space-y-3">
      <p className="text-xs text-fg-subtle">
        公開 {live.length} / 全 {rows.length}
        {dry.length ? ` · 枠切れ ${dry.length}` : ""}
      </p>
      <ul className="space-y-1.5">
        {rows.map((v) => {
          const partner = !!v.owner_player_id;
          const credit = Number(v.credit_sec) || 0;
          const paused = Number(v.active) === 0;
          const out = partner && credit <= 0;
          return (
            <li
              key={v.id}
              className="rounded-[var(--radius-md)] border border-border bg-bg-elevated px-3 py-2 text-sm"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-medium">{v.label}</div>
                  <div className="font-mono text-[11px] text-fg-subtle">{v.id}</div>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    void setWatchActive({ data: { id: v.id, active: paused } }).then(() => load());
                  }}
                >
                  {paused ? "公開" : "非公開"}
                </Button>
              </div>
              <div className="mt-1 text-[11px] text-fg-subtle">
                {paused ? "停止中" : out ? "枠切れで非表示" : "配信中"}
                {" · "}
                {partner ? "パートナー" : "運営"}
                {partner ? ` · 残枠 ${fmtSec(credit)}` : ""}
                {" · "}
                視聴 {fmtSec(Number(v.total_watch_sec) || 0)} · 報酬 {v.claim_count} 回
              </div>
            </li>
          );
        })}
        {!rows.length && (
          <li className="text-sm text-fg-subtle">映像がまだありません。</li>
        )}
      </ul>
      <form
        className="space-y-2 rounded-[var(--radius-xl)] border border-border bg-bg-elevated p-4"
        onSubmit={(e) => {
          e.preventDefault();
          void upsertWatchVideo({
            data: { url, label, durationSec: duration, asPartner: false },
          }).then((r) => {
            if (r.ok) {
              toast.success("運営映像を追加しました（枠を消費しません）");
              setUrl("");
              load();
            } else toast.error("追加できません");
          });
        }}
      >
        <p className="text-xs font-medium text-fg-subtle">運営映像を追加</p>
        <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="YouTube URL" />
        <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="表示名" />
        <label className="block text-xs text-fg-subtle">
          尺（秒）
          <Input
            type="number"
            min={10}
            value={duration}
            onChange={(e) => setDuration(Number(e.target.value))}
          />
        </label>
        <Button type="submit">追加</Button>
      </form>
    </div>
  );
}

function CreditOps() {
  const [hours, setHours] = useState(2);
  const [issued, setIssued] = useState<string | null>(null);
  const [rows, setRows] = useState<Awaited<ReturnType<typeof listPrepaidAdmin>>>([]);

  function load() {
    void listPrepaidAdmin().then(setRows);
  }
  useEffect(load, []);

  return (
    <div className="space-y-3">
      <div className="rounded-[var(--radius-xl)] border border-border bg-bg-elevated p-4">
        <p className="mb-1 text-xs font-medium text-fg-subtle">広告コード発行</p>
        <p className="mb-3 text-[11px] text-fg-subtle">
          パートナーが自分の映像を出すための視聴枠です。コードを渡すと時間ぶんの枠が入ります。
        </p>
        <div className="flex gap-2">
          <label className="block flex-1 text-xs text-fg-subtle">
            時間
            <Input
              type="number"
              min={1}
              max={240}
              value={hours}
              onChange={(e) => setHours(Number(e.target.value))}
            />
          </label>
          <Button
            type="button"
            className="self-end"
            onClick={() => {
              void issuePrepaid({ data: { hours } }).then((r) => {
                if (r.ok) {
                  setIssued(r.code);
                  copyText(r.code);
                  load();
                }
              });
            }}
          >
            発行
          </Button>
        </div>
        {issued && (
          <p className="mt-2 font-mono text-sm text-primary select-all">{issued}</p>
        )}
      </div>
      <ul className="space-y-1.5">
        {rows.map((r) => (
          <li
            key={r.code}
            className="flex items-center justify-between gap-2 rounded-[var(--radius-md)] border border-border bg-bg-elevated px-3 py-2"
          >
            <div>
              <button
                type="button"
                className="font-mono text-sm text-primary"
                onClick={() => copyText(r.code)}
              >
                {r.code}
              </button>
              <div className="text-[11px] text-fg-subtle">
                {r.hours}時間 · {r.claim_count}/{r.max_claims || "∞"}
                {Number(r.claim_count) > 0 ? " · 使用済" : " · 未使用"}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function StaffOps({ isSuper, onChange }: { isSuper: boolean; onChange: () => void }) {
  const [desk, setDesk] = useState<Awaited<ReturnType<typeof getStaffDesk>> | null>(null);
  const [id, setId] = useState("");
  const [label, setLabel] = useState("");

  function load() {
    void getStaffDesk().then(setDesk);
  }
  useEffect(load, []);

  return (
    <div className="space-y-3">
      <p className="text-xs text-fg-subtle">
        根管理者は初回ログインで固定されます。DB 行からは外せません。
      </p>
      {isSuper && (
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input value={id} onChange={(e) => setId(e.target.value)} placeholder="ユーザー ID" />
          <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="表示名" />
          <Button
            type="button"
            onClick={() => {
              void appointStaff({ data: { playerId: id, label } }).then((r) => {
                if (r.ok) {
                  toast.success("任命しました");
                  setId("");
                  load();
                  onChange();
                } else toast.error("任命できません");
              });
            }}
          >
            任命
          </Button>
        </div>
      )}
      <ul className="space-y-1.5">
        {desk?.staff.map((s) => (
          <li
            key={s.playerId}
            className="flex items-center justify-between rounded-[var(--radius-md)] border border-border bg-bg-elevated px-3 py-2 text-sm"
          >
            <span>
              {s.label}{" "}
              <span className="font-mono text-[11px] text-fg-subtle">{s.playerId}</span>
              {s.fixed ? " · 固定" : ""}
            </span>
            {isSuper && !s.fixed && (
              <Button
                type="button"
                size="sm"
                variant="danger"
                onClick={() => {
                  void removeStaff({ data: s.playerId }).then(() => {
                    load();
                    onChange();
                  });
                }}
              >
                解任
              </Button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function StoreOps() {
  const [cfg, setCfg] = useState<RemoteStoreConfig>(DEFAULT_REMOTE_CONFIG);
  const [busy, setBusy] = useState(false);
  const [connected, setConnected] = useState<boolean | null>(null);
  const [status, setStatus] = useState("");
  const [clientIp, setClientIp] = useState<string | null>(null);
  const [logs, setLogs] = useState<AccessLogItem[]>([]);
  const [ips, setIps] = useState<AccessIpItem[]>([]);
  const [snaps, setSnaps] = useState<RemoteSnapshotMeta[]>([]);

  useEffect(() => {
    void getConnectorSettings({ data: "studio" }).then(setCfg).catch(() => {});
  }, []);

  async function refresh(next = cfg) {
    const [lr, ir, sr] = await Promise.all([
      remoteLogRecent(next, 15),
      remoteLogIps(next),
      remoteSnapList(next),
    ]);
    if (lr.ok) {
      setLogs(lr.data.items ?? []);
      if (lr.data.your_ip) setClientIp(lr.data.your_ip);
    }
    if (ir.ok) setIps(ir.data.items ?? []);
    if (sr.ok) setSnaps(sr.data.items ?? []);
  }

  return (
    <div className="space-y-3">
      <div className="rounded-[var(--radius-xl)] border border-border bg-bg-elevated p-4">
        <p className="text-xs font-medium text-fg-subtle">外部ストレージ設定</p>
        <p className="mt-1 text-[11px] text-fg-subtle">
          grokbuild-external-storage の php-api。素材の実体はブラウザから直接送ります。未設定のあいだは
          素材登録できません（Vercel の一時保存は使いません）。
        </p>
        <div
          className={`mt-3 grid gap-2 rounded-[var(--radius-md)] border p-3 sm:grid-cols-3 ${
            connected === true
              ? "border-primary/30 bg-primary/5"
              : connected === false
                ? "border-red-400/30 bg-red-500/5"
                : "border-border bg-bg-subtle"
          }`}
        >
          <div>
            <div className="text-[11px] text-fg-subtle">接続</div>
            <div className="text-sm font-semibold">
              {connected === true ? "OK" : connected === false ? "失敗" : "未確認"}
            </div>
          </div>
          <div>
            <div className="text-[11px] text-fg-subtle">プロキシが見た IP</div>
            <div className="font-mono text-sm">{clientIp ?? "—"}</div>
          </div>
          <div>
            <div className="text-[11px] text-fg-subtle">スナップ</div>
            <div className="text-sm font-semibold">{snaps.length} 件</div>
          </div>
        </div>
        <div className="mt-3 space-y-2">
          <Input
            value={cfg.proxyUrl}
            onChange={(e) => setCfg({ ...cfg, proxyUrl: e.target.value })}
            placeholder="https://…/api/proxy.php"
          />
          <Input
            type="password"
            value={cfg.apiKey}
            onChange={(e) => setCfg({ ...cfg, apiKey: e.target.value })}
            placeholder="API キー"
          />
          <Input
            value={cfg.namespace}
            onChange={(e) => setCfg({ ...cfg, namespace: e.target.value })}
            placeholder="テナント（default）"
          />
          <div className="grid grid-cols-2 gap-2">
            <Input
              value={cfg.basicUser}
              onChange={(e) => setCfg({ ...cfg, basicUser: e.target.value })}
              placeholder="Basic ユーザー"
            />
            <Input
              type="password"
              value={cfg.basicPass}
              onChange={(e) => setCfg({ ...cfg, basicPass: e.target.value })}
              placeholder="Basic パスワード"
            />
          </div>
          <label className="flex min-h-11 items-center gap-2 text-xs text-fg-muted">
            <input
              type="checkbox"
              checked={cfg.enabled}
              onChange={(e) => setCfg({ ...cfg, enabled: e.target.checked })}
              className="size-5 accent-[var(--color-primary)]"
            />
            共用コネクタを有効
          </label>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            type="button"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void saveConnectorSettings({
                data: {
                  scope: "studio",
                  proxyUrl: cfg.proxyUrl,
                  apiKey: cfg.apiKey,
                  basicUser: cfg.basicUser,
                  basicPass: cfg.basicPass,
                  namespace: cfg.namespace,
                  setupUrl: cfg.setupUrl,
                  enabled: cfg.enabled,
                },
              })
                .then(() => toast.success("保存しました"))
                .finally(() => setBusy(false));
            }}
          >
            保存
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              setStatus("確認中…");
              void remotePing(cfg)
                .then(async (r) => {
                  if (r.ok) {
                    setConnected(true);
                    setStatus("接続できました");
                    toast.success("接続できました");
                    await refresh(cfg);
                  } else {
                    setConnected(false);
                    setStatus(r.error);
                    toast.error(r.error);
                  }
                })
                .finally(() => setBusy(false));
            }}
          >
            接続確認
          </Button>
        </div>
        {status && <p className="mt-2 text-[11px] text-fg-subtle">{status}</p>}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <section className="rounded-[var(--radius-xl)] border border-border bg-bg-elevated p-4">
          <h3 className="text-sm font-medium">接続元 IP</h3>
          <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto font-mono text-[11px] text-fg-muted">
            {!ips.length && <li>接続確認後に出ます</li>}
            {ips.map((row) => (
              <li key={row.ip}>
                {row.ip}
                {row.ip === clientIp ? " ← この端末" : ""} · {row.hits}回
              </li>
            ))}
          </ul>
        </section>
        <section className="rounded-[var(--radius-xl)] border border-border bg-bg-elevated p-4">
          <h3 className="text-sm font-medium">直近ログ</h3>
          <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto text-[11px] text-fg-muted">
            {!logs.length && <li>ログなし</li>}
            {logs.map((row) => (
              <li key={row.id}>
                {row.ip} · {row.action} · {row.ok ? "OK" : "NG"}
              </li>
            ))}
          </ul>
        </section>
      </div>

      {snaps.length > 0 && (
        <section className="rounded-[var(--radius-xl)] border border-border bg-bg-elevated p-4">
          <h3 className="text-sm font-medium">サーバ上のスナップショット</h3>
          <ul className="mt-2 space-y-1 text-[11px] text-fg-muted">
            {snaps.map((s) => (
              <li key={s.id}>
                #{s.id} {s.title} · {s.kind}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
