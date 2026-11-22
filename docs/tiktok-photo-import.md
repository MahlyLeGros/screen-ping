# TikTok photo import

Photo posts use the anonymous public embed's ordered `displayImages`, not the video extractor. Public access can fail; no personal cookies, accounts, challenge solvers or external download services are used.

The existing worker downloads every photo through its guarded transport, normalizes them without upscaling, and renders local MP4/H.264/AAC segments with leftward swipe transitions. Defaults: 3 seconds per photo, 30 fps, all photos retained, total at most 30 seconds. Timing is frame-quantized; the editor reports the effective duration. A single photo is shown for at least 2 seconds for compatibility with the existing transport. Speed accepts 0.5–10 seconds per photo; transitions occupy at most 7 frames and at most one quarter of a photo interval.

Limits: 100 photos, 25 MiB per downloaded image, 20 million pixels per image, 256 MiB aggregate download/decoded image storage, public music at most 10 MiB/3 minutes, final video at most 50 MiB. Missing music produces an explicit silent-slideshow warning; missing photos fail the whole import. Existing worker deadlines, one-at-a-time processing, queue limits and global storage reservation apply. Ready photo jobs retain a conservative scratch-space reservation for future edits.

`POST /api/media/imports/{id}/slideshow` accepts `seconds_per_photo` and `volume`, authorizes ownership and queues a fresh render from retained local assets. Responses add `media_kind`, `photo_count`, `seconds_per_photo`, `effective_seconds_per_photo`, `photo_urls`, `music_url`, and `has_music`. Asset access remains private. Sources expire after five idle minutes and are reimported from the saved link/recipe; pending pings retain their final files. Remote save recipes contain no downloaded media blobs.

Rollout defaults to disabled (`TIKTOK_PHOTO_IMPORT_ENABLED=false`). `TIKTOK_PHOTO_TEST_USER` optionally enables a single authenticated username for a reception pilot; other users remain disabled even with short photo links. After real reception verification, enable the global flag and clear the pilot username. YouTube/Instagram switches remain unchanged. No desktop update is required.
