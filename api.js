async function apiRequest(url, options = {}) {
    const headers = new Headers(options.headers || {});
    if (options.body && !headers.has("Content-Type")) {
        headers.set("Content-Type", "application/json");
    }

    const response = await fetch(url, {
        ...options,
        headers,
        credentials: "same-origin"
    });
    const payload = response.status === 204 ? null : await response.json();
    if (!response.ok) {
        const error = new Error(payload?.error || "The request could not be completed.");
        error.status = response.status;
        throw error;
    }
    return payload;
}

async function requireSignedIn(returnTo) {
    try {
        const { user } = await apiRequest("/api/me");
        if (user.needsPreferences) {
            const preferencesUrl = new URL("/preferences.html", window.location.origin);
            if (returnTo === "/saved.html") preferencesUrl.searchParams.set("returnTo", returnTo);
            window.location.replace(preferencesUrl.toString());
            return null;
        }
        return user;
    } catch (error) {
        if (error.status === 401) {
            window.location.replace(`/auth.html?returnTo=${encodeURIComponent(returnTo)}`);
            return null;
        }
        throw error;
    }
}

function formatItemPrice(price) {
    if (price === null || price === undefined) return "Price not listed";
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(price);
}

function isGuestSession() {
    return sessionStorage.getItem("found_guest_mode") === "true";
}

function startGuestSession() {
    sessionStorage.setItem("found_guest_state", JSON.stringify({ reviewed: [], saved: [] }));
    sessionStorage.setItem("found_guest_mode", "true");
    sessionStorage.removeItem("found_guest_swipe_tip_seen");
}

function readGuestState() {
    const serialized = sessionStorage.getItem("found_guest_state");
    if (!serialized) return { reviewed: [], saved: [] };
    const state = JSON.parse(serialized);
    if (!state || !Array.isArray(state.reviewed) || !Array.isArray(state.saved) ||
        !state.reviewed.every((id) => Number.isSafeInteger(id) && id > 0) ||
        !state.saved.every((id) => Number.isSafeInteger(id) && id > 0)) {
        throw new Error("Your guest session data is invalid. Exit guest mode and start a new session.");
    }
    return state;
}

function writeGuestState(state) {
    sessionStorage.setItem("found_guest_state", JSON.stringify(state));
}

async function signOut() {
    if (isGuestSession()) {
        sessionStorage.removeItem("found_guest_mode");
        sessionStorage.removeItem("found_guest_state");
        sessionStorage.removeItem("found_guest_swipe_tip_seen");
        window.location.replace("/auth.html");
        return;
    }
    await apiRequest("/api/auth/logout", { method: "POST" });
    window.location.replace("/auth.html");
}
