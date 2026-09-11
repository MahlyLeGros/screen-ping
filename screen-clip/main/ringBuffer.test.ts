import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import {
  formatClipFilename,
  pruneSegments,
  selectSegmentsForFlush,
  writeConcatList,
} from "./ringBuffer";

test("pruneSegments keeps newest N files", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "screen-clip-ring-"));
  try {
    for (let i = 0; i < 5; i++) {
      const file = path.join(dir, `seg_${String(i).padStart(3, "0")}.mkv`);
      fs.writeFileSync(file, "x");
      const t = Date.now() - (5 - i) * 1000;
      fs.utimesSync(file, new Date(t), new Date(t));
    }
    const kept = pruneSegments(dir, 3);
    assert.equal(kept.length, 3);
    assert.equal(fs.readdirSync(dir).filter((n) => n.endsWith(".mkv")).length, 3);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("selectSegmentsForFlush returns chronological newest slice", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "screen-clip-flush-"));
  try {
    for (let i = 0; i < 4; i++) {
      const file = path.join(dir, `seg_${String(i).padStart(3, "0")}.mkv`);
      fs.writeFileSync(file, "x");
      const t = Date.now() - (4 - i) * 1000;
      fs.utimesSync(file, new Date(t), new Date(t));
    }
    const selected = selectSegmentsForFlush(dir, 2);
    assert.equal(selected.length, 2);
    assert.ok(selected[0].endsWith("seg_002.mkv") || selected[0].includes("seg_002"));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("writeConcatList escapes paths for ffmpeg concat demuxer", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "screen-clip-concat-"));
  try {
    const list = path.join(dir, "list.txt");
    writeConcatList([path.join(dir, "a b.mkv"), path.join(dir, "c'd.mkv")], list);
    const body = fs.readFileSync(list, "utf8");
    assert.match(body, /file '/);
    assert.match(body, /a b\.mkv/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("formatClipFilename uses clip_YYYYMMDD_HHMMSS.ext", () => {
  const name = formatClipFilename(new Date(2026, 8, 11, 3, 52, 1), "mp4");
  assert.equal(name, "clip_20260911_035201.mp4");
});
