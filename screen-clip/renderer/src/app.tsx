import { createRoot } from "react-dom/client";
import { useMemo, useState, type ReactNode } from "react";

import "./ui/theme.css";
import { Button, Card, Segmented, TitleBar, Toggle } from "./ui/components";
import type { ClipSettings, SettingKey, VideoEncoderId } from "./clipApi";
import { useClipState } from "./useClipState";

type Tab = "general" | "video" | "audio" | "output";

const ENCODER_LABELS: Record<VideoEncoderId, string> = {
  libx264: "x264 (CPU)",
  h264_nvenc: "NVENC H.264",
  hevc_nvenc: "NVENC HEVC",
  h264_amf: "AMF H.264",
  h264_qsv: "QSV H.264",
  "libvpx-vp9": "VP9",
};

function setSetting<K extends SettingKey>(key: K, value: ClipSettings[K]) {
  window.clipAPI.set(key, value);
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      <span className="field__label">{label}</span>
      <span className="field__control">{children}</span>
    </label>
  );
}

function App() {
  const state = useClipState();
  const [tab, setTab] = useState<Tab>("general");
  const settings = state?.settings;

  const encoderOptions = useMemo(() => {
    const available = new Set(state?.availableEncoders ?? ["libx264"]);
    return (Object.keys(ENCODER_LABELS) as VideoEncoderId[])
      .filter((id) => available.has(id) || id === "libx264")
      .map((id) => ({ value: id, label: ENCODER_LABELS[id] }));
  }, [state?.availableEncoders]);

  if (!state || !settings) {
    return (
      <div className="shell">
        <TitleBar title="Screen Clip" onClose={() => window.clipAPI.close()} onMinimize={() => window.clipAPI.minimize()} />
        <div className="shell__body">
          <p className="muted">Loading…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="shell">
      <TitleBar
        title="Screen Clip"
        onClose={() => window.clipAPI.close()}
        onMinimize={() => window.clipAPI.minimize()}
      />
      <div className="shell__body settings">
        <nav className="tabs">
          {(
            [
              ["general", "General"],
              ["video", "Video"],
              ["audio", "Audio"],
              ["output", "Output"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={tab === id ? "tabs__item tabs__item--on" : "tabs__item"}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </nav>

        {state.encodingWarning && <div className="banner">{state.encodingWarning}</div>}

        {tab === "general" && (
          <div className="stack">
            <Card title="Instant replay">
              <Field label="Buffer">
                <Toggle value={settings.bufferEnabled} onChange={(v) => setSetting("bufferEnabled", v)} green />
              </Field>
              <Field label="Duration">
                <Segmented
                  value={settings.bufferSeconds}
                  options={[
                    { value: 15, label: "15s" },
                    { value: 30, label: "30s" },
                    { value: 60, label: "60s" },
                    { value: 120, label: "120s" },
                  ]}
                  onChange={(v) => setSetting("bufferSeconds", v)}
                />
              </Field>
              <Field label="Hotkey">
                <input className="input" value={settings.hotkey} onChange={(e) => setSetting("hotkey", e.target.value)} />
              </Field>
              <Field label="Monitor">
                <select
                  className="input"
                  value={settings.displayId ?? ""}
                  onChange={(e) => setSetting("displayId", e.target.value ? Number(e.target.value) : null)}
                >
                  <option value="">Primary</option>
                  {state.displays.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.label}
                    </option>
                  ))}
                </select>
              </Field>
            </Card>
            <Card title="Startup">
              <Field label="Launch with Windows">
                <Toggle value={settings.launchAtLogin} onChange={(v) => setSetting("launchAtLogin", v)} />
              </Field>
            </Card>
          </div>
        )}

        {tab === "video" && (
          <div className="stack">
            <Card title="Picture">
              <Field label="Resolution">
                <select
                  className="input"
                  value={settings.resolutionMode}
                  onChange={(e) => setSetting("resolutionMode", e.target.value as ClipSettings["resolutionMode"])}
                >
                  <option value="native">Native</option>
                  <option value="1920x1080">1920×1080</option>
                  <option value="1280x720">1280×720</option>
                  <option value="854x480">854×480</option>
                  <option value="custom">Custom</option>
                </select>
              </Field>
              {settings.resolutionMode === "custom" && (
                <Field label="Custom size">
                  <div className="row">
                    <input
                      className="input"
                      type="number"
                      value={settings.customWidth}
                      onChange={(e) => setSetting("customWidth", Number(e.target.value))}
                    />
                    <span>×</span>
                    <input
                      className="input"
                      type="number"
                      value={settings.customHeight}
                      onChange={(e) => setSetting("customHeight", Number(e.target.value))}
                    />
                  </div>
                </Field>
              )}
              <Field label="FPS">
                <Segmented
                  value={settings.fps}
                  options={[
                    { value: 24, label: "24" },
                    { value: 30, label: "30" },
                    { value: 60, label: "60" },
                    { value: 120, label: "120" },
                  ]}
                  onChange={(v) => setSetting("fps", v)}
                />
              </Field>
              <Field label="Downscale">
                <select
                  className="input"
                  value={settings.scaleFilter}
                  onChange={(e) => setSetting("scaleFilter", e.target.value as ClipSettings["scaleFilter"])}
                >
                  <option value="bicubic">Bicubic</option>
                  <option value="bilinear">Bilinear</option>
                  <option value="lanczos">Lanczos</option>
                </select>
              </Field>
            </Card>
            <Card title="Encoder">
              <Field label="Encoder">
                <select
                  className="input"
                  value={settings.videoEncoder}
                  onChange={(e) => setSetting("videoEncoder", e.target.value as VideoEncoderId)}
                >
                  {encoderOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Rate control">
                <Segmented
                  value={settings.rateControl}
                  options={[
                    { value: "cbr" as const, label: "CBR" },
                    { value: "vbr" as const, label: "VBR" },
                  ]}
                  onChange={(v) => setSetting("rateControl", v)}
                />
              </Field>
              <Field label="Bitrate (kbps)">
                <div className="stack-sm">
                  <Segmented
                    value={
                      ([2500, 6000, 10000, 15000] as number[]).includes(settings.videoBitrateKbps)
                        ? settings.videoBitrateKbps
                        : -1
                    }
                    options={[
                      { value: 2500, label: "2.5M" },
                      { value: 6000, label: "6M" },
                      { value: 10000, label: "10M" },
                      { value: 15000, label: "15M" },
                      { value: -1, label: "Custom" },
                    ]}
                    onChange={(v) => {
                      if (v > 0) setSetting("videoBitrateKbps", v);
                    }}
                  />
                  <input
                    className="input"
                    type="number"
                    value={settings.videoBitrateKbps}
                    onChange={(e) => setSetting("videoBitrateKbps", Number(e.target.value))}
                  />
                </div>
              </Field>
              <Field label="Preset">
                <input
                  className="input"
                  value={settings.encoderPreset}
                  onChange={(e) => setSetting("encoderPreset", e.target.value)}
                />
              </Field>
              <Field label="Keyframe (s)">
                <input
                  className="input"
                  type="number"
                  min={1}
                  value={settings.keyframeIntervalSec}
                  onChange={(e) => setSetting("keyframeIntervalSec", Number(e.target.value))}
                />
              </Field>
            </Card>
          </div>
        )}

        {tab === "audio" && (
          <div className="stack">
            <Card title="Sources">
              <Field label="System audio">
                <Toggle
                  value={settings.includeSystemAudio}
                  onChange={(v) => setSetting("includeSystemAudio", v)}
                  green
                />
              </Field>
              <p className="hint">
                Needs a Windows loopback device (enable Stereo Mix in Sound settings, or install VB-Cable).
                Without it, the buffer still runs (video only).
              </p>
              <Field label="Microphone">
                <Toggle value={settings.includeMic} onChange={(v) => setSetting("includeMic", v)} />
              </Field>
            </Card>
            <Card title="Encode">
              <Field label="Codec">
                <Segmented
                  value={settings.audioCodec}
                  options={[
                    { value: "aac" as const, label: "AAC" },
                    { value: "opus" as const, label: "Opus" },
                  ]}
                  onChange={(v) => setSetting("audioCodec", v)}
                />
              </Field>
              <Field label="Bitrate">
                <Segmented
                  value={settings.audioBitrateKbps}
                  options={[
                    { value: 96, label: "96" },
                    { value: 160, label: "160" },
                    { value: 192, label: "192" },
                    { value: 320, label: "320" },
                  ]}
                  onChange={(v) => setSetting("audioBitrateKbps", v)}
                />
              </Field>
              <Field label="Sample rate">
                <Segmented
                  value={settings.sampleRate}
                  options={[
                    { value: 48000, label: "48 kHz" },
                    { value: 44100, label: "44.1 kHz" },
                  ]}
                  onChange={(v) => setSetting("sampleRate", v)}
                />
              </Field>
            </Card>
          </div>
        )}

        {tab === "output" && (
          <div className="stack">
            <Card title="Clip file">
              <Field label="Format">
                <Segmented
                  value={settings.containerFormat}
                  options={[
                    { value: "mp4" as const, label: "MP4" },
                    { value: "mkv" as const, label: "MKV" },
                    { value: "mov" as const, label: "MOV" },
                    { value: "webm" as const, label: "WebM" },
                  ]}
                  onChange={(v) => setSetting("containerFormat", v)}
                />
              </Field>
              <Field label="Folder">
                <div className="row">
                  <input className="input" readOnly value={settings.outputDir} />
                  <Button onClick={() => void window.clipAPI.pickOutputDir()}>Browse</Button>
                </div>
              </Field>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
