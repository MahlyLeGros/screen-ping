"""Fail-closed networking for the isolated extraction process, including redirects.

DNS results are checked once and the exact returned addresses are used by socket
connections. The parent process (and its database connections) is never patched.
"""
import ipaddress
import re
import socket
from urllib.parse import urlsplit, urlunsplit

ALLOWED_DOMAINS = ("tiktok.com", "tiktokv.com", "tiktokcdn.com", "tiktokcdn-us.com", "byteoversea.com", "ibytedtos.com")


def allowed_host(host: str, domains=None) -> bool:
    host = host.lower().rstrip(".")
    return any(host == domain or host.endswith("." + domain) for domain in (domains or ALLOWED_DOMAINS))


def validate_url(url: str, *, initial: bool = False) -> str:
    if len(url) > 2048 or any(ord(c) < 33 for c in url):
        raise ValueError("Invalid TikTok link")
    parsed = urlsplit(url)
    host = (parsed.hostname or "").lower()
    if parsed.scheme != "https" or parsed.username or parsed.password or parsed.port not in (None, 443):
        raise ValueError("Only public HTTPS TikTok links are supported")
    if not allowed_host(host):
        raise ValueError("Unsupported download destination")
    if initial:
        short = host in ("vm.tiktok.com", "vt.tiktok.com") and re.fullmatch(r"/[A-Za-z0-9]+/?", parsed.path)
        video = host in ("tiktok.com", "www.tiktok.com", "m.tiktok.com") and re.fullmatch(r"/@[^/]+/video/[0-9]+/?", parsed.path)
        share = host == "www.tiktok.com" and re.fullmatch(r"/t/[A-Za-z0-9]+/?", parsed.path)
        if not (short or video or share):
            raise ValueError("Paste a video link, not a profile, live or photo post")
        if video:
            parsed = parsed._replace(netloc="www.tiktok.com")
    return urlunsplit(("https", parsed.netloc, parsed.path, parsed.query, ""))


def public_ip(address: str) -> bool:
    ip = ipaddress.ip_address(address.split("%")[0])
    return ip.is_global and not ip.is_multicast and not (getattr(ip, "ipv4_mapped", None) and not ip.ipv4_mapped.is_global)


def install_network_guard(domains=None):
    approved_addresses: set[str] = set()
    original_dns = socket.getaddrinfo
    original_connect = socket.socket.connect
    original_connect_ex = socket.socket.connect_ex

    def guarded_dns(host, port, *args, **kwargs):
        if not isinstance(host, str) or not allowed_host(host, domains) or int(port) != 443:
            raise OSError("Download destination blocked")
        answers = original_dns(host, port, *args, **kwargs)
        if not answers or any(not public_ip(answer[4][0]) for answer in answers):
            raise OSError("Non-public download address blocked")
        approved_addresses.update(answer[4][0] for answer in answers)
        return answers

    def check_address(address):
        if not isinstance(address, tuple) or int(address[1]) != 443 or address[0] not in approved_addresses or not public_ip(address[0]):
            raise OSError("Non-public connection blocked")

    def connect(sock, address):
        check_address(address)
        return original_connect(sock, address)

    def connect_ex(sock, address):
        check_address(address)
        return original_connect_ex(sock, address)

    socket.getaddrinfo = guarded_dns
    socket.socket.connect = connect
    socket.socket.connect_ex = connect_ex
