/**
 * Optional application protocol on top of P2PRoom.
 *
 * Know-how extracted from a live spectating app:
 *  - close() is one-shot → rejoin() builds a new mesh
 *  - snapshots go on the unreliable channel; events on reliable
 *  - late joiners send request-snapshot; one existing peer answers
 *  - events carry a UUID; a designated acker (usually the host) replies
 */
import { P2PRoom } from "./room";
import type { DataChannelKind, PeerInfo, P2PRoomOptions } from "./types";

export type SyncRole = "host" | "peer";

export type SyncWire =
  | { type: "hello"; name: string; role: SyncRole }
  | { type: "snapshot"; seq: number; state: unknown; by: string; at: number }
  | { type: "request-snapshot" }
  | { type: "event"; id: string; payload: unknown; by: string; at: number }
  | { type: "ack"; id: string; by: string };

export interface P2PSyncOptions {
  room: string;
  selfId: string;
  name?: string;
  role?: SyncRole;
  signalingUrl?: string;
  iceServers?: RTCIceServer[];
  /** Provide current state when answering request-snapshot / publishing. */
  getSnapshot?: () => unknown;
  onSnapshot?: (state: unknown, from: string, seq: number, meta: { by: string; at: number }) => void;
  onEvent?: (payload: unknown, from: string, id: string) => void;
  onAck?: (id: string, by: string) => void;
  onHello?: (from: string, name: string, role: SyncRole) => void;
  onState?: (data: unknown, from: string, channel: DataChannelKind) => void;
  onPeersChanged?: (peers: PeerInfo[]) => void;
  onConnected?: () => void;
}

