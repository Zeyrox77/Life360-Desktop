"""Application configuration.

Settings are loaded from environment variables (and an optional ``.env`` file).
None of the values here contain personal account credentials - those are only
ever supplied at runtime through the login endpoint and are never persisted.
"""

from __future__ import annotations

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime configuration for the Life360 web dashboard."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        env_prefix="LIFE360_",
        extra="ignore",
    )

    # Base URL of the (unofficial) Life360 REST API.
    api_base_url: str = "https://api.life360.com/v3"

    # CloudFront mirror used as a fallback when the primary host blocks a
    # request at the WAF layer.
    api_fallback_url: str = "https://api-cloudfront.life360.com/v3"

    # OAuth2 client credentials used by the official mobile clients. This is the
    # well-known public "Basic" token that all unofficial Life360 clients rely
    # on. It is NOT a personal secret - it only identifies the client app.
    # Life360 periodically disables old client tokens; this is the value that is
    # currently accepted by the v3 token endpoint.
    client_authorization: str = (
        "Basic Y2F0aGFwYWNyQVBoZUtVc3RlOGV2ZXZldnVjSGFmZVRydVl1ZnJhYzpkOEM5ZVlVdkE2dUZ1YnJ1SmVnZXRyZVZ1dFJlQ1JVWQ=="
    )

    # User-Agent sent with every request. A realistic value reduces the chance
    # of the edge/CDN layer flagging the request as an unknown bot.
    user_agent: str = "com.life360.android.safetymapd/KOKO/23.49.0 android/13"

    # Browser profile that curl_cffi impersonates at the TLS/JA3 level. Life360
    # sits behind Cloudflare, which blocks generic Python clients and desktop
    # Chrome fingerprints but accepts Safari/iOS ones. Override with the
    # LIFE360_IMPERSONATE environment variable if a profile stops working.
    impersonate: str = "safari_ios"

    # HTTP timeout (seconds) for upstream Life360 requests.
    request_timeout: float = 20.0

    # Host/port the local web server binds to.
    host: str = "127.0.0.1"
    port: int = 8360


settings = Settings()
