import { chromium } from "playwright";
import { writeFile, mkdir } from "node:fs/promises";

const html = `<!doctype html>
<meta charset="utf-8" />
<canvas id="c" width="1200" height="630"></canvas>
<script>
const c = document.getElementById("c");
const ctx = c.getContext("2d");
const W = 1200, H = 630;

function rr(x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function chip(x, y, label, on) {
  ctx.font = "600 15px 'Hiragino Sans','Noto Sans JP',sans-serif";
  const w = ctx.measureText(label).width + 22;
  rr(x, y, w, 30, 8);
  ctx.fillStyle = on ? "rgba(125,211,192,0.16)" : "#1a1d26";
  ctx.fill();
  ctx.strokeStyle = on ? "#7dd3c0" : "#2a2f3a";
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = on ? "#7dd3c0" : "#9aa3b2";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(label, x + 11, y + 16);
  return w;
}

// page wash
ctx.fillStyle = "#08090b";
ctx.fillRect(0, 0, W, H);

// window
const wx = 48, wy = 36, ww = 1104, wh = 558;
rr(wx, wy, ww, wh, 20);
ctx.fillStyle = "#12141a";
ctx.fill();
ctx.strokeStyle = "#2a2f3a";
ctx.lineWidth = 1.5;
ctx.stroke();

// title bar
rr(wx, wy, ww, 56, [20, 20, 0, 0]);
ctx.fillStyle = "#161922";
ctx.fill();
ctx.beginPath();
ctx.moveTo(wx, wy + 56);
ctx.lineTo(wx + ww, wy + 56);
ctx.strokeStyle = "#2a2f3a";
ctx.stroke();

// traffic lights
[["#f07178", 76], ["#e6c07b", 98], ["#7dd3c0", 120]].forEach(([col, x]) => {
  ctx.beginPath();
  ctx.arc(x, wy + 28, 7, 0, Math.PI * 2);
  ctx.fillStyle = col;
  ctx.fill();
});

ctx.fillStyle = "#eef0f4";
ctx.font = "700 20px 'Hiragino Sans','Noto Sans JP',sans-serif";
ctx.textAlign = "left";
ctx.textBaseline = "middle";
ctx.fillText("アイコンエディタ", 148, wy + 28);
ctx.fillStyle = "#6b7385";
ctx.font = "500 14px 'Hiragino Sans','Noto Sans JP',sans-serif";
ctx.fillText("ログイン不要  ·  置いて揃えて書き出す", 330, wy + 28);

// left canvas card
const cx = 78, cy = 114, cs = 360;
rr(cx, cy, cs, cs, 16);
ctx.fillStyle = "#0a0b0d";
ctx.fill();

// checkerboard
const cell = 16;
ctx.save();
ctx.beginPath();
ctx.roundRect(cx + 14, cy + 14, cs - 28, cs - 28, 8);
ctx.clip();
for (let y = cy + 14; y < cy + cs - 14; y += cell) {
  for (let x = cx + 14; x < cx + cs - 14; x += cell) {
    const odd = (((x - cx) / cell) + ((y - cy) / cell)) % 2 === 0;
    ctx.fillStyle = odd ? "#1c1f26" : "#12141a";
    ctx.fillRect(x, y, cell, cell);
  }
}
ctx.restore();

// crop ring
ctx.strokeStyle = "rgba(238,240,244,0.82)";
ctx.lineWidth = 3;
ctx.strokeRect(cx + 18, cy + 18, cs - 36, cs - 36);

// image blob
const g = ctx.createLinearGradient(cx + 86, cy + 78, cx + 270, cy + 268);
g.addColorStop(0, "hsl(168 32% 32%)");
g.addColorStop(1, "hsl(214 24% 16%)");
rr(cx + 86, cy + 78, 188, 188, 20);
ctx.fillStyle = g;
ctx.fill();
ctx.fillStyle = "#eef0f4";
ctx.font = "700 78px 'Hiragino Sans','Noto Sans JP',sans-serif";
ctx.textAlign = "center";
ctx.textBaseline = "middle";
ctx.fillText("あ", cx + 180, cy + 176);

// selection + handles around the blob
const bx = cx + 86, by = cy + 78, bw = 188, bh = 188;
ctx.save();
ctx.strokeStyle = "rgba(125,211,192,0.95)";
ctx.lineWidth = 2;
ctx.setLineDash([6, 4]);
ctx.strokeRect(bx - 4, by - 4, bw + 8, bh + 8);
ctx.setLineDash([]);
ctx.beginPath();
ctx.moveTo(bx + bw / 2, by - 4);
ctx.lineTo(bx + bw / 2, by - 28);
ctx.stroke();
ctx.fillStyle = "#7dd3c0";
ctx.strokeStyle = "#0a0b0d";
ctx.lineWidth = 1.5;
const hs = [
  [bx - 4, by - 4], [bx + bw / 2, by - 4], [bx + bw + 4, by - 4],
  [bx + bw + 4, by + bh / 2], [bx + bw + 4, by + bh + 4],
  [bx + bw / 2, by + bh + 4], [bx - 4, by + bh + 4], [bx - 4, by + bh / 2],
];
hs.forEach(([x, y]) => {
  ctx.fillRect(x - 5, y - 5, 10, 10);
  ctx.strokeRect(x - 5, y - 5, 10, 10);
});
ctx.beginPath();
ctx.arc(bx + bw / 2, by - 28, 6, 0, Math.PI * 2);
ctx.fill();
ctx.stroke();
ctx.restore();

// text layer
ctx.save();
ctx.font = "700 36px 'Hiragino Sans','Noto Sans JP',sans-serif";
ctx.textAlign = "center";
ctx.lineJoin = "round";
ctx.lineWidth = 8;
ctx.strokeStyle = "#111318";
ctx.strokeText("ICON", cx + 180, cy + 308);
ctx.fillStyle = "#7dd3c0";
ctx.fillText("ICON", cx + 180, cy + 308);
ctx.restore();

// right panel
const px = 468, py = 114;
ctx.fillStyle = "#eef0f4";
ctx.font = "700 44px 'Hiragino Sans','Noto Sans JP',sans-serif";
ctx.textAlign = "left";
ctx.textBaseline = "alphabetic";
ctx.fillText("画像も文字も、ここで完結。", px, py + 46);

ctx.fillStyle = "#9aa3b2";
ctx.font = "500 20px 'Hiragino Sans','Noto Sans JP',sans-serif";
ctx.fillText("ガイドに吸い付く。縁取りと影。指定色を透明に。", px, py + 84);
ctx.fillText("アイコンもOGも、この画面だけで書き出せます。", px, py + 114);

let x = px;
x += chip(x, py + 146, "300×300", true) + 8;
x += chip(x, py + 146, "OG 1200×630", true) + 8;
chip(x, py + 146, "透過PNG", true);

// tool row
const tools = ["画像", "文字", "ガイド", "縦横比ロック"];
let tx = px;
tools.forEach((t, i) => {
  const w = chip(tx, py + 196, t, i === 3);
  tx += w + 8;
});

// fake layer list
const layers = [
  { name: "文字 · ICON", on: true },
  { name: "画像", on: false },
  { name: "ガイド（十字）", on: false },
];
layers.forEach((l, i) => {
  const y = py + 250 + i * 52;
  rr(px, y, 600, 46, 10);
  ctx.fillStyle = l.on ? "rgba(125,211,192,0.10)" : "#1a1d26";
  ctx.fill();
  ctx.strokeStyle = l.on ? "#7dd3c0" : "#2a2f3a";
  ctx.stroke();
  ctx.fillStyle = l.on ? "#eef0f4" : "#9aa3b2";
  ctx.font = "600 16px 'Hiragino Sans','Noto Sans JP',sans-serif";
  ctx.textBaseline = "middle";
  ctx.fillText(l.name, px + 16, y + 24);
  if (l.on) {
    ctx.fillStyle = "#7dd3c0";
    ctx.font = "600 11px 'Hiragino Sans','Noto Sans JP',sans-serif";
    ctx.fillText("選択中", px + 520, y + 24);
  }
});

// footer of window
ctx.fillStyle = "#6b7385";
ctx.font = "500 14px 'Hiragino Sans','Noto Sans JP',sans-serif";
ctx.textBaseline = "alphabetic";
ctx.fillText("アカウント不要  ·  ブラウザだけで編集・ダウンロード", px, py + 430);
</script>`;

const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const page = await browser.newPage({
  viewport: { width: 1200, height: 630 },
  deviceScaleFactor: 1,
});
await page.setContent(html, { waitUntil: "load" });
const buf = await page.locator("#c").screenshot({ type: "png" });
await mkdir("/workspace/public", { recursive: true });
await writeFile("/workspace/public/og-icon.png", buf);
await browser.close();
console.log("wrote /workspace/public/og-icon.png", buf.length);
