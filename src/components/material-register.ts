import { toast } from "sonner";
import { remoteSnapSave } from "@/lib/external-storage/client";
import {
  beginMaterialRegister,
  cancelMaterialRegister,
  finishMaterialRegister,
} from "@/lib/kernel/fns";

export type RegisterKind = "icon" | "strip";

export async function makeThumb(dataUrl: string, max = 96): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      const ctx = c.getContext("2d");
      if (!ctx) {
        reject(new Error("canvas"));
        return;
      }
      ctx.drawImage(img, 0, 0, w, h);
      resolve(c.toDataURL("image/jpeg", 0.72));
    };
    img.onerror = () => reject(new Error("image"));
    img.src = dataUrl;
  });
}

export async function registerMaterial(opts: {
  kind: RegisterKind;
  title: string;
  width: number;
  height: number;
  dataUrl: string;
}): Promise<{ ok: boolean; tickets?: number }> {
  let thumb: string;
  try {
    thumb = await makeThumb(opts.dataUrl);
  } catch {
    toast.error("サムネイルを作れませんでした");
    return { ok: false };
  }
  const begun = await beginMaterialRegister({
    data: {
      kind: opts.kind,
      title: opts.title,
      width: opts.width,
      height: opts.height,
      thumbUrl: thumb,
    },
  }).catch(() => null);
  if (!begun) {
    toast.error("ログインしてから登録してください");
    return { ok: false };
  }
  if (!begun.ok) {
    const msg: Record<string, string> = {
      no_ticket: "チケットがありません。視聴で入手できます",
      thumb: "サムネイルが大きすぎます",
      bad_image: "画像を読めません",
      no_store: "外部ストレージが未設定です。運営が接続するまで登録できません",
    };
    toast.error(msg[begun.reason] ?? "登録を開始できません");
    return { ok: false };
  }

  try {
    const snap = await remoteSnapSave(begun.remote, {
      title: opts.title,
      kind: opts.kind,
      payload: {
        v: 1,
        width: opts.width,
        height: opts.height,
        image: opts.dataUrl,
      },
    });
    if (!snap.ok) {
      await cancelMaterialRegister({ data: begun.id });
      toast.error(`外部ストレージへ送れませんでした: ${snap.error}`);
      return { ok: false };
    }
    const fin = await finishMaterialRegister({
      data: { id: begun.id, remoteSnapId: snap.data.id },
    });
    if (!fin.ok) {
      await cancelMaterialRegister({ data: begun.id });
      toast.error("登録の確定に失敗しました");
      return { ok: false };
    }
    toast.success("素材ライブラリに登録しました");
    return { ok: true, tickets: begun.tickets };
  } catch {
    await cancelMaterialRegister({ data: begun.id }).catch(() => {});
    toast.error("登録中にエラーが起きました。チケットは戻します");
    return { ok: false };
  }
}
