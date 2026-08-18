/** LAN / same-NAT helpers. Numeric host IPs + ports for extra ICE. */

const PRIV4 = /^(10\.|192\.168\.|127\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/;
const PRIV6 = /^(::1|fe80:|fc|fd)/i;

export type LanHint = { ips: string[]; ports: number[] };

export function normalizeIp(raw: string): string {
  let ip = raw.trim().toLowerCase();
  if (ip.startsWith("::ffff:")) ip = ip.slice(7);
  if (ip.startsWith("[") && ip.includes("]")) ip = ip.slice(1, ip.indexOf("]"));
  const mapped = ip.match(/^(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (mapped) return mapped[1];
  return ip.slice(0, 64);
}

export function samePublicIp(a: string, b: string): boolean {
  const x = normalizeIp(a);
  const y = normalizeIp(b);
  return !!x && !!y && x === y;
}

export function isPrivateIp(ip: string): boolean {
  const n = normalizeIp(ip);
  if (!n) return false;
  if (PRIV4.test(n)) return true;
  if (n.includes(":") && PRIV6.test(n)) return true;
  return false;
}

export function isNumericIp(ip: string): boolean {
  const n = normalizeIp(ip);
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(n)) return true;
  if (n.includes(":") && !n.endsWith(".local")) return true;
  return false;
}

export function parseIceLine(candidate: string | null | undefined): {
  ip: string;
  port: number;
  typ: string;
} | null {
  if (!candidate) return null;
  const m = candidate.match(
    /candidate:\S+\s+\d+\s+\S+\s+\d+\s+(\S+)\s+(\d+)\s+typ\s+(\S+)/i,
  );
  if (!m) return null;
  const port = Number(m[2]);
  if (!Number.isFinite(port) || port < 1 || port > 65535) return null;
  return { ip: m[1], port, typ: m[3].toLowerCase() };
}

export function clientIpFromRequest(request: Request): string {
  const h = request.headers;
  const raw =
    h.get("cf-connecting-ip") ||
    h.get("x-real-ip") ||
    h.get("x-forwarded-for") ||
    "";
  const first = raw.split(",")[0] ?? "";
  return normalizeIp(first);
}

export function hostCandidateInit(ip: string, port: number): RTCIceCandidateInit {
  return {
    candidate: `candidate:lan 1 udp 2130706431 ${ip} ${port} typ host generation 0`,
    sdpMid: "0",
    sdpMLineIndex: 0,
  };
}

export async function gatherLanHints(ms = 700): Promise<LanHint> {
  if (typeof RTCPeerConnection === "undefined") return { ips: [], ports: [] };
  const ips = new Set<string>();
  const ports = new Set<number>();
  const pc = new RTCPeerConnection({ iceServers: [] });
  try {
    pc.createDataChannel("lan");
    pc.onicecandidate = (e) => {
      const line = e.candidate?.candidate;
      const parsed = parseIceLine(line);
      if (!parsed || parsed.typ !== "host") return;
      ports.add(parsed.port);
      if (isNumericIp(parsed.ip) && isPrivateIp(parsed.ip)) ips.add(normalizeIp(parsed.ip));
    };
    await pc.setLocalDescription(await pc.createOffer());
    await new Promise((r) => setTimeout(r, ms));
  } catch {
    /* gather is best-effort */
  } finally {
    pc.close();
  }
  return { ips: [...ips].slice(0, 8), ports: [...ports].slice(0, 8) };
}
