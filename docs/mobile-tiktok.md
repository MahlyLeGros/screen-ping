# Mobile and TikTok imports

The desktop receiver is required on the recipient's Windows PC, not on the sender's phone. Mobile Send follows media → preview → recipients → advanced settings, with a persistent send button. Draw exposes brush controls, Clear and Stop without right-click. GIF search is not included.

## Deployment

1. Build and deploy the server image (FFmpeg and pinned yt-dlp are included). Server startup adds the import table and nullable media duration/expiry columns, without rewriting existing messages.
2. Start exactly **one** `import-worker` service and one realtime server process. Jobs live in SQL, not Redis. Restarted in-progress jobs fail explicitly; queued jobs survive. The worker processes one job at a time, kills the extraction process tree after 180 seconds, limits CPU/memory in Compose and cleans expired imports.
3. Publish desktop **1.0.66** with the existing signed update-feed workflow. Clients advertise their long-video capability; the server rejects long sends to old clients.
4. Deploy the web build. Set `TIKTOK_IMPORT_ENABLED=true` in the VPS environment and recreate server and worker **only after a real public-video import passes**. Default is false. To disable import, restore false and recreate those two services; ordinary uploads remain available.

## Import restrictions

Public TikTok video links only (including vm/vt and /t short links). No live, photo, profile, authenticated content, personal cookies or challenge solving. yt-dlp only extracts metadata; Screen Ping downloads a single progressive HTTPS MP4 itself. No external downloaders or remote manifests are passed to FFmpeg.

The child process has no application/database credentials. All its DNS resolutions require an approved TikTok/CDN hostname and public addresses; socket connections must use those approved resolved addresses on port 443. Redirects are subject to the same guard. Unsupported CDN domains fail closed and should be reviewed before changing the allowlist.

The source and final file are bounded to 50 MiB; videos over 180 seconds are refused, never silently cut. Compatible H.264/AAC videos are remuxed for fast start; others are compressed to H.264/AAC, max 1280 pixels on the long side, 30 fps and moderate capped bitrate. A prepared file is shared across recipients without uploading it from the phone again. Imports expire 30 minutes after preparation; only their owner can preview or create sends.

## Verification

Server: `python -m pytest -q`. Web: `npm test` and `npm run build`. Desktop: `npm run build` and `npm run test:delivery`.

Manual release gate: Safari iPhone and Chrome Android (portrait/landscape, keyboard, file picker, touchscreen placement and Draw); real public normal/short TikTok links from the VPS; a complete >30-second video with sound to two compatible desktop recipients, including one busy queue. Browser viewport emulation is not proof of Safari compatibility or TikTok availability.

TikTok may restrict requests based on region or server IP. Such failures must remain explicit and offer manual upload; do not add cookies, impersonation dependencies or challenge solvers to conceal the restriction.

### Release 1.0.66 checks (2026-10-08)

- 109 server tests and 16 web tests passed; web and desktop builds passed. Existing strict web type-check errors are not represented as passing by the Vite build.
- Sandboxed Chromium checks covered mobile portrait/landscape, sticky sending, clipboard images, preserved selection, Draw controls, prepared-video sending without a file re-upload, and desktop viewports from 1366 pixels through 4K. Actual Safari/iPhone and Chrome/Android device checks remain manual.
- The provided public TikTok imported successfully on the VPS with its full 53,167 ms duration. An isolated production check with disposable accounts and simulated desktop peers verified owner-only access, cancellation, private MP4 access, rejection of an old desktop, one shared file, a common start time for two recipients, no premature expiry after 30 seconds, and final delivery acknowledgements. All disposable accounts and media were removed afterward. This protocol check is not a physical-PC playback test.
- Offline FFmpeg checks covered complete 35-second vertical video and 1920-pixel horizontal video normalization. Desktop overlay regression checks covered the idle first ping, burst ordering, duplicate protection, stalled cleanup, recovery after a media access error, synchronized slow-peer preparation, audio preparation and cancellation.
