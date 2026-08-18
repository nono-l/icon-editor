import { defineConfig } from "vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

export default defineConfig({
  base: "./",
  plugins: [tailwindcss(), viteReact()],
  resolve: {
    alias: {
      "@/lib/kernel/fns": path.resolve("src/lib/kernel/fns.legacy.ts"),
      "@/lib/auth/use-current-user": path.resolve("src/lib/auth/legacy-session.ts"),
      "@/lib/auth/client": path.resolve("src/lib/auth/legacy-session.ts"),
      "@": path.resolve("src"),
    },
  },
  define: {
    "import.meta.env.VITE_LEGACY": JSON.stringify("1"),
    "import.meta.env.VITE_AUTH_ENABLED": JSON.stringify("true"),
  },
  build: {
    outDir: "legacy/app",
    emptyDirBeforeWrite: false,
    rollupOptions: {
      input: path.resolve("legacy-index.html"),
    },
  },
});
