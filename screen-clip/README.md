# Screen Clip

Windows tray app for **instant-replay screen clips** (rolling buffer + hotkey), with OBS-style encoding settings and system audio.

## Features

- Continuous circular buffer (15 / 30 / 60 / 120 seconds)
- Save last N seconds with a global hotkey (default `Ctrl+Shift+S`)
- Screen capture + WASAPI loopback (system sound), optional mic mix
- Encoding controls: resolution, FPS, encoder (x264 / NVENC / AMF / QSV / VP9), CBR/VBR bitrate, audio codec/bitrate, container (MP4 / MKV / MOV / WebM)
- Starts with Windows (tray / `--hidden`)
- UI styled like Screen Ping (dark iridescent tray + settings)

## Develop

```bat
cd screen-clip
npm install
npm run fetch-ffmpeg
npm run build
npm start
```

Dev with Vite:

```bat
npm run dev
```

## Package (Windows)

```bat
npm run dist
```

Or from repo root: `build-clip-installer.bat`  
Installer lands in `screen-clip/release/`.

## Manual Windows test checklist

1. Install / run the app — tray icon appears; settings window opens on manual launch.
2. Confirm buffer status is ON in the tray menu.
3. Play audio + move windows for ~10–15 seconds.
4. Press the hotkey (or **Save clip**) — an MP4 (or chosen format) appears in the output folder with sound.
5. Change bitrate / resolution / format in Settings → Video / Output — buffer restarts.
6. Enable **Launch with Windows**, reboot, confirm the app is in the tray without a settings window (`--hidden`).
7. Pause buffer from the tray, confirm hotkey reports buffer empty / paused behavior; resume again.

## Notes

- Full capture (gdigrab + WASAPI) only works on Windows.
- GPU encoders are listed only when the bundled FFmpeg reports them.
- WebM forces VP9 + Opus; incompatible pairs show a warning and auto-adjust.
