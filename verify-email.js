const statusMessage = document.getElementById("verification-status");
const continueLink = document.getElementById("continue-link");

(async function verifyEmail() {
    const token = new URLSearchParams(window.location.search).get("token");
    if (!token || !/^[a-f0-9]{64}$/i.test(token)) {
        statusMessage.textContent = "This verification link is missing or invalid.";
        return;
    }

    window.history.replaceState({}, "", "/verify-email.html");
    try {
        await apiRequest("/api/auth/verify-email", {
            method: "POST",
            body: JSON.stringify({ token })
        });
        statusMessage.textContent = "Your email is verified and your account is ready.";
        continueLink.hidden = false;
        window.setTimeout(() => window.location.replace("/"), 1500);
    } catch (error) {
        console.error("Could not verify the email address.", error);
        statusMessage.textContent = error.message;
    }
})();
