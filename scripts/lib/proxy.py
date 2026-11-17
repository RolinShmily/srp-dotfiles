import socket


def _speaks_socks5(host: str, port: int, timeout: float = 0.8) -> bool:
    """Return True when host:port answers a SOCKS5 greeting (0x05 ...)."""
    try:
        with socket.create_connection((host, port), timeout=timeout) as sock:
            sock.sendall(b"\x05\x01\x00")
            reply = sock.recv(2)
            return len(reply) == 2 and reply[0] == 0x05
    except OSError:
        return False


def normalize_proxy(value: str) -> str:
    """Turn "host:port" into a proxy URL; an explicit scheme is kept as-is."""
    raw = (value or "").strip()
    if not raw or raw.lower() in ("none", "off", "false"):
        return ""
    if "://" in raw:
        return raw

    host, sep, port = raw.rpartition(":")
    if not sep or not port.isdigit() or not host:
        raise ValueError(f"proxy must be host:port or a URL with a scheme: {raw}")

    scheme = "socks5" if _speaks_socks5(host.strip("[]"), int(port)) else "http"
    return f"{scheme}://{raw}"


if __name__ == "__main__":
    import sys

    print(normalize_proxy(" ".join(sys.argv[1:])))
