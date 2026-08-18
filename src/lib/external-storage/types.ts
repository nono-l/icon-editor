/** Connection + tenant. App-agnostic. Copied from grokbuild-external-storage. */
export type RemoteStoreConfig = {
  proxyUrl: string;
  apiKey: string;
  basicUser: string;
  basicPass: string;
  namespace: string;
  appId: string;
  setupUrl: string;
  enabled: boolean;
};

export type RemoteKvItem = {
  key: string;
  updated_at: string;
};

export type RemoteSnapshotMeta = {
  id: number;
  title: string;
  kind: string;
  updated_at: string;
  created_at: string;
};

export type RemoteSnapshot = RemoteSnapshotMeta & {
  payload: unknown;
};

export const STUDIO_APP_ID = "icon-studio";
export const STUDIO_CONNECTOR_USER = "_studio";

export const DEFAULT_REMOTE_CONFIG: RemoteStoreConfig = {
  proxyUrl: "",
  apiKey: "",
  basicUser: "",
  basicPass: "",
  namespace: "default",
  appId: STUDIO_APP_ID,
  setupUrl: "",
  enabled: false,
};

export function composeNamespace(appId: string, tenant: string): string {
  const a = (appId || "app").trim() || "app";
  const t = (tenant || "default").trim() || "default";
  if (t === a || t.startsWith(`${a}.`)) return t;
  return `${a}.${t}`;
}
