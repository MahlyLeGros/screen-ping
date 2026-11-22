// Copies the Electron renderer build (desktop/dist/renderer) to dist/ for
// Tauri, and lets the pages reach Tauri's IPC endpoint. The pages' CSP says
// `connect-src 'none'`, which would push Tauri onto its slower fallback.
// Run `npx vite build` in desktop/ first.
import { cpSync, readdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, "..", "..", "desktop", "dist", "renderer");
const out = join(here, "..", "dist");
if (!existsSync(join(src, "overlay.html"))) {
  console.error(`Missing ${src}. Run "npx vite build" in desktop/ first.`);
  process.exit(1);
}
rmSync(out, { recursive: true, force: true });
cpSync(src, out, { recursive: true });
let patched = 0;
for (const name of readdirSync(out).filter((n) => n.endsWith(".html"))) {
  const file = join(out, name);
  const html = readFileSync(file, "utf8");
  const next = html.replaceAll("connect-src 'none'", "connect-src ipc: http://ipc.localhost");
  if (next !== html) patched++;
  writeFileSync(file, next);
}
console.log(`renderer copied to ${out} (${patched} pages patched for Tauri IPC)`);
