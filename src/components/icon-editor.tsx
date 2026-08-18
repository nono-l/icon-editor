import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  BoxSelect,
  ChevronsDown,
  ChevronsUp,
  Download,
  ImagePlus,
  Link2,
  Magnet,
  Pipette,
  RotateCcw,
  RotateCw,
  Share2,
  Trash2,
  Type,
  Unlink2,
  Users,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  inviteUrl,
  loadImage,
  normalizeRoom,
  roomCode as makeRoomCode,
  serializeDoc,
  serializeLayer,
  wireFromLayers,
  useCanvasRoom,
  type CanvasDoc,
  type CanvasOp,
  type LivePose,
  type RosterSeat,
} from "@/lib/canvas-room";
import { cn } from "@/lib/utils";

const ICON = { id: "icon" as const, w: 300, h: 300, label: "アイコン 300×300" };
const OG = { id: "og" as const, w: 1200, h: 630, label: "OG 1200×630" };
const BASE_PRESETS = [ICON, OG];
export type CanvasPreset = { id: string; w: number; h: number; label: string };
type PresetId = string;
const SNAP = 10;

type GuideShape = "box" | "hline" | "vline" | "cross";

type ImageLayer = {
  id: string;
  kind: "image";
  name: string;
  img: HTMLImageElement;
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  rotate: number;
  w: number;
  h: number;
  opacity: number;
  keyColor: string | null;
  keyTolerance: number;
};

type TextLayer = {
  id: string;
  kind: "text";
  name: string;
  text: string;
  color: string;
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  rotate: number;
  w: number;
  h: number;
  opacity: number;
  strokeWidth: number;
  strokeColor: string;
  strokeOpacity: number;
  shadowBlur: number;
  shadowColor: string;
  shadowOpacity: number;
  shadowX: number;
  shadowY: number;
};

type GuideLayer = {
  id: string;
  kind: "guide";
  name: string;
  shape: GuideShape;
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  rotate: number;
  w: number;
  h: number;
};

type Layer = ImageLayer | TextLayer | GuideLayer;

const GUIDE_LABEL: Record<GuideShape, string> = {
  box: "枠",
  hline: "横線",
  vline: "縦線",
  cross: "十字",
};

const BACKGROUNDS: { id: string; label: string; color: string | null }[] = [
  { id: "none", label: "なし", color: null },
  { id: "black", label: "黒", color: "#0a0b0d" },
  { id: "ink", label: "深緑", color: "#061810" },
  { id: "white", label: "白", color: "#f4f4f5" },
  { id: "mint", label: "ミント", color: "#14302b" },
];

function drawCheckerboard(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const cell = 12;
  for (let y = 0; y < h; y += cell) {
    for (let x = 0; x < w; x += cell) {
      const odd = (x / cell + y / cell) % 2 === 0;
      ctx.fillStyle = odd ? "#2a2c31" : "#17181c";
      ctx.fillRect(x, y, cell, cell);
    }
  }
}

function nid(): string {
  return `ly_${Math.random().toString(36).slice(2, 9)}`;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function rgbToHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

function colorWithAlpha(hex: string, alpha: number): string {
  const rgb = hexToRgb(hex);
  const a = Math.max(0, Math.min(1, alpha));
  if (!rgb) return `rgba(0,0,0,${a})`;
  return `rgba(${rgb.r},${rgb.g},${rgb.b},${a})`;
}

const chromaCache = new Map<string, HTMLCanvasElement>();

function keyedSource(layer: ImageLayer): CanvasImageSource {
  if (!layer.keyColor) return layer.img;
  const key = `${layer.id}:${layer.keyColor}:${layer.keyTolerance}:${layer.img.src}`;
  const hit = chromaCache.get(key);
  if (hit) return hit;
  const src = hexToRgb(layer.keyColor);
  if (!src) return layer.img;
  const w = layer.img.naturalWidth || layer.w;
  const h = layer.img.naturalHeight || layer.h;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  if (!ctx) return layer.img;
  ctx.drawImage(layer.img, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h);
  const px = data.data;
  const thresh = (layer.keyTolerance / 100) * 441;
  const feather = Math.max(10, thresh * 0.4);
  for (let i = 0; i < px.length; i += 4) {
    const d = Math.hypot(px[i] - src.r, px[i + 1] - src.g, px[i + 2] - src.b);
    if (d <= thresh) {
      px[i + 3] = 0;
    } else if (d < thresh + feather) {
      px[i + 3] = Math.round(px[i + 3] * ((d - thresh) / feather));
    }
  }
  ctx.putImageData(data, 0, 0);
  chromaCache.set(key, c);
  return c;
}

function clampScale(n: number): number {
  return Math.min(8, Math.max(0.05, n));
}

function normDeg(deg: number): number {
  const n = ((deg % 360) + 360) % 360;
  return n > 180 ? n - 360 : n;
}

function sampleLayerColor(layer: ImageLayer, px: number, py: number): string | null {
  const dx = px - layer.x;
  const dy = py - layer.y;
  const rad = (-layer.rotate * Math.PI) / 180;
  const lx = dx * Math.cos(rad) - dy * Math.sin(rad);
  const ly = dx * Math.sin(rad) + dy * Math.cos(rad);
  const w = layer.w * layer.scaleX;
  const h = layer.h * layer.scaleY;
  if (Math.abs(lx) > w / 2 || Math.abs(ly) > h / 2) return null;
  const u = ((lx + w / 2) / w) * (layer.img.naturalWidth || layer.w);
  const v = ((ly + h / 2) / h) * (layer.img.naturalHeight || layer.h);
  const c = document.createElement("canvas");
  c.width = 1;
  c.height = 1;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(layer.img, Math.floor(u), Math.floor(v), 1, 1, 0, 0, 1, 1);
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
  return rgbToHex(r, g, b);
}

function measureText(
  text: string,
  scaleX: number,
  scaleY: number,
  strokeWidth = 0,
): { w: number; h: number } {
  const size = 28;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return {
      w: size * text.length * 0.6 * scaleX + strokeWidth * 2,
      h: size * 1.2 * scaleY + strokeWidth * 2,
    };
  }
  ctx.font = `700 ${size}px "Hiragino Sans", "Noto Sans JP", sans-serif`;
  const w = ctx.measureText(text).width * scaleX;
  return { w: w + strokeWidth * 2 * scaleX, h: size * 1.25 * scaleY + strokeWidth * 2 * scaleY };
}

function layerSize(layer: Layer): { w: number; h: number } {
  if (layer.kind === "image") {
    return { w: layer.w * layer.scaleX, h: layer.h * layer.scaleY };
  }
  if (layer.kind === "text") {
    return measureText(layer.text, layer.scaleX, layer.scaleY, layer.strokeWidth ?? 0);
  }
  if (layer.shape === "hline") return { w: layer.w * layer.scaleX, h: Math.max(12, 12 * layer.scaleY) };
  if (layer.shape === "vline") return { w: Math.max(12, 12 * layer.scaleX), h: layer.h * layer.scaleY };
  return { w: layer.w * layer.scaleX, h: layer.h * layer.scaleY };
}

function layerAabb(layer: Pick<Layer, "x" | "y" | "rotate"> & { w: number; h: number }) {
  const rad = (layer.rotate * Math.PI) / 180;
  const c = Math.abs(Math.cos(rad));
  const s = Math.abs(Math.sin(rad));
  const aw = layer.w * c + layer.h * s;
  const ah = layer.w * s + layer.h * c;
  return {
    left: layer.x - aw / 2,
    right: layer.x + aw / 2,
    top: layer.y - ah / 2,
    bottom: layer.y + ah / 2,
    cx: layer.x,
    cy: layer.y,
  };
}

function snapTargets(layer: Layer): { v: number[]; h: number[] } {
  const { w, h } = layerSize(layer);
  const box = layerAabb({ ...layer, w, h });
  if (layer.kind === "guide") {
    if (layer.shape === "hline") return { v: [box.left, box.cx, box.right], h: [box.cy] };
    if (layer.shape === "vline") return { v: [box.cx], h: [box.top, box.cy, box.bottom] };
    if (layer.shape === "cross") return { v: [box.cx], h: [box.cy] };
  }
  return {
    v: [box.left, box.cx, box.right],
    h: [box.top, box.cy, box.bottom],
  };
}

function snapMove(
  moving: Layer,
  x: number,
  y: number,
  others: Layer[],
  canvasW: number,
  canvasH: number,
): { x: number; y: number; v: number[]; h: number[] } {
  const { w, h } = layerSize(moving);
  const box = layerAabb({ ...moving, x, y, w, h });
  const selfV = [box.left, box.cx, box.right];
  const selfH = [box.top, box.cy, box.bottom];

  const targetsV = [0, canvasW / 2, canvasW];
  const targetsH = [0, canvasH / 2, canvasH];
  for (const o of others) {
    if (o.id === moving.id) continue;
    if (o.kind !== "guide" && moving.kind === "guide") {
      /* guides still snap to content edges */
    }
    const t = snapTargets(o);
    targetsV.push(...t.v);
    targetsH.push(...t.h);
  }

  let dx = 0;
  let dy = 0;
  let bestDx = SNAP + 1;
  let bestDy = SNAP + 1;
  const hitV: number[] = [];
  const hitH: number[] = [];

  for (const tv of targetsV) {
    for (const sv of selfV) {
      const d = tv - sv;
      if (Math.abs(d) < Math.abs(bestDx)) bestDx = d;
    }
  }
  for (const th of targetsH) {
    for (const sh of selfH) {
      const d = th - sh;
      if (Math.abs(d) < Math.abs(bestDy)) bestDy = d;
    }
  }

  if (Math.abs(bestDx) <= SNAP) {
    dx = bestDx;
    for (const tv of targetsV) {
      for (const sv of selfV) {
        if (Math.abs(tv - (sv + dx)) < 0.51) hitV.push(tv);
      }
    }
  }
  if (Math.abs(bestDy) <= SNAP) {
    dy = bestDy;
    for (const th of targetsH) {
      for (const sh of selfH) {
        if (Math.abs(th - (sh + dy)) < 0.51) hitH.push(th);
      }
    }
  }

  return { x: x + dx, y: y + dy, v: [...new Set(hitV)], h: [...new Set(hitH)] };
}

