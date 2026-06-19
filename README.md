# Life360 Desktop

A standalone desktop application that lets you view your
[Life360](https://www.life360.com/) circles, members and locations in its own
window &mdash; no browser required. It brings the core experience of the mobile
app to your Windows PC and can be packaged as a single `.exe`.

> **Prefer the browser version?**
> There is also a **browser variant** (runs a local server you open in your
> web browser) on the
> [`browser` branch](https://github.com/Zeyrox77/Life360-Desktop/tree/browser).

> **Disclaimer**
> This project uses Life360's unofficial, undocumented REST API. It is **not**
> affiliated with, endorsed by, or supported by Life360, Inc. Use it only with
> your own account and your own circles, and at your own risk. The API may
> change or stop working at any time.

---

## Features

- **Native desktop window** &mdash; opens like a normal app, no browser tab.
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
- **Stays signed in** &mdash; your access token is stored locally so you do not
  have to paste it again every launch.

## Download & run

### Option A: Download the Windows executable (easiest)

Grab `Life360.exe` from the [Releases page](https://github.com/Zeyrox77/Life360-Desktop/releases),
double-click it, and sign in (see [Signing in](#signing-in)). No Python needed.

### Option B: Run from source

```bash
git clone https://github.com/Zeyrox77/Life360-Desktop.git
cd Life360
python -m venv .venv
# Windows:  .venv\Scripts\activate
# macOS/Linux:  source .venv/bin/activate
pip install -r requirements.txt
python desktop.py
```

Requires Python 3.10+. On Windows, the
[Microsoft Edge WebView2 runtime](https://developer.microsoft.com/microsoft-edge/webview2/)
is used for the window (pre-installed on Windows 10/11).

## Signing in

Life360 signs most accounts in with a **one-time code (OTP)** sent to your email
or phone, so this app authenticates with an **access token** copied from an
existing Life360 web session.

1. Open <https://life360.com/login> in a browser and sign in normally
   (email + the code you receive).
2. Press **F12** to open Developer Tools and switch to the **Network** tab.
3. Reload the page (**F5**) and click the request named **`manage-membership`**.
4. Under **Headers -> Request Headers**, scroll to **`Cookie`** and find
   `LIFE360_AUTH_TOKEN=`.
5. Copy everything **after** the `=` up to (but not including) the next `;`,
   and paste it into the app's token box. (Pasting the whole
   `LIFE360_AUTH_TOKEN=...;` chunk also works - it is cleaned up automatically.)

Tick **"Keep me signed in on this device"** so the token persists across
restarts. The token is never sent to or stored on any server. It stays valid
until Life360 expires it; when that happens the app asks you to paste a fresh one.

## How it works

The window does not talk to Life360 directly. The app starts a small **FastAPI**
backend on a local port and shows it inside a native
[`pywebview`](https://pywebview.flowrl.com/) window. The backend:

1. validates the access token you provide, and
2. forwards authenticated read requests to the Life360 API.

```
Native window (pywebview)  <-->  FastAPI backend (local)  <-->  Life360 REST API
```

### Getting past Cloudflare

Life360 sits behind Cloudflare, which fingerprints the TLS handshake and blocks
generic HTTP clients with a "bot protection" page. To get through reliably the
backend uses [`curl_cffi`](https://github.com/lexiforest/curl_cffi) to impersonate
a **Safari/iOS** TLS fingerprint, which Life360's edge accepts. The profile is
configurable via `LIFE360_IMPERSONATE`.

## Project structure

```
.
├── backend/                # Shared FastAPI backend (Life360 client + API)
│   ├── config.py
│   ├── life360_client.py   # curl_cffi client (Cloudflare bypass)
│   └── main.py
├── frontend/               # Shared HTML/CSS/JS dashboard
│   ├── index.html
│   ├── css/styles.css
│   └── js/{api.js,app.js}
├── desktop.py              # Desktop launcher (server thread + native window)
├── Life360.spec            # PyInstaller build spec for the .exe
├── build_windows.bat       # One-click local Windows build
├── .github/workflows/release.yml  # CI: build exe + publish release
├── requirements.txt
└── requirements-build.txt  # Build-only deps (PyInstaller)
```

## Building the Windows executable

### Locally (on a Windows machine)

```bat
build_windows.bat
```

or manually:

```bat
pip install -r requirements.txt -r requirements-build.txt
pyinstaller Life360.spec --noconfirm --clean
```

The result is `dist\Life360.exe`.

### Creating a release (automated)

A GitHub Actions workflow builds the exe on Windows and publishes a Release with
the exe attached whenever you push a version tag:

```bash
git tag v1.0.0
git push origin v1.0.0
```

The workflow can also be run manually from the **Actions** tab (it then uploads
the exe as a downloadable build artifact).

## Configuration

Optional settings via environment variables (prefixed `LIFE360_`):

| Variable                  | Default                       | Description                                   |
| ------------------------- | ----------------------------- | --------------------------------------------- |
| `LIFE360_API_BASE_URL`    | `https://api.life360.com/v3`  | Base URL of the Life360 REST API.             |
| `LIFE360_IMPERSONATE`     | `safari_ios`                  | Browser TLS fingerprint used to pass Cloudflare. |
| `LIFE360_REQUEST_TIMEOUT` | `20`                          | Upstream request timeout in seconds.          |

## Troubleshooting

- **"That token was rejected by Life360"** &mdash; the token was copied
  incompletely or has expired. Repeat the [Signing in](#signing-in) steps and
  paste a fresh `LIFE360_AUTH_TOKEN` value.
- **The window is blank on Windows** &mdash; install/repair the
  [Edge WebView2 runtime](https://developer.microsoft.com/microsoft-edge/webview2/).
- **"Life360 blocked the request ... (Cloudflare)"** &mdash; wait a minute,
  disable any VPN/proxy, and retry. If it persists, try
  `LIFE360_IMPERSONATE=safari17_0`.

## License

Released under the [MIT License](LICENSE).
