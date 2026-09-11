/**
 * After electron-builder packs the app, also place ffmpeg.exe next to
 * Screen Clip.exe so portable extracts keep working even if resourcesPath
 * resolution fails on some Windows setups.
 */
const fs = require("fs");
const path = require("path");

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== "win32") return;

  const exeName = "ffmpeg.exe";
  const from = path.join(context.appOutDir, "resources", "ffmpeg", exeName);
  const to = path.join(context.appOutDir, exeName);

  if (!fs.existsSync(from)) {
    console.warn(`[afterPack] bundled ffmpeg missing at ${from}`);
    return;
  }

  fs.copyFileSync(from, to);
  console.log(`[afterPack] copied ${exeName} next to app executable`);
};
