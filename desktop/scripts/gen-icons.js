const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const scriptDir = __dirname;
const ps1 = path.join(scriptDir, "gen-icons.ps1");
const assetsDir = path.join(scriptDir, "..", "assets");
const brandLogo = path.join(scriptDir, "..", "..", "brand", "logo-source.png");

if (!fs.existsSync(brandLogo)) {
  console.error("Missing brand/logo-source.png — place the official logo there.");
  process.exit(1);
}

fs.mkdirSync(assetsDir, { recursive: true });

try {
  execFileSync(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", ps1],
    { stdio: "inherit" }
  );
} catch (err) {
  console.error("gen-icons.ps1 failed:", err.message || err);
  process.exit(1);
}

async function writeIco() {
  // png-to-ico writes classic Windows ICO (needed for electron-builder / rcedit)
  const pngToIco = require("png-to-ico").default || require("png-to-ico");
  const sources = ["icon-16.png", "icon-24.png", "icon-32.png", "icon-48.png", "icon-256.png"]
    .map((name) => path.join(assetsDir, name))
    .filter((p) => fs.existsSync(p));
  if (!sources.length) {
    throw new Error("No PNG sources for icon.ico");
  }
  const buf = await pngToIco(sources);
  const dest = path.join(assetsDir, "icon.ico");
  fs.writeFileSync(dest, buf);
  console.log("Wrote", dest, `(${buf.length} bytes)`);
}

writeIco()
  .then(() => console.log("Icons ready."))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
