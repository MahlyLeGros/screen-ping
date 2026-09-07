"""Tests for magic-byte MIME sniffing on uploads."""

from app.services.media import sniff_media_mime


def test_sniff_jpeg():
    assert sniff_media_mime(b"\xff\xd8\xff\xe0" + b"\x00" * 20) == "image/jpeg"


def test_sniff_png():
    assert sniff_media_mime(b"\x89PNG\r\n\x1a\n" + b"\x00" * 20) == "image/png"


def test_sniff_gif():
    assert sniff_media_mime(b"GIF89a" + b"\x00" * 20) == "image/gif"


def test_sniff_webp():
    assert sniff_media_mime(b"RIFF" + b"\x00\x00\x00\x00" + b"WEBP" + b"\x00" * 8) == "image/webp"


def test_sniff_mp4():
    assert sniff_media_mime(b"\x00\x00\x00\x18ftypisom" + b"\x00" * 20) == "video/mp4"


def test_sniff_webm():
    assert sniff_media_mime(b"\x1a\x45\xdf\xa3" + b"\x00" * 20) == "video/webm"


def test_sniff_mp3_id3():
    assert sniff_media_mime(b"ID3" + b"\x00" * 20) == "audio/mpeg"


def test_sniff_wav():
    assert sniff_media_mime(b"RIFF" + b"\x00\x00\x00\x00" + b"WAVE" + b"\x00" * 8) == "audio/wav"


def test_sniff_ogg():
    assert sniff_media_mime(b"OggS" + b"\x00" * 20) == "audio/ogg"


def test_sniff_m4a():
    assert sniff_media_mime(b"\x00\x00\x00\x1cftypM4A " + b"\x00" * 20) == "audio/mp4"


def test_sniff_flac():
    assert sniff_media_mime(b"fLaC" + b"\x00" * 20) == "audio/flac"


def test_sniff_unknown():
    assert sniff_media_mime(b"not-a-media-file") is None
