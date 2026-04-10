from __future__ import annotations

from collections import defaultdict
from threading import Lock

_lock = Lock()
# (path, status_code) -> count
_http_requests: dict[tuple[str, int], int] = defaultdict(int)


def record_http_request(path: str, status_code: int) -> None:
    p = path if len(path) < 512 else path[:512]
    with _lock:
        _http_requests[(p, int(status_code))] += 1


def prometheus_text() -> str:
    lines = [
        "# HELP inside_me_http_requests_total Total HTTP responses by path and status",
        "# TYPE inside_me_http_requests_total counter",
    ]
    with _lock:
        for (path, status), n in sorted(_http_requests.items()):
            esc = path.replace("\\", "\\\\").replace('"', '\\"')
            lines.append(f'inside_me_http_requests_total{{path="{esc}",status="{status}"}} {n}')
    lines.append(
        "# HELP inside_me_info Inside-ME build info\n"
        '# TYPE inside_me_info gauge\n'
        'inside_me_info{version="0.1.0"} 1\n'
    )
    return "\n".join(lines) + "\n"
