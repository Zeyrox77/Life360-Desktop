/**
 * Life360 Web Dashboard - application logic.
 *
 * Renders the login flow, the circle switcher, the member sidebar, the live
 * map and the member detail panel. Data is refreshed automatically while the
 * dashboard is open.
 */
(() => {
    "use strict";

    const REFRESH_INTERVAL_MS = 30_000;

    // --- Application state -------------------------------------------------
    const state = {
        user: null,
        circles: [],
        activeCircleId: null,
        members: [],
        places: [],
        selectedMemberId: null,
        map: null,
        markers: new Map(), // memberId -> Leaflet marker
        placeMarkers: [],
        refreshTimer: null,
        hasFitBounds: false,
    };

    // --- Element references ------------------------------------------------
    const el = {
        loginView: document.getElementById("login-view"),
        dashboardView: document.getElementById("dashboard-view"),
        loginError: document.getElementById("login-error"),
        tokenForm: document.getElementById("token-form"),
        tokenInput: document.getElementById("token-input"),
        tokenSubmit: document.getElementById("token-submit"),
        rememberToken: document.getElementById("remember-token"),
        circleSwitcherBtn: document.getElementById("circle-switcher-btn"),
        activeCircleName: document.getElementById("active-circle-name"),
        circleList: document.getElementById("circle-list"),
        memberList: document.getElementById("member-list"),
        memberCount: document.getElementById("member-count"),
        placeList: document.getElementById("place-list"),
        placeCount: document.getElementById("place-count"),
        userName: document.getElementById("user-name"),
        logoutBtn: document.getElementById("logout-btn"),
        refreshBtn: document.getElementById("refresh-btn"),
        refreshStatus: document.getElementById("refresh-status"),
        detailPanel: document.getElementById("detail-panel"),
        detailContent: document.getElementById("detail-content"),
        detailClose: document.getElementById("detail-close"),
    };

    // ======================================================================
    // Helpers
    // ======================================================================
    function escapeHtml(value) {
        if (value === null || value === undefined) return "";
        return String(value)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    function initials(first, last) {
        const a = (first || "").trim();
        const b = (last || "").trim();
        const text = `${a.charAt(0)}${b.charAt(0)}`.toUpperCase();
        return text || "?";
    }

    function fullName(member) {
        return [member.firstName, member.lastName].filter(Boolean).join(" ") || "Unknown";
    }

    function toNumber(value) {
        const n = Number(value);
        return Number.isFinite(n) ? n : null;
    }

    function timeAgo(epochSeconds) {
        const ts = toNumber(epochSeconds);
        if (!ts) return "unknown";
        const seconds = Math.max(0, Math.floor(Date.now() / 1000 - ts));
        if (seconds < 60) return "just now";
        const minutes = Math.floor(seconds / 60);
        if (minutes < 60) return `${minutes} min ago`;
        const hours = Math.floor(minutes / 60);
        if (hours < 24) return `${hours} hr${hours > 1 ? "s" : ""} ago`;
        const days = Math.floor(hours / 24);
        return `${days} day${days > 1 ? "s" : ""} ago`;
    }

    function formatTimestamp(epochSeconds) {
        const ts = toNumber(epochSeconds);
        if (!ts) return "Unknown";
        return new Date(ts * 1000).toLocaleString();
    }

    function batteryClass(level) {
        if (level === null) return "";
        if (level >= 50) return "high";
        if (level >= 20) return "mid";
        return "low";
    }

    function locationLabel(location) {
        if (!location) return "Location unavailable";
        return (
            location.name ||
            location.shortAddress ||
            location.address1 ||
            "Unknown location"
        );
    }

    function movementInfo(location) {
        if (!location) return { cls: "", tag: "", label: "Offline" };
        const isDriving = String(location.isDriving) === "1";
        const inTransit = String(location.inTransit) === "1";
        const speed = toNumber(location.speed);
        if (isDriving) return { cls: "driving", tag: "Driving", label: "Driving" };
        if (inTransit || (speed !== null && speed > 0)) {
            return { cls: "moving", tag: "Moving", label: "Moving" };
        }
        return { cls: "stationary", tag: "", label: "Stationary" };
    }

    // ======================================================================
    // View switching
    // ======================================================================
    function showLogin() {
        stopRefresh();
        el.dashboardView.hidden = true;
        el.loginView.hidden = false;
    }

    function showDashboard() {
        el.loginView.hidden = true;
        el.dashboardView.hidden = false;
        ensureMap();
    }

    // ======================================================================
    // Authentication
    // ======================================================================
    function setButtonLoading(button, loading, idleLabel) {
        button.disabled = loading;
        button.querySelector(".btn-label").textContent = loading ? `${idleLabel}\u2026` : idleLabel;
        button.querySelector(".btn-spinner").hidden = !loading;
    }

    function showLoginError(message) {
        el.loginError.textContent = message;
        el.loginError.hidden = false;
    }

    async function handleTokenLogin(event) {
        event.preventDefault();
        el.loginError.hidden = true;
        if (!el.tokenInput.value.trim()) {
            showLoginError("Please paste your access token.");
            return;
        }
        setButtonLoading(el.tokenSubmit, true, "Sign in");
        try {
            await Life360API.loginWithToken(el.tokenInput.value, el.rememberToken.checked);
            el.tokenInput.value = "";
            await startDashboard();
        } catch (error) {
            showLoginError(error.message || "Sign in failed.");
        } finally {
            setButtonLoading(el.tokenSubmit, false, "Sign in");
        }
    }

    function handleLogout() {
        Life360API.clearToken();
        state.selectedMemberId = null;
        state.activeCircleId = null;
        showLogin();
    }

    // ======================================================================
    // Dashboard loading
    // ======================================================================
    async function startDashboard() {
        showDashboard();
        try {
            const [me, circlesResp] = await Promise.all([
                Life360API.me().catch(() => null),
                Life360API.circles(),
            ]);

            state.user = me;
            if (me) {
                el.userName.textContent = [me.firstName, me.lastName].filter(Boolean).join(" ") || me.loginEmail || "";
            }

            state.circles = circlesResp.circles || [];
            renderCircleSwitcher();

            if (state.circles.length === 0) {
                el.activeCircleName.textContent = "No circles found";
                return;
            }

            await selectCircle(state.circles[0].id);
            startRefresh();
        } catch (error) {
            if (error.status === 401) {
                showLogin();
                return;
            }
            el.activeCircleName.textContent = "Failed to load";
            el.refreshStatus.textContent = error.message || "Error loading data";
        }
    }

    function renderCircleSwitcher() {
        el.circleList.innerHTML = "";
        state.circles.forEach((circle) => {
            const li = document.createElement("li");
            if (circle.id === state.activeCircleId) li.classList.add("active");
            const count = (circle.memberCount !== undefined && circle.memberCount !== null)
                ? circle.memberCount
                : (circle.members ? circle.members.length : "");
            li.innerHTML =
                `<span>${escapeHtml(circle.name)}</span>` +
                (count !== "" ? `<span class="member-pill">${escapeHtml(count)} members</span>` : "");
            li.addEventListener("click", async () => {
                el.circleList.hidden = true;
                if (circle.id !== state.activeCircleId) {
                    state.selectedMemberId = null;
                    closeDetail();
                    await selectCircle(circle.id);
                }
            });
            el.circleList.appendChild(li);
        });
    }

    async function selectCircle(circleId) {
        state.activeCircleId = circleId;
        state.hasFitBounds = false;
        const circle = state.circles.find((c) => c.id === circleId);
        el.activeCircleName.textContent = circle ? circle.name : "Circle";
        renderCircleSwitcher();
        await refreshData(true);
    }

    async function refreshData(fit = false) {
        if (!state.activeCircleId) return;
        try {
            const [membersResp, placesResp] = await Promise.all([
                Life360API.members(state.activeCircleId),
                Life360API.places(state.activeCircleId).catch(() => ({ places: [] })),
            ]);
            state.members = membersResp.members || [];
            state.places = placesResp.places || [];
            renderMembers();
            renderPlaces();
            renderMap(fit);
            if (state.selectedMemberId) {
                const member = state.members.find((m) => m.id === state.selectedMemberId);
                if (member) renderMemberDetail(member);
            }
            const now = new Date();
            el.refreshStatus.textContent = `Updated ${now.toLocaleTimeString()}`;
        } catch (error) {
            if (error.status === 401) {
                showLogin();
                return;
            }
            el.refreshStatus.textContent = error.message || "Refresh failed";
        }
    }

    // ======================================================================
    // Sidebar rendering
    // ======================================================================
    function renderMembers() {
        el.memberCount.textContent = state.members.length;
        el.memberList.innerHTML = "";

        if (state.members.length === 0) {
            el.memberList.innerHTML = '<li class="empty-hint">No members in this circle.</li>';
            return;
        }

        state.members.forEach((member) => {
            const location = member.location;
            const battery = location ? toNumber(location.battery) : null;
            const charging = location && String(location.charge) === "1";
            const move = movementInfo(location);

            const li = document.createElement("li");
            li.className = "member-item";
            if (member.id === state.selectedMemberId) li.classList.add("active");

            const avatar = member.avatar
                ? `<img class="avatar" src="${escapeHtml(member.avatar)}" alt="" referrerpolicy="no-referrer" />`
                : `<div class="avatar">${escapeHtml(initials(member.firstName, member.lastName))}</div>`;

            const batteryHtml = battery !== null
                ? `<span class="battery ${batteryClass(battery)}">${charging ? "\u26a1" : ""}${battery}%</span>`
                : "";

            li.innerHTML = `
                ${avatar}
                <div class="member-info">
                    <div class="member-name">${escapeHtml(fullName(member))}</div>
                    <div class="member-sub">${escapeHtml(locationLabel(location))}</div>
                    <div class="member-sub">${location ? escapeHtml(timeAgo(location.timestamp)) : "No location"}</div>
                </div>
                <div class="member-meta">
                    ${batteryHtml}
                    ${move.tag ? `<span class="tag ${move.cls}">${escapeHtml(move.tag)}</span>` : `<span class="status-dot ${move.cls}"></span>`}
                </div>
            `;

            li.addEventListener("click", () => {
                state.selectedMemberId = member.id;
                renderMembers();
                renderMemberDetail(member);
                focusMember(member);
            });

            el.memberList.appendChild(li);
        });
    }

    function renderPlaces() {
        el.placeCount.textContent = state.places.length;
        el.placeList.innerHTML = "";
        if (state.places.length === 0) {
            el.placeList.innerHTML = '<li class="empty-hint">No saved places.</li>';
            return;
        }
        state.places.forEach((place) => {
            const li = document.createElement("li");
            li.className = "place-item";
            li.innerHTML = `
                <div class="place-icon">&#9873;</div>
                <span>${escapeHtml(place.name || "Place")}</span>
            `;
            li.addEventListener("click", () => {
                const lat = toNumber(place.latitude);
                const lng = toNumber(place.longitude);
                if (state.map && lat !== null && lng !== null) {
                    state.map.setView([lat, lng], 16);
                }
            });
            el.placeList.appendChild(li);
        });
    }

    // ======================================================================
    // Map rendering
    // ======================================================================
    function ensureMap() {
        if (state.map) return;
        state.map = L.map("map", { zoomControl: true }).setView([20, 0], 2);
        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
            maxZoom: 19,
            attribution: "&copy; OpenStreetMap contributors",
        }).addTo(state.map);
    }

    function memberMarkerIcon(member) {
        const inner = member.avatar
            ? `<img class="map-avatar" src="${escapeHtml(member.avatar)}" alt="" referrerpolicy="no-referrer" />`
            : `<div class="map-avatar">${escapeHtml(initials(member.firstName, member.lastName))}</div>`;
        return L.divIcon({
            className: "map-avatar-wrap",
            html: inner,
            iconSize: [44, 44],
            iconAnchor: [22, 22],
            popupAnchor: [0, -24],
        });
    }

    function renderMap(fit = false) {
        ensureMap();

        // Clear existing markers.
        state.markers.forEach((marker) => state.map.removeLayer(marker));
        state.markers.clear();
        state.placeMarkers.forEach((marker) => state.map.removeLayer(marker));
        state.placeMarkers = [];

        const bounds = [];

        // Place markers.
        state.places.forEach((place) => {
            const lat = toNumber(place.latitude);
            const lng = toNumber(place.longitude);
            if (lat === null || lng === null) return;
            const marker = L.marker([lat, lng], {
                icon: L.divIcon({
                    className: "",
                    html: '<div class="place-marker"></div>',
                    iconSize: [22, 22],
                    iconAnchor: [11, 22],
                }),
            }).addTo(state.map);
            marker.bindPopup(`<strong>${escapeHtml(place.name || "Place")}</strong>`);
            state.placeMarkers.push(marker);
        });

        // Member markers.
        state.members.forEach((member) => {
            const location = member.location;
            if (!location) return;
            const lat = toNumber(location.latitude);
            const lng = toNumber(location.longitude);
            if (lat === null || lng === null) return;

            const marker = L.marker([lat, lng], { icon: memberMarkerIcon(member) }).addTo(state.map);
            const battery = toNumber(location.battery);
            marker.bindPopup(`
                <strong>${escapeHtml(fullName(member))}</strong><br />
                ${escapeHtml(locationLabel(location))}<br />
                <span style="color:#6b7280">${escapeHtml(timeAgo(location.timestamp))}</span>
                ${battery !== null ? ` &middot; ${battery}%` : ""}
            `);
            marker.on("click", () => {
                state.selectedMemberId = member.id;
                renderMembers();
                renderMemberDetail(member);
            });
            state.markers.set(member.id, marker);
            bounds.push([lat, lng]);
        });

        if (fit && bounds.length > 0 && !state.hasFitBounds) {
            if (bounds.length === 1) {
                state.map.setView(bounds[0], 15);
            } else {
                state.map.fitBounds(bounds, { padding: [60, 60], maxZoom: 16 });
            }
            state.hasFitBounds = true;
        }

        // Leaflet needs a nudge when its container becomes visible.
        setTimeout(() => state.map.invalidateSize(), 100);
    }

    function focusMember(member) {
        const marker = state.markers.get(member.id);
        if (marker) {
            state.map.setView(marker.getLatLng(), 16);
            marker.openPopup();
        }
    }

    // ======================================================================
    // Member detail panel
    // ======================================================================
    function detailRow(label, value) {
        if (value === null || value === undefined || value === "") return "";
        return `
            <li class="detail-row">
                <span class="label">${escapeHtml(label)}</span>
                <span class="value">${escapeHtml(value)}</span>
            </li>`;
    }

    function renderMemberDetail(member) {
        const location = member.location || {};
        const battery = toNumber(location.battery);
        const charging = String(location.charge) === "1";
        const wifi = String(location.wifiState) === "1";
        const move = movementInfo(location);
        const speed = toNumber(location.speed);

        const avatar = member.avatar
            ? `<img class="avatar" src="${escapeHtml(member.avatar)}" alt="" referrerpolicy="no-referrer" />`
            : `<div class="avatar">${escapeHtml(initials(member.firstName, member.lastName))}</div>`;

        const address = [location.address1, location.address2].filter(Boolean).join(", ");
        const coords = (location.latitude && location.longitude)
            ? `${toNumber(location.latitude)?.toFixed(5)}, ${toNumber(location.longitude)?.toFixed(5)}`
            : "";

        el.detailContent.innerHTML = `
            <div class="detail-head">
                ${avatar}
                <h3>${escapeHtml(fullName(member))}</h3>
                <div class="detail-status">${escapeHtml(move.label)} &middot; ${escapeHtml(timeAgo(location.timestamp))}</div>
            </div>
            <ul class="detail-rows">
                ${detailRow("Place", location.name)}
                ${detailRow("Address", address || location.shortAddress)}
                ${detailRow("Coordinates", coords)}
                ${detailRow("Battery", battery !== null ? `${battery}%${charging ? " (charging)" : ""}` : null)}
                ${detailRow("Wi-Fi", location.wifiState !== undefined ? (wifi ? "Connected" : "Off") : null)}
                ${detailRow("Speed", speed !== null && speed >= 0 ? `${(speed * 3.6).toFixed(1)} km/h` : null)}
                ${detailRow("Driving", String(location.isDriving) === "1" ? "Yes" : "No")}
                ${detailRow("Accuracy", location.accuracy ? `${toNumber(location.accuracy)} m` : null)}
                ${detailRow("Last update", formatTimestamp(location.timestamp))}
                ${detailRow("Email", member.loginEmail)}
                ${detailRow("Phone", member.loginPhone)}
            </ul>
        `;
        el.detailPanel.hidden = false;
    }

    function closeDetail() {
        el.detailPanel.hidden = true;
        state.selectedMemberId = null;
        renderMembers();
    }

    // ======================================================================
    // Auto refresh
    // ======================================================================
    function startRefresh() {
        stopRefresh();
        state.refreshTimer = setInterval(() => refreshData(false), REFRESH_INTERVAL_MS);
    }

    function stopRefresh() {
        if (state.refreshTimer) {
            clearInterval(state.refreshTimer);
            state.refreshTimer = null;
        }
    }

    // ======================================================================
    // Event wiring
    // ======================================================================
    function bindEvents() {
        el.tokenForm.addEventListener("submit", handleTokenLogin);
        el.logoutBtn.addEventListener("click", handleLogout);
        el.refreshBtn.addEventListener("click", () => refreshData(false));
        el.detailClose.addEventListener("click", closeDetail);

        el.circleSwitcherBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            el.circleList.hidden = !el.circleList.hidden;
        });
        document.addEventListener("click", () => {
            el.circleList.hidden = true;
        });
        el.circleList.addEventListener("click", (e) => e.stopPropagation());
    }

    // ======================================================================
    // Bootstrap
    // ======================================================================
    function init() {
        bindEvents();
        if (Life360API.isAuthenticated()) {
            startDashboard();
        } else {
            showLogin();
        }
    }

    document.addEventListener("DOMContentLoaded", init);
})();
