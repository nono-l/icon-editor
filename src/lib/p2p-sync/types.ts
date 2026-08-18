/** Wire contract between the client and any HTTP signaling relay. */

export type SignalKind = "offer" | "answer" | "ice" | "lan" | "bus";

export interface PeerRow {
  id: string;
  name: string;
  /** True when this peer's public IP matches the polling client. */
  sameIp?: boolean;
}

export interface SignalRow {
  id: number;
  from: string;
  kind: SignalKind;
  payload: unknown;
}

export interface RtcPollResponse {
  peers: PeerRow[];
  signals: SignalRow[];
}

export interface PeerInfo {
  id: string;
  name: string;
  connectionState: RTCPeerConnectionState;
  /** Selected local ICE candidate type: host | srflx | prflx | relay. */
  candidateType: string | null;
  /** Data-channel ping RTT (ms), measured every 2s once connected. */
  rttMs: number | null;
  /** Date.now() of last WebRTC ping/pong or data-channel message. */
  lastHbAt: number | null;
  /** Date.now() of last signaling poll / SSE tick. */
  lastPollAt: number | null;
  /** Server saw the same public IP as us. */
  sameIp: boolean;
  /** This peer has both LAN and WAN links and will relay. */
  proxy: boolean;
  /** Immediate peer we heard this origin through, if not direct. */
  via: string | null;
}

export type DataChannelKind = "state" | "reliable";

export interface P2PRoomOptions {
  room: string;
  selfId: string;
  name?: string;
  /**
   * Signaling HTTP endpoint (GET poll + POST signal/leave).
   * Default: `/api/rtc`
   */
  signalingUrl?: string;
  iceServers?: RTCIceServer[];
  onPeersChanged?: (peers: PeerInfo[]) => void;
  onMessage?: (
    from: string,
    data: unknown,
    channel: DataChannelKind,
  ) => void;
  /** First successful signaling poll (self is on the roster). */
  onConnected?: () => void;
}

/** Minimal SQL surface the reference signaling handler needs. */
export type QueryFn = <T = Record<string, unknown>>(
  text: string,
  params?: unknown[],
) => Promise<T[]>;
