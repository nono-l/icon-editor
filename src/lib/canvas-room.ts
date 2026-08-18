import { useCallback, useEffect, useRef, useState } from "react";
import { P2PSync, type PeerInfo, type SyncRole } from "@/lib/p2p-sync";

export type WireImage = {
  kind: "image";
  id: string;
  name: string;
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
  src: string;
};

export type WireText = {
  kind: "text";
  id: string;
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

export type WireGuide = {
  kind: "guide";
  id: string;
  name: string;
  shape: "box" | "hline" | "vline" | "cross";
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  rotate: number;
  w: number;
  h: number;
};

export type WireLayer = WireImage | WireText | WireGuide;

export type CanvasDoc = {
  v: 1;
  presetId: string;
  bg: string | null;
  layers: WireLayer[];
  by?: string;
  at?: number;
};

export type LivePose = {
  type: "live";
  id: string;
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  rotate: number;
  by?: string;
  at?: number;
};

export type CursorMsg = {
  type: "cursor";
  x: number;
  y: number;
  name: string;
};

export type RemoteCursor = {
  id: string;
  name: string;
  x: number;
  y: number;
  color: string;
  at: number;
};

export function roomCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 6; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
  return s;
}

export function normalizeRoom(raw: string): string {
  return raw.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, "").slice(0, 16);
}

export function invitePath(room: string): string {
  return `/join/${normalizeRoom(room)}`;
}

export function inviteUrl(room: string): string {
  if (typeof window === "undefined") return invitePath(room);
  return `${window.location.origin}${invitePath(room)}`;
}

export function peerHue(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360;
  return `hsl(${h} 70% 62%)`;
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image"));
    img.src = src;
  });
}

