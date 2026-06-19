"""Thin asynchronous wrapper around the (unofficial) Life360 REST API.

Life360 sits behind Cloudflare, which fingerprints the TLS handshake and blocks
generic Python HTTP clients (httpx/requests) with a "bot protection" HTML page.
To get through reliably we use ``curl_cffi`` to impersonate a real mobile
browser's TLS/JA3 fingerprint. Empirically, Safari/iOS fingerprints are accepted
by Life360's edge while desktop Chrome fingerprints are challenged.

The client is intentionally stateless with respect to user accounts: callers
authenticate once to obtain a bearer access token and then pass that token back
on every subsequent request. The token never leaves the user's own machine.
"""

from __future__ import annotations

import logging
from typing import Any

from curl_cffi.requests import AsyncSession
from curl_cffi.requests.exceptions import RequestException

from .config import settings

logger = logging.getLogger("life360")
if not logger.handlers:
    _handler = logging.StreamHandler()
    _handler.setFormatter(logging.Formatter("INFO:     life360: %(message)s"))
    logger.addHandler(_handler)
    logger.setLevel(logging.INFO)
    logger.propagate = False


class Life360Error(Exception):
    """Base error for all Life360 API failures."""

    def __init__(self, message: str, status_code: int = 502) -> None:
        super().__init__(message)
        self.message = message
        self.status_code = status_code


class AuthenticationError(Life360Error):
    """Raised when login fails or a token is rejected."""

    def __init__(self, message: str = "Invalid Life360 credentials or session expired.") -> None:
        super().__init__(message, status_code=401)


class RateLimitError(Life360Error):
    """Raised when the upstream API rejects requests due to rate limiting."""

    def __init__(self, message: str = "Life360 is rate limiting requests. Please try again shortly.") -> None:
        super().__init__(message, status_code=429)


class CloudflareBlockError(Life360Error):
    """Raised when Cloudflare blocks the request before it reaches Life360."""

    def __init__(self) -> None:
        super().__init__(
            "Life360 blocked the request at its bot-protection layer (Cloudflare). "
            "Please wait a minute and try again. If it keeps happening, disable any "
            "VPN/proxy and retry from a normal home connection.",
            status_code=503,
        )


def _base_headers() -> dict[str, str]:
    return {
        "Accept": "application/json",
        "User-Agent": settings.user_agent,
        "Cache-Control": "no-cache",
    }


def _looks_like_cloudflare(content_type: str, body: str) -> bool:
    """Heuristically detect a Cloudflare/bot-protection HTML response."""
    if "json" in content_type:
        return False
    lowered = body.lower()
    return (
        "cloudflare" in lowered
        or "captcha" in lowered
        or "security service" in lowered
        or "attention required" in lowered
        or "<!doctype html" in lowered
        or "<html" in lowered
    )


def _new_session() -> AsyncSession:
    """Create an AsyncSession that impersonates a real mobile browser."""
    return AsyncSession(
        impersonate=settings.impersonate,
        timeout=settings.request_timeout,
    )


