import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import test from "node:test";
import { assertFfmpegAvailable, ffmpegCandidatePaths, resolveFfmpegPath } from "./ffmpegPath";

test("ffmpegCandidatePaths returns absolute unique paths", () => {
  const paths = ffmpegCandidatePaths();
  assert.ok(paths.length >= 1);
  const set = new Set(paths);
  assert.equal(set.size, paths.length);
  for (const p of paths) {
    assert.equal(p, path.resolve(p));
  }
});

test("resolveFfmpegPath finds vendor binary via cwd when present", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sc-ffmpeg-"));
  const vendorDir = path.join(tmp, "vendor", "ffmpeg");
  fs.mkdirSync(vendorDir, { recursive: true });
  const exe = process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
  const bin = path.join(vendorDir, exe);
  fs.writeFileSync(bin, "fake");

  const prevCwd = process.cwd();
  try {
    process.chdir(tmp);
    const resolved = resolveFfmpegPath();
    assert.equal(resolved, path.resolve(bin));
    assert.equal(assertFfmpegAvailable(resolved), path.resolve(bin));
  } finally {
    process.chdir(prevCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("assertFfmpegAvailable throws a helpful error for bare missing name", () => {
  assert.throws(
    () => assertFfmpegAvailable("ffmpeg-definitely-missing-xyz.exe"),
    /ffmpeg/,
  );
});
