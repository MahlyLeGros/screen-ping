/**
 * Downloads a Windows x64 FFmpeg build into vendor/ffmpeg/.
 * Prefer the static GPL build (single ffmpeg.exe, no DLL hell).
 * Set FORCE_FFMPEG_WIN=1 on Linux to fetch the Windows binary for packaging.
 */
const fs = require("fs");
const path = require("path");
const https = require("https");
const { execFileSync } = require("child_process");

const root = path.join(__dirname, "..");
const outDir = path.join(root, "vendor", "ffmpeg");
const forceWin = process.env.FORCE_FFMPEG_WIN === "1";
const wantWin = process.platform === "win32" || forceWin;
const exeName = wantWin ? "ffmpeg.exe" : "ffmpeg";
const outFile = path.join(outDir, exeName);

fs.mkdirSync(outDir, { recursive: true });

function looksValid(file) {
  if (!fs.existsSync(file)) return false;
  const st = fs.statSync(file);
  if (st.size < 1_000_000) return false; // real static builds are tens of MB
  return true;
}

if (looksValid(outFile)) {
  console.log("FFmpeg already present:", outFile, `(${fs.statSync(outFile).size} bytes)`);
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
            reject(new Error(`Download failed: ${res.statusCode} for ${current}`));
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

function findFile(dir, predicate) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) {
      const found = findFile(full, predicate);
      if (found) return found;
    } else if (predicate(name, full)) {
      return full;
    }
  }
  return null;
}

async function main() {
  if (!wantWin) {
    fs.writeFileSync(outFile, "#!/bin/sh\necho ffmpeg-placeholder\n");
    fs.chmodSync(outFile, 0o755);
    fs.writeFileSync(
      path.join(outDir, "README.txt"),
      "Run FORCE_FFMPEG_WIN=1 npm run fetch-ffmpeg (or run on Windows) to download a real Windows build.\n",
    );
    console.log("Wrote FFmpeg placeholder for non-Windows host:", outFile);
    return;
  }

  // Static GPL build — one self-contained ffmpeg.exe (no shared DLLs required).
  const url =
    "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip";

  console.log("Downloading", url);
  const zipBuf = await download(url);
  const zipPath = path.join(outDir, "ffmpeg.zip");
  fs.writeFileSync(zipPath, zipBuf);

  const extractDir = path.join(outDir, "_extract");
  fs.rmSync(extractDir, { recursive: true, force: true });
  fs.mkdirSync(extractDir, { recursive: true });

  try {
    execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-Command",
        `Expand-Archive -Path '${zipPath.replace(/'/g, "''")}' -DestinationPath '${extractDir.replace(/'/g, "''")}' -Force`,
      ],
      { stdio: "inherit" },
    );
  } catch {
    execFileSync("unzip", ["-o", zipPath, "-d", extractDir], { stdio: "inherit" });
  }

  const found = findFile(extractDir, (name) => name.toLowerCase() === "ffmpeg.exe");
  if (!found) throw new Error("ffmpeg.exe not found in archive");

  // Clean previous binaries / leftover DLLs from shared builds.
  for (const name of fs.readdirSync(outDir)) {
    if (name === "_extract" || name === "ffmpeg.zip") continue;
    if (/\.(exe|dll|so)$/i.test(name) || name === "ffmpeg") {
      fs.rmSync(path.join(outDir, name), { force: true });
    }
  }

  fs.copyFileSync(found, outFile);

  // If a shared build was used accidentally, also copy sibling DLLs from the same bin/ folder.
  const binDir = path.dirname(found);
  for (const name of fs.readdirSync(binDir)) {
    if (/\.dll$/i.test(name)) {
      fs.copyFileSync(path.join(binDir, name), path.join(outDir, name));
    }
  }

  fs.rmSync(extractDir, { recursive: true, force: true });
  fs.rmSync(zipPath, { force: true });
  console.log("Installed", outFile, `(${fs.statSync(outFile).size} bytes)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