async def login(username: str, password: str) -> dict[str, Any]:
    """Exchange account credentials for an OAuth2 access token.

    Returns the raw token payload, which includes ``access_token`` and
    ``token_type`` (typically ``Bearer``).
    """

    headers = {
        **_base_headers(),
        "Authorization": settings.client_authorization,
        "Content-Type": "application/x-www-form-urlencoded",
    }
    data = {
        "grant_type": "password",
        "username": username,
        "password": password,
    }

    # Try the primary host first, then the CloudFront mirror. Some networks get
    # blocked by the WAF on one host but not the other.
    hosts = [settings.api_base_url]
    if settings.api_fallback_url and settings.api_fallback_url not in hosts:
        hosts.append(settings.api_fallback_url)

    last_error: Life360Error | None = None
    async with _new_session() as session:
        for base_url in hosts:
            url = f"{base_url}/oauth2/token.json"
            try:
                response = await session.post(url, headers=headers, data=data)
            except RequestException as exc:  # network-level failure
                logger.warning("Login request to %s failed: %s", url, exc)
                last_error = Life360Error(
                    "Could not reach Life360. Check your internet connection and try again."
                )
                continue

            content_type = response.headers.get("content-type", "")
            snippet = response.text[:300].replace("\n", " ")
            logger.info(
                "Login via %s (impersonate=%s) -> HTTP %s (%s); body: %s",
                url,
                settings.impersonate,
                response.status_code,
                content_type or "unknown",
                snippet,
            )

            if response.status_code == 200 and "json" in content_type:
                payload = response.json()
                if "access_token" in payload:
                    return payload
                raise AuthenticationError("Login response did not contain an access token.")

            if response.status_code == 429:
                last_error = RateLimitError()
                continue

            if _looks_like_cloudflare(content_type, response.text):
                last_error = CloudflareBlockError()
                continue  # try the next host

            # A JSON error is authoritative (e.g. wrong password) - stop here.
            if "json" in content_type:
                try:
                    upstream = response.json()
                except ValueError:
                    upstream = None
                if isinstance(upstream, dict) and upstream.get("errorMessage"):
                    raise AuthenticationError(str(upstream["errorMessage"]))
                raise AuthenticationError("Invalid Life360 credentials.")

            last_error = Life360Error(
                f"Unexpected response from Life360 (HTTP {response.status_code}).",
                status_code=502,
            )

    raise last_error or Life360Error("Login failed for an unknown reason.")


async def _get(path: str, access_token: str, params: dict[str, Any] | None = None) -> Any:
    """Perform an authenticated GET request against the Life360 API."""

    headers = {
        **_base_headers(),
        "Authorization": f"Bearer {access_token}",
    }

    hosts = [settings.api_base_url]
    if settings.api_fallback_url and settings.api_fallback_url not in hosts:
        hosts.append(settings.api_fallback_url)

    last_error: Life360Error | None = None
    async with _new_session() as session:
        for base_url in hosts:
            url = f"{base_url}/{path.lstrip('/')}"
            try:
                response = await session.get(url, headers=headers, params=params)
            except RequestException as exc:
                logger.warning("GET %s failed: %s", url, exc)
                last_error = Life360Error("Could not reach Life360. Please try again.")
                continue

            content_type = response.headers.get("content-type", "")

            if response.status_code in (401, 403) and "json" in content_type:
                raise AuthenticationError()
            if response.status_code == 429:
                last_error = RateLimitError()
                continue
            if _looks_like_cloudflare(content_type, response.text):
                last_error = CloudflareBlockError()
                continue
            if response.status_code >= 400:
                last_error = Life360Error(
                    f"Life360 request failed (HTTP {response.status_code}).",
                    status_code=502,
                )
                continue

            if not response.content:
                return {}
            return response.json()

    raise last_error or Life360Error("Life360 request failed for an unknown reason.")


async def get_me(access_token: str) -> dict[str, Any]:
    """Return the authenticated user's profile."""
    return await _get("users/me.json", access_token)


async def get_circles(access_token: str) -> list[dict[str, Any]]:
    """Return all circles the authenticated user belongs to."""
    payload = await _get("circles.json", access_token)
    return payload.get("circles", []) if isinstance(payload, dict) else []


async def get_circle(circle_id: str, access_token: str) -> dict[str, Any]:
    """Return detailed information for a single circle, including members."""
    return await _get(f"circles/{circle_id}.json", access_token)


async def get_circle_members(circle_id: str, access_token: str) -> list[dict[str, Any]]:
    """Return the members of a circle with their latest location data."""
    payload = await _get(f"circles/{circle_id}/members.json", access_token)
    return payload.get("members", []) if isinstance(payload, dict) else []


async def get_member(circle_id: str, member_id: str, access_token: str) -> dict[str, Any]:
    """Return a single member's detailed record."""
    return await _get(f"circles/{circle_id}/members/{member_id}.json", access_token)


async def get_circle_places(circle_id: str, access_token: str) -> list[dict[str, Any]]:
    """Return the saved Places (geofences) configured for a circle."""
    payload = await _get(f"circles/{circle_id}/places.json", access_token)
    return payload.get("places", []) if isinstance(payload, dict) else []


async def get_member_history(
    circle_id: str, member_id: str, access_token: str
) -> dict[str, Any]:
    """Return recent location history for a single member."""
    return await _get(
        f"circles/{circle_id}/members/{member_id}/history",
        access_token,
    )
