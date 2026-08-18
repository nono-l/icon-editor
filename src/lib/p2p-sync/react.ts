/**
 * Optional React binding. room / selfId / name are captured on mount —
 * change them by remounting (key the component).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { P2PRoom } from "./room";
import type { DataChannelKind, PeerInfo } from "./types";

export interface UseP2PRoomOptions {
  room: string;
  selfId: string;
  name?: string;
  signalingUrl?: string;
}

export function useP2PRoom(options: UseP2PRoomOptions) {
  const [room] = useState(() => options.room);
  const [selfId] = useState(() => options.selfId);
  const [name] = useState(() => options.name ?? options.selfId);
  const [signalingUrl] = useState(() => options.signalingUrl);
  const [peers, setPeers] = useState<PeerInfo[]>([]);
  const [joined, setJoined] = useState(false);
  const roomRef = useRef<P2PRoom | null>(null);
  const listeners = useRef(
    new Set<(from: string, data: unknown, channel: DataChannelKind) => void>(),
  );

  useEffect(() => {
    const p2p = new P2PRoom({
      room,
      selfId,
      name,
      signalingUrl,
      onPeersChanged: setPeers,
      onMessage: (from, data, channel) => {
        for (const fn of listeners.current) fn(from, data, channel);
      },
      onConnected: () => setJoined(true),
    });
    roomRef.current = p2p;
    void p2p.join();
    return () => {
      roomRef.current = null;
      p2p.close();
    };
  }, [room, selfId, name, signalingUrl]);

  const broadcast = useCallback((data: unknown) => {
    roomRef.current?.broadcast(data);
  }, []);
  const send = useCallback((data: unknown, peerId?: string) => {
    roomRef.current?.send(data, peerId);
  }, []);
  const onMessage = useCallback(
    (fn: (from: string, data: unknown, channel: DataChannelKind) => void) => {
      listeners.current.add(fn);
      return () => {
        listeners.current.delete(fn);
      };
    },
    [],
  );
  const rejoin = useCallback(() => {
    roomRef.current?.close();
    const p2p = new P2PRoom({
      room,
      selfId,
      name,
      signalingUrl,
      onPeersChanged: setPeers,
      onMessage: (from, data, channel) => {
        for (const fn of listeners.current) fn(from, data, channel);
      },
      onConnected: () => setJoined(true),
    });
    roomRef.current = p2p;
    setJoined(false);
    void p2p.join();
  }, [room, selfId, name, signalingUrl]);

  return { selfId, room, peers, joined, broadcast, send, onMessage, rejoin };
}
