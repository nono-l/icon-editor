import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outdir = resolve(root, "legacy/app");
mkdirSync(outdir, { recursive: true });

const r = spawnSync(
  process.execPath,
  [resolve(root, "node_modules/vite/bin/vite.js"), "build", "--config", "vite.legacy.config.ts"],
  { cwd: root, stdio: "inherit" },
);
if (r.status !== 0) process.exit(r.status ?? 1);

const built = existsSync(resolve(outdir, "legacy-index.html"))
  ? resolve(outdir, "legacy-index.html")
  : resolve(outdir, "index.html");
let html = readFileSync(built, "utf8");
html = html.replaceAll("./assets/", "/app/assets/");
html = html.replaceAll("src=\"assets/", "src=\"/app/assets/");
html = html.replaceAll("href=\"assets/", "href=\"/app/assets/");
writeFileSync(resolve(outdir, "index.html"), html);
const fav = resolve(root, "public/favicon.svg");
if (existsSync(fav)) cpSync(fav, resolve(outdir, "favicon.svg"));
console.log("legacy build →", outdir);
