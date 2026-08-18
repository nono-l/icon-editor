import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { AppShell, useStudio } from "@/components/app-shell";
import { IconEditor, type CanvasPreset } from "@/components/icon-editor";
import { registerMaterial } from "@/components/material-register";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  deleteBanner,
  listMyBanners,
  publishBanner,
  saveBannerHref,
  setBannerActive,
} from "@/lib/kernel/fns";

export const Route = createFileRoute("/banner")({ component: BannerPage });

const STRIPS: CanvasPreset[] = [
  { id: "strip-s", w: 160, h: 64, label: "帯 160×64" },
  { id: "strip-m", w: 320, h: 80, label: "帯 320×80" },
  { id: "strip-l", w: 400, h: 80, label: "帯 400×80" },
];

function BannerPage() {
  const [studio, reload] = useStudio();
  const [href, setHref] = useState("");
  const [mine, setMine] = useState<Awaited<ReturnType<typeof listMyBanners>> | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [confirmStep, setConfirmStep] = useState(0);

  function load() {
    if (!studio.signedIn) return;
    void listMyBanners()
      .then(setMine)
      .catch(() => setMine(null));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studio.signedIn]);

  return (
    <AppShell studio={studio} title="帯エディタ" kicker="STRIP">
      <p className="mb-4 text-sm text-fg-muted">
        高さは最大 85px、幅は高さの 1.5〜5 倍。未ログインでも編集・保存できます。配信登録はログイン後、週 8
        回まで。表示 1 回 = 枠 1 秒、外部クリック 1 回 = 20 分。
      </p>
      <div className="mb-4">
        <Input
          value={href}
          onChange={(e) => setHref(e.target.value)}
          placeholder="任意のリンク（https://…）"
        />
      </div>
      <IconEditor
        variant="page"
        initialPreset="strip-m"
        hideBasePresets
        extraPresets={STRIPS}
        onRegisterMaterial={
          studio.storage === "remote"
            ? async (meta) => {
                const r = await registerMaterial({
                  kind: "strip",
                  title: `帯 ${meta.width}×${meta.height}`,
                  ...meta,
                });
                if (r.ok) reload();
              }
            : undefined
        }
        onExported={async (_blob, meta) => {
          if (!studio.signedIn) {
            toast.message("端末に保存しました。配信はログイン後です");
            return;
          }
          const r = await publishBanner({
            data: {
              imageUrl: meta.dataUrl,
              width: meta.width,
              height: meta.height,
              href,
            },
          });
          if (!r.ok) {
            const msg: Record<string, string> = {
              week_cap: "今週の差し替え上限です",
              too_big: "画像が大きすぎます",
              bad_image: "画像を読めません",
            };
            toast.error(msg[r.reason] ?? "配信できません");
            return;
          }
          toast.success("帯を配信登録しました");
          reload();
          load();
        }}
      />

      {studio.signedIn && mine && (
        <section className="mt-6 rounded-[var(--radius-xl)] border border-border bg-bg-elevated p-4">
          <p className="mb-2 text-xs font-medium text-fg-subtle">
            配信中 · 今週 {mine.weekUsed}/{mine.weekLimit}
          </p>
          {!mine.banners.length ? (
            <p className="text-xs text-fg-subtle">まだありません</p>
          ) : (
            <ul className="space-y-3">
              {mine.banners.map((b) => {
                const impress = mine.events.find((e) => e.banner_id === b.id && e.kind === "impress")?.n ?? 0;
                const clicks = mine.events.find((e) => e.banner_id === b.id && e.kind === "click")?.n ?? 0;
                return (
                  <li key={b.id} className="rounded-[var(--radius-md)] border border-border p-3">
                    <img src={b.image_url} alt="" className="mb-2 max-h-[85px] w-auto" />
                    <div className="text-[11px] text-fg-subtle">
                      表示 {impress} · クリック {clicks} · {b.active ? "有効" : "停止"}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          void setBannerActive({ data: { id: b.id, active: !b.active } }).then(load);
                        }}
                      >
                        {b.active ? "無効化" : "有効化"}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          void saveBannerHref({ data: { id: b.id, href } }).then(() =>
                            toast.success("リンクを更新"),
                          );
                        }}
                      >
                        リンク更新
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="danger"
                        onClick={() => {
                          if (confirmId !== b.id) {
                            setConfirmId(b.id);
                            setConfirmStep(1);
                            toast.message("削除は戻せません。枠も回数も戻りません。もう一度。");
                            return;
                          }
                          if (confirmStep < 3) {
                            setConfirmStep((s) => s + 1);
                            toast.message(`確認 ${confirmStep + 1}/3`);
                            return;
                          }
                          void deleteBanner({ data: b.id }).then(() => {
                            toast.success("削除しました");
                            setConfirmId(null);
                            setConfirmStep(0);
                            load();
                          });
                        }}
                      >
                        削除{confirmId === b.id ? ` ${confirmStep}/3` : ""}
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}
    </AppShell>
  );
}
