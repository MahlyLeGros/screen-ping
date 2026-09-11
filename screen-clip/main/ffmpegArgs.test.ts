import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCaptureArgs,
  buildRemuxArgs,
  containerExtension,
  normalizeEncoding,
  segmentCountForBuffer,
  targetSize,
} from "./ffmpegArgs";
import { DEFAULT_SETTINGS, type ClipSettings } from "./store";

function settings(partial: Partial<ClipSettings> = {}): ClipSettings {
  return { ...DEFAULT_SETTINGS, ...partial };
}

test("normalizeEncoding forces VP9+Opus for webm", () => {
  const result = normalizeEncoding(
    settings({ containerFormat: "webm", videoEncoder: "libx264", audioCodec: "aac" }),
  );
  assert.equal(result.videoEncoder, "libvpx-vp9");
  assert.equal(result.audioCodec, "opus");
  assert.equal(result.containerFormat, "webm");
  assert.ok(result.warning);
});

test("normalizeEncoding forces webm when VP9 selected", () => {
  const result = normalizeEncoding(
    settings({ containerFormat: "mp4", videoEncoder: "libvpx-vp9", audioCodec: "aac" }),
  );
  assert.equal(result.containerFormat, "webm");
  assert.equal(result.audioCodec, "opus");
});

test("targetSize returns null for native", () => {
  assert.equal(targetSize(settings({ resolutionMode: "native" }), { width: 1920, height: 1080 }), null);
});

test("targetSize maps presets and even custom dims", () => {
  assert.deepEqual(targetSize(settings({ resolutionMode: "1280x720" }), { width: 1, height: 1 }), {
    width: 1280,
    height: 720,
  });
  assert.deepEqual(
    targetSize(settings({ resolutionMode: "custom", customWidth: 1281, customHeight: 721 }), {
      width: 1,
      height: 1,
    }),
    { width: 1280, height: 720 },
  );
});

test("segmentCountForBuffer keeps spare segment", () => {
  assert.equal(segmentCountForBuffer(30, 5), 7);
  assert.ok(segmentCountForBuffer(15, 5) >= 2);
});

test("buildCaptureArgs includes bitrate, fps, and scale on win32", () => {
  const args = buildCaptureArgs({
    settings: settings({
      fps: 60,
      videoBitrateKbps: 6000,
      resolutionMode: "1280x720",
      includeSystemAudio: true,
      includeMic: false,
    }),
    geometry: { offsetX: 0, offsetY: 0, width: 1920, height: 1080 },
    segmentPattern: "seg_%05d.mkv",
    segmentTimeSec: 5,
    platform: "win32",
  });
  assert.ok(args.includes("gdigrab"));
  assert.ok(args.includes("wasapi"));
  assert.ok(args.includes("loopback"));
  assert.ok(args.includes("6000k"));
  assert.ok(args.some((a) => a.includes("scale=1280:720")));
  assert.ok(args.includes("segment"));
});

test("buildRemuxArgs copies streams into output", () => {
  const args = buildRemuxArgs("list.txt", "out.mp4");
  assert.ok(args.includes("concat"));
  assert.ok(args.includes("copy"));
  assert.ok(args.includes("out.mp4"));
});

test("containerExtension passthrough", () => {
  assert.equal(containerExtension("mkv"), "mkv");
});
