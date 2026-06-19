/**
 * Thin client for the local backend API.
 *
 * The access token is stored in the browser only:
 *   - localStorage  -> "keep me signed in" (persists across browser restarts)
 *   - sessionStorage -> cleared when the tab is closed
 * It is never sent to or stored on any server.
 */
const Life360API = (() => {
    const TOKEN_KEY = "life360_access_token";

    function getToken() {
        return localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(TOKEN_KEY);
    }

    function setToken(token, persist = true) {
        clearToken();
        if (persist) {
            localStorage.setItem(TOKEN_KEY, token);
        } else {
            sessionStorage.setItem(TOKEN_KEY, token);
        }
    }

    function clearToken() {
        localStorage.removeItem(TOKEN_KEY);
        sessionStorage.removeItem(TOKEN_KEY);
    }

    function isAuthenticated() {
        return Boolean(getToken());
    }

    /**
     * Normalise whatever the user pasted into a bare access token.
     * Accepts: a raw token, "Bearer <token>", a full cookie chunk like
     * "LIFE360_AUTH_TOKEN=<token>;", or the entire Cookie header.
     */
    function normaliseToken(raw) {
        let value = (raw || "").trim();

        // If the whole cookie header (or chunk) was pasted, extract the token.
        const match = value.match(/LIFE360_AUTH_TOKEN=([^;]+)/i);
        if (match) {
            value = match[1];
        }

        // Strip an optional "Bearer " prefix and surrounding quotes/semicolons.
        value = value
            .replace(/^bearer\s+/i, "")
            .replace(/^["']|["']$/g, "")
            .replace(/;+$/, "")
            .trim();

        return value;
    }

    async function request(path, options = {}) {
        const headers = Object.assign({}, options.headers || {});
        const token = getToken();
        if (token) {
            headers["Authorization"] = `Bearer ${token}`;
        }

        const response = await fetch(path, { ...options, headers });

        let body = null;
        const text = await response.text();
        if (text) {
            try {
                body = JSON.parse(text);
            } catch (_e) {
                body = { detail: text };
            }
        }

        // A 401 on a request that carried a token means the saved token is no
        // longer valid, so clear it.
        if (response.status === 401 && token) {
            clearToken();
        }

        if (!response.ok) {
            const message =
                (body && body.detail) ||
                (response.status === 401
                    ? "Your token has expired. Please paste a fresh one."
                    : `Request failed (HTTP ${response.status}).`);
            const err = new Error(message);
            err.status = response.status;
            throw err;
        }
        return body;
    }

    async function loginWithToken(raw, persist = true) {
        const token = normaliseToken(raw);
        if (!token) {
            throw new Error("Please paste a valid access token.");
        }
        setToken(token, persist);
        try {
            // Validate the token by fetching the user's profile.
            await request("/api/login/token", { method: "POST" });
        } catch (error) {
            clearToken();
            if (error.status === 401) {
                throw new Error(
                    "That token was rejected by Life360. Make sure you copied the full " +
                    "LIFE360_AUTH_TOKEN value, then try again."
                );
            }
            throw error;
        }
        return { access_token: token };
    }

    return {
        isAuthenticated,
        clearToken,
        loginWithToken,
        me: () => request("/api/me"),
        circles: () => request("/api/circles"),
        circle: (id) => request(`/api/circles/${id}`),
        members: (id) => request(`/api/circles/${id}/members`),
        member: (cid, mid) => request(`/api/circles/${cid}/members/${mid}`),
        memberHistory: (cid, mid) => request(`/api/circles/${cid}/members/${mid}/history`),
        places: (id) => request(`/api/circles/${id}/places`),
    };
})();
