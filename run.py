"""Entry point for running the Life360 Web Dashboard.

Usage:
    python run.py

The server then serves the dashboard at http://<host>:<port> (default
http://127.0.0.1:8360). Host and port can be overridden via the
LIFE360_HOST and LIFE360_PORT environment variables.
"""

from __future__ import annotations

import uvicorn

from backend.config import settings


def main() -> None:
    print("=" * 60)
    print(" Life360 Web Dashboard")
    print(f" Open http://{settings.host}:{settings.port} in your browser")
    print("=" * 60)
    uvicorn.run(
        "backend.main:app",
        host=settings.host,
        port=settings.port,
        reload=False,
    )


if __name__ == "__main__":
    main()
