const path = require("path");
const fs = require("fs");

async function main() {
  const { rcedit } = require("rcedit");
  const root = path.join(__dirname, "..");
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const exe =
    process.argv[2] ||
    path.join(root, "release", "win-unpacked", "Screen Ping.exe");
  const ico = path.join(root, "assets", "icon.ico");
  if (!fs.existsSync(exe)) {
    console.error("EXE not found:", exe);
    process.exit(1);
  }
  if (!fs.existsSync(ico)) {
    console.error("ICO not found:", ico);
    process.exit(1);
  }

  const version = String(pkg.version || "0.0.0");
  const product = pkg.build?.productName || "Screen Ping";
  console.log("Stamping icon and version onto", exe);
  await rcedit(exe, {
    icon: ico,
    "file-version": version,
    "product-version": version,
    "version-string": {
      ProductName: product,
      FileDescription: product,
      CompanyName: product,
      InternalName: product,
      OriginalFilename: `${product}.exe`,
      LegalCopyright: `Copyright ${new Date().getFullYear()} ${product}`,
    },
  });
  console.log("Icon and version stamped OK");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
