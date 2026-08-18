import { unlockRemainingLabel } from "@/lib/kernel/grants";
import { AppShell, useStudio } from "@/components/app-shell";
import { IconEditor, type CanvasPreset } from "@/components/icon-editor";
import { registerMaterial } from "@/components/material-register";
import { PromoPanel } from "@/components/promo-panel";

const UNLOCK_PRESETS: Record<string, CanvasPreset> = {
  size512: { id: "size512", w: 512, h: 512, label: "512×512" },
  size1024: { id: "size1024", w: 1024, h: 1024, label: "1024×1024" },
  apple: { id: "apple", w: 180, h: 180, label: "Apple 180×180" },
};

const PALETTE = [
  { id: "navy", label: "紺", color: "#0c1a33" },
  { id: "paper", label: "紙", color: "#efe6d6" },
  { id: "dusk", label: "黄昏", color: "#2a1812" },
];

export function StudioCanvas({
  room,
  onRoomChange,
}: {
  room: string | null;
  onRoomChange: (code: string | null) => void;
}) {
  const [studio, reload] = useStudio();
  const extraPresets = studio.unlocks
    .map((id) => {
      const base = UNLOCK_PRESETS[id];
      if (!base) return null;
      const until = studio.unlockUntil[id];
      const remain = until ? unlockRemainingLabel(until) : "";
      return remain ? { ...base, label: `${base.label} · ${remain}` } : base;
    })
    .filter((p): p is CanvasPreset => !!p);
  const extraBackgrounds = studio.unlocks.includes("palette") ? PALETTE : [];

  return (
    <AppShell studio={studio} title="アイコンエディタ">
      <p className="mb-4 text-sm text-fg-muted">
        300×300 と 1200×630 は最初から使えます。帯のリンクでインク、視聴でチケット。解除は 90 日間。
        ホストが発行した招待URLを開くと、そのまま部屋に入れます。
      </p>
      <PromoPanel studio={studio} onChange={reload} />
      <IconEditor
        extraPresets={extraPresets}
        extraBackgrounds={extraBackgrounds}
        enableCollab
        roomCode={room}
        displayName={studio.signedIn ? "メンバー" : "ゲスト"}
        onRoomChange={onRoomChange}
        onRegisterMaterial={
          studio.storage === "remote"
            ? async (meta) => {
                const r = await registerMaterial({
                  kind: "icon",
                  title: `アイコン ${meta.width}×${meta.height}`,
                  ...meta,
                });
                if (r.ok) reload();
              }
            : undefined
        }
      />
    </AppShell>
  );
}
