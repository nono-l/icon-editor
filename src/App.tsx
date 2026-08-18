import { Toaster } from "sonner";
import { IconEditor } from "@/components/icon-editor";

export function App() {
  return (
    <div className="min-h-dvh bg-bg px-4 py-6 pb-10 text-fg sm:px-6 sm:py-10">
      <div className="mx-auto max-w-2xl">
        <header className="mb-6">
          <p className="text-[10px] tracking-[0.2em] text-fg-subtle">STANDALONE</p>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            アイコンエディタ
          </h1>
          <p className="mt-2 text-sm text-fg-muted">
            300×300 のアイコンと、1200×630 の OG 画像をブラウザだけで作れます。背景なしは透過PNGです。
          </p>
        </header>
        <IconEditor variant="page" />
      </div>
      <Toaster theme="dark" position="top-center" richColors />
    </div>
  );
}
