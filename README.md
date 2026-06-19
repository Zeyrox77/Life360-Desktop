# Life360 Web Dashboard

A self-hosted web dashboard that lets you view your [Life360](https://www.life360.com/)
circles, members and locations from a desktop browser &mdash; bringing the core
experience of the mobile app to the big screen.

> **Looking for the desktop app?**
> This is the **browser** variant (runs a local server you open in your browser).
> There is also a standalone **desktop application** (opens in its own window,
> available as a Windows `.exe`) on the
> [`main` branch](https://github.com/Zeyrox77/Life360-Desktop/tree/main).

> **Disclaimer**
> This project uses Life360's unofficial, undocumented REST API. It is **not**
> affiliated with, endorsed by, or supported by Life360, Inc. Use it only with
> your own account and your own circles, and at your own risk. The API may
> change or stop working at any time.

---

## Features

- **Sign in with your Life360 account** &mdash; credentials are exchanged for an
  access token that lives only in your browser session.
- **Circle switcher** &mdash; browse every circle you belong to.
- **Member list** &mdash; avatars, current place/address, battery level, charging
  state and movement status (driving / moving / stationary) at a glance.
- **Live map** &mdash; every member and saved place plotted on an interactive
  OpenStreetMap, with avatar markers and popups.
- **Member detail panel** &mdash; address, coordinates, battery, Wi-Fi state,
  speed, driving status, location accuracy and last-update time.
- **Saved Places** &mdash; the circle's geofenced places shown in the sidebar and
  on the map.
- **Automatic refresh** every 30 seconds, plus a manual refresh button.

## How it works

The browser never talks to Life360 directly. A small **FastAPI** backend acts as
a thin proxy that:

1. validates the access token you provide and returns your profile, and
2. forwards authenticated read requests to the Life360 API, which avoids the
   browser CORS restrictions that would otherwise block direct calls.

```
Browser (frontend)  <-->  FastAPI backend (proxy)  <-->  Life360 REST API
```

No account credentials are ever written to disk by this application.

### Getting past Cloudflare

Life360 sits behind Cloudflare, which fingerprints the TLS handshake and blocks
generic Python HTTP clients (and even desktop-Chrome fingerprints) with a "bot
protection" page. To get through reliably the backend uses
[`curl_cffi`](https://github.com/lexiforest/curl_cffi) to impersonate a real
**Safari/iOS** TLS fingerprint, which Life360's edge accepts. The profile is
configurable via `LIFE360_IMPERSONATE`.

## Project structure

```
.
├── backend/
│   ├── __init__.py
│   ├── config.py           # Environment-based configuration
│   ├── life360_client.py   # Async client for the Life360 REST API
│   └── main.py             # FastAPI app + routes + static file serving
├── frontend/
│   ├── index.html          # Single-page dashboard
│   ├── css/styles.css      # Styling
│   └── js/
│       ├── api.js          # Local backend API client
│       └── app.js          # Dashboard logic (map, sidebar, details)
├── run.py                  # Convenience entry point
├── requirements.txt
├── .env.example
└── README.md
```

## Requirements

- Python 3.10 or newer
- A Life360 account that you can sign into at <https://life360.com/login>
  (used to obtain an access token, see [Signing in](#signing-in)).

## Signing in

Life360 signs most accounts in with a **one-time code (OTP)** sent to your email
or phone, so this app authenticates with an **access token** copied from an
existing Life360 web session.

1. Open <https://life360.com/login> in your browser and sign in normally
   (email + the code you receive).
2. Press **F12** to open Developer Tools and switch to the **Network** tab.
3. Reload the page (**F5**) and click the request named **`manage-membership`**.
4. Under **Headers -> Request Headers**, scroll to **`Cookie`** and find
   `LIFE360_AUTH_TOKEN=`.
5. Copy everything **after** the `=` up to (but not including) the next `;`,
   and paste it into the dashboard's token box. (Pasting the whole
   `LIFE360_AUTH_TOKEN=...;` chunk also works - it is cleaned up automatically.)

Tick **"Keep me signed in on this device"** to store the token in this browser's
`localStorage` so you stay logged in across restarts. The token is never sent to
or stored on any server. It stays valid until Life360 expires it; when that
happens the app will ask you to paste a fresh one.

## Setup

```bash
# 1. Clone the repository
git clone https://github.com/Zeyrox77/Life360-Desktop.git
cd Life360

# 2. (Recommended) create a virtual environment
python -m venv .venv
source .venv/bin/activate        # On Windows: .venv\Scripts\activate

# 3. Install dependencies
pip install -r requirements.txt

# 4. (Optional) configure host/port
cp .env.example .env             # then edit if desired
```

## Running

```bash
python run.py
```

Then open <http://127.0.0.1:8360> in your browser and sign in with your access
token (see [Signing in](#signing-in) above).

You can change the bind address and port with environment variables:

```bash
LIFE360_HOST=0.0.0.0 LIFE360_PORT=9000 python run.py
```

## Configuration

All settings are optional and read from environment variables (prefixed with
`LIFE360_`) or an `.env` file:

| Variable                  | Default                       | Description                                   |
| ------------------------- | ----------------------------- | --------------------------------------------- |
| `LIFE360_HOST`            | `127.0.0.1`                   | Address the server binds to.                  |
| `LIFE360_PORT`            | `8360`                        | Port the server listens on.                   |
| `LIFE360_API_BASE_URL`    | `https://api.life360.com/v3`  | Base URL of the Life360 REST API.             |
| `LIFE360_IMPERSONATE`     | `safari_ios`                  | Browser TLS fingerprint used to pass Cloudflare. |
| `LIFE360_REQUEST_TIMEOUT` | `20`                          | Upstream request timeout in seconds.          |

You never put your Life360 account credentials in configuration &mdash; you log
in through the web interface.

## API endpoints (local backend)

| Method | Path                                                  | Description                          |
| ------ | ----------------------------------------------------- | ------------------------------------ |
| POST   | `/api/login/token`                                    | Validate a user-supplied access token. |
| GET    | `/api/me`                                             | Authenticated user profile.          |
| GET    | `/api/circles`                                        | List all circles.                    |
| GET    | `/api/circles/{id}`                                   | Circle details (incl. members).      |
| GET    | `/api/circles/{id}/members`                           | Members with latest locations.       |
| GET    | `/api/circles/{id}/members/{memberId}`                | Single member details.               |
| GET    | `/api/circles/{id}/members/{memberId}/history`        | Recent location history.             |
| GET    | `/api/circles/{id}/places`                            | Saved Places for a circle.           |
| GET    | `/api/health`                                         | Liveness probe.                      |

Interactive API docs are available at <http://127.0.0.1:8360/docs> while the
server is running.

## Privacy & security notes

- Run this on a machine you control. By default the server binds to `127.0.0.1`
  so it is only reachable from your own computer.
- The access token is stored in the browser's `sessionStorage` and is cleared
  when you close the tab or sign out.
- Only use the dashboard with your own account and circles you are a member of.

## Troubleshooting

- **"That token was rejected by Life360"** &mdash; the token was copied
  incompletely or has expired. Repeat the [Signing in](#signing-in) steps and
  paste a fresh `LIFE360_AUTH_TOKEN` value.
- **You get signed out after a while** &mdash; Life360 expired the token. Grab a
  new one the same way; there is no fixed lifetime under our control.
- **"Life360 blocked the request ... (Cloudflare)"** &mdash; the bot-protection
  layer challenged the request. Wait a minute, disable any VPN/proxy, and retry.
  If it persists, try a different fingerprint, e.g. `LIFE360_IMPERSONATE=safari17_0`.
- **Rate limited** &mdash; too many requests in a short time; wait and retry.

## License

Released under the [MIT License](LICENSE).