export function makeEventId(): string {
  const cryptoObj = globalThis.crypto;
  if (cryptoObj && typeof cryptoObj.randomUUID === "function") {
    return cryptoObj.randomUUID();
  }
  const bytes = new Uint8Array(16);
  if (cryptoObj && typeof cryptoObj.getRandomValues === "function") {
    cryptoObj.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i++) bytes[i] = (Math.random() * 256) | 0;
  }
  const ms = BigInt(Date.now());
  bytes[0] = Number((ms >> 40n) & 0xffn);
  bytes[1] = Number((ms >> 32n) & 0xffn);
  bytes[2] = Number((ms >> 24n) & 0xffn);
  bytes[3] = Number((ms >> 16n) & 0xffn);
  bytes[4] = Number((ms >> 8n) & 0xffn);
  bytes[5] = Number(ms & 0xffn);
  bytes[6] = 0x70 | (bytes[6] & 0x0f);
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  let hex = "";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export class P2PSync {
  private opts: P2PSyncOptions;
  private roomInst: P2PRoom | null = null;
  private seq = 0;
  private lastLocalAt = 0;
  private readonly seenAt = new Map<string, number>();
  private readonly acked = new Set<string>();
  private fallbackTimer: ReturnType<typeof setInterval> | null = null;

  constructor(opts: P2PSyncOptions) {
    this.opts = opts;
  }

  get room(): P2PRoom | null {
    return this.roomInst;
  }

  start(): void {
    this.openRoom();
  }

  /**
   * Rebuild the mesh without changing identity / room id.
   * Required after tab sleep, NAT stall, or peer TTL expiry —
   * P2PRoom.close() cannot be undone.
   */
  rejoin(): void {
    this.stop();
    this.openRoom();
  }

  stop(): void {
    if (this.fallbackTimer) {
      clearInterval(this.fallbackTimer);
      this.fallbackTimer = null;
    }
    this.roomInst?.close();
    this.roomInst = null;
  }

  noteLocal(): void {
    this.lastLocalAt = Date.now();
  }

  private stamp(): { by: string; at: number } {
    return { by: this.opts.selfId, at: Date.now() };
  }

  private isEcho(
    by: string | undefined,
    at: number | undefined,
    key: string,
    vsLocal = false,
  ): boolean {
    if (by && by === this.opts.selfId) return true;
    if (vsLocal && at != null && this.lastLocalAt > 0 && at + 200 < this.lastLocalAt) return true;
    const prev = this.seenAt.get(key);
    if (at != null && prev != null && at <= prev) return true;
    return false;
  }

  private remember(by: string, at: number, key = by): void {
    const prev = this.seenAt.get(key) ?? 0;
    if (at > prev) this.seenAt.set(key, at);
  }

  publishSnapshot(state?: unknown): boolean {
    const p2p = this.roomInst;
    if (!p2p) return false;
    const snap = state ?? this.opts.getSnapshot?.();
    if (snap === undefined) return false;
    this.seq += 1;
    const msg: SyncWire = { type: "snapshot", seq: this.seq, state: snap, ...this.stamp() };
    p2p.broadcast(msg);
    p2p.send(msg);
    if (p2p.hasUnreachable()) p2p.sendBus(msg);
    return true;
  }

  requestSnapshot(): void {
    this.roomInst?.send({ type: "request-snapshot" } satisfies SyncWire);
  }

  sendEvent(payload: unknown, toPeerId?: string): string {
    const id = makeEventId();
    const msg: SyncWire = { type: "event", id, payload, ...this.stamp() };
    const p2p = this.roomInst;
    if (!p2p) return id;
    if (toPeerId) p2p.send(msg, toPeerId);
    else p2p.send(msg);
    if (!toPeerId || p2p.hasUnreachable()) p2p.sendBus(msg);
    return id;
  }

  ack(id: string): void {
    if (!id || this.acked.has(id)) return;
    this.acked.add(id);
    const msg: SyncWire = {
      type: "ack",
      id,
      by: this.opts.selfId,
    };
    this.roomInst?.send(msg);
  }

  sendHello(): void {
    this.roomInst?.send({
      type: "hello",
      name: this.opts.name ?? this.opts.selfId,
      role: this.opts.role ?? "peer",
    } satisfies SyncWire);
  }

  /** Host: P2P if up, and bus when that peer is not on a data channel. */
  pushCanvas(toPeerId?: string): boolean {
    const p2p = this.roomInst;
    if (!p2p) return false;
    const raw = this.opts.getSnapshot?.();
    if (raw === undefined) return false;
    const mark = this.stamp();
    const snap =
      raw && typeof raw === "object" ? { ...(raw as object), ...mark } : raw;
    this.seq += 1;
    const msg: SyncWire = { type: "snapshot", seq: this.seq, state: snap, ...this.stamp() };
    if (toPeerId) p2p.send(msg, toPeerId);
    else {
      p2p.broadcast(msg);
      p2p.send(msg);
    }
    if (toPeerId || p2p.hasUnreachable()) p2p.sendBus(msg);
    return true;
  }

  private openRoom(): void {
    const roomOpts: P2PRoomOptions = {
      room: this.opts.room,
      selfId: this.opts.selfId,
      name: this.opts.name,
      signalingUrl: this.opts.signalingUrl,
      iceServers: this.opts.iceServers,
      onPeersChanged: this.opts.onPeersChanged,
      onConnected: () => {
        this.sendHello();
        if (this.opts.role === "host") this.publishSnapshot();
        else this.requestSnapshot();
        this.opts.onConnected?.();
        if (this.fallbackTimer) clearInterval(this.fallbackTimer);
        this.fallbackTimer = setInterval(() => {
          if (!this.roomInst?.hasUnreachable()) return;
          this.sendHello();
          if (this.opts.role === "host") this.pushCanvas();
          else this.requestSnapshot();
        }, 4000);
      },
      onMessage: (from, data, channel) => this.onWire(from, data, channel),
    };
    const p2p = new P2PRoom(roomOpts);
    this.roomInst = p2p;
    void p2p.join();
  }

  private onWire(from: string, data: unknown, _channel: DataChannelKind): void {
    const msg = data as SyncWire;
    if (!msg || typeof msg !== "object" || !("type" in msg)) return;

    if (msg.type === "hello") {
      this.opts.onHello?.(from, msg.name, msg.role);
      if (this.opts.role === "host") this.pushCanvas(from);
      return;
    }
    if (msg.type === "request-snapshot") {
      if (this.opts.role === "host" || this.opts.getSnapshot) this.pushCanvas(from);
      return;
    }
    if (msg.type === "snapshot") {
      const by = msg.by || from;
      const at = typeof msg.at === "number" ? msg.at : 0;
      if (this.isEcho(by, at, `snap:${by}`, true)) return;
      this.remember(by, at, `snap:${by}`);
      this.opts.onSnapshot?.(msg.state, from, msg.seq, { by, at });
      return;
    }
    if (msg.type === "event") {
      const by = msg.by || from;
      const at = typeof msg.at === "number" ? msg.at : 0;
      if (this.isEcho(by, at, `ev:${msg.id}`)) return;
      this.remember(by, at, `ev:${by}`);
      this.opts.onEvent?.(msg.payload, from, msg.id);
      if (this.opts.role === "host" && from !== this.opts.selfId) {
        this.ack(msg.id);
      }
      return;
    }
    if (msg.type === "ack") {
      this.opts.onAck?.(msg.id, msg.by);
      return;
    }
    if (data && typeof data === "object" && "type" in data) {
      const extra = data as { type: string; by?: string; at?: number; id?: string };
      if (extra.type === "live" || extra.type === "cursor") {
        const by = extra.by || from;
        const at = typeof extra.at === "number" ? extra.at : 0;
        const key = `${extra.type}:${by}:${extra.id ?? ""}`;
        if (this.isEcho(by, at, key)) return;
        this.remember(by, at, key);
        this.opts.onState?.(data, from, _channel);
        return;
      }
    }
    this.opts.onState?.(data, from, _channel);
  }
}
