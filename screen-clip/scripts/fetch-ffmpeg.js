/**
 * Downloads a static FFmpeg build for Windows into vendor/ffmpeg/.
 * On non-Windows CI/dev hosts, creates a placeholder so packaging scripts still resolve.
 */
const fs = require("fs");
const path = require("path");
const https = require("https");
const { execFileSync } = require("child_process");

const root = path.join(__dirname, "..");
const outDir = path.join(root, "vendor", "ffmpeg");
const exeName = process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
const outFile = path.join(outDir, exeName);

fs.mkdirSync(outDir, { recursive: true });

if (fs.existsSync(outFile) && fs.statSync(outFile).size > 1000) {
  console.log("FFmpeg already present:", outFile);
  process.exit(0);
}

function download(url) {
  return new Promise((resolve, reject) => {
    const follow = (current) => {
      https
        .get(current, (res) => {
          if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            follow(res.headers.location);
            return;
          }
          if (res.statusCode !== 200) {
            reject(new Error(`Download failed: ${res.statusCode}`));
            res.resume();
            return;
          }
          const chunks = [];
          res.on("data", (c) => chunks.push(c));
          res.on("end", () => resolve(Buffer.concat(chunks)));
        })
        .on("error", reject);
    };
    follow(url);
  });
}

async function main() {
  // Official BtbN shared GPL build (essentials) — Windows x64 only for packaging.
  const url =
    "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl-shared.zip";

  if (process.platform !== "win32" && process.env.FORCE_FFMPEG_WIN !== "1") {
    // Placeholder so electron-builder extraResources does not fail in Linux agents.
    fs.writeFileSync(outFile, "#!/bin/sh\necho ffmpeg-placeholder\n");
    fs.chmodSync(outFile, 0o755);
    fs.writeFileSync(path.join(outDir, "README.txt"), "Run npm run fetch-ffmpeg on Windows to download a real build.\n");
    console.log("Wrote FFmpeg placeholder for non-Windows host:", outFile);
    return;
  }

  console.log("Downloading", url);
  const zipBuf = await download(url);
  const zipPath = path.join(outDir, "ffmpeg.zip");
  fs.writeFileSync(zipPath, zipBuf);

  const extractDir = path.join(outDir, "_extract");
  fs.rmSync(extractDir, { recursive: true, force: true });
  fs.mkdirSync(extractDir, { recursive: true });

  try {
    execFileSync("powershell.exe", [
      "-NoProfile",
      "-Command",
      `Expand-Archive -Path '${zipPath.replace(/'/g, "''")}' -DestinationPath '${extractDir.replace(/'/g, "''")}' -Force`,
    ], { stdio: "inherit" });
  } catch {
    // Fallback for environments with unzip
    execFileSync("unzip", ["-o", zipPath, "-d", extractDir], { stdio: "inherit" });
  }

  function findExe(dir) {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      const st = fs.statSync(full);
      if (st.isDirectory()) {
        const found = findExe(full);
        if (found) return found;
      } else if (name.toLowerCase() === "ffmpeg.exe" || name === "ffmpeg") {
        return full;
      }
    }
    return null;
  }

  const found = findExe(extractDir);
  if (!found) throw new Error("ffmpeg binary not found in archive");
  fs.copyFileSync(found, outFile);
  fs.rmSync(extractDir, { recursive: true, force: true });
  fs.rmSync(zipPath, { force: true });
  console.log("Installed", outFile);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
