import type { RemoteSnapshot, RemoteSnapshotMeta, RemoteStoreConfig } from "./types";
import { composeNamespace } from "./types";

export type ProxyResult<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: string; status?: number };

type ProxyEnvelope = {
  ok?: boolean;
  error?: string;
  [key: string]: unknown;
};

export type AccessLogItem = {
  id: number;
  ip: string;
  action: string;
  ok: number;
  http_status: number;
  origin?: string | null;
  namespace?: string | null;
  note?: string | null;
  created_at: string;
};

export type AccessIpItem = {
  ip: string;
  hits: number;
  ok_hits: number;
  last_seen: string;
  first_seen: string;
};

function encodeBasic(user: string, pass: string): string {
  const raw = `${user}:${pass}`;
  if (typeof btoa === "function") return btoa(raw);
  return Buffer.from(raw, "utf8").toString("base64");
}

function buildHeaders(config: RemoteStoreConfig): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Api-Key": config.apiKey.trim(),
  };
  const user = config.basicUser?.trim() ?? "";
  const pass = config.basicPass ?? "";
  if (user) headers.Authorization = `Basic ${encodeBasic(user, pass)}`;
  return headers;
}

/** Browser → php-api/proxy.php. Bypasses Vercel body limits. */
export async function callRemoteProxy<T = ProxyEnvelope>(
  config: RemoteStoreConfig,
  body: Record<string, unknown>,
): Promise<ProxyResult<T>> {
  const url = config.proxyUrl.trim();
  if (!url) return { ok: false, error: "プロキシ URL が未設定です" };
  if (!config.apiKey.trim()) return { ok: false, error: "API キーが未設定です" };
  if (!config.namespace.trim()) return { ok: false, error: "名前空間が未設定です" };

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: buildHeaders(config),
      body: JSON.stringify({
        ...body,
        namespace:
          typeof body.namespace === "string"
            ? body.namespace
            : composeNamespace(config.appId, config.namespace),
      }),
    });
    let json: ProxyEnvelope | null = null;
    try {
      json = (await res.json()) as ProxyEnvelope;
    } catch {
      return {
        ok: false,
        error: res.status === 401 ? "401 認証エラー" : `応答が JSON ではありません (HTTP ${res.status})`,
        status: res.status,
      };
    }
    if (!res.ok || json.ok === false) {
      return { ok: false, error: (json.error as string) || `HTTP ${res.status}`, status: res.status };
    }
    return { ok: true, data: json as T };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "ネットワークエラー（CORS や URL を確認）",
    };
  }
}

export async function remotePing(config: RemoteStoreConfig) {
  return callRemoteProxy(config, { action: "ping" });
}

export async function remoteLogRecent(config: RemoteStoreConfig, limit = 20) {
  return callRemoteProxy<{ ok: true; items: AccessLogItem[]; your_ip?: string }>(config, {
    action: "log.recent",
    limit,
  });
}

export async function remoteLogIps(config: RemoteStoreConfig) {
  return callRemoteProxy<{ ok: true; items: AccessIpItem[]; your_ip?: string }>(config, {
    action: "log.ips",
  });
}

export async function remoteSnapSave(
  config: RemoteStoreConfig,
  opts: { title: string; kind?: string; payload: unknown; id?: number },
) {
  return callRemoteProxy<{ ok: true; id: number }>(config, {
    action: "snap.save",
    title: opts.title,
    kind: opts.kind ?? "material",
    payload: opts.payload,
    ...(opts.id ? { id: opts.id } : {}),
  });
}

export async function remoteSnapList(config: RemoteStoreConfig, kind?: string) {
  return callRemoteProxy<{ ok: true; items: RemoteSnapshotMeta[] }>(config, {
    action: "snap.list",
    ...(kind ? { kind } : {}),
  });
}

export async function remoteSnapGet(config: RemoteStoreConfig, id: number) {
  return callRemoteProxy<{ ok: true; found: boolean; item?: RemoteSnapshot }>(config, {
    action: "snap.get",
    id,
  });
}
