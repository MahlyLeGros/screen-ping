import type {
  AudioCodec,
  ClipSettings,
  ContainerFormat,
  ScaleFilter,
  VideoEncoderId,
} from "./store";

export interface CaptureGeometry {
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
}

export interface NormalizedEncoding {
  videoEncoder: VideoEncoderId;
  audioCodec: AudioCodec;
  containerFormat: ContainerFormat;
  warning?: string;
}

/** Ensure codec/container pairs FFmpeg can remux without re-encode. */
export function normalizeEncoding(settings: ClipSettings): NormalizedEncoding {
  let videoEncoder = settings.videoEncoder;
  let audioCodec = settings.audioCodec;
  let containerFormat = settings.containerFormat;
  let warning: string | undefined;

  const isHevc = videoEncoder === "hevc_nvenc";
  const isVp9 = videoEncoder === "libvpx-vp9";

  if (containerFormat === "webm") {
    if (!isVp9) {
      videoEncoder = "libvpx-vp9";
      warning = "WebM requires VP9 — switched video encoder to libvpx-vp9.";
    }
    if (audioCodec !== "opus") {
      audioCodec = "opus";
      warning = (warning ? `${warning} ` : "") + "WebM requires Opus — switched audio codec.";
    }
  } else if (isVp9) {
    containerFormat = "webm";
    audioCodec = "opus";
    warning = "VP9 output forced WebM + Opus.";
  }

  return { videoEncoder, audioCodec, containerFormat, warning };
}

export function targetSize(
  settings: ClipSettings,
  _source: { width: number; height: number },
): { width: number; height: number } | null {
  switch (settings.resolutionMode) {
    case "native":
      return null;
    case "1920x1080":
      return { width: 1920, height: 1080 };
    case "1280x720":
      return { width: 1280, height: 720 };
    case "854x480":
      return { width: 854, height: 480 };
    case "custom":
      return {
        width: Math.max(16, settings.customWidth - (settings.customWidth % 2)),
        height: Math.max(16, settings.customHeight - (settings.customHeight % 2)),
      };
    default:
      return null;
  }
}

function scaleFilterFlag(filter: ScaleFilter): string {
  return filter;
}

function videoEncodeArgs(encoder: VideoEncoderId, settings: ClipSettings, gop: number): string[] {
  const bitrate = `${settings.videoBitrateKbps}k`;
  const maxrate = bitrate;
  const bufsize = `${settings.videoBitrateKbps * 2}k`;
  const preset = settings.encoderPreset;

  if (encoder === "libx264") {
    return [
      "-c:v", "libx264", "-preset", preset || "veryfast", "-pix_fmt", "yuv420p",
      "-g", String(gop), "-keyint_min", String(gop),
      "-b:v", bitrate, "-maxrate", maxrate, "-bufsize", bufsize,
    ];
  }

  if (encoder === "libvpx-vp9") {
    return [
      "-c:v", "libvpx-vp9", "-b:v", bitrate, "-maxrate", maxrate, "-bufsize", bufsize,
      "-pix_fmt", "yuv420p", "-g", String(gop), "-row-mt", "1",
      "-deadline", "realtime", "-cpu-used", "5",
    ];
  }

  if (encoder === "h264_nvenc" || encoder === "hevc_nvenc") {
    const rc = settings.rateControl === "cbr" ? "cbr" : "vbr";
    return [
      "-c:v", encoder, "-preset", preset || "p4", "-rc", rc,
      "-b:v", bitrate, "-maxrate", maxrate, "-bufsize", bufsize,
      "-pix_fmt", "yuv420p", "-g", String(gop),
    ];
  }

  return [
    "-c:v", encoder, "-b:v", bitrate, "-maxrate", maxrate, "-bufsize", bufsize,
    "-pix_fmt", "yuv420p", "-g", String(gop),
  ];
}

function audioEncodeArgs(codec: AudioCodec, settings: ClipSettings): string[] {
  if (codec === "opus") {
    return ["-c:a", "libopus", "-b:a", `${settings.audioBitrateKbps}k`, "-ar", String(settings.sampleRate)];
  }
  return ["-c:a", "aac", "-b:a", `${settings.audioBitrateKbps}k`, "-ar", String(settings.sampleRate)];
}

