const preferencesForm = document.getElementById("preferences-form");
const preferencesMessage = document.getElementById("preferences-message");
const saveButton = document.getElementById("save-preferences");

function getPreferencesReturnPath() {
    return new URLSearchParams(window.location.search).get("returnTo") === "/saved.html"
        ? "/saved.html"
        : "/";
}

(async function startPreferencesPage() {
    try {
        const { user } = await apiRequest("/api/me");
        if (user.needsPreferences) return;
        window.location.replace(getPreferencesReturnPath());
    } catch (error) {
        if (error.status === 401) {
            window.location.replace(`/auth.html?returnTo=${encodeURIComponent(getPreferencesReturnPath())}`);
            return;
        }
        console.error("Could not check the current account.", error);
        preferencesMessage.textContent = error.message;
        saveButton.disabled = true;
    }
})();

preferencesForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const categories = [...preferencesForm.querySelectorAll('input[name="category"]:checked')]
        .map((input) => input.value);
    if (categories.length === 0) {
        preferencesMessage.textContent = "Choose at least one category to continue.";
        return;
    }

    saveButton.disabled = true;
    preferencesMessage.textContent = "";
    try {
        await apiRequest("/api/profile/preferences", {
            method: "POST",
            body: JSON.stringify({ categories })
        });
        window.location.replace(getPreferencesReturnPath());
    } catch (error) {
        console.error("Could not save shopping preferences.", error);
        preferencesMessage.textContent = error.message;
        saveButton.disabled = false;
    }
});
