"""FastAPI application exposing a clean local API and serving the dashboard.

The browser never talks to Life360 directly. This server acts as a thin proxy
that:

* performs the OAuth2 password login and hands the access token back to the
  browser (kept only in the browser's session storage), and
* forwards authenticated read requests to the Life360 API, sidestepping the
  browser CORS restrictions that would otherwise block direct calls.
"""

from __future__ import annotations

from pathlib import Path

from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from . import life360_client as life360
from .config import settings
from .life360_client import Life360Error

FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend"

app = FastAPI(
    title="Life360 Web Dashboard",
    description="A self-hosted web interface for viewing Life360 circles, members and locations.",
    version="1.0.0",
)


# --------------------------------------------------------------------------- #
# Error handling
# --------------------------------------------------------------------------- #
@app.exception_handler(Life360Error)
async def life360_error_handler(_request, exc: Life360Error) -> JSONResponse:
    return JSONResponse(status_code=exc.status_code, content={"detail": exc.message})


# --------------------------------------------------------------------------- #
# Dependencies
# --------------------------------------------------------------------------- #
async def get_access_token(authorization: str | None = Header(default=None)) -> str:
    """Extract the bearer access token from the incoming Authorization header."""
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Missing or malformed Authorization header.")
    return authorization.split(" ", 1)[1].strip()


# --------------------------------------------------------------------------- #
# Schemas
# --------------------------------------------------------------------------- #
# --------------------------------------------------------------------------- #
# API routes
# --------------------------------------------------------------------------- #
@app.post("/api/login/token", tags=["auth"])
async def login_with_token(token: str = Depends(get_access_token)):
    """Validate a user-supplied access token by fetching their profile.

    Life360 signs most accounts in with a one-time code (OTP), so this app
    authenticates with an access token copied from an existing Life360 web
    session rather than an email/password.
    """
    user = await life360.get_me(token)
    return {"ok": True, "user": user}


@app.get("/api/me", tags=["user"])
async def me(token: str = Depends(get_access_token)):
    """Return the authenticated user's profile."""
    return await life360.get_me(token)


@app.get("/api/circles", tags=["circles"])
async def circles(token: str = Depends(get_access_token)):
    """List all circles the user belongs to."""
    return {"circles": await life360.get_circles(token)}


@app.get("/api/circles/{circle_id}", tags=["circles"])
async def circle_detail(circle_id: str, token: str = Depends(get_access_token)):
    """Return full details for a single circle (includes members)."""
    return await life360.get_circle(circle_id, token)


@app.get("/api/circles/{circle_id}/members", tags=["members"])
async def circle_members(circle_id: str, token: str = Depends(get_access_token)):
    """Return members of a circle with their latest location data."""
    return {"members": await life360.get_circle_members(circle_id, token)}


@app.get("/api/circles/{circle_id}/members/{member_id}", tags=["members"])
async def member_detail(
    circle_id: str, member_id: str, token: str = Depends(get_access_token)
):
    """Return a single member's detailed record."""
    return await life360.get_member(circle_id, member_id, token)


@app.get("/api/circles/{circle_id}/members/{member_id}/history", tags=["members"])
async def member_history(
    circle_id: str, member_id: str, token: str = Depends(get_access_token)
):
    """Return recent location history for a single member."""
    return await life360.get_member_history(circle_id, member_id, token)


@app.get("/api/circles/{circle_id}/places", tags=["places"])
async def circle_places(circle_id: str, token: str = Depends(get_access_token)):
    """Return the saved Places (geofences) for a circle."""
    return {"places": await life360.get_circle_places(circle_id, token)}


@app.get("/api/health", tags=["meta"])
async def health():
    """Simple liveness probe."""
    return {"status": "ok", "version": app.version, "api_base_url": settings.api_base_url}


# --------------------------------------------------------------------------- #
# Static frontend
# --------------------------------------------------------------------------- #
@app.get("/", include_in_schema=False)
async def index() -> FileResponse:
    return FileResponse(FRONTEND_DIR / "index.html")


# Serve the frontend assets (css/js/images) under /static.
app.mount("/static", StaticFiles(directory=FRONTEND_DIR), name="static")