export async function imageToDataUrl(img: HTMLImageElement): Promise<string> {
  if (img.src.startsWith("data:")) return img.src;
  const max = 720;
  const scale = Math.min(1, max / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
  const w = Math.max(1, Math.round((img.naturalWidth || 1) * scale));
  const h = Math.max(1, Math.round((img.naturalHeight || 1) * scale));
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  if (!ctx) return img.src;
  ctx.drawImage(img, 0, 0, w, h);
  return c.toDataURL("image/jpeg", 0.82);
}

export async function serializeLayer(
  layer: WireLayer | (Omit<WireImage, "src"> & { img: HTMLImageElement }),
): Promise<WireLayer> {
  if (layer.kind === "image" && "img" in layer) {
    const src = await imageToDataUrl(layer.img);
    const { img: _img, ...rest } = layer;
    return { ...rest, src };
  }
  return layer as WireLayer;
}

export async function serializeDoc(
  presetId: string,
  bg: string | null,
  layers: Array<WireLayer | (Omit<WireImage, "src"> & { img: HTMLImageElement })>,
): Promise<CanvasDoc> {
  const out: WireLayer[] = [];
  for (const layer of layers) out.push(await serializeLayer(layer));
  return { v: 1, presetId, bg, layers: out };
}

export function wireFromLayers(
  layers: Array<WireLayer | (Omit<WireImage, "src"> & { img: HTMLImageElement })>,
  prev: CanvasDoc,
): WireLayer[] {
  return layers.map((layer) => {
    if (layer.kind === "image" && "img" in layer) {
      const old = prev.layers.find((l) => l.id === layer.id && l.kind === "image");
      const src =
        (old && old.kind === "image" && old.src) ||
        (layer.img.src.startsWith("data:") ? layer.img.src : "");
      const { img: _img, ...rest } = layer;
      return { ...rest, src };
    }
    return layer as WireLayer;
  });
}

export type CanvasOp =
  | { type: "reorder"; ids: string[] }
  | { type: "patch"; id: string; patch: Record<string, unknown> }
  | { type: "add"; layer: WireLayer }
  | { type: "remove"; id: string }
  | { type: "clear" }
  | { type: "preset"; presetId: string }
  | { type: "bg"; bg: string | null };

export function applyCanvasOp(doc: CanvasDoc, op: CanvasOp): CanvasDoc {
  if (op.type === "reorder") {
    const map = new Map(doc.layers.map((l) => [l.id, l]));
    const next = op.ids.map((id) => map.get(id)).filter(Boolean) as WireLayer[];
    for (const l of doc.layers) if (!op.ids.includes(l.id)) next.push(l);
    return { ...doc, layers: next };
  }
  if (op.type === "patch") {
    return {
      ...doc,
      layers: doc.layers.map((l) => (l.id === op.id ? ({ ...l, ...op.patch } as WireLayer) : l)),
    };
  }
  if (op.type === "add") {
    if (doc.layers.some((l) => l.id === op.layer.id)) return doc;
    return { ...doc, layers: [...doc.layers, op.layer] };
  }
  if (op.type === "remove") {
    return { ...doc, layers: doc.layers.filter((l) => l.id !== op.id) };
  }
  if (op.type === "clear") return { ...doc, layers: [] };
  if (op.type === "preset") return { ...doc, presetId: op.presetId };
  if (op.type === "bg") return { ...doc, bg: op.bg };
  return doc;
}

export type SeatRole = SyncRole | "self";

export type RosterSeat = {
  id: string;
  name: string;
  role: SyncRole;
  self: boolean;
  connectionState: RTCPeerConnectionState | "self";
  rttMs: number | null;
  lastHbAt: number | null;
  lastPollAt: number | null;
  candidateType: string | null;
  color: string;
  sameIp?: boolean;
  proxy?: boolean;
  via?: string | null;
};

export type CanvasRoomHandle = {
  room: string;
  selfId: string;
  peers: PeerInfo[];
  roster: RosterSeat[];
  joined: boolean;
  cursors: RemoteCursor[];
  publish: () => void;
  sendLive: (pose: Omit<LivePose, "type">) => void;
  sendCursor: (x: number, y: number) => void;
  sendOp: (op: CanvasOp) => void;
  rejoin: () => void;
};

export function useCanvasRoom(opts: {
  room: string | null;
  name: string;
  role: SyncRole;
  getDoc: () => CanvasDoc;
  onDoc: (doc: CanvasDoc, from: string) => void;
  onLive: (pose: LivePose, from: string) => void;
  onOp?: (op: CanvasOp, from: string) => void;
}): CanvasRoomHandle | null {
  const lastBus = useRef(0);
  const [peers, setPeers] = useState<PeerInfo[]>([]);
  const [roles, setRoles] = useState<Record<string, SyncRole>>({});
  const [joined, setJoined] = useState(false);
  const [cursors, setCursors] = useState<RemoteCursor[]>([]);
  const syncRef = useRef<P2PSync | null>(null);
  const [selfId] = useState(() => `p${Math.random().toString(36).slice(2, 10)}`);
  const lastCursor = useRef(0);
  const optsRef = useRef(opts);
  optsRef.current = opts;

  useEffect(() => {
    if (!opts.room) return;
    const sync = new P2PSync({
      room: opts.room,
      selfId,
      name: opts.name,
      role: opts.role,
      getSnapshot: () => optsRef.current.getDoc(),
      onSnapshot: (state, from, _seq, meta) => {
        if (meta.by === selfId) return;
        const doc = state as CanvasDoc;
        if (doc?.by === selfId) return;
        if (doc?.v === 1 && Array.isArray(doc.layers)) optsRef.current.onDoc(doc, from);
      },
      onState: (data, from) => {
        const msg = data as LivePose | CursorMsg;
        if (!msg || typeof msg !== "object") return;
        if (msg.type === "live") {
          if (msg.by === selfId) return;
          optsRef.current.onLive(msg, from);
        }
        if (msg.type === "cursor") {
          setCursors((prev) => {
            const next = prev.filter((c) => c.id !== from);
            next.push({
              id: from,
              name: msg.name,
              x: msg.x,
              y: msg.y,
              color: peerHue(from),
              at: Date.now(),
            });
            return next;
          });
        }
      },
      onEvent: (payload, from) => {
        const op = payload as CanvasOp;
        if (!op || typeof op !== "object" || !("type" in op)) return;
        optsRef.current.onOp?.(op, from);
      },
      onHello: (from, _name, helloRole) => {
        setRoles((prev) => ({ ...prev, [from]: helloRole }));
      },
      onPeersChanged: (list) => {
        setPeers(list);
        setRoles((prev) => {
          const keep: Record<string, SyncRole> = {};
          for (const p of list) {
            if (prev[p.id]) keep[p.id] = prev[p.id];
          }
          return keep;
        });
        if (optsRef.current.role !== "host") return;
        const viaServer = list.some((p) => p.via === "server");
        if (!viaServer) return;
        const now = Date.now();
        if (now - lastBus.current < 1200) return;
        lastBus.current = now;
        sync.pushCanvas();
      },
      onConnected: () => setJoined(true),
    });
    syncRef.current = sync;
    sync.start();
    return () => {
      sync.stop();
      syncRef.current = null;
      setJoined(false);
      setPeers([]);
      setRoles({});
      setCursors([]);
    };
  }, [opts.room, opts.name, opts.role, selfId]);

  useEffect(() => {
    const t = window.setInterval(() => {
      setCursors((prev) => prev.filter((c) => Date.now() - c.at < 4000));
    }, 1000);
    return () => window.clearInterval(t);
  }, []);

  const publish = useCallback(() => {
    syncRef.current?.noteLocal();
    syncRef.current?.pushCanvas();
  }, []);

  const sendLive = useCallback((pose: Omit<LivePose, "type">) => {
    syncRef.current?.noteLocal();
    const msg: LivePose = {
      type: "live",
      ...pose,
      by: selfId,
      at: Date.now(),
    };
    const room = syncRef.current?.room;
    room?.broadcast(msg);
    if (room?.hasUnreachable()) room.sendBus(msg);
  }, [selfId]);

  const sendCursor = useCallback((x: number, y: number) => {
    const now = performance.now();
    if (now - lastCursor.current < 50) return;
    lastCursor.current = now;
    const room = syncRef.current?.room;
    const msg = {
      type: "cursor" as const,
      x,
      y,
      name: optsRef.current.name,
      by: selfId,
      at: Date.now(),
    };
    room?.broadcast(msg);
  }, [selfId]);

  const sendOp = useCallback((op: CanvasOp) => {
    syncRef.current?.noteLocal();
    syncRef.current?.sendEvent(op);
  }, []);

  const rejoin = useCallback(() => {
    setJoined(false);
    syncRef.current?.rejoin();
  }, []);

  if (!opts.room) return null;
  const roster: RosterSeat[] = [
    {
      id: selfId,
      name: `${opts.name}（自分）`,
      role: opts.role,
      self: true,
      connectionState: "self" as const,
      rttMs: null,
      lastHbAt: null,
      lastPollAt: peers.find((p) => p.lastPollAt)?.lastPollAt ?? null,
      candidateType: null,
      color: peerHue(selfId),
      proxy:
        peers.some((p) => p.connectionState === "connected" && p.sameIp && !p.via) &&
        peers.some((p) => p.connectionState === "connected" && !p.sameIp && !p.via),
    },
    ...peers.map((p) => ({
      id: p.id,
      name: p.name || "ゲスト",
      role: roles[p.id] ?? "peer",
      self: false,
      connectionState: p.connectionState,
      rttMs: p.rttMs,
      lastHbAt: p.lastHbAt,
      lastPollAt: p.lastPollAt,
      candidateType: p.candidateType,
      sameIp: p.sameIp,
      proxy: p.proxy,
      via: p.via,
      color: peerHue(p.id),
    })),
  ].sort((a, b) => Number(b.role === "host") - Number(a.role === "host"));
  return {
    room: opts.room,
    selfId,
    peers,
    roster,
    joined,
    cursors,
    publish,
    sendLive,
    sendCursor,
    sendOp,
    rejoin,
  };
}
