/**
 * Rewrite electron-builder latest.yml so file URLs are absolute.
 * Used for per-version feeds at /desktop/updates/v/{version}/latest.yml
 * while installers stay in /desktop/updates/.
 */
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");

function usage() {
  console.error(
    "Usage: node write-version-feed.js <latest.yml> <version> <installer-file-name> <out-dir> [base-url]",
  );
  process.exit(1);
}

const latestYml = process.argv[2];
const version = process.argv[3];
const installerName = process.argv[4];
const outDir = process.argv[5];
const baseUrl = (process.argv[6] || "https://screenping.xyz/desktop/updates").replace(/\/$/, "");

if (!latestYml || !version || !installerName || !outDir) usage();

const absInstallerUrl = `${baseUrl}/${encodeURIComponent(installerName)}`;
const raw = fs.readFileSync(latestYml, "utf8");
const rewritten = raw
  .split(/\r?\n/)
  .map((line) => {
    const urlMatch = line.match(/^(\s*url:\s*)(.+)$/);
    if (urlMatch) {
      const value = urlMatch[2].trim().replace(/^['"]|['"]$/g, "");
      if (!/^https?:\/\//i.test(value)) {
        return `${urlMatch[1]}${absInstallerUrl}`;
      }
    }
    return line;
  })
  .join("\n");

fs.mkdirSync(outDir, { recursive: true });
const dest = path.join(outDir, "latest.yml");
fs.writeFileSync(dest, rewritten, "utf8");
console.log("Wrote version feed", dest, "->", absInstallerUrl);
// Touch so tooling knows path exists
void pathToFileURL;