function drawGuide(ctx: CanvasRenderingContext2D, layer: GuideLayer, active: boolean) {
  const { w, h } = layerSize(layer);
  ctx.save();
  ctx.translate(layer.x, layer.y);
  ctx.rotate((layer.rotate * Math.PI) / 180);
  ctx.strokeStyle = active ? "rgba(125, 211, 192, 0.95)" : "rgba(125, 211, 192, 0.55)";
  ctx.lineWidth = active ? 1.75 : 1.25;
  ctx.setLineDash([5, 4]);
  if (layer.shape === "box") {
    ctx.strokeRect(-w / 2, -h / 2, w, h);
  } else if (layer.shape === "hline") {
    ctx.beginPath();
    ctx.moveTo(-w / 2, 0);
    ctx.lineTo(w / 2, 0);
    ctx.stroke();
  } else if (layer.shape === "vline") {
    ctx.beginPath();
    ctx.moveTo(0, -h / 2);
    ctx.lineTo(0, h / 2);
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.moveTo(-w / 2, 0);
    ctx.lineTo(w / 2, 0);
    ctx.moveTo(0, -h / 2);
    ctx.lineTo(0, h / 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(0, 0, 4, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

function drawLayer(ctx: CanvasRenderingContext2D, layer: Layer) {
  if (layer.kind === "guide") return;
  ctx.save();
  ctx.translate(layer.x, layer.y);
  ctx.rotate((layer.rotate * Math.PI) / 180);
  ctx.globalAlpha = Math.max(0, Math.min(1, layer.opacity ?? 1));
  if (layer.kind === "image") {
    const w = layer.w * layer.scaleX;
    const h = layer.h * layer.scaleY;
    ctx.drawImage(keyedSource(layer), -w / 2, -h / 2, w, h);
  } else {
    ctx.scale(layer.scaleX, layer.scaleY);
    const size = 28;
    ctx.font = `700 ${size}px "Hiragino Sans", "Noto Sans JP", sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    ctx.miterLimit = 2;
    const layerA = Math.max(0, Math.min(1, layer.opacity ?? 1));
    const strokeW = layer.strokeWidth ?? 0;
    const strokeA = Math.max(0, Math.min(1, layer.strokeOpacity ?? 1));
    const shadowA = Math.max(0, Math.min(1, layer.shadowOpacity ?? 1));
    const hasShadow =
      shadowA > 0 && ((layer.shadowBlur ?? 0) > 0 || layer.shadowX || layer.shadowY);

    if (hasShadow) {
      ctx.save();
      ctx.globalAlpha = layerA * shadowA;
      if ((layer.shadowBlur ?? 0) > 0) {
        ctx.filter = `blur(${layer.shadowBlur}px)`;
      }
      const sx = layer.shadowX ?? 0;
      const sy = layer.shadowY ?? 0;
      const sc = layer.shadowColor || "#000000";
      if (strokeW > 0) {
        ctx.lineWidth = strokeW;
        ctx.strokeStyle = sc;
        ctx.strokeText(layer.text, sx, sy);
      }
      ctx.fillStyle = sc;
      ctx.fillText(layer.text, sx, sy);
      ctx.restore();
    }

    ctx.shadowColor = "transparent";
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;

    if (strokeW > 0 && strokeA > 0) {
      ctx.globalAlpha = layerA * strokeA;
      ctx.lineWidth = strokeW;
      ctx.strokeStyle = colorWithAlpha(layer.strokeColor || "#111318", 1);
      ctx.strokeText(layer.text, 0, 0);
    }
    ctx.globalAlpha = layerA;
    ctx.fillStyle = layer.color;
    ctx.fillText(layer.text, 0, 0);
  }
  ctx.restore();
}

function hitTest(layer: Layer, px: number, py: number): boolean {
  const dx = px - layer.x;
  const dy = py - layer.y;
  const rad = (-layer.rotate * Math.PI) / 180;
  const lx = dx * Math.cos(rad) - dy * Math.sin(rad);
  const ly = dx * Math.sin(rad) + dy * Math.cos(rad);
  const { w, h } = layerSize(layer);
  const pad = layer.kind === "guide" ? 8 : 0;
  return Math.abs(lx) <= w / 2 + pad && Math.abs(ly) <= h / 2 + pad;
}

type ScaleHandle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";
type XformHandle = ScaleHandle | "rot";

function localPoint(layer: Layer, px: number, py: number): { x: number; y: number } {
  const dx = px - layer.x;
  const dy = py - layer.y;
  const rad = (-layer.rotate * Math.PI) / 180;
  return {
    x: dx * Math.cos(rad) - dy * Math.sin(rad),
    y: dx * Math.sin(rad) + dy * Math.cos(rad),
  };
}

function handlePositions(layer: Layer): Record<XformHandle, { x: number; y: number }> {
  const { w, h } = layerSize(layer);
  const hw = w / 2;
  const hh = h / 2;
  const rotPad = Math.max(22, Math.min(w, h) * 0.12);
  return {
    nw: { x: -hw, y: -hh },
    n: { x: 0, y: -hh },
    ne: { x: hw, y: -hh },
    e: { x: hw, y: 0 },
    se: { x: hw, y: hh },
    s: { x: 0, y: hh },
    sw: { x: -hw, y: hh },
    w: { x: -hw, y: 0 },
    rot: { x: 0, y: -hh - rotPad },
  };
}

function hitHandle(layer: Layer, px: number, py: number, radius: number): XformHandle | null {
  const local = localPoint(layer, px, py);
  const pos = handlePositions(layer);
  let best: XformHandle | null = null;
  let bestD = radius;
  for (const key of Object.keys(pos) as XformHandle[]) {
    const d = Math.hypot(local.x - pos[key].x, local.y - pos[key].y);
    if (d <= bestD) {
      bestD = d;
      best = key;
    }
  }
  return best;
}

function drawHandles(ctx: CanvasRenderingContext2D, layer: Layer) {
  const { w, h } = layerSize(layer);
  const pos = handlePositions(layer);
  ctx.save();
  ctx.translate(layer.x, layer.y);
  ctx.rotate((layer.rotate * Math.PI) / 180);
  ctx.strokeStyle = "rgba(125, 211, 192, 0.95)";
  ctx.lineWidth = 2;
  ctx.setLineDash([5, 4]);
  ctx.strokeRect(-w / 2 - 2, -h / 2 - 2, w + 4, h + 4);
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(0, -h / 2);
  ctx.lineTo(pos.rot.x, pos.rot.y);
  ctx.stroke();
  ctx.fillStyle = "#7dd3c0";
  ctx.strokeStyle = "#0a0b0d";
  ctx.lineWidth = 1.5;
  for (const key of Object.keys(pos) as XformHandle[]) {
    const p = pos[key];
    if (key === "rot") {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    } else {
      ctx.fillRect(p.x - 5, p.y - 5, 10, 10);
      ctx.strokeRect(p.x - 5, p.y - 5, 10, 10);
    }
  }
  ctx.restore();
}

function layerLabel(layer: Layer): string {
  if (layer.name.trim()) return layer.name.trim();
  if (layer.kind === "image") return "画像";
  if (layer.kind === "text") return layer.text || "文字";
  return `ガイド（${GUIDE_LABEL[layer.shape]}）`;
}

async function hydrateLayer(
  w: import("@/lib/canvas-room").WireLayer,
  prev: Map<string, Layer>,
): Promise<Layer | null> {
  if (w.kind === "image") {
    const old = prev.get(w.id);
    const reuse = old?.kind === "image" && old.img.src === w.src ? old.img : null;
    const img = reuse ?? (await loadImage(w.src).catch(() => null));
    if (!img) return null;
    return {
      id: w.id,
      kind: "image",
      name: w.name,
      img,
      x: w.x,
      y: w.y,
      scaleX: w.scaleX,
      scaleY: w.scaleY,
      rotate: w.rotate,
      w: w.w,
      h: w.h,
      opacity: w.opacity,
      keyColor: w.keyColor,
      keyTolerance: w.keyTolerance,
    };
  }
  return w as Layer;
}

export function IconEditor({
  open = true,
  onClose,
  variant = "page",
  initialPreset = "icon",
  extraPresets = [],
  extraBackgrounds = [],
  hideBasePresets = false,
  onExported,
  onRegisterMaterial,
  roomCode: roomFromParent,
  onRoomChange,
  displayName = "ゲスト",
  enableCollab = false,
}: {
  open?: boolean;
  onClose?: () => void;
  variant?: "modal" | "page";
  initialPreset?: PresetId;
  extraPresets?: CanvasPreset[];
  extraBackgrounds?: { id: string; label: string; color: string | null }[];
  hideBasePresets?: boolean;
  onExported?: (blob: Blob, meta: { width: number; height: number; dataUrl: string }) => void;
  onRegisterMaterial?: (meta: { width: number; height: number; dataUrl: string }) => void;
  roomCode?: string | null;
  onRoomChange?: (code: string | null) => void;
  displayName?: string;
  enableCollab?: boolean;
}) {
  const presets = hideBasePresets ? extraPresets : [...BASE_PRESETS, ...extraPresets];
  const backgrounds = [...BACKGROUNDS, ...extraBackgrounds];
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [layers, setLayers] = useState<Layer[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [bg, setBg] = useState<string | null>(null);
  const [presetId, setPresetId] = useState<PresetId>(initialPreset);
  const preset = presets.find((p) => p.id === presetId) ?? presets[0] ?? ICON;
  const W = preset.w;
  const H = preset.h;
  const sizeRef = useRef({ w: W, h: H });
  sizeRef.current = { w: W, h: H };
  const [snap, setSnap] = useState<{ v: number[]; h: number[] }>({ v: [], h: [] });
  const [picking, setPicking] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const renameRef = useRef<HTMLInputElement>(null);
  const lastLayerTap = useRef<{ id: string; t: number } | null>(null);
  const [lockAspect, setLockAspect] = useState(true);
  const [pinCanvas, setPinCanvas] = useState(false);
  const [pinCollab, setPinCollab] = useState(false);
  const [collabH, setCollabH] = useState(0);
  const collabPinRef = useRef<HTMLDivElement>(null);
  const [narrow, setNarrow] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const drag = useRef<
    | { mode: "move"; id: string; ox: number; oy: number }
    | {
        mode: "scale";
        id: string;
        handle: ScaleHandle;
        startSX: number;
        startSY: number;
        startLX: number;
        startLY: number;
        lock: boolean;
      }
    | { mode: "rotate"; id: string; startAngle: number; startRotate: number }
    | null
  >(null);
  const pinch = useRef<{ dist: number; scaleX: number; scaleY: number } | null>(null);
  const layersRef = useRef(layers);
  layersRef.current = layers;
  const applyingRef = useRef(false);
  const localDirtyRef = useRef(false);
  const gotRemoteRef = useRef(false);
  const docRef = useRef<CanvasDoc>({ v: 1, presetId: initialPreset, bg: null, layers: [] });
  const [joinInput, setJoinInput] = useState("");
  const [issuedUrl, setIssuedUrl] = useState("");
  const [role, setRole] = useState<"host" | "peer">("peer");
  const room = enableCollab ? normalizeRoom(roomFromParent || "") || null : null;
  const hostOnly = !room || role === "host";

  useEffect(() => {
    if (!room) return;
    try {
      if (sessionStorage.getItem(`canvas-host-${room}`)) setRole("host");
    } catch {
      /* ignore */
    }
  }, [room]);

  useEffect(() => {
    if (!room) return;
    docRef.current = {
      v: 1,
      presetId,
      bg,
      layers: wireFromLayers(layers, docRef.current),
    };
    let alive = true;
    void serializeDoc(presetId, bg, layers).then((d) => {
      if (alive) docRef.current = d;
    });
    return () => {
      alive = false;
    };
  }, [layers, presetId, bg, room]);

  const applyRemoteDoc = useCallback(async (doc: CanvasDoc) => {
    applyingRef.current = true;
    gotRemoteRef.current = true;
    if (role !== "host") {
      setPresetId(doc.presetId);
      setBg(doc.bg);
    }
    const prev = new Map(layersRef.current.map((l) => [l.id, l]));
    const next: Layer[] = [];
    for (const w of doc.layers) {
      const layer = await hydrateLayer(w, prev);
      if (layer) next.push(layer);
    }
    setLayers(next);
    queueMicrotask(() => {
      applyingRef.current = false;
    });
  }, [role]);

  const applyRemoteOp = useCallback(async (op: CanvasOp) => {
    applyingRef.current = true;
    gotRemoteRef.current = true;
    if (op.type === "preset") {
      if (role !== "host") setPresetId(op.presetId);
    } else if (op.type === "bg") {
      if (role !== "host") setBg(op.bg);
    } else if (op.type === "clear") {
      setLayers([]);
    } else if (op.type === "remove") {
      setLayers((ls) => ls.filter((l) => l.id !== op.id));
    } else if (op.type === "reorder") {
      setLayers((ls) => {
        const map = new Map(ls.map((l) => [l.id, l]));
        const next = op.ids.map((id) => map.get(id)).filter(Boolean) as Layer[];
        for (const l of ls) if (!op.ids.includes(l.id)) next.push(l);
        return next;
      });
    } else if (op.type === "patch") {
      const { img: _img, ...safe } = op.patch as { img?: unknown };
      setLayers((ls) => ls.map((l) => (l.id === op.id ? ({ ...l, ...safe } as Layer) : l)));
    } else if (op.type === "add") {
      const prev = new Map(layersRef.current.map((l) => [l.id, l]));
      if (prev.has(op.layer.id)) {
        applyingRef.current = false;
        return;
      }
      const layer = await hydrateLayer(op.layer, prev);
      if (layer) setLayers((ls) => (ls.some((l) => l.id === layer.id) ? ls : [...ls, layer]));
    }
    queueMicrotask(() => {
      applyingRef.current = false;
    });
  }, [role]);

  const collab = useCanvasRoom({
    room,
    name: displayName.slice(0, 16) || "ゲスト",
    role,
    getDoc: () => docRef.current,
    onDoc: (doc) => {
      void applyRemoteDoc(doc);
    },
    onLive: (pose: LivePose) => {
      if (drag.current?.id === pose.id) return;
      setLayers((ls) =>
        ls.map((l) =>
          l.id === pose.id
            ? { ...l, x: pose.x, y: pose.y, scaleX: pose.scaleX, scaleY: pose.scaleY, rotate: pose.rotate }
            : l,
        ),
      );
    },
    onOp: (op) => {
      void applyRemoteOp(op);
    },
  });
  const collabRef = useRef(collab);
  collabRef.current = collab;

  useEffect(() => {
    if (!collab || applyingRef.current) return;
    if (role !== "host" && !gotRemoteRef.current) return;
    if (!localDirtyRef.current) return;
    const t = window.setTimeout(() => {
      if (!localDirtyRef.current) return;
      localDirtyRef.current = false;
      collab.publish();
    }, 240);
    return () => window.clearTimeout(t);
  }, [layers, presetId, bg, collab?.publish, role]);

  const selectedLayer = layers.find((l) => l.id === selected) ?? null;

  const paint = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    if (bg) {
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);
    } else {
      drawCheckerboard(ctx, W, H);
    }
    for (const layer of layers) drawLayer(ctx, layer);
    for (const layer of layers) {
      if (layer.kind === "guide") drawGuide(ctx, layer, layer.id === selected);
    }
    if (snap.v.length || snap.h.length) {
      ctx.save();
      ctx.strokeStyle = "rgba(230, 192, 123, 0.85)";
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 3]);
      for (const x of snap.v) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, H);
        ctx.stroke();
      }
      for (const y of snap.h) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(W, y);
        ctx.stroke();
      }
      ctx.restore();
    }
    if (selectedLayer) {
      drawHandles(ctx, selectedLayer);
    }
    if (collab?.cursors.length) {
      for (const c of collab.cursors) {
        ctx.save();
        ctx.fillStyle = c.color;
        ctx.beginPath();
        ctx.moveTo(c.x, c.y);
        ctx.lineTo(c.x + 4, c.y + 14);
        ctx.lineTo(c.x + 10, c.y + 10);
        ctx.closePath();
        ctx.fill();
        ctx.font = '600 11px "Hiragino Sans", "Noto Sans JP", sans-serif';
        ctx.fillText(c.name, c.x + 12, c.y + 12);
        ctx.restore();
      }
    }
  }, [bg, layers, selected, selectedLayer, snap, W, H, collab?.cursors]);

  useEffect(() => {
    paint();
  }, [paint, open]);

  useEffect(() => {
    if (open) setPresetId(initialPreset);
  }, [open, initialPreset]);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 639px)");
    const apply = () => setNarrow(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("yotei-icon-pin-canvas");
      if (saved === "0") setPinCanvas(false);
      else if (saved === "1") setPinCanvas(true);
      else setPinCanvas(window.matchMedia("(max-width: 639px)").matches);
    } catch {
      setPinCanvas(window.matchMedia("(max-width: 639px)").matches);
    }
    try {
      const saved = localStorage.getItem("yotei-icon-pin-collab");
      if (saved === "1") setPinCollab(true);
      else setPinCollab(false);
    } catch {
      setPinCollab(false);
    }
  }, []);

  useEffect(() => {
    const el = collabPinRef.current;
    if (!el) {
      setCollabH(0);
      return;
    }
    const measure = () => setCollabH(el.getBoundingClientRect().height);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [enableCollab, room, role, issuedUrl, pinCollab]);

  function togglePinCanvas() {
    setPinCanvas((v) => {
      const next = !v;
      try {
        localStorage.setItem("yotei-icon-pin-canvas", next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  }

  function togglePinCollab() {
    setPinCollab((v) => {
      const next = !v;
      try {
        localStorage.setItem("yotei-icon-pin-collab", next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  }

  useEffect(() => {
    if (!open || variant === "page") return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open, variant]);

  useEffect(() => {
    if (!renamingId) return;
    renameRef.current?.focus();
    renameRef.current?.select();
  }, [renamingId]);

  function beginRename(layer: Layer) {
    setSelected(layer.id);
    setRenameValue(layer.name.trim() || layerLabel({ ...layer, name: "" }));
    setRenamingId(layer.id);
  }

  function commitRename() {
    if (!renamingId) return;
    const next = renameValue.trim().slice(0, 24);
    updateLayer(renamingId, { name: next });
    setRenamingId(null);
  }

  function cancelRename() {
    setRenamingId(null);
  }

  function onLayerActivate(layer: Layer) {
    const now = Date.now();
    const prev = lastLayerTap.current;
    if (prev && prev.id === layer.id && now - prev.t < 400) {
      lastLayerTap.current = null;
      beginRename(layer);
      return;
    }
    lastLayerTap.current = { id: layer.id, t: now };
    setSelected(layer.id);
  }

  function touchLocal() {
    localDirtyRef.current = true;
  }

  function emitOp(op: CanvasOp) {
    if (applyingRef.current) return;
    collabRef.current?.sendOp(op);
  }

  function updateLayer(id: string, patch: Partial<Layer>) {
    touchLocal();
    setLayers((ls) => ls.map((l) => (l.id === id ? ({ ...l, ...patch } as Layer) : l)));
    const poseOnly = Object.keys(patch).every((k) =>
      ["x", "y", "scaleX", "scaleY", "rotate"].includes(k),
    );
    if (!poseOnly) {
      const { img: _img, ...safe } = patch as Partial<Layer> & { img?: unknown };
      emitOp({ type: "patch", id, patch: safe });
    }
  }

  function addImage(file: File) {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const fit = Math.min(W / img.naturalWidth, H / img.naturalHeight);
      const layer: ImageLayer = {
        id: nid(),
        kind: "image",
        name: "",
        img,
        x: W / 2,
        y: H / 2,
        scaleX: fit,
        scaleY: fit,
        rotate: 0,
        w: img.naturalWidth,
        h: img.naturalHeight,
        opacity: 1,
        keyColor: null,
        keyTolerance: 18,
      };
      touchLocal();
      setLayers((ls) => [...ls, layer]);
      setSelected(layer.id);
      void serializeLayer(layer).then((wire) => emitOp({ type: "add", layer: wire }));
    };
    img.src = url;
  }

  function addText() {
    const layer: TextLayer = {
      id: nid(),
      kind: "text",
      name: "",
      text: "テキスト",
      color: "#eef0f4",
      x: W / 2,
      y: H / 2,
      scaleX: 1.4,
      scaleY: 1.4,
      rotate: 0,
      w: 120,
      h: 40,
      opacity: 1,
      strokeWidth: 0,
      strokeColor: "#111318",
      strokeOpacity: 1,
      shadowBlur: 0,
      shadowColor: "#000000",
      shadowOpacity: 0.65,
      shadowX: 2,
      shadowY: 2,
    };
    touchLocal();
    setLayers((ls) => [...ls, layer]);
    setSelected(layer.id);
    void serializeLayer(layer).then((wire) => emitOp({ type: "add", layer: wire }));
  }

  function addGuide(shape: GuideShape) {
    const layer: GuideLayer = {
      id: nid(),
      kind: "guide",
      name: "",
      shape,
      x: W / 2,
      y: H / 2,
      scaleX: 1,
      scaleY: 1,
      rotate: 0,
      w: shape === "vline" ? 12 : 180,
      h: shape === "hline" ? 12 : 180,
    };
    touchLocal();
    setLayers((ls) => [...ls, layer]);
    setSelected(layer.id);
    void serializeLayer(layer).then((wire) => emitOp({ type: "add", layer: wire }));
  }

  function fitSelected() {
    if (!selectedLayer) return;
    if (selectedLayer.kind === "image") {
      const fit = Math.max(W / selectedLayer.w, H / selectedLayer.h);
      updateLayer(selectedLayer.id, { scaleX: fit, scaleY: fit, x: W / 2, y: H / 2, rotate: 0 });
      return;
    }
    if (selectedLayer.kind === "guide") {
      updateLayer(selectedLayer.id, { scaleX: 1, scaleY: 1, x: W / 2, y: H / 2, rotate: 0 });
    }
  }

  function moveZ(dir: "top" | "up" | "down" | "bottom") {
    if (!selected) return;
    touchLocal();
    const ls = layersRef.current;
    const i = ls.findIndex((l) => l.id === selected);
    if (i < 0) return;
    const next = [...ls];
    const [item] = next.splice(i, 1);
    if (dir === "top") next.push(item);
    else if (dir === "bottom") next.unshift(item);
    else if (dir === "up") next.splice(Math.min(i + 1, next.length), 0, item);
    else next.splice(Math.max(i - 1, 0), 0, item);
    setLayers(next);
    emitOp({ type: "reorder", ids: next.map((l) => l.id) });
  }

  function canvasPoint(e: React.PointerEvent | PointerEvent | React.WheelEvent): {
    x: number;
    y: number;
  } {
    const canvas = canvasRef.current!;
    const r = canvas.getBoundingClientRect();
    const cx = "clientX" in e ? e.clientX : 0;
    const cy = "clientY" in e ? e.clientY : 0;
    return {
      x: ((cx - r.left) / r.width) * sizeRef.current.w,
      y: ((cy - r.top) / r.height) * sizeRef.current.h,
    };
  }

  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    const p = canvasPoint(e);
    if (picking) {
      const target =
        (selectedLayer?.kind === "image" ? selectedLayer : null) ??
        [...layers].reverse().find((l): l is ImageLayer => l.kind === "image" && hitTest(l, p.x, p.y));
      if (!target) {
        toast.error("画像の上をクリックして色を拾ってください");
        return;
      }
      const color = sampleLayerColor(target, p.x, p.y);
      if (!color) {
        toast.error("その位置の色が取れませんでした");
        return;
      }
      updateLayer(target.id, { keyColor: color });
      setSelected(target.id);
      setPicking(false);
      toast.success(`透明色に設定 ${color.toUpperCase()}`);
      return;
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    if (selectedLayer) {
      const handle = hitHandle(selectedLayer, p.x, p.y, 16);
      if (handle === "rot") {
        drag.current = {
          mode: "rotate",
          id: selectedLayer.id,
          startAngle: Math.atan2(p.y - selectedLayer.y, p.x - selectedLayer.x),
          startRotate: selectedLayer.rotate,
        };
        return;
      }
      if (handle) {
        const local = localPoint(selectedLayer, p.x, p.y);
        drag.current = {
          mode: "scale",
          id: selectedLayer.id,
          handle,
          startSX: selectedLayer.scaleX,
          startSY: selectedLayer.scaleY,
          startLX: local.x || 1,
          startLY: local.y || 1,
          lock: lockAspect,
        };
        return;
      }
    }
    let hit: Layer | undefined;
    for (let i = layers.length - 1; i >= 0; i--) {
      if (hitTest(layers[i], p.x, p.y)) {
        hit = layers[i];
        break;
      }
    }
    const id = hit?.id ?? selected;
    if (hit) setSelected(hit.id);
    const layer = layers.find((l) => l.id === id);
    if (layer) drag.current = { mode: "move", id: layer.id, ox: p.x - layer.x, oy: p.y - layer.y };
  }

  function onPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    const p = canvasPoint(e);
    collab?.sendCursor(p.x, p.y);
    if (!drag.current) return;
    const moving = layersRef.current.find((l) => l.id === drag.current!.id);
    if (!moving) return;

    if (drag.current.mode === "rotate") {
      const angle = Math.atan2(p.y - moving.y, p.x - moving.x);
      const deg = drag.current.startRotate + ((angle - drag.current.startAngle) * 180) / Math.PI;
      updateLayer(moving.id, { rotate: deg });
      collab?.sendLive({
        id: moving.id,
        x: moving.x,
        y: moving.y,
        scaleX: moving.scaleX,
        scaleY: moving.scaleY,
        rotate: deg,
      });
      return;
    }

    if (drag.current.mode === "scale") {
      const local = localPoint(moving, p.x, p.y);
      const h = drag.current.handle;
      const affectX = h.includes("e") || h.includes("w") || h === "nw" || h === "ne" || h === "sw" || h === "se";
      const affectY = h.includes("n") || h.includes("s") || h === "nw" || h === "ne" || h === "sw" || h === "se";
      // n/s/e/w already covered: n and s are only y, e and w only x
      const onlyX = h === "e" || h === "w";
      const onlyY = h === "n" || h === "s";
      let nextX = drag.current.startSX;
      let nextY = drag.current.startSY;
      const rx = Math.abs(drag.current.startLX) < 1 ? 1 : local.x / drag.current.startLX;
      const ry = Math.abs(drag.current.startLY) < 1 ? 1 : local.y / drag.current.startLY;
      if (drag.current.lock && !onlyX && !onlyY) {
        const f = Math.abs(Math.abs(rx) > Math.abs(ry) ? rx : ry);
        nextX = clampScale(drag.current.startSX * f);
        nextY = clampScale(drag.current.startSY * f);
      } else if (drag.current.lock && onlyX) {
        nextX = clampScale(drag.current.startSX * Math.abs(rx));
        nextY = clampScale(drag.current.startSY * Math.abs(rx));
      } else if (drag.current.lock && onlyY) {
        nextX = clampScale(drag.current.startSX * Math.abs(ry));
        nextY = clampScale(drag.current.startSY * Math.abs(ry));
      } else {
        if (affectX && !onlyY) nextX = clampScale(drag.current.startSX * Math.abs(rx));
        if (affectY && !onlyX) nextY = clampScale(drag.current.startSY * Math.abs(ry));
        if (onlyX) nextX = clampScale(drag.current.startSX * Math.abs(rx));
        if (onlyY) nextY = clampScale(drag.current.startSY * Math.abs(ry));
      }
      updateLayer(moving.id, { scaleX: nextX, scaleY: nextY });
      collab?.sendLive({
        id: moving.id,
        x: moving.x,
        y: moving.y,
        scaleX: nextX,
        scaleY: nextY,
        rotate: moving.rotate,
      });
      return;
    }

    const rawX = p.x - drag.current.ox;
    const rawY = p.y - drag.current.oy;
    const snapped = snapMove(
      moving,
      rawX,
      rawY,
      layersRef.current,
      sizeRef.current.w,
      sizeRef.current.h,
    );
    setSnap({ v: snapped.v, h: snapped.h });
    updateLayer(drag.current.id, { x: snapped.x, y: snapped.y });
    const live = layersRef.current.find((l) => l.id === drag.current!.id);
    if (live) {
      collab?.sendLive({
        id: live.id,
        x: snapped.x,
        y: snapped.y,
        scaleX: live.scaleX,
        scaleY: live.scaleY,
        rotate: live.rotate,
      });
    }
  }

  function onPointerUp() {
    drag.current = null;
    pinch.current = null;
    setSnap({ v: [], h: [] });
  }

  function onWheel(e: React.WheelEvent<HTMLCanvasElement>) {
    if (!selectedLayer) return;
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.08 : 0.92;
    if (lockAspect) {
      updateLayer(selectedLayer.id, {
        scaleX: clampScale(selectedLayer.scaleX * factor),
        scaleY: clampScale(selectedLayer.scaleY * factor),
      });
    } else {
      updateLayer(selectedLayer.id, {
        scaleX: clampScale(selectedLayer.scaleX * factor),
        scaleY: clampScale(selectedLayer.scaleY * factor),
      });
    }
  }

  function onTouchStart(e: React.TouchEvent<HTMLCanvasElement>) {
    if (e.touches.length === 2 && selectedLayer) {
      const [a, b] = [e.touches[0], e.touches[1]];
      const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      pinch.current = { dist, scaleX: selectedLayer.scaleX, scaleY: selectedLayer.scaleY };
    }
  }

  function onTouchMove(e: React.TouchEvent<HTMLCanvasElement>) {
    if (e.touches.length === 2 && pinch.current && selected) {
      e.preventDefault();
      const [a, b] = [e.touches[0], e.touches[1]];
      const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      const f = dist / pinch.current.dist;
      updateLayer(selected, {
        scaleX: clampScale(pinch.current.scaleX * f),
        scaleY: clampScale(pinch.current.scaleY * f),
      });
    }
  }

  function paintExport(ctx: CanvasRenderingContext2D, format: "jpeg" | "png") {
    if (format === "jpeg" || bg) {
      ctx.fillStyle = bg || "#0a0b0d";
      ctx.fillRect(0, 0, W, H);
    } else {
      ctx.clearRect(0, 0, W, H);
    }
    for (const layer of layers) drawLayer(ctx, layer);
  }

  function exportBlob(format: "jpeg" | "png" = "png"): Promise<Blob | null> {
    const off = document.createElement("canvas");
    off.width = W;
    off.height = H;
    const ctx = off.getContext("2d");
    if (!ctx) return Promise.resolve(null);
    paintExport(ctx, format);
    const type = format === "png" ? "image/png" : "image/jpeg";
    return new Promise((resolve) => {
      off.toBlob((blob) => resolve(blob), type, 0.92);
    });
  }

  function isIosLike() {
    if (typeof navigator === "undefined") return false;
    return (
      /iP(hone|ad|od)/i.test(navigator.userAgent) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
    );
  }

  function closePreview() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
  }

  async function download() {
    const filename = `${preset.id}-${W}x${H}.png`;
    const blob = await exportBlob("png");
    if (!blob) {
      toast.error("書き出しに失敗しました");
      return;
    }
    const file = new File([blob], filename, { type: "image/png" });
    if (onExported) {
      const dataUrl = await new Promise<string>((resolve) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result || ""));
        r.readAsDataURL(blob);
      });
      onExported(blob, { width: W, height: H, dataUrl });
    }
    const shareData: ShareData = { files: [file], title: filename };
    if (typeof navigator.canShare === "function" && navigator.canShare(shareData)) {
      try {
        await navigator.share(shareData);
        toast.success("共有から「画像を保存」できます");
        return;
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return;
      }
    }

    const url = URL.createObjectURL(blob);
    if (isIosLike()) {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPreviewUrl(url);
      toast.message("画像を長押しして「写真に追加」してください");
      return;
    }

    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 4000);
    toast.success(`PNGをダウンロードしました（${W}×${H}）`);
  }

  async function registerAsMaterial() {
    const blob = await exportBlob("png");
    if (!blob || !onRegisterMaterial) {
      toast.error("書き出しに失敗しました");
      return;
    }
    const dataUrl = await new Promise<string>((resolve) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result || ""));
      r.readAsDataURL(blob);
    });
    onRegisterMaterial({ width: W, height: H, dataUrl });
  }

  if (!open) return null;

  const isPage = variant === "page";

  const body = (
    <div
      className={cn(
        "flex w-full flex-col bg-bg-elevated",
        isPage
          ? "rounded-[var(--radius-xl)] border border-border"
          : "max-h-dvh overflow-hidden max-w-2xl sm:rounded-[var(--radius-xl)] sm:border sm:border-border",
      )}
    >
      {!isPage && (
        <header className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
          <div>
            <p className="text-[10px] tracking-widest text-fg-subtle">ICON EDITOR</p>
            <h2 id="icon-editor-title" className="text-base font-semibold">
              アイコンエディタ
            </h2>
            <p className="text-xs text-fg-subtle">ログイン不要 · 300×300 · ガイドに吸い付きます</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid size-11 place-items-center rounded-[var(--radius-md)] text-fg-muted hover:bg-bg-subtle hover:text-fg"
            aria-label="閉じる"
          >
            <X className="size-5" />
          </button>
        </header>
      )}

      {isPage && (
        <header className="border-b border-border px-4 py-3">
          <p className="text-xs text-fg-muted">
            ガイドは書き出しに出ません。画像や文字を近づけると辺・中央に吸い付きます。
          </p>
        </header>
      )}

      <div
        className={cn(
          "px-4 py-4",
          isPage ? "" : "min-h-0 flex-1 overflow-y-auto",
        )}
      >
        {enableCollab && (
          <div
            ref={collabPinRef}
            className={cn(
              "mx-auto mb-3 w-full max-w-[20rem] sm:max-w-none",
              pinCollab &&
                "sticky z-40 -mx-4 border-b border-border bg-bg-elevated/95 px-4 py-2 backdrop-blur-md",
            )}
            style={
              pinCollab
                ? { top: "var(--grok-banner-h, 0px)" }
                : undefined
            }
          >
            <div className="rounded-[var(--radius-md)] border border-border bg-bg-subtle p-2">
              <div className="flex items-center gap-2">
                <Users className="size-3.5 shrink-0 text-primary" />
                <span className="text-xs font-medium">みんなで編集</span>
                {room && (
                  <span className="text-[11px] text-primary">
                    {role === "host" ? "ホスト" : "参加中"}
                  </span>
                )}
                <label className="ml-auto flex shrink-0 items-center gap-1.5 text-[11px] text-fg-muted">
                  <input
                    type="checkbox"
                    checked={pinCollab}
                    onChange={togglePinCollab}
                    className="size-4 accent-[var(--color-primary)]"
                  />
                  追従
                </label>
              </div>
              {room ? (
                <div className="mt-2 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-sm text-primary">{room}</span>
                    <Button type="button" size="sm" variant="outline" onClick={() => collab?.rejoin()}>
                      再接続
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setIssuedUrl("");
                        onRoomChange?.(null);
                      }}
                    >
                      退出
                    </Button>
                  </div>
                  {collab && <CollabRoster seats={collab.roster} joined={collab.joined} />}
                  {role === "host" && (
                    <div className="space-y-1.5">
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => {
                          const url = inviteUrl(room);
                          setIssuedUrl(url);
                          void navigator.clipboard.writeText(url).then(
                            () => toast.success("招待URLを発行してコピーしました"),
                            () => toast.message(url),
                          );
                        }}
                      >
                        <Link2 className="size-3.5" />
                        招待URLを発行
                      </Button>
                      {issuedUrl && (
                        <button
                          type="button"
                          className="block w-full truncate text-left font-mono text-[11px] text-primary"
                          onClick={() => {
                            void navigator.clipboard.writeText(issuedUrl).then(
                              () => toast.success("招待URLをコピーしました"),
                              () => toast.message(issuedUrl),
                            );
                          }}
                        >
                          {issuedUrl}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => {
                      const code = makeRoomCode();
                      try {
                        sessionStorage.setItem(`canvas-host-${code}`, "1");
                      } catch {
                        /* ignore */
                      }
                      setRole("host");
                      onRoomChange?.(code);
                      setIssuedUrl(inviteUrl(code));
                    }}
                  >
                    部屋をつくる
                  </Button>
                  <Input
                    value={joinInput}
                    onChange={(e) => setJoinInput(e.target.value.toUpperCase())}
                    placeholder="部屋コード"
                    className="h-9 max-w-[8rem] font-mono"
                    maxLength={16}
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={!normalizeRoom(joinInput)}
                    onClick={() => {
                      const code = normalizeRoom(joinInput);
                      if (!code) return;
                      setRole("peer");
                      onRoomChange?.(code);
                    }}
                  >
                    入る
                  </Button>
                </div>
              )}
              <p className="mt-1 text-[11px] text-fg-subtle">
                ホストが招待URLを発行すると、相手はそのリンクからそのまま部屋に入れます。
              </p>
            </div>
          </div>
        )}

        <div
          className={cn(
            "mx-auto grid place-items-center",
            pinCanvas &&
              "sticky z-30 -mx-4 border-b border-border bg-bg-elevated/95 px-4 py-2 backdrop-blur-md",
          )}
          style={
            pinCanvas
              ? {
                  top: `calc(var(--grok-banner-h, 0px)${
                    pinCollab && enableCollab ? ` + ${collabH}px` : ""
                  })`,
                }
              : undefined
          }
        >
          <label className="mb-1.5 flex items-center gap-2 text-xs text-fg-muted">
            <input
              type="checkbox"
              checked={pinCanvas}
              onChange={togglePinCanvas}
              className="size-4 accent-[var(--color-primary)]"
            />
            キャンバスをスクロールに追従
          </label>
          <div className="relative rounded-[var(--radius-md)] border border-border-strong bg-bg p-2 sm:p-3">
            <canvas
              ref={canvasRef}
              width={W}
              height={H}
              className={cn(
                "touch-none",
                picking ? "cursor-crosshair" : "cursor-grab active:cursor-grabbing",
              )}
              style={{
                width: "100%",
                height: "auto",
                maxWidth:
                  pinCanvas && narrow ? (W / H > 1.4 ? 280 : 176) : W / H > 1.4 ? 560 : 300,
                maxHeight: pinCanvas && narrow ? "32vh" : undefined,
                aspectRatio: `${W} / ${H}`,
              }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              onWheel={onWheel}
              onTouchStart={onTouchStart}
              onTouchMove={onTouchMove}
            />
            <div className="pointer-events-none absolute inset-2 rounded-[var(--radius-sm)] ring-2 ring-fg/80 ring-offset-0 sm:inset-3" />
          </div>
          <p className="mt-1.5 text-center text-[11px] text-fg-subtle">
            {picking
              ? "画像の上をクリックして、透明にしたい色を拾います"
              : "角で拡大 · 辺で縦または横だけ · 丸で回転 · ガイドに吸着"}
          </p>
        </div>

        <div className="mt-4">
          <p className="mb-1.5 text-xs font-medium text-fg-subtle">
            書き出しサイズ
            {room && !hostOnly && (
              <span className="ml-2 font-normal text-fg-subtle/80">ホストのみ変更可</span>
            )}
          </p>
          <div className="grid grid-cols-2 gap-2">
            {presets.map((p) => (
              <Button
                key={p.id}
                type="button"
                size="sm"
                variant={presetId === p.id ? "secondary" : "outline"}
                disabled={!hostOnly && presetId !== p.id}
                onClick={() => {
                  if (!hostOnly) return;
                  touchLocal();
                  setPresetId(p.id);
                  emitOp({ type: "preset", presetId: p.id });
                }}
              >
                {p.label}
              </Button>
            ))}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) addImage(f);
              e.target.value = "";
            }}
          />
          <Button type="button" variant="secondary" size="sm" onClick={() => fileRef.current?.click()}>
            <ImagePlus className="size-3.5" />
            画像
          </Button>
          <Button type="button" variant="secondary" size="sm" onClick={addText}>
            <Type className="size-3.5" />
            文字
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              if (!hostOnly) {
                toast.message("全消去はホストだけできます");
                return;
              }
              setLayers([]);
              setSelected(null);
              touchLocal();
              emitOp({ type: "clear" });
            }}
            disabled={!!room && !hostOnly}
          >
            全消去
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={fitSelected}
            disabled={!selectedLayer || selectedLayer.kind === "text"}
          >
            枠にフィット
          </Button>
        </div>

        <div className="mt-3">
          <p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-fg-subtle">
            <Magnet className="size-3.5" aria-hidden />
            レイアウト用ガイド（書き出しなし）
          </p>
          <div className="grid grid-cols-4 gap-1">
            <Button type="button" variant="outline" size="sm" onClick={() => addGuide("box")}>
              <BoxSelect className="size-3.5" />
              枠
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => addGuide("hline")}>
              横線
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => addGuide("vline")}>
              縦線
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => addGuide("cross")}>
              十字
            </Button>
          </div>
        </div>

        <div className="mt-4">
          <p className="mb-1.5 text-xs font-medium text-fg-subtle">
            背景
            <span className="ml-2 font-normal text-fg-subtle/80">
              {room && !hostOnly ? "ホストのみ変更可" : "なし＝透過PNG"}
            </span>
          </p>
          <div className="flex flex-wrap gap-2">
            {backgrounds.map((b) => (
              <button
                key={b.id}
                type="button"
                disabled={!hostOnly && bg !== b.color}
                onClick={() => {
                  if (!hostOnly) return;
                  touchLocal();
                  setBg(b.color);
                  emitOp({ type: "bg", bg: b.color });
                }}
                className={cn(
                  "min-h-11 rounded-[var(--radius-md)] border px-3 text-xs font-medium",
                  bg === b.color ? "border-primary text-primary" : "border-border text-fg-muted",
                  !hostOnly && bg !== b.color && "opacity-50",
                  !b.color &&
                    "bg-[repeating-conic-gradient(#2a2c31_0%_25%,#17181c_0%_50%)] bg-[length:12px_12px]",
                )}
                style={b.color ? { background: b.color } : undefined}
              >
                {b.label}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-4">
          <p className="mb-1.5 text-xs font-medium text-fg-subtle">
            レイヤー
            <span className="ml-2 font-normal text-fg-subtle/80">ダブルタップで名前変更</span>
          </p>
          {layers.length === 0 ? (
            <p className="text-xs text-fg-subtle">（レイヤーなし）</p>
          ) : (
            <ul className="space-y-1">
              {[...layers].reverse().map((l) => (
                <li key={l.id}>
                  {renamingId === l.id ? (
                    <Input
                      ref={renameRef}
                      value={renameValue}
                      maxLength={24}
                      aria-label="レイヤー名"
                      className="h-11"
                      onChange={(e) => setRenameValue(e.target.value)}
                      onBlur={commitRename}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          commitRename();
                        } else if (e.key === "Escape") {
                          e.preventDefault();
                          cancelRename();
                        }
                      }}
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => onLayerActivate(l)}
                      className={cn(
                        "flex min-h-11 w-full items-center justify-between rounded-[var(--radius-md)] border px-3 text-left text-sm",
                        selected === l.id
                          ? "border-primary bg-primary/10 text-fg"
                          : "border-border bg-bg-subtle text-fg-muted",
                      )}
                    >
                      <span className="truncate">{layerLabel(l)}</span>
                      {selected === l.id && (
                        <span className="text-[10px] text-primary">選択中</span>
                      )}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          <div className="mt-2 grid grid-cols-4 gap-1">
            <Button type="button" variant="outline" size="sm" onClick={() => moveZ("bottom")}>
              <ChevronsDown className="size-3.5" />
              最下
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => moveZ("down")}>
              <ArrowDown className="size-3.5" />
              下
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => moveZ("up")}>
              <ArrowUp className="size-3.5" />
              上
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => moveZ("top")}>
              <ChevronsUp className="size-3.5" />
              最上
            </Button>
          </div>
        </div>

        {selectedLayer && (
          <div className="mt-4 rounded-[var(--radius-lg)] border border-border bg-bg-subtle/50 p-3">
            <p className="mb-2 text-xs font-medium text-fg-subtle">選択中のレイヤー</p>
            {selectedLayer.kind === "text" && (
              <div className="mb-3 space-y-3">
                <div className="grid gap-2 sm:grid-cols-[1fr_5.5rem]">
                  <Input
                    value={selectedLayer.text}
                    onChange={(e) => updateLayer(selectedLayer.id, { text: e.target.value })}
                    maxLength={24}
                  />
                  <input
                    type="color"
                    value={selectedLayer.color}
                    onChange={(e) => updateLayer(selectedLayer.id, { color: e.target.value })}
                    className="h-11 w-full cursor-pointer rounded-[var(--radius-md)] border border-border bg-bg"
                    aria-label="文字色"
                  />
                </div>
                <div className="rounded-[var(--radius-md)] border border-border bg-bg px-3 py-2">
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span className="text-[11px] font-medium text-fg-subtle">縁取り</span>
                    <input
                      type="color"
                      value={selectedLayer.strokeColor}
                      onChange={(e) => updateLayer(selectedLayer.id, { strokeColor: e.target.value })}
                      className="h-9 w-12 cursor-pointer rounded-[var(--radius-sm)] border border-border bg-bg"
                      aria-label="縁取り色"
                    />
                  </div>
                  <label className="block">
                    <span className="mb-1 flex items-center justify-between text-[11px] text-fg-subtle">
                      <span>太さ</span>
                      <span>{selectedLayer.strokeWidth}px</span>
                    </span>
                    <input
                      type="range"
                      min={0}
                      max={20}
                      value={selectedLayer.strokeWidth}
                      onChange={(e) =>
                        updateLayer(selectedLayer.id, { strokeWidth: Number(e.target.value) })
                      }
                      className="h-11 w-full accent-[var(--color-primary)]"
                      aria-label="縁取りの太さ"
                    />
                  </label>
                  <label className="mt-1 block">
                    <span className="mb-1 flex items-center justify-between text-[11px] text-fg-subtle">
                      <span>透明度</span>
                      <span>{Math.round((selectedLayer.strokeOpacity ?? 1) * 100)}%</span>
                    </span>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={Math.round((selectedLayer.strokeOpacity ?? 1) * 100)}
                      onChange={(e) =>
                        updateLayer(selectedLayer.id, {
                          strokeOpacity: Number(e.target.value) / 100,
                        })
                      }
                      className="h-11 w-full accent-[var(--color-primary)]"
                      aria-label="縁取りの透明度"
                    />
                  </label>
                </div>
                <div className="rounded-[var(--radius-md)] border border-border bg-bg px-3 py-2">
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span className="text-[11px] font-medium text-fg-subtle">影</span>
                    <input
                      type="color"
                      value={selectedLayer.shadowColor}
                      onChange={(e) => updateLayer(selectedLayer.id, { shadowColor: e.target.value })}
                      className="h-9 w-12 cursor-pointer rounded-[var(--radius-sm)] border border-border bg-bg"
                      aria-label="影の色"
                    />
                  </div>
                  <label className="block">
                    <span className="mb-1 flex items-center justify-between text-[11px] text-fg-subtle">
                      <span>ぼかし</span>
                      <span>{selectedLayer.shadowBlur}px</span>
                    </span>
                    <input
                      type="range"
                      min={0}
                      max={32}
                      value={selectedLayer.shadowBlur}
                      onChange={(e) =>
                        updateLayer(selectedLayer.id, { shadowBlur: Number(e.target.value) })
                      }
                      className="h-11 w-full accent-[var(--color-primary)]"
                      aria-label="影のぼかし"
                    />
                  </label>
                  <label className="mt-1 block">
                    <span className="mb-1 flex items-center justify-between text-[11px] text-fg-subtle">
                      <span>透明度</span>
                      <span>{Math.round((selectedLayer.shadowOpacity ?? 1) * 100)}%</span>
                    </span>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={Math.round((selectedLayer.shadowOpacity ?? 1) * 100)}
                      onChange={(e) =>
                        updateLayer(selectedLayer.id, {
                          shadowOpacity: Number(e.target.value) / 100,
                        })
                      }
                      className="h-11 w-full accent-[var(--color-primary)]"
                      aria-label="影の透明度"
                    />
                  </label>
                  <div className="mt-1 grid grid-cols-2 gap-2">
                    <label className="block">
                      <span className="mb-1 flex items-center justify-between text-[11px] text-fg-subtle">
                        <span>横</span>
                        <span>{selectedLayer.shadowX}</span>
                      </span>
                      <input
                        type="range"
                        min={-20}
                        max={20}
                        value={selectedLayer.shadowX}
                        onChange={(e) =>
                          updateLayer(selectedLayer.id, { shadowX: Number(e.target.value) })
                        }
                        className="h-11 w-full accent-[var(--color-primary)]"
                        aria-label="影の横位置"
                      />
                    </label>
                    <label className="block">
                      <span className="mb-1 flex items-center justify-between text-[11px] text-fg-subtle">
                        <span>縦</span>
                        <span>{selectedLayer.shadowY}</span>
                      </span>
                      <input
                        type="range"
                        min={-20}
                        max={20}
                        value={selectedLayer.shadowY}
                        onChange={(e) =>
                          updateLayer(selectedLayer.id, { shadowY: Number(e.target.value) })
                        }
                        className="h-11 w-full accent-[var(--color-primary)]"
                        aria-label="影の縦位置"
                      />
                    </label>
                  </div>
                </div>
              </div>
            )}
            {selectedLayer.kind === "guide" && (
              <div className="mb-2 grid grid-cols-4 gap-1">
                {(["box", "hline", "vline", "cross"] as const).map((shape) => (
                  <Button
                    key={shape}
                    type="button"
                    size="sm"
                    variant={selectedLayer.shape === shape ? "secondary" : "outline"}
                    onClick={() => updateLayer(selectedLayer.id, { shape })}
                  >
                    {GUIDE_LABEL[shape]}
                  </Button>
                ))}
              </div>
            )}
            {selectedLayer.kind !== "guide" && (
              <label className="mb-3 block">
                <span className="mb-1 flex items-center justify-between text-[11px] text-fg-subtle">
                  <span>透明度</span>
                  <span>{Math.round((selectedLayer.opacity ?? 1) * 100)}%</span>
                </span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={Math.round((selectedLayer.opacity ?? 1) * 100)}
                  onChange={(e) =>
                    updateLayer(selectedLayer.id, { opacity: Number(e.target.value) / 100 })
                  }
                  className="h-11 w-full accent-[var(--color-primary)]"
                  aria-label="透明度"
                />
              </label>
            )}
            {selectedLayer.kind === "image" && (
              <div className="mb-3 rounded-[var(--radius-md)] border border-border bg-bg px-3 py-2">
                <p className="mb-2 text-[11px] font-medium text-fg-subtle">
                  指定色を透明にする（JPEGなど透過なし向け）
                </p>
                <div className="mb-2 flex items-center gap-2">
                  <input
                    type="color"
                    value={selectedLayer.keyColor ?? "#ffffff"}
                    onChange={(e) => updateLayer(selectedLayer.id, { keyColor: e.target.value })}
                    className="h-11 w-14 cursor-pointer rounded-[var(--radius-md)] border border-border bg-bg"
                    aria-label="透明にする色"
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant={picking ? "secondary" : "outline"}
                    onClick={() => setPicking((v) => !v)}
                  >
                    <Pipette className="size-3.5" />
                    {picking ? "クリックして拾う" : "スポイト"}
                  </Button>
                  {selectedLayer.keyColor && (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        updateLayer(selectedLayer.id, { keyColor: null });
                        setPicking(false);
                      }}
                    >
                      解除
                    </Button>
                  )}
                </div>
                {selectedLayer.keyColor && (
                  <p className="mb-1 font-mono text-[11px] text-fg-muted">
                    {selectedLayer.keyColor.toUpperCase()}
                  </p>
                )}
                <label className="block">
                  <span className="mb-1 flex items-center justify-between text-[11px] text-fg-subtle">
                    <span>色の誤差</span>
                    <span>{selectedLayer.keyTolerance}</span>
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={80}
                    value={selectedLayer.keyTolerance}
                    onChange={(e) =>
                      updateLayer(selectedLayer.id, { keyTolerance: Number(e.target.value) })
                    }
                    className="h-11 w-full accent-[var(--color-primary)]"
                    aria-label="色の誤差"
                  />
                </label>
              </div>
            )}
            <div className="mb-3 rounded-[var(--radius-md)] border border-border bg-bg px-3 py-2">
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-[11px] font-medium text-fg-subtle">拡大縮小・回転</span>
                <button
                  type="button"
                  onClick={() => setLockAspect((v) => !v)}
                  className={cn(
                    "inline-flex min-h-11 items-center gap-1.5 rounded-[var(--radius-md)] border px-3 text-xs",
                    lockAspect
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-fg-muted",
                  )}
                >
                  {lockAspect ? <Link2 className="size-3.5" /> : <Unlink2 className="size-3.5" />}
                  縦横比を維持 {lockAspect ? "ON" : "OFF"}
                </button>
              </div>
              <label className="block">
                <span className="mb-1 flex items-center justify-between text-[11px] text-fg-subtle">
                  <span>横</span>
                  <span>{selectedLayer.scaleX.toFixed(2)}</span>
                </span>
                <input
                  type="range"
                  min={5}
                  max={800}
                  value={Math.round(selectedLayer.scaleX * 100)}
                  onChange={(e) => {
                    const next = clampScale(Number(e.target.value) / 100);
                    if (lockAspect) {
                      const f = next / selectedLayer.scaleX;
                      updateLayer(selectedLayer.id, {
                        scaleX: next,
                        scaleY: clampScale(selectedLayer.scaleY * f),
                      });
                    } else {
                      updateLayer(selectedLayer.id, { scaleX: next });
                    }
                  }}
                  className="h-11 w-full accent-[var(--color-primary)]"
                  aria-label="横方向の拡大"
                />
              </label>
              <label className="mt-1 block">
                <span className="mb-1 flex items-center justify-between text-[11px] text-fg-subtle">
                  <span>縦</span>
                  <span>{selectedLayer.scaleY.toFixed(2)}</span>
                </span>
                <input
                  type="range"
                  min={5}
                  max={800}
                  value={Math.round(selectedLayer.scaleY * 100)}
                  onChange={(e) => {
                    const next = clampScale(Number(e.target.value) / 100);
                    if (lockAspect) {
                      const f = next / selectedLayer.scaleY;
                      updateLayer(selectedLayer.id, {
                        scaleY: next,
                        scaleX: clampScale(selectedLayer.scaleX * f),
                      });
                    } else {
                      updateLayer(selectedLayer.id, { scaleY: next });
                    }
                  }}
                  className="h-11 w-full accent-[var(--color-primary)]"
                  aria-label="縦方向の拡大"
                />
              </label>
              <label className="mt-1 block">
                <span className="mb-1 flex items-center justify-between text-[11px] text-fg-subtle">
                  <span>回転</span>
                  <span>{Math.round(selectedLayer.rotate)}°</span>
                </span>
                <input
                  type="range"
                  min={-180}
                  max={180}
                  value={normDeg(selectedLayer.rotate)}
                  onChange={(e) =>
                    updateLayer(selectedLayer.id, { rotate: Number(e.target.value) })
                  }
                  className="h-11 w-full accent-[var(--color-primary)]"
                  aria-label="回転"
                />
              </label>
            </div>
            <div className="flex flex-wrap gap-1">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  updateLayer(selectedLayer.id, {
                    scaleX: clampScale(selectedLayer.scaleX * 0.9),
                    scaleY: clampScale(selectedLayer.scaleY * 0.9),
                  })
                }
              >
                <ZoomOut className="size-3.5" />
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  updateLayer(selectedLayer.id, {
                    scaleX: clampScale(selectedLayer.scaleX * 1.1),
                    scaleY: clampScale(selectedLayer.scaleY * 1.1),
                  })
                }
              >
                <ZoomIn className="size-3.5" />
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  updateLayer(selectedLayer.id, { rotate: selectedLayer.rotate - 15 })
                }
              >
                <RotateCcw className="size-3.5" />
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  updateLayer(selectedLayer.id, { rotate: selectedLayer.rotate + 15 })
                }
              >
                <RotateCw className="size-3.5" />
              </Button>
              <Button
                type="button"
                variant="danger"
                size="sm"
                onClick={() => {
                  touchLocal();
                  setLayers((ls) => ls.filter((l) => l.id !== selectedLayer.id));
                  setSelected(null);
                  emitOp({ type: "remove", id: selectedLayer.id });
                }}
              >
                <Trash2 className="size-3.5" />
                削除
              </Button>
            </div>
            <p className="mt-2 text-[11px] text-fg-subtle">
              横 {selectedLayer.scaleX.toFixed(2)} · 縦 {selectedLayer.scaleY.toFixed(2)} · 回転{" "}
              {Math.round(selectedLayer.rotate)}°
              {selectedLayer.kind === "guide" ? " · 保存時は消えます" : ""}
            </p>
          </div>
        )}
      </div>

      <footer className="flex flex-col gap-2 border-t border-border px-4 py-3">
        <div className="flex gap-2">
          <Button type="button" className="flex-1" onClick={() => void download()}>
            <Share2 className="size-4 sm:hidden" />
            <Download className="hidden size-4 sm:block" />
            {narrow ? "保存" : bg ? "PNGを保存" : "透過PNGを保存"}
          </Button>
          {onRegisterMaterial && (
            <Button type="button" variant="secondary" onClick={() => void registerAsMaterial()}>
              素材登録
            </Button>
          )}
        </div>
        <p className="text-center text-[11px] text-fg-subtle">
          素材登録はログイン済みのチケット1枚。外部ストレージ設定があるときだけ送れます。
        </p>
        {!isPage && onClose && (
          <Button type="button" variant="ghost" className="w-full" onClick={onClose}>
            閉じる
          </Button>
        )}
      </footer>
    </div>
  );

  const preview = previewUrl ? (
    <div
      className="fixed inset-0 z-[90] flex flex-col items-center justify-center gap-3 bg-bg/90 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal
      aria-label="保存用プレビュー"
    >
      <p className="text-center text-sm text-fg">
        画像を長押しして「写真に追加」してください
      </p>
      <img
        src={previewUrl}
        alt="書き出した画像"
        className="max-h-[62dvh] w-auto max-w-full rounded-[var(--radius-md)] border border-border bg-[repeating-conic-gradient(#2a2c31_0%_25%,#17181c_0%_50%)] bg-[length:16px_16px]"
      />
      <div className="flex w-full max-w-sm gap-2">
        <Button type="button" className="flex-1" onClick={() => void download()}>
          <Share2 className="size-4" />
          共有
        </Button>
        <Button type="button" variant="outline" className="flex-1" onClick={closePreview}>
          閉じる
        </Button>
      </div>
    </div>
  ) : null;

  if (isPage) {
    return (
      <>
        {body}
        {preview}
      </>
    );
  }

  return (
    <div
      className="fixed inset-0 z-[80] flex items-end justify-center bg-bg/80 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      role="dialog"
      aria-modal
      aria-labelledby="icon-editor-title"
    >
      {body}
      {preview}
    </div>
  );
}

function linkMeta(seat: RosterSeat) {
  if (seat.via === "server") {
    return { label: "サーバー経由", tone: "bg-primary/45", text: "text-fg-muted" };
  }
  if (seat.connectionState === "self" || seat.connectionState === "connected") {
    return { label: "つながってる", tone: "bg-primary", text: "text-primary" };
  }
  if (seat.connectionState === "connecting" || seat.connectionState === "new") {
    return { label: "つなぎ中", tone: "bg-primary/45 animate-pulse", text: "text-fg-muted" };
  }
  if (seat.connectionState === "failed") {
    return { label: "届かない", tone: "bg-fg-muted", text: "text-fg-subtle" };
  }
  if (seat.connectionState === "disconnected") {
    return { label: "切れた", tone: "bg-fg-subtle", text: "text-fg-subtle" };
  }
  return { label: "待機", tone: "bg-fg-subtle", text: "text-fg-subtle" };
}

function pathLabel(kind: string | null) {
  if (kind === "host") return "同じ回線";
  if (kind === "srflx" || kind === "prflx") return "直通";
  if (kind === "relay") return "中継";
  return null;
}

function CollabRoster({ seats, joined }: { seats: RosterSeat[]; joined: boolean }) {
  const direct = seats.filter((s) => s.self || (s.connectionState === "connected" && !s.via)).length;
  const viaServer = seats.filter((s) => s.via === "server").length;
  const host = seats.find((s) => s.role === "host");
  const others = seats.filter((s) => s !== host);
  const [, bump] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => bump((n) => n + 1), 250);
    return () => window.clearInterval(t);
  }, []);

  return (
    <div className="rounded-[var(--radius-sm)] border border-border bg-bg px-2 py-2">
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <p className="text-[11px] text-fg-subtle">
          {joined
            ? viaServer
              ? `直結 ${direct} · サーバー ${viaServer}`
              : `つながってる ${direct} / ${seats.length}`
            : "部屋に入っています…"}
        </p>
        {host && (
          <p className="text-[11px] text-primary">
            ホスト {host.self ? "自分" : host.name}
          </p>
        )}
      </div>
      <div className="flex flex-col gap-1.5">
        {host && <SeatRow seat={host} seats={seats} />}
        {others.map((seat) => (
          <div key={seat.id} className="flex gap-2">
            <div className="flex w-3 flex-col items-center">
              <div className={cn("h-3 w-px shrink-0 bg-border")} />
              <div className={cn("size-1.5 shrink-0 rounded-full", linkMeta(seat).tone)} />
              <div className="w-px min-h-3 flex-1 bg-border" />
            </div>
            <div className="min-w-0 flex-1 pb-0.5">
              <SeatRow seat={seat} seats={seats} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ago(at: number | null | undefined) {
  if (at == null) return "—";
  return `${Math.max(0, Date.now() - at)}ms前`;
}

function viaName(seats: RosterSeat[], id: string) {
  if (id === "server") return "サーバー";
  const s = seats.find((x) => x.id === id);
  return s ? s.name.replace("（自分）", "") : "中継";
}

function SeatRow({ seat, seats }: { seat: RosterSeat; seats: RosterSeat[] }) {
  const st = linkMeta(seat);
  const path = pathLabel(seat.candidateType);
  const server = seat.via === "server" || seat.self;
  return (
    <div className="flex min-h-8 items-center gap-2">
      <span
        className="grid size-7 shrink-0 place-items-center rounded-full text-[10px] font-bold text-bg"
        style={{ background: seat.color }}
        title={seat.id}
      >
        {(seat.name.replace("（自分）", "") || "?").slice(0, 1)}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-xs font-medium">{seat.name}</span>
          {seat.role === "host" && (
            <span className="shrink-0 rounded-full bg-primary/15 px-1.5 py-px text-[9px] font-bold text-primary">
              ホスト
            </span>
          )}
          {seat.proxy && (
            <span className="shrink-0 rounded-full bg-primary/15 px-1.5 py-px text-[9px] font-bold text-primary">
              中継
            </span>
          )}
        </div>
        <p className={cn("text-[10px] leading-tight", st.text)}>
          {st.label}
          {seat.via && seat.via !== "server" ? ` · ${viaName(seats, seat.via)} 経由` : ""}
          {seat.sameIp && !seat.via ? " · 同じ回線" : ""}
          {server ? ` · POLL ${ago(seat.lastPollAt)}` : ` · HB ${ago(seat.lastHbAt)}`}
          {!server && seat.rttMs != null ? ` · 往復${seat.rttMs}ms` : ""}
          {path && !seat.via ? ` · ${path}` : ""}
        </p>
      </div>
    </div>
  );
}

