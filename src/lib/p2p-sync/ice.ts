function envStr(key: string): string | undefined {
  try {
    const env = (import.meta as { env?: Record<string, string | undefined> }).env;
    return env?.[key];
  } catch {
    return undefined;
  }
}

export function defaultIceServers(): RTCIceServer[] {
  const stunRaw = envStr("VITE_STUN_URLS");
  const stun = stunRaw
    ?.split(",")
    .map((u) => u.trim())
    .filter(Boolean);
  const turnUrls = envStr("VITE_TURN_URLS")
    ?.split(",")
    .map((u) => u.trim())
    .filter(Boolean);
  const turnUser = envStr("VITE_TURN_USERNAME") ?? "openrelayproject";
  const turnPass = envStr("VITE_TURN_CREDENTIAL") ?? "openrelayproject";

  const servers: RTCIceServer[] = [
    {
      urls: stun?.length
        ? stun
        : ["stun:stun.l.google.com:19302", "stun:stun.cloudflare.com:3478"],
    },
  ];
  const relays = turnUrls?.length
    ? turnUrls
    : [
        "turn:openrelay.metered.ca:80",
        "turn:openrelay.metered.ca:443",
        "turn:openrelay.metered.ca:443?transport=tcp",
      ];
  servers.push({
    urls: relays,
    username: turnUser,
    credential: turnPass,
  });
  return servers;
}