export interface BuildCaptureOptions {
  settings: ClipSettings;
  geometry: CaptureGeometry;
  segmentPattern: string;
  segmentTimeSec?: number;
  platform?: NodeJS.Platform;
  /** DirectShow device name for system loopback (Stereo Mix / VB-Cable). */
  systemAudioDevice?: string | null;
  /** DirectShow microphone device name. */
  micDeviceName?: string | null;
  /** Force-disable system audio even if settings ask for it (fallback path). */
  forceNoSystemAudio?: boolean;
  /** Force-disable mic even if settings ask for it (fallback path). */
  forceNoMic?: boolean;
}

/**
 * Build FFmpeg argv for continuous segmented capture.
 * Intermediate container is always Matroska for robust segment cuts.
 */
export function buildCaptureArgs(opts: BuildCaptureOptions): string[] {
  const settings = opts.settings;
  const platform = opts.platform ?? process.platform;
  const normalized = normalizeEncoding(settings);
  const gop = Math.max(1, Math.round(settings.fps * settings.keyframeIntervalSec));
  const segmentTime = opts.segmentTimeSec ?? 5;
  const size = targetSize(settings, opts.geometry);

  const args: string[] = ["-y", "-hide_banner", "-loglevel", "error"];

  if (platform === "win32") {
    args.push(
      "-f", "gdigrab", "-framerate", String(settings.fps),
      "-offset_x", String(opts.geometry.offsetX),
      "-offset_y", String(opts.geometry.offsetY),
      "-video_size", `${opts.geometry.width}x${opts.geometry.height}`,
      "-i", "desktop",
    );
  } else if (platform === "linux") {
    args.push(
      "-f", "x11grab", "-framerate", String(settings.fps),
      "-video_size", `${opts.geometry.width}x${opts.geometry.height}`,
      "-i", `:${process.env.DISPLAY?.replace(/^:/, "") || "0.0"}+${opts.geometry.offsetX},${opts.geometry.offsetY}`,
    );
  } else {
    args.push("-f", "avfoundation", "-framerate", String(settings.fps), "-i", "1:none");
  }

  let audioInputs = 0;
  // Stock FFmpeg builds do not ship a working WASAPI demuxer. Use DirectShow instead.
  // System audio needs a loopback device (Stereo Mix / VB-Cable / VoiceMeeter).
  const wantSystem =
    platform === "win32" &&
    settings.includeSystemAudio &&
    !opts.forceNoSystemAudio &&
    !!opts.systemAudioDevice;
  const wantMic =
    platform === "win32" && settings.includeMic && !opts.forceNoMic && !!opts.micDeviceName;

  if (wantSystem) {
    args.push("-f", "dshow", "-i", `audio=${opts.systemAudioDevice}`);
    audioInputs += 1;
  }
  if (wantMic) {
    args.push("-f", "dshow", "-i", `audio=${opts.micDeviceName}`);
    audioInputs += 1;
  }

  const filters: string[] = [];
  if (size) {
    filters.push(`scale=${size.width}:${size.height}:flags=${scaleFilterFlag(settings.scaleFilter)}`);
  }

  if (audioInputs === 2) {
    const vf = filters.length ? filters.join(",") : "null";
    args.push(
      "-filter_complex",
      `[0:v]${vf}[v];[1:a][2:a]amix=inputs=2:duration=longest:dropout_transition=0[a]`,
      "-map", "[v]", "-map", "[a]",
    );
  } else if (audioInputs === 1) {
    if (filters.length) args.push("-vf", filters.join(","));
    args.push("-map", "0:v", "-map", "1:a");
  } else {
    if (filters.length) args.push("-vf", filters.join(","));
    args.push("-map", "0:v", "-an");
  }

  args.push(...videoEncodeArgs(normalized.videoEncoder, settings, gop));
  if (audioInputs > 0) {
    args.push(...audioEncodeArgs(normalized.audioCodec, settings));
  }

  args.push(
    "-f", "segment",
    "-segment_time", String(segmentTime),
    "-reset_timestamps", "1",
    "-strftime", "0",
    opts.segmentPattern,
  );

  return args;
}

export function buildRemuxArgs(inputListPath: string, outputPath: string): string[] {
  return [
    "-y", "-hide_banner", "-loglevel", "error",
    "-f", "concat", "-safe", "0",
    "-i", inputListPath,
    "-c", "copy",
    outputPath,
  ];
}

export function containerExtension(format: ContainerFormat): string {
  return format;
}

export function segmentCountForBuffer(bufferSeconds: number, segmentTimeSec = 5): number {
  return Math.max(2, Math.ceil(bufferSeconds / segmentTimeSec) + 1);
}
