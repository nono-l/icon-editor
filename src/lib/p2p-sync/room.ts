/**
 * Full-mesh WebRTC rooms. Signaling is HTTP poll; application data is
 * browser-to-browser on two data channels:
 *   - "state"    — unreliable / unordered (snapshots, cursors)
 *   - "reliable" — ordered / reliable (events, chat, ACK)
 *
 * Perfect-negotiation: on glare the polite peer (lexicographically smaller id)
 * rolls back. Client-authoritative — do not use for ranked / cheat-sensitive play.
 */
import { defaultIceServers } from "./ice";
import { gatherLanHints, hostCandidateInit, parseIceLine, isNumericIp, isPrivateIp, type LanHint } from "./lan";
import type {
  DataChannelKind,
  PeerInfo,
  P2PRoomOptions,
  RtcPollResponse,
  SignalKind,
} from "./types";

export type { PeerInfo, P2PRoomOptions } from "./types";

interface PeerSlot {
  pc: RTCPeerConnection;
  state?: RTCDataChannel;
  reliable?: RTCDataChannel;
  makingOffer: boolean;
  ignoreOffer: boolean;
  pendingCandidates: RTCIceCandidateInit[];
  lastProgressAt: number;
  recoveryAttempts: number;
  terminal?: boolean;
  recreatedForOffer?: boolean;
  info: PeerInfo;
  pingSentAt?: number;
  sameIp?: boolean;
  lanSent?: boolean;
  lastRetryAt?: number;
}

const FAST_POLL_MS = 400;
const IDLE_POLL_MS = 2000;
const PING_INTERVAL_MS = 2000;
const HB_ALIVE_MS = 6000;
const STALL_MS = 8_000;
const RETRY_GAP_MS = 1200;
const P2P_FALLBACK_MS = 4000;
const SIGNAL_RETRY_DELAYS_MS = [250, 750];

export class P2PRoom {
  private readonly opts: P2PRoomOptions;
  private readonly signalingUrl: string;
  private readonly peers = new Map<string, PeerSlot>();
  private readonly signalQueues = new Map<string, Promise<void>>();
  private cursor = 0;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private streamTimer: ReturnType<typeof setTimeout> | null = null;
  private es: EventSource | null = null;
  private streaming = false;
  private closed = false;
  private everPolled = false;
  private lastPeersFingerprint = "";
  private lanHint: LanHint | null = null;
  private lanHintPromise: Promise<LanHint> | null = null;
  private outSeq = 0;
  private readonly seen = new Map<string, number>();
  private readonly heardVia = new Map<string, { via: string; name: string; at: number }>();
  private wasProxy = false;
  private lastRoster = new Set<string>();
  private lastPollAt = 0;
  private readonly busParts = new Map<string, { n: number; parts: (string | undefined)[]; at: number }>();

  constructor(opts: P2PRoomOptions) {
    this.opts = opts;
    this.signalingUrl = opts.signalingUrl ?? "/api/rtc";
  }

  get room(): string {
    return this.opts.room;
  }

  get selfId(): string {
    return this.opts.selfId;
  }

  get isClosed(): boolean {
    return this.closed;
  }

  /**
   * First poll IS the join. A failed first poll must not strand the room —
   * timers start anyway and the next poll retries.
   */
  async join(): Promise<void> {
    try {
      await this.pollOnce();
    } catch {
      /* transient */
    }
    if (this.closed) return;
    this.openStream();
    this.schedulePoll(this.anyPairConnecting() ? FAST_POLL_MS : IDLE_POLL_MS);
    this.pingTimer = setInterval(() => {
      this.pingAll();
      this.watchdog();
    }, PING_INTERVAL_MS);
  }

