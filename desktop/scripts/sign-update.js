const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const installer = process.argv[2];
const privatePath = process.env.SCREENPING_UPDATE_PRIVATE_KEY || process.argv[3];
if (!installer || !privatePath) throw new Error("Usage: node sign-update.js <installer.exe> <private.pem>");
const digest = crypto.createHash("sha512").update(fs.readFileSync(installer)).digest();
const key = fs.readFileSync(privatePath);
const signature = crypto.sign(null, digest, key).toString("base64");
fs.writeFileSync(`${installer}.sig`, `${signature}\n`, "utf8");
console.log(`Signed ${path.basename(installer)} -> ${path.basename(installer)}.sig`);
