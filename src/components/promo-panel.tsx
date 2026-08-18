import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { buyUnlock, claimPromo } from "@/lib/kernel/fns";
import { UNLOCK_META, UNLOCK_TTL_DAYS, unlockRemainingLabel, type UnlockId } from "@/lib/kernel/grants";
import type { StudioState } from "./app-shell";

export function PromoPanel({
  studio,
  onChange,
}: {
  studio: StudioState;
  onChange: () => void;
}) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  async function claim() {
    if (!studio.signedIn) {
      toast.message("コードの受け取りにはログインが必要です");
      return;
    }
    setBusy(true);
    try {
      const r = await claimPromo({ data: code });
      if (!r.ok) {
        const msg: Record<string, string> = {
          already: "このコードは受け取り済みです",
          expired: "期限切れです",
          sold_out: "上限に達しています",
          invalid: "コードが見つかりません",
        };
        toast.error(msg[r.reason] ?? "受け取れませんでした");
        return;
      }
      toast.success(`${r.label} · ${r.summary}`);
      setCode("");
      onChange();
    } catch {
      toast.error("ログインしてから受け取ってください");
    } finally {
      setBusy(false);
    }
  }

  async function buy(id: UnlockId) {
    if (!studio.signedIn) {
      toast.message("交換にはログインが必要です");
      return;
    }
    setBusy(true);
    try {
      const r = await buyUnlock({ data: id });
      if (!r.ok) {
        toast.error(
          r.reason === "broke" ? "インクが足りません" : r.reason === "owned" ? "解除済みです" : "交換できません",
        );
        return;
      }
      toast.success(`${UNLOCK_META[id].label} を 90 日間解除しました`);
      onChange();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mb-4 space-y-3 rounded-[var(--radius-xl)] border border-border bg-bg-elevated p-4">
      <div>
        <p className="text-xs font-medium text-fg-subtle">プロモコード</p>
        <p className="mt-0.5 text-[11px] text-fg-subtle">
          試すなら <span className="font-mono text-primary">WELCOME</span> または{" "}
          <span className="font-mono text-primary">STUDIO</span>
        </p>
        <div className="mt-2 flex gap-2">
          <Input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="コード"
            maxLength={24}
            className="font-mono uppercase"
            onKeyDown={(e) => {
              if (e.key === "Enter") void claim();
            }}
          />
          <Button type="button" onClick={() => void claim()} disabled={busy || !code.trim()}>
            受け取る
          </Button>
        </div>
      </div>
      <div>
        <p className="mb-1.5 text-xs font-medium text-fg-subtle">インクで解除 · {UNLOCK_TTL_DAYS}日間</p>
        <p className="mb-2 text-[11px] text-fg-subtle">
          インクは帯広告のリンクを開くと 1 回 1 滴。解除は {UNLOCK_TTL_DAYS} 日で切れます。
        </p>
        <div className="grid grid-cols-2 gap-1.5">
          {(Object.keys(UNLOCK_META) as UnlockId[]).map((id) => {
            const until = studio.unlockUntil[id];
            const owned = !!until && studio.unlocks.includes(id);
            const m = UNLOCK_META[id];
            return (
              <button
                key={id}
                type="button"
                disabled={owned || busy}
                onClick={() => void buy(id)}
                className="rounded-[var(--radius-md)] border border-border bg-bg-subtle px-3 py-2 text-left disabled:opacity-60"
              >
                <div className="text-xs font-medium text-fg">{m.label}</div>
                <div className="text-[11px] text-fg-subtle">
                  {owned && until
                    ? unlockRemainingLabel(until)
                    : `${m.inkCost} インク · ${m.hint}`}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
