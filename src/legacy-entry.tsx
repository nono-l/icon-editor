import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { IconEditor } from "@/components/icon-editor";
import { Toaster } from "sonner";
import {
  registerEmail,
  signInEmail,
  signOut,
  useCurrentUserState,
} from "@/lib/auth/legacy-session";
import { getMyStudio, saveConnectorSettings, savePromo } from "@/lib/kernel/fns.legacy";
import { GUEST_STUDIO, type StudioState } from "@/components/app-shell";
import "./styles.css";

function StaffBox() {
  const [code, setCode] = useState("");
  const [ink, setInk] = useState("5");
  const [proxy, setProxy] = useState("");
  const [key, setKey] = useState("");
  const [msg, setMsg] = useState("");
  return (
    <section className="mt-8 rounded-xl border border-border bg-bg-elevated p-4 text-sm">
      <h2 className="font-medium">管理者</h2>
      <p className="mt-1 text-xs text-fg-muted">プロモコードと外部ストレージ（Vercel を使わない本番用）</p>
      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        <input className="rounded-md border border-border bg-bg px-3 py-2" placeholder="CODE" value={code} onChange={(e) => setCode(e.target.value)} />
        <input className="rounded-md border border-border bg-bg px-3 py-2" placeholder="インク" value={ink} onChange={(e) => setInk(e.target.value)} />
        <button
          type="button"
          className="rounded-md bg-primary px-3 py-2 text-primary-fg"
          onClick={() => {
            void savePromo({ data: { code, grant: { ink: Number(ink) || 0 } } }).then(() => setMsg("コードを保存しました"));
          }}
        >
          コード発行
        </button>
      </div>
      <div className="mt-3 grid gap-2">
        <input className="rounded-md border border-border bg-bg px-3 py-2" placeholder="外部ストレージ proxy URL" value={proxy} onChange={(e) => setProxy(e.target.value)} />
        <input className="rounded-md border border-border bg-bg px-3 py-2" placeholder="APIキー" value={key} onChange={(e) => setKey(e.target.value)} />
        <button
          type="button"
          className="rounded-md border border-border px-3 py-2"
          onClick={() => {
            void saveConnectorSettings({
              data: { proxyUrl: proxy, apiKey: key, enabled: true },
            }).then(() => setMsg("ストレージを保存しました"));
          }}
        >
          ストレージ保存
        </button>
      </div>
      {msg && <p className="mt-2 text-xs text-primary">{msg}</p>}
    </section>
  );
}

function pathRoom(): string | null {
  const m = location.pathname.match(/\/join\/([A-Za-z0-9_-]{2,16})/i);
  if (m) return m[1].toUpperCase();
  const q = new URLSearchParams(location.search).get("room");
  return q ? q.toUpperCase() : null;
}

function App() {
  const { user, isPending } = useCurrentUserState();
  const [studio, setStudio] = useState<StudioState>(GUEST_STUDIO);
  const [room, setRoom] = useState<string | null>(() => pathRoom());
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"login" | "register">("login");
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!user) {
      setStudio(GUEST_STUDIO);
      return;
    }
    void getMyStudio()
      .then((s) => setStudio(s as StudioState))
      .catch(() => setStudio({ ...GUEST_STUDIO, signedIn: true, userId: user.id }));
  }, [user]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    const fn = mode === "register" ? registerEmail : signInEmail;
    const r = await fn(email, password);
    if (r.error || !r.user) {
      setErr(r.error === "exists" ? "登録済みです" : "ログインできません");
      return;
    }
    location.reload();
  }

  return (
    <div className="min-h-dvh bg-bg text-fg">
      <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div>
          <p className="text-[10px] tracking-[0.2em] text-primary">ICON STUDIO</p>
          <p className="text-sm text-fg-muted">レガシーサーバー / PHP + MySQL</p>
        </div>
        {user ? (
          <button
            type="button"
            className="rounded-full border border-border px-3 py-1 text-xs"
            onClick={() => void signOut().then(() => location.reload())}
          >
            {user.displayName} · ログアウト
          </button>
        ) : null}
      </header>
      <main className="mx-auto max-w-3xl px-4 py-5">
        {!isPending && !user && (
          <form onSubmit={(e) => void submit(e)} className="mb-6 rounded-xl border border-border bg-bg-elevated p-4">
            <h2 className="text-sm font-medium">
              {mode === "login" ? "ログイン" : "新規登録"}
            </h2>
            <input
              className="mt-3 w-full rounded-md border border-border bg-bg px-3 py-2 text-sm"
              placeholder="メール"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            <input
              className="mt-2 w-full rounded-md border border-border bg-bg px-3 py-2 text-sm"
              placeholder="パスワード（6文字以上）"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
            />
            {err && <p className="mt-2 text-xs text-red-300">{err}</p>}
            <button type="submit" className="mt-3 h-10 w-full rounded-md bg-primary text-sm font-medium text-primary-fg">
              {mode === "login" ? "入る" : "登録して入る"}
            </button>
            <button
              type="button"
              className="mt-2 w-full text-xs text-fg-muted"
              onClick={() => setMode(mode === "login" ? "register" : "login")}
            >
              {mode === "login" ? "新規登録する" : "ログインに戻る"}
            </button>
          </form>
        )}
        <IconEditor
          enableCollab
          roomCode={room}
          displayName={studio.signedIn ? studio.userId?.slice(0, 8) || "メンバー" : "ゲスト"}
          onRoomChange={setRoom}
        />
        {studio.isStaff && <StaffBox />}
      </main>
      <Toaster theme="dark" />
    </div>
  );
}

const el = document.getElementById("root");
if (el) createRoot(el).render(<App />);