  /**
   * close() is one-shot. To rejoin after tab-sleep / TTL expiry, construct a
   * NEW P2PRoom and call join() again.
   */
  close(): void {
    this.closed = true;
    this.closeStream();
    if (this.pollTimer) clearTimeout(this.pollTimer);
    if (this.pingTimer) clearInterval(this.pingTimer);
    if (this.streamTimer) clearTimeout(this.streamTimer);
    for (const slot of this.peers.values()) slot.pc.close();
    this.peers.clear();
    void fetch(this.signalingUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        op: "leave",
        room: this.opts.room,
        peer: this.opts.selfId,
      }),
      keepalive: true,
    }).catch(() => {});
  }

  /** Unreliable / unordered fan-out (stale packets drop). */
  broadcast(data: unknown): void {
    this.flood(this.wrap(data), "state", null, null);
  }

  /** Reliable / ordered send to one peer, or all when peerId is omitted. */
  send(data: unknown, peerId?: string): void {
    const env = this.wrap(data, peerId);
    if (peerId) {
      if (this.channelOpen(peerId, "reliable")) {
        this.flood(env, "reliable", peerId, null);
      } else if (this.needsFallback(peerId)) {
        void this.sendBus(data);
      }
      return;
    }
    this.flood(env, "reliable", null, null);
    if (this.hasUnreachable()) void this.sendBus(data);
  }

  needsFallback(peerId: string): boolean {
    if (this.channelOpen(peerId, "reliable") || this.channelOpen(peerId, "state")) {
      return false;
    }
    if (!this.lastRoster.has(peerId) && !this.peers.has(peerId)) return false;
    const slot = this.peers.get(peerId);
    if (slot?.info.via === "server") return true;
    const live = slot?.pc.connectionState;
    if (live === "failed" || live === "disconnected" || live === "closed") return true;
    const started = slot?.lastProgressAt ?? 0;
    return started > 0 && Date.now() - started >= P2P_FALLBACK_MS;
  }

  hasUnreachable(): boolean {
    for (const id of this.lastRoster) {
      if (id === this.opts.selfId) continue;
      if (this.needsFallback(id)) return true;
    }
    return false;
  }

  sendBus(data: unknown): void {
    void this.postBus(data);
  }

  peerList(): PeerInfo[] {
    const now = Date.now();
    const list: PeerInfo[] = [];
    for (const slot of this.peers.values()) {
      if (!this.visible(slot)) continue;
      list.push({ ...slot.info, lastPollAt: this.lastPollAt || slot.info.lastPollAt });
    }
    for (const [id, r] of this.heardVia) {
      if (now - r.at > HB_ALIVE_MS) {
        this.heardVia.delete(id);
        continue;
      }
      if (list.some((p) => p.id === id)) continue;
      list.push({
        id,
        name: r.name || "経由",
        connectionState: "connected",
        candidateType: null,
        rttMs: null,
        lastHbAt: null,
        lastPollAt: this.lastPollAt || r.at,
        sameIp: false,
        proxy: false,
        via: r.via,
      });
    }
    return list;
  }

  connectedCount(): number {
    let n = 0;
    for (const s of this.peers.values()) {
      if (s.info.connectionState === "connected") n += 1;
    }
    return n;
  }

  private schedulePoll(delay: number): void {
    if (this.closed) return;
    if (this.pollTimer) clearTimeout(this.pollTimer);
    this.pollTimer = setTimeout(() => void this.poll(), delay);
  }

  private anyPairConnecting(): boolean {
    for (const s of this.peers.values()) {
      if (s.terminal) continue;
      if (s.info.connectionState !== "connected") return true;
    }
    return false;
  }

  private async applyInbox(body: RtcPollResponse): Promise<void> {
    if (this.closed) return;
    this.lastPollAt = Date.now();
    for (const slot of this.peers.values()) slot.info.lastPollAt = this.lastPollAt;
    if (!this.everPolled) {
      this.everPolled = true;
      this.opts.onConnected?.();
    }
    this.reconcileRoster(body.peers);
    const roster = new Set(body.peers.map((p) => p.id));
    for (const sig of body.signals) {
      this.cursor = Math.max(this.cursor, sig.id);
      await this.onSignal(sig.from, sig.kind, sig.payload, roster);
      if (this.closed) return;
    }
  }

  private streamUrl(): string {
    const params = new URLSearchParams({
      room: this.opts.room,
      peer: this.opts.selfId,
      name: this.opts.name ?? "",
      since: String(this.cursor),
      stream: "1",
    });
    return `${this.signalingUrl}?${params}`;
  }

  private closeStream(): void {
    this.streaming = false;
    if (this.es) {
      this.es.close();
      this.es = null;
    }
  }

  private openStream(): void {
    if (this.closed || typeof EventSource === "undefined") return;
    this.closeStream();
    const es = new EventSource(this.streamUrl());
    this.es = es;
    es.addEventListener("hello", () => {
      this.streaming = true;
      if (this.pollTimer) {
        clearTimeout(this.pollTimer);
        this.pollTimer = null;
      }
    });
    es.addEventListener("tick", (ev) => {
      this.streaming = true;
      try {
        const body = JSON.parse((ev as MessageEvent).data) as RtcPollResponse;
        void this.applyInbox(body);
      } catch {
        /* ignore */
      }
    });
    es.addEventListener("bye", () => {
      this.closeStream();
      this.openStream();
    });
    es.onerror = () => {
      this.closeStream();
      if (this.closed) return;
      this.schedulePoll(FAST_POLL_MS);
      if (this.streamTimer) clearTimeout(this.streamTimer);
      this.streamTimer = setTimeout(() => this.openStream(), 1500);
    };
  }

  private async pollOnce(): Promise<void> {
    const params = new URLSearchParams({
      room: this.opts.room,
      peer: this.opts.selfId,
      name: this.opts.name ?? "",
      since: String(this.cursor),
    });
    const res = await fetch(`${this.signalingUrl}?${params}`);
    if (this.closed) return;
    if (!res.ok) throw new Error(`signaling poll failed: ${res.status}`);
    const body = (await res.json()) as RtcPollResponse;
    await this.applyInbox(body);
  }

  private async poll(): Promise<void> {
    if (this.closed || this.streaming) return;
    try {
      await this.pollOnce();
    } catch {
      /* tab sleep / deploy */
    }
    if (!this.streaming) {
      this.schedulePoll(this.anyPairConnecting() ? FAST_POLL_MS : IDLE_POLL_MS);
    }
  }

  private reconcileRoster(peers: { id: string; name: string; sameIp?: boolean }[]): void {
    const alive = new Set(peers.map((p) => p.id));
    this.lastRoster = alive;
    for (const p of peers) {
      if (p.id === this.opts.selfId) continue;
      const existing = this.peers.get(p.id);
      if (existing) {
        existing.info.name = p.name;
        existing.sameIp = !!p.sameIp;
        existing.info.sameIp = !!p.sameIp;
        if (p.sameIp) void this.shareLan(existing, p.id);
      } else {
        this.connectTo(p.id, p.name, this.opts.selfId > p.id, !!p.sameIp);
      }
    }
    for (const [id, slot] of this.peers) {
      if (alive.has(id)) continue;
      if (this.hbAlive(slot)) continue;
      slot.pc.close();
      this.peers.delete(id);
      this.heardVia.delete(id);
    }
    this.emitPeers();
  }

  private connectTo(
    peerId: string,
    name: string,
    initiator: boolean,
    sameIp = false,
  ): PeerSlot | null {
    if (this.closed) return null;
    const pc = new RTCPeerConnection({
      iceServers: this.opts.iceServers ?? defaultIceServers(),
    });
    const slot: PeerSlot = {
      pc,
      makingOffer: false,
      ignoreOffer: false,
      pendingCandidates: [],
      lastProgressAt: Date.now(),
      recoveryAttempts: 0,
      sameIp,
      info: {
        id: peerId,
        name,
        connectionState: pc.connectionState,
        candidateType: null,
        rttMs: null,
        lastHbAt: null,
        lastPollAt: null,
        sameIp,
        proxy: false,
        via: null,
      },
    };
    this.peers.set(peerId, slot);

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        void this.sendSignal(peerId, "ice", e.candidate.toJSON());
        const parsed = parseIceLine(e.candidate.candidate);
        if (parsed?.typ === "host" && isNumericIp(parsed.ip) && isPrivateIp(parsed.ip)) {
          this.lanHint = {
            ips: [...new Set([...(this.lanHint?.ips ?? []), parsed.ip])],
            ports: [...new Set([...(this.lanHint?.ports ?? []), parsed.port])],
          };
        } else if (parsed?.typ === "host") {
          this.lanHint = {
            ips: this.lanHint?.ips ?? [],
            ports: [...new Set([...(this.lanHint?.ports ?? []), parsed.port])],
          };
        }
        if (sameIp || slot.sameIp) void this.shareLan(slot, peerId);
      }
    };
    pc.onconnectionstatechange = () => {
      slot.info.connectionState = pc.connectionState;
      if (
        pc.connectionState === "connecting" ||
        pc.connectionState === "connected"
      ) {
        slot.lastProgressAt = Date.now();
      }
      if (pc.connectionState === "connected") {
        slot.recoveryAttempts = 0;
        slot.terminal = false;
        slot.info.via = null;
        slot.info.lastHbAt = Date.now();
        void this.readCandidateType(slot);
      }
      this.emitPeers();
      this.announceProxy();
      if (pc.connectionState === "failed") pc.restartIce();
      if (
        pc.connectionState === "failed" ||
        pc.connectionState === "disconnected"
      ) {
        this.schedulePoll(FAST_POLL_MS);
      }
    };
    pc.onnegotiationneeded = async () => {
      try {
        slot.makingOffer = true;
        await pc.setLocalDescription();
        await this.sendSignal(peerId, "offer", pc.localDescription!.toJSON());
      } catch {
        /* next negotiationneeded */
      } finally {
        slot.makingOffer = false;
      }
    };
    pc.ondatachannel = (e) => this.attachChannel(slot, e.channel);

    if (initiator) {
      this.attachChannel(
        slot,
        pc.createDataChannel("state", { ordered: false, maxRetransmits: 0 }),
      );
      this.attachChannel(slot, pc.createDataChannel("reliable", { ordered: true }));
    }
    return slot;
  }

  private attachChannel(slot: PeerSlot, channel: RTCDataChannel): void {
    if (channel.label === "state") slot.state = channel;
    else slot.reliable = channel;
    channel.onopen = () => {
      slot.lastProgressAt = Date.now();
      this.announceProxy();
    };
    channel.onmessage = (e) => {
      let msg: {
        t: string;
        d?: unknown;
        o?: string;
        n?: number;
        h?: number;
        to?: string;
        name?: string;
        on?: boolean;
      };
      try {
        msg = JSON.parse(e.data as string) as typeof msg;
      } catch {
        return;
      }
      if (msg.t === "ping") {
        slot.info.lastHbAt = Date.now();
        if (slot.state?.readyState === "open") {
          slot.state.send(JSON.stringify({ t: "pong" }));
        }
        return;
      }
      if (msg.t === "pong") {
        slot.info.lastHbAt = Date.now();
        if (slot.pingSentAt) {
          slot.info.rttMs = Math.round(performance.now() - slot.pingSentAt);
          slot.pingSentAt = undefined;
          this.emitPeers();
        }
        return;
      }
      if (msg.t === "proxy") {
        slot.info.lastHbAt = Date.now();
        slot.info.proxy = !!msg.on;
        this.emitPeers();
        return;
      }
      if (msg.t !== "d") return;
      const kind: DataChannelKind = channel.label === "state" ? "state" : "reliable";
      const origin = typeof msg.o === "string" && msg.o ? msg.o : slot.info.id;
      if (origin === this.opts.selfId) return;
      const n = typeof msg.n === "number" ? msg.n : -1;
      const hops = typeof msg.h === "number" ? msg.h : 0;
      if (n >= 0 && this.alreadySeen(`${origin}:${n}`)) return;
      if (n >= 0) this.markSeen(`${origin}:${n}`);

      const dest = typeof msg.to === "string" ? msg.to : "";
      if (dest && dest !== this.opts.selfId) {
        if (this.isProxy() && hops < 2) {
          this.flood({ ...msg, h: hops + 1 }, kind, dest, slot.info.id);
        }
        return;
      }

      const direct = this.channelOpen(origin, "reliable") || this.channelOpen(origin, "state");
      if (!direct) {
        this.heardVia.set(origin, {
          via: slot.info.id,
          name: typeof msg.name === "string" ? msg.name : "",
          at: Date.now(),
        });
      } else {
        this.heardVia.delete(origin);
      }
      this.opts.onMessage?.(origin, msg.d, kind);
      slot.info.lastHbAt = Date.now();
      if (this.isProxy() && hops < 2 && !dest) {
        this.flood({ ...msg, o: origin, h: hops + 1 }, kind, null, slot.info.id);
      }
    };
  }

  private async flushPendingCandidates(slot: PeerSlot): Promise<void> {
    while (slot.pendingCandidates.length > 0) {
      const candidate = slot.pendingCandidates.shift()!;
      try {
        await slot.pc.addIceCandidate(candidate);
      } catch (err) {
        if (!slot.ignoreOffer) console.warn("[p2p-sync] addIceCandidate:", err);
      }
      if (this.closed) return;
    }
  }

  private async onSignal(
    from: string,
    kind: SignalKind,
    payload: unknown,
    roster: Set<string>,
  ): Promise<void> {
    if (this.closed) return;
    if (kind === "bus") {
      this.onBusChunk(from, payload);
      return;
    }
    let slot = this.peers.get(from);
    if (!slot) {
      if (!roster.has(from)) return;
      const created = this.connectTo(from, "", false, this.peers.get(from)?.sameIp);
      if (!created) return;
      slot = created;
    }
    const polite = this.opts.selfId < from;

    try {
      if (kind === "offer" || kind === "answer") {
        const description = payload as RTCSessionDescriptionInit;
        const collision =
          kind === "offer" &&
          (slot.makingOffer || slot.pc.signalingState !== "stable");
        slot.ignoreOffer = !polite && collision;
        if (slot.ignoreOffer) return;
        try {
          await slot.pc.setRemoteDescription(description);
        } catch (err) {
          if (kind !== "offer" || slot.recreatedForOffer) throw err;
          const attempts = slot.recoveryAttempts;
          const name = slot.info.name;
          slot.pc.close();
          this.peers.delete(from);
          const fresh = this.connectTo(from, name, false, slot.sameIp);
          if (!fresh) return;
          fresh.recoveryAttempts = attempts;
          fresh.recreatedForOffer = true;
          slot = fresh;
          await slot.pc.setRemoteDescription(description);
        }
        if (this.closed) return;
        await this.flushPendingCandidates(slot);
        if (this.closed) return;
        if (kind === "offer") {
          await slot.pc.setLocalDescription();
          if (this.closed) return;
          await this.sendSignal(from, "answer", slot.pc.localDescription!.toJSON());
        }
      } else if (kind === "ice") {
        const candidate = payload as RTCIceCandidateInit;
        if (!slot.pc.remoteDescription) {
          slot.pendingCandidates.push(candidate);
          return;
        }
        try {
          await slot.pc.addIceCandidate(candidate);
        } catch (err) {
          if (!slot.ignoreOffer) console.warn("[p2p-sync] addIceCandidate:", err);
        }
      } else if (kind === "lan") {
        await this.applyLan(slot, payload);
      }
    } catch {
      /* next offer cycle */
    }
  }

  private async ensureLanHint(): Promise<LanHint> {
    if (this.lanHint) return this.lanHint;
    this.lanHintPromise ??= gatherLanHints().then((h) => {
      this.lanHint = h;
      return h;
    });
    return this.lanHintPromise;
  }

  private hostPortsFromPc(slot: PeerSlot): number[] {
    const ports = new Set<number>();
    const sdp = slot.pc.localDescription?.sdp ?? "";
    for (const line of sdp.split(/\r?\n/)) {
      const parsed = parseIceLine(line.startsWith("a=") ? line.slice(2) : line);
      if (parsed?.typ === "host") ports.add(parsed.port);
    }
    return [...ports];
  }

  private async shareLan(slot: PeerSlot, peerId: string): Promise<void> {
    if (this.closed || slot.lanSent) return;
    const hint = await this.ensureLanHint();
    const ports = [...new Set([...hint.ports, ...this.hostPortsFromPc(slot)])].slice(0, 8);
    const ips = hint.ips.slice(0, 8);
    if (!ips.length || !ports.length) return;
    slot.lanSent = true;
    void this.sendSignal(peerId, "lan", { ips, ports } satisfies LanHint);
  }

  private async applyLan(slot: PeerSlot, payload: unknown): Promise<void> {
    if (!payload || typeof payload !== "object") return;
    const raw = payload as Partial<LanHint>;
    const ips = (Array.isArray(raw.ips) ? raw.ips : [])
      .map((ip) => String(ip))
      .filter((ip) => isNumericIp(ip) && isPrivateIp(ip))
      .slice(0, 8);
    const ports = (Array.isArray(raw.ports) ? raw.ports : [])
      .map((p) => Number(p))
      .filter((p) => Number.isFinite(p) && p > 0 && p < 65536)
      .slice(0, 8);
    if (!ips.length || !ports.length) return;
    for (const ip of ips) {
      for (const port of ports) {
        const cand = hostCandidateInit(ip, port);
        if (!slot.pc.remoteDescription) {
          slot.pendingCandidates.push(cand);
          continue;
        }
        try {
          await slot.pc.addIceCandidate(cand);
        } catch {
          /* not all synthesized hosts are accepted */
        }
        if (this.closed) return;
      }
    }
  }

  private sendSignal(
    to: string,
    kind: SignalKind,
    payload: unknown,
  ): Promise<void> {
    const prev = this.signalQueues.get(to) ?? Promise.resolve();
    const next = prev.then(() => this.postSignal(to, kind, payload));
    this.signalQueues.set(to, next.catch(() => {}));
    return next;
  }

  private async postBus(data: unknown): Promise<void> {
    if (this.closed) return;
    let raw: string;
    try {
      raw = JSON.stringify(data);
    } catch {
      return;
    }
    const id = `b${this.opts.selfId}${this.outSeq + 1}`;
    const size = 10_000;
    const n = Math.max(1, Math.ceil(raw.length / size));
    for (let i = 0; i < n; i++) {
      if (this.closed) return;
      const body = raw.slice(i * size, (i + 1) * size);
      try {
        await fetch(this.signalingUrl, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            op: "bus",
            room: this.opts.room,
            from: this.opts.selfId,
            payload: { id, i, n, body },
          }),
        });
      } catch {
        return;
      }
    }
  }

  private onBusChunk(from: string, payload: unknown): void {
    if (!payload || typeof payload !== "object") return;
    const p = payload as { id?: string; i?: number; n?: number; body?: string };
    const id = String(p.id ?? "");
    const i = Number(p.i);
    const n = Number(p.n);
    const body = typeof p.body === "string" ? p.body : "";
    if (!id || !Number.isFinite(i) || !Number.isFinite(n) || n < 1 || n > 80 || i < 0 || i >= n) {
      return;
    }
    const key = `${from}:${id}`;
    let buf = this.busParts.get(key);
    if (!buf || buf.n !== n) {
      buf = { n, parts: Array.from({ length: n }), at: Date.now() };
      this.busParts.set(key, buf);
    }
    buf.parts[i] = body;
    buf.at = Date.now();
    if (buf.parts.some((x) => x === undefined)) return;
    this.busParts.delete(key);
    let data: unknown;
    try {
      data = JSON.parse(buf.parts.join(""));
    } catch {
      return;
    }
    this.heardVia.set(from, {
      via: "server",
      name:
        data && typeof data === "object" && "name" in data && typeof (data as { name: unknown }).name === "string"
          ? (data as { name: string }).name
          : this.heardVia.get(from)?.name || "",
      at: Date.now(),
    });
    const slot = this.peers.get(from);
    if (slot) {
      slot.info.lastPollAt = Date.now();
      if (!this.channelOpen(from, "reliable") && !this.channelOpen(from, "state")) {
        slot.info.via = "server";
      }
    }
    this.opts.onMessage?.(from, data, "reliable");
    this.emitPeers();
    if (this.busParts.size > 24) {
      const cutoff = Date.now() - 20_000;
      for (const [k, v] of this.busParts) {
        if (v.at < cutoff) this.busParts.delete(k);
      }
    }
  }

  private async postSignal(
    to: string,
    kind: SignalKind,
    payload: unknown,
  ): Promise<void> {
    for (let attempt = 0; ; attempt++) {
      if (this.closed) return;
      try {
        const res = await fetch(this.signalingUrl, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            op: "signal",
            room: this.opts.room,
            from: this.opts.selfId,
            to,
            kind,
            payload,
          }),
        });
        if (res.ok) return;
        throw new Error(`signal POST failed: ${res.status}`);
      } catch (err) {
        if (attempt >= SIGNAL_RETRY_DELAYS_MS.length) {
          console.warn(`[p2p-sync] signal ${kind} → ${to} failed`, err);
          return;
        }
        await new Promise((r) => setTimeout(r, SIGNAL_RETRY_DELAYS_MS[attempt]));
      }
    }
  }

  private pingAll(): void {
    const wire = JSON.stringify({ t: "ping" });
    for (const slot of this.peers.values()) {
      if (slot.state?.readyState !== "open") continue;
      const stale =
        slot.pingSentAt !== undefined &&
        performance.now() - slot.pingSentAt > 2 * PING_INTERVAL_MS;
      if (slot.pingSentAt === undefined || stale) {
        slot.pingSentAt = performance.now();
        try {
          slot.state.send(wire);
        } catch {
          slot.info.lastHbAt = slot.info.lastHbAt ?? 0;
        }
      }
    }
  }

  private hbAlive(slot: PeerSlot): boolean {
    if (slot.info.via === "server") return false;
    if (slot.info.lastHbAt == null) return false;
    return Date.now() - slot.info.lastHbAt <= HB_ALIVE_MS;
  }

  private pollAlive(slot?: PeerSlot): boolean {
    const at = slot?.info.lastPollAt || this.lastPollAt;
    if (!at) return false;
    return Date.now() - at <= 8_000;
  }

  private visible(slot: PeerSlot): boolean {
    const live = slot.pc.connectionState;
    if (live === "closed") return false;
    if (this.hbAlive(slot)) return true;
    if (slot.info.via === "server" && this.pollAlive(slot)) return true;
    if (live === "connecting" || live === "new") {
      return Date.now() - slot.lastProgressAt <= STALL_MS;
    }
    return false;
  }

  private dropPeer(peerId: string): void {
    const slot = this.peers.get(peerId);
    if (!slot) return;
    slot.pc.close();
    this.peers.delete(peerId);
    this.heardVia.delete(peerId);
  }

  private retryPeer(peerId: string, slot: PeerSlot): void {
    const now = Date.now();
    if (slot.lastRetryAt && now - slot.lastRetryAt < RETRY_GAP_MS) return;
    slot.lastRetryAt = now;
    slot.recoveryAttempts += 1;
    slot.lastProgressAt = now;
    slot.terminal = false;
    const { name, sameIp } = { name: slot.info.name, sameIp: slot.sameIp };
    if (this.opts.selfId > peerId) {
      slot.pc.close();
      this.peers.delete(peerId);
      const fresh = this.connectTo(peerId, name, true, sameIp);
      if (fresh) {
        fresh.recoveryAttempts = slot.recoveryAttempts;
        fresh.lastRetryAt = now;
      }
    } else {
      try {
        slot.pc.restartIce();
      } catch {
        slot.pc.close();
        this.peers.delete(peerId);
        this.connectTo(peerId, name, false, sameIp);
      }
    }
    this.schedulePoll(FAST_POLL_MS);
  }

  private watchdog(): void {
    if (this.closed) return;
    const now = Date.now();
    let changed = false;
    for (const [peerId, slot] of [...this.peers]) {
      const live = slot.pc.connectionState;
      if (live !== slot.info.connectionState) {
        slot.info.connectionState = live;
        if (live === "connecting" || live === "connected") slot.lastProgressAt = now;
        changed = true;
      }

      const goneFromRoster = !this.lastRoster.has(peerId);
      const silent = !this.hbAlive(slot) && now - slot.lastProgressAt > HB_ALIVE_MS;
      const cut = live === "failed" || live === "disconnected" || live === "closed";

      if (goneFromRoster && (silent || cut || !this.hbAlive(slot))) {
        this.dropPeer(peerId);
        changed = true;
        continue;
      }

      if (!this.visible(slot) && silent) {
        this.dropPeer(peerId);
        if (this.lastRoster.has(peerId)) this.retryPeer(peerId, slot);
        changed = true;
        continue;
      }

      if (cut || (live === "connected" && silent)) {
        if (this.lastRoster.has(peerId)) this.retryPeer(peerId, slot);
        else this.dropPeer(peerId);
        changed = true;
      }
    }
    if (changed) this.emitPeers();
  }

  private async readCandidateType(slot: PeerSlot): Promise<void> {
    try {
      const stats = await slot.pc.getStats();
      let selected: RTCIceCandidatePairStats | undefined;
      stats.forEach((s) => {
        if (s.type === "candidate-pair" && (s as RTCIceCandidatePairStats).nominated) {
          selected = s as RTCIceCandidatePairStats;
        }
      });
      const localId = selected?.localCandidateId;
      if (localId) {
        const local = stats.get(localId) as { candidateType?: string } | undefined;
        slot.info.candidateType = local?.candidateType ?? null;
        this.emitPeers();
      }
    } catch {
      /* diagnostics */
    }
  }

  private wrap(data: unknown, to?: string) {
    this.outSeq += 1;
    return {
      t: "d",
      o: this.opts.selfId,
      n: this.outSeq,
      h: 0,
      name: this.opts.name ?? "",
      ...(to ? { to } : {}),
      d: data,
    };
  }

  private flood(
    env: unknown,
    channel: DataChannelKind,
    onlyTo: string | null,
    except: string | null,
  ): void {
    const wire = JSON.stringify(env);
    for (const [id, slot] of this.peers) {
      if (onlyTo && id !== onlyTo) continue;
      if (except && id === except) continue;
      const ch = channel === "state" ? slot.state : slot.reliable;
      if (ch?.readyState === "open") {
        try {
          ch.send(wire);
        } catch {
          /* drop */
        }
      }
    }
  }

  private channelOpen(peerId: string, channel: DataChannelKind): boolean {
    const slot = this.peers.get(peerId);
    if (!slot || slot.pc.connectionState !== "connected") return false;
    const ch = channel === "state" ? slot.state : slot.reliable;
    return ch?.readyState === "open";
  }

  private isProxy(): boolean {
    let lan = false;
    let wan = false;
    for (const slot of this.peers.values()) {
      if (slot.pc.connectionState !== "connected") continue;
      const open =
        slot.reliable?.readyState === "open" || slot.state?.readyState === "open";
      if (!open) continue;
      if (slot.sameIp || slot.info.candidateType === "host") lan = true;
      else wan = true;
    }
    return lan && wan;
  }

  private announceProxy(): void {
    const on = this.isProxy();
    if (on === this.wasProxy) return;
    this.wasProxy = on;
    const wire = JSON.stringify({ t: "proxy", on });
    for (const slot of this.peers.values()) {
      if (slot.reliable?.readyState === "open") {
        try {
          slot.reliable.send(wire);
        } catch {
          /* drop */
        }
      }
    }
    this.emitPeers();
  }

  private alreadySeen(key: string): boolean {
    return this.seen.has(key);
  }

  private markSeen(key: string): void {
    this.seen.set(key, Date.now());
    if (this.seen.size < 240) return;
    const cutoff = Date.now() - 30_000;
    for (const [k, at] of this.seen) {
      if (at < cutoff) this.seen.delete(k);
    }
    if (this.seen.size > 240) {
      const first = this.seen.keys().next().value;
      if (first) this.seen.delete(first);
    }
  }

  private emitPeers(): void {
    const list = this.peerList();
    const fingerprint = JSON.stringify(
      list.map((p) => [p.id, p.name, p.connectionState, p.candidateType, p.rttMs, p.sameIp, p.proxy, p.via, p.lastHbAt, p.lastPollAt]),
    );
    if (fingerprint === this.lastPeersFingerprint) return;
    this.lastPeersFingerprint = fingerprint;
    this.opts.onPeersChanged?.(list);
  }
}
