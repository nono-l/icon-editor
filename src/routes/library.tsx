import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { AppShell, useStudio } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getConnectorSettings, listMaterials, saveConnectorSettings } from "@/lib/kernel/fns";
import { remotePing } from "@/lib/external-storage/client";
import { DEFAULT_REMOTE_CONFIG, type RemoteStoreConfig } from "@/lib/external-storage/types";

export const Route = createFileRoute("/library")({ component: LibraryPage });

function LibraryPage() {
  const [studio, reload] = useStudio();
  const [items, setItems] = useState<Awaited<ReturnType<typeof listMaterials>>>([]);

  useEffect(() => {
    void listMaterials().then(setItems).catch(() => setItems([]));
  }, [studio.tickets]);

  return (
    <AppShell studio={studio} title="素材ライブラリ" kicker="LIBRARY">
      <p className="mb-4 text-sm text-fg-muted">
        登録はログインユーザーのチケット1枚。チケットは視聴でのみ増えます。実体は外部ストレージへ直接送ります（Vercel
        には置きません）。
        {studio.storage !== "remote" && " いまは外部ストレージ未設定のため、登録できません。"}
      </p>
      {!studio.signedIn && (
        <p className="mb-4 text-sm text-fg-muted">
          登録するには{" "}
          <Link to="/login" className="text-primary underline-offset-2 hover:underline">
            ログイン
          </Link>
          してください。
        </p>
      )}
      {studio.signedIn && studio.tickets < 1 && (
        <p className="mb-4 text-sm text-fg-muted">
          チケットがありません。{" "}
          <Link to="/watch" className="text-primary underline-offset-2 hover:underline">
            視聴
          </Link>
          で入手できます。
        </p>
      )}

      {studio.signedIn && <OwnConnector onSaved={reload} />}

      {!items.length ? (
        <div className="rounded-[var(--radius-xl)] border border-dashed border-border-strong bg-bg-elevated p-8 text-center text-sm text-fg-subtle">
          まだ素材がありません。編集または帯から登録してください。
        </div>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {items.map((m) => (
            <li
              key={m.id}
              className="overflow-hidden rounded-[var(--radius-lg)] border border-border bg-bg-elevated"
            >
              <div className="flex aspect-square items-center justify-center bg-[repeating-conic-gradient(#2a2c31_0%_25%,#17181c_0%_50%)] bg-[length:14px_14px] p-3">
                {m.thumb_url ? (
                  <img src={m.thumb_url} alt="" className="max-h-full max-w-full" />
                ) : null}
              </div>
              <div className="px-3 py-2">
                <div className="truncate text-xs font-medium">{m.title}</div>
                <div className="text-[11px] text-fg-subtle">
                  {m.width}×{m.height} · {m.kind === "strip" ? "帯" : "アイコン"} ·{" "}
                  {m.storage === "remote" ? "外部" : "一時"}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </AppShell>
  );
}

function OwnConnector({ onSaved }: { onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [cfg, setCfg] = useState<RemoteStoreConfig>(DEFAULT_REMOTE_CONFIG);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    void getConnectorSettings({ data: "own" }).then(setCfg).catch(() => {});
  }, [open]);

  async function save() {
    setBusy(true);
    try {
      await saveConnectorSettings({
        data: {
          scope: "own",
          proxyUrl: cfg.proxyUrl,
          apiKey: cfg.apiKey,
          basicUser: cfg.basicUser,
          basicPass: cfg.basicPass,
          namespace: cfg.namespace,
          setupUrl: cfg.setupUrl,
          enabled: cfg.enabled,
        },
      });
      toast.success("接続先を保存しました");
      onSaved();
    } finally {
      setBusy(false);
    }
  }

  async function ping() {
    setBusy(true);
    const r = await remotePing(cfg);
    setBusy(false);
    if (r.ok) toast.success("接続できました");
    else toast.error(r.error);
  }

  return (
    <section className="mb-4 rounded-[var(--radius-xl)] border border-border bg-bg-elevated p-4">
      <button
        type="button"
        className="text-xs font-medium text-fg-muted hover:text-fg"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? "自分の外部ストレージを閉じる" : "自分の外部ストレージ（任意）"}
      </button>
      {open && (
        <div className="mt-3 space-y-2">
          <p className="text-[11px] text-fg-subtle">
            未設定なら運営の共用先を使います。どちらも無いときは素材登録できません（Vercel
            に大きな画像を置かないため）。
          </p>
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
            placeholder="テナント"
          />
          <label className="flex min-h-11 items-center gap-2 text-xs text-fg-muted">
            <input
              type="checkbox"
              checked={cfg.enabled}
              onChange={(e) => setCfg({ ...cfg, enabled: e.target.checked })}
              className="size-5 accent-[var(--color-primary)]"
            />
            この接続を使う
          </label>
          <div className="flex gap-2">
            <Button type="button" size="sm" onClick={() => void save()} disabled={busy}>
              保存
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => void ping()} disabled={busy}>
              接続確認
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
