/**
 * electron-builder only writes resources/app-update.yml when packaging an NSIS
 * (or similar) target. Our dist flow packs with --dir first so we can stamp
 * the icon, then builds NSIS from --prepackaged — so this file must be written
 * by hand or auto-update fails with ENOENT.
 */
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const publish = Array.isArray(pkg.build?.publish) ? pkg.build.publish[0] : pkg.build?.publish;

if (!publish || !publish.provider || !publish.url) {
  console.error("No build.publish.url in package.json — cannot write app-update.yml");
  process.exit(1);
}

const outDir = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(root, "release", "win-unpacked", "resources");

fs.mkdirSync(outDir, { recursive: true });

const lines = [
  `provider: ${publish.provider}`,
  `url: ${publish.url}`,
  `updaterCacheDirName: ${pkg.name}-updater`,
  "",
];

const dest = path.join(outDir, "app-update.yml");
fs.writeFileSync(dest, lines.join("\n"), "utf8");
console.log("Wrote", dest);
