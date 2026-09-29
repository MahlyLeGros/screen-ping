import test from "node:test";
import assert from "node:assert/strict";
import { parseDshowAudioDevices, pickLoopbackDevice, pickMicDevice } from "./winAudio";

test("parseDshowAudioDevices extracts audio device names", () => {
  const sample = `
[dshow @ 000] DirectShow audio devices
[dshow @ 000]  "Stereo Mix (Realtek(R) Audio)" (audio)
[dshow @ 000]  "Microphone (USB Audio)" (audio)
[dshow @ 000] DirectShow video devices
[dshow @ 000]  "Integrated Camera" (video)
`;
  assert.deepEqual(parseDshowAudioDevices(sample), [
    "Stereo Mix (Realtek(R) Audio)",
    "Microphone (USB Audio)",
  ]);
});

test("pickLoopbackDevice prefers Stereo Mix", () => {
  assert.equal(
    pickLoopbackDevice(["Speakers (Realtek)", "Stereo Mix (Realtek)", "Microphone"]),
    "Stereo Mix (Realtek)",
  );
  assert.equal(pickLoopbackDevice(["Speakers (Realtek)", "Microphone"]), null);
});

test("pickMicDevice skips loopback device", () => {
  assert.equal(
    pickMicDevice(["Stereo Mix (Realtek)", "Microphone (USB)"], "Stereo Mix (Realtek)"),
    "Microphone (USB)",
  );
});
