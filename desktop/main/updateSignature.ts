import crypto from "crypto";
import fs from "fs";
import path from "path";

import { UPDATE_PUBLIC_KEY } from "./updatePublicKey";
import { normalizeServerUrl } from "./serverUrl";
import store from "./store";

function sha512File(file: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha512");
    const stream = fs.createReadStream(file);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest()));
  });
}

export async function verifyDownloadedUpdate(installerPath: string): Promise<boolean> {
  const base = normalizeServerUrl(store.get("serverUrl"));
  const name = path.basename(installerPath);
  const response = await fetch(`${base}/desktop/updates/${encodeURIComponent(name)}.sig`, { cache: "no-store" });
  if (!response.ok) return false;
  const signature = Buffer.from((await response.text()).trim(), "base64");
  const digest = await sha512File(installerPath);
  return crypto.verify(null, digest, UPDATE_PUBLIC_KEY, signature);
}
