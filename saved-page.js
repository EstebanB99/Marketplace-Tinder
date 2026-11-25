const savedItemsArea = document.getElementById("saved-items");
const savedCount = document.getElementById("saved-count");
const announcement = document.getElementById("announcement");
let guestMode = false;
let guestItems = [];

function makeSavedLocation(item) {
    const location = document.createElement("div");
    location.className = "location";
    location.innerHTML = '<svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z" stroke="currentColor" stroke-width="1.7"/><circle cx="12" cy="10" r="2.5" stroke="currentColor" stroke-width="1.7"/></svg>';
    const address = document.createElement("span");
    address.textContent = `${item.address}, ${item.city}, ${item.state} ${item.zipcode}`;
    location.append(address);
    return location;
}

function makeSavedCard(item) {
    const article = document.createElement("article");
    article.className = "saved-card";

    const image = document.createElement("img");
    image.src = item.image;
    image.alt = item.imageAlt;

    const content = document.createElement("div");
    content.className = "card-content";
    const titleLine = document.createElement("div");
    titleLine.className = "item-title-line";
    const title = document.createElement("h2");
    title.textContent = item.name;
    const id = document.createElement("span");
    id.className = "item-number";
    id.textContent = `NO. ${item.itemID}`;
    titleLine.append(title, id);

    const description = document.createElement("p");
    description.className = "description";
    description.textContent = item.description;

    const price = document.createElement("p");
    price.className = "item-price";
    price.textContent = formatItemPrice(item.price);

    const removeButton = document.createElement("button");
    removeButton.className = "remove-button";
    removeButton.type = "button";
    removeButton.textContent = "Remove from saved";
    removeButton.setAttribute("aria-label", `Remove ${item.name} from saved items`);
    removeButton.addEventListener("click", () => removeSavedItem(item, removeButton));
    content.append(titleLine, price, description, makeSavedLocation(item), removeButton);
    article.append(image, content);
    return article;
}

function renderEmpty() {
    const emptyState = document.createElement("div");
    emptyState.className = "empty-state";
    const icon = document.createElement("div");
    icon.className = "empty-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = "♡";
    const heading = document.createElement("h2");
    heading.textContent = "No saved finds yet.";
    const message = document.createElement("p");
    message.textContent = guestMode
        ? "Guest saves are kept only in this browser window's session."
        : "When you keep an item, it will show up here.";
    const browse = document.createElement("a");
    browse.className = "browse-button";
    browse.href = "/";
    browse.textContent = "Browse items";
    emptyState.append(icon, heading, message, browse);
    savedItemsArea.className = "";
    savedItemsArea.replaceChildren(emptyState);
}

async function loadSavedItems() {
    savedItemsArea.textContent = "Loading your saved finds…";
    let items;
    if (guestMode) {
        guestItems = (await apiRequest("/api/guest/items")).items;
        const savedIds = new Set(readGuestState().saved);
        items = guestItems.filter((item) => savedIds.has(item.itemID));
        savedCount.textContent = `${items.length} ${items.length === 1 ? "item" : "items"} saved for this browser session`;
    } else {
        items = (await apiRequest("/api/items/saved")).items;
        savedCount.textContent = `${items.length} ${items.length === 1 ? "item" : "items"} saved`;
    }

    if (items.length === 0) {
        renderEmpty();
        return;
    }
    savedItemsArea.className = "item-grid";
    savedItemsArea.replaceChildren(...items.map(makeSavedCard));
}

async function removeSavedItem(item, button) {
    button.disabled = true;
    try {
        if (guestMode) {
            const state = readGuestState();
            state.saved = state.saved.filter((id) => id !== item.itemID);
            state.reviewed = state.reviewed.filter((id) => id !== item.itemID);
            writeGuestState(state);
            announcement.textContent = `${item.name} removed and returned to your guest review list.`;
            await loadSavedItems();
            return;
        }

        await apiRequest(`/api/items/${item.itemID}/saved`, { method: "DELETE" });
        announcement.textContent = `${item.name} removed from saved items and returned to your review list.`;
        await loadSavedItems();
    } catch (error) {
        console.error("Could not remove the saved item.", error);
        announcement.textContent = error.message;
        button.disabled = false;
    }
}

document.getElementById("sign-out").addEventListener("click", () => {
    signOut().catch((error) => {
        console.error("Could not sign out.", error);
        announcement.textContent = error.message;
    });
});

(async function startSavedPage() {
    if (isGuestSession()) {
        guestMode = true;
        document.getElementById("account-email").textContent = "Guest session";
        document.getElementById("sign-out").textContent = "Exit guest";
        await loadSavedItems();
        return;
    }

    const user = await requireSignedIn("/saved.html");
    if (!user) return;
    document.getElementById("account-email").textContent = user.email;
    await loadSavedItems();
})().catch((error) => {
    console.error("Could not load saved items.", error);
    savedItemsArea.textContent = error.message;
});
