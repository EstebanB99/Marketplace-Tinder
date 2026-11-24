const resetForm = document.getElementById("reset-form");
const resetMessage = document.getElementById("reset-message");
const submitButton = document.getElementById("submit-button");
const token = new URLSearchParams(window.location.search).get("token");

if (token && /^[a-f0-9]{64}$/i.test(token)) {
    window.history.replaceState({}, "", "/reset-password.html");
    resetForm.hidden = false;
    resetMessage.textContent = "";
} else {
    resetMessage.textContent = "This password reset link is missing or invalid.";
}

resetForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    resetMessage.textContent = "";
    if (document.getElementById("password").value !== document.getElementById("confirm-password").value) {
        resetMessage.textContent = "The passwords do not match.";
        return;
    }

    submitButton.disabled = true;
    try {
        const result = await apiRequest("/api/auth/reset-password", {
            method: "POST",
            body: JSON.stringify({
                token,
                password: document.getElementById("password").value
            })
        });
        resetForm.hidden = true;
        resetMessage.style.color = "var(--green)";
        resetMessage.textContent = result.message;
    } catch (error) {
        console.error("Could not reset the password.", error);
        resetMessage.textContent = error.message;
    } finally {
        submitButton.disabled = false;
    }
});
