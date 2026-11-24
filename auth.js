const authForm = document.getElementById("auth-form");
const loginTab = document.getElementById("login-tab");
const registerTab = document.getElementById("register-tab");
const passwordInput = document.getElementById("password");
const passwordHint = document.getElementById("password-hint");
const passwordField = document.getElementById("password-field");
const submitButton = document.getElementById("submit-button");
const formMessage = document.getElementById("form-message");
const guestButton = document.getElementById("guest-button");
const forgotLink = document.getElementById("forgot-link");
const backToLogin = document.getElementById("back-to-login");
const accountTabs = document.getElementById("account-tabs");
let mode = "login";

function meetsPasswordPolicy(password) {
    return password.length >= 6 &&
        password.length <= 128 &&
        /[A-Z]/.test(password) &&
        /[a-z]/.test(password) &&
        /[^A-Za-z0-9\s]/.test(password);
}

function getReturnPath() {
    const requestedPath = new URLSearchParams(window.location.search).get("returnTo");
    return requestedPath === "/saved.html" ? requestedPath : "/";
}

function setMode(nextMode) {
    mode = nextMode;
    const registering = mode === "register";
    const requestingReset = mode === "forgot";
    accountTabs.hidden = requestingReset;
    loginTab.setAttribute("aria-selected", String(!registering));
    registerTab.setAttribute("aria-selected", String(registering));
    passwordField.hidden = requestingReset;
    passwordInput.disabled = requestingReset;
    passwordInput.required = !requestingReset;
    passwordInput.autocomplete = registering ? "new-password" : "current-password";
    passwordInput.minLength = registering ? 6 : 1;
    passwordHint.hidden = !registering;
    submitButton.textContent = registering ? "Create account" : requestingReset ? "Send reset link" : "Sign in";
    forgotLink.hidden = registering || requestingReset;
    backToLogin.hidden = !requestingReset;
    guestButton.hidden = requestingReset;
    document.getElementById("page-title").textContent = requestingReset ? "Reset your password." : "Welcome to Found.";
    document.getElementById("auth-description").textContent = registering
        ? "Verify your email address to create your account and start browsing."
        : requestingReset
            ? "Enter the email address linked to your account and we’ll send a reset link if an account exists."
            : "Sign in to pick up where you left off, or create an account to start browsing.";
    formMessage.textContent = "";
    formMessage.style.color = "";
}

loginTab.addEventListener("click", () => setMode("login"));
registerTab.addEventListener("click", () => setMode("register"));
forgotLink.addEventListener("click", () => setMode("forgot"));
backToLogin.addEventListener("click", () => setMode("login"));

document.getElementById("guest-button").addEventListener("click", () => {
    startGuestSession();
    window.location.replace(getReturnPath());
});

authForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    submitButton.disabled = true;
    formMessage.textContent = "";

    if (mode === "forgot") {
        try {
            const result = await apiRequest("/api/auth/forgot-password", {
                method: "POST",
                body: JSON.stringify({ email: document.getElementById("email").value })
            });
            formMessage.textContent = result.message;
            formMessage.style.color = "var(--green)";
        } catch (error) {
            console.error("Could not request a password reset.", error);
            formMessage.textContent = error.message;
        } finally {
            if (submitButton.isConnected) submitButton.disabled = false;
        }
        return;
    }

    if (mode === "register" && !meetsPasswordPolicy(passwordInput.value)) {
        formMessage.textContent = "Use at least 6 characters, including an uppercase letter, a lowercase letter, and a special character.";
        submitButton.disabled = false;
        return;
    }

    try {
        const result = await apiRequest(`/api/auth/${mode}`, {
            method: "POST",
            body: JSON.stringify({
                email: document.getElementById("email").value,
                password: passwordInput.value
            })
        });
        if (mode === "register") {
            formMessage.textContent = result.message;
            formMessage.style.color = "var(--green)";
            authForm.reset();
            return;
        }
        window.location.replace(getReturnPath());
    } catch (error) {
        console.error("Could not complete account sign-in.", error);
        formMessage.style.color = "";
        formMessage.textContent = error.message;
    } finally {
        if (submitButton.isConnected) submitButton.disabled = false;
    }
});

(async function redirectIfSignedIn() {
    try {
        await apiRequest("/api/me");
        window.location.replace(getReturnPath());
    } catch (error) {
        if (error.status !== 401) {
            console.error("Could not check the current account.", error);
            formMessage.textContent = error.message;
        }
    }
})();
