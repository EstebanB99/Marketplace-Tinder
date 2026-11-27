const itemArea = document.getElementById("item-area");
const announcement = document.getElementById("announcement");
const restoreButton = document.getElementById("restore-passed");
const restoreStatus = document.getElementById("restore-status");
let currentItem = null;
let choicePending = false;
let swipeCommitPending = false;
let guestItems = [];

function makeLocation(item) {
    const location = document.createElement("div");
    location.className = "location";
    location.innerHTML = '<svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z" stroke="currentColor" stroke-width="1.7"/><circle cx="12" cy="10" r="2.5" stroke="currentColor" stroke-width="1.7"/></svg>';
    const address = document.createElement("span");
    address.textContent = `${item.address}, ${item.city}, ${item.state} ${item.zipcode}`;
    location.append(address);
    return location;
}

function updateProgress(stats) {
    const total = Number(stats.total);
    const remaining = Number(stats.remaining);
    const kept = Number(stats.kept);
    const passed = Number(stats.passed);
    const reviewed = total - remaining;
    const percent = total ? Math.round((reviewed / total) * 100) : 0;

    document.getElementById("review-count").textContent = `${reviewed} of ${total} reviewed`;
    document.getElementById("progress-percent").textContent = `${percent}%`;
    document.getElementById("kept-count").textContent = kept;
    document.getElementById("passed-count").textContent = passed;
    document.getElementById("progress-fill").style.width = `${percent}%`;
    const progressBar = document.getElementById("progress-bar");
    progressBar.setAttribute("aria-valuemax", total);
    progressBar.setAttribute("aria-valuenow", reviewed);
    restoreButton.hidden = isGuestSession() || passed === 0;
}

function renderEmpty(stats) {
    const emptyState = document.createElement("div");
    emptyState.className = "empty-state";

    const icon = document.createElement("div");
    icon.className = "empty-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = "✦";

    const heading = document.createElement("h2");
    const message = document.createElement("p");
    const browseSaved = document.createElement("a");
    browseSaved.className = "choice keep";
    browseSaved.href = "/saved.html";
    browseSaved.textContent = "View saved items";

    if (isGuestSession()) {
        heading.textContent = "You've seen every find.";
        message.textContent = "Your guest saves last only until you close this browser window.";
    } else if (Number(stats.passed) > 0) {
        heading.textContent = "You're all caught up.";
        message.textContent = "You've seen every available find. You can bring passed items back whenever you like.";
    } else {
        heading.textContent = "You've seen it all.";
        message.textContent = "Your kept items are waiting for you in your saved finds.";
    }

    emptyState.append(icon, heading, message, browseSaved);
    itemArea.replaceChildren(emptyState);
}

function renderItem(item) {
    const article = document.createElement("article");
    article.className = "item-card";
    article.setAttribute("aria-labelledby", "item-name");

    const photoWrap = document.createElement("div");
    photoWrap.className = "photo-wrap";
    const image = document.createElement("img");
    image.src = item.image;
    image.alt = item.imageAlt;
    const label = document.createElement("span");
    label.className = "photo-label";
    label.textContent = "A local find";
    photoWrap.append(image, label);

    const content = document.createElement("div");
    content.className = "card-content";
    const titleLine = document.createElement("div");
    titleLine.className = "item-title-line";
    const title = document.createElement("h2");
    title.id = "item-name";
    title.textContent = item.name;
    const number = document.createElement("span");
    number.className = "item-number";
    number.textContent = `NO. ${item.itemID}`;
    titleLine.append(title, number);

    const description = document.createElement("p");
    description.className = "description";
    description.textContent = item.description;

    const price = document.createElement("p");
    price.className = "item-price";
    price.textContent = formatItemPrice(item.price);

    const footer = document.createElement("div");
    footer.className = "card-footer";
    const passButton = document.createElement("button");
    passButton.className = "choice discard";
    passButton.type = "button";
    passButton.setAttribute("aria-label", `Pass on ${item.name}`);
    passButton.innerHTML = '<span class="choice-symbol" aria-hidden="true">×</span> Pass';
    const keepButton = document.createElement("button");
    keepButton.className = "choice keep";
    keepButton.type = "button";
    keepButton.setAttribute("aria-label", `Keep ${item.name}`);
    keepButton.innerHTML = '<span class="choice-symbol" aria-hidden="true">♡</span> Keep';

    passButton.addEventListener("click", () => chooseItem("pass"));
    keepButton.addEventListener("click", () => chooseItem("keep"));
    footer.append(passButton, keepButton);

    let pointerStart = null;
    article.addEventListener("pointerdown", (event) => {
        if (event.pointerType === "mouse" || !event.isPrimary || choicePending || swipeCommitPending ||
            event.target.closest("button, a")) return;
        pointerStart = { x: event.clientX, y: event.clientY, pointerId: event.pointerId };
        article.classList.add("is-dragging");
        article.setPointerCapture(event.pointerId);
    });
    article.addEventListener("pointermove", (event) => {
        if (!pointerStart || event.pointerId !== pointerStart.pointerId) return;
        const deltaX = event.clientX - pointerStart.x;
        const deltaY = event.clientY - pointerStart.y;
        if (Math.abs(deltaY) > Math.abs(deltaX) * 1.15) {
            article.style.transform = "";
            article.style.removeProperty("--swipe-rotation");
            delete article.dataset.swipeDirection;
            delete article.dataset.swipeLabel;
            return;
        }
        article.style.transform = `translateX(${deltaX}px) rotate(${deltaX * 0.035}deg)`;
        if (Math.abs(deltaX) >= 30) {
            const direction = deltaX > 0 ? "right" : "left";
            article.dataset.swipeDirection = direction;
            article.dataset.swipeLabel = direction === "right" ? "KEEP" : "PASS";
        } else {
            delete article.dataset.swipeDirection;
            delete article.dataset.swipeLabel;
        }
    });
    article.addEventListener("pointerup", (event) => {
        if (!pointerStart || event.pointerId !== pointerStart.pointerId) return;
        const deltaX = event.clientX - pointerStart.x;
        const deltaY = event.clientY - pointerStart.y;
        pointerStart = null;
        if (Math.abs(deltaY) > Math.abs(deltaX) * 1.15 || Math.abs(deltaX) < Math.max(70, article.clientWidth * 0.22)) {
            resetSwipeCard(article);
            return;
        }

        const decision = deltaX > 0 ? "keep" : "pass";
        swipeCommitPending = true;
        article.classList.remove("is-dragging");
        article.classList.add("is-swipe-committing");
        article.style.transform = `translateX(${deltaX > 0 ? window.innerWidth : -window.innerWidth}px) rotate(${deltaX > 0 ? 14 : -14}deg)`;
        article.style.opacity = "0";
        window.setTimeout(() => {
            swipeCommitPending = false;
            chooseItem(decision);
        }, 180);
    });
    article.addEventListener("pointercancel", () => {
        pointerStart = null;
        resetSwipeCard(article);
    });
    article.addEventListener("lostpointercapture", () => {
        if (!swipeCommitPending) {
            pointerStart = null;
            resetSwipeCard(article);
        }
    });

    const keyboardHint = document.createElement("p");
    keyboardHint.className = "keyboard-hint";
    keyboardHint.textContent = "Press ← to pass or → to keep";
    content.append(titleLine, price, description, makeLocation(item), footer, keyboardHint);
    article.append(photoWrap, content);
    itemArea.replaceChildren(article);
}

function resetSwipeCard(article) {
    article.classList.remove("is-dragging", "is-swipe-committing");
    article.style.transform = "";
    article.style.opacity = "";
    delete article.dataset.swipeDirection;
    delete article.dataset.swipeLabel;
}

async function loadNextItem() {
    itemArea.textContent = "Loading your next find…";
    try {
        if (isGuestSession()) {
            const state = readGuestState();
            const itemIDs = new Set(guestItems.map((item) => item.itemID));
            const reviewed = new Set(state.reviewed.filter((id) => itemIDs.has(id)));
            const saved = new Set(state.saved.filter((id) => itemIDs.has(id)));
            currentItem = guestItems.find((item) => !reviewed.has(item.itemID)) || null;
            const stats = {
                total: guestItems.length,
                remaining: guestItems.length - reviewed.size,
                kept: saved.size,
                passed: [...reviewed].filter((id) => !saved.has(id)).length
            };
            updateProgress(stats);
            if (currentItem) renderItem(currentItem);
            else renderEmpty(stats);
            return;
        }

        const result = await apiRequest("/api/items/next");
        currentItem = result.item;
        updateProgress(result.stats);
        if (currentItem) renderItem(currentItem);
        else renderEmpty(result.stats);
    } catch (error) {
        console.error("Could not load the next item.", error);
        itemArea.textContent = error.message;
    }
}

async function chooseItem(decision) {
    if (!currentItem || choicePending || swipeCommitPending) return;
    choicePending = true;
    const item = currentItem;
    try {
        if (isGuestSession()) {
            const state = readGuestState();
            if (!state.reviewed.includes(item.itemID)) state.reviewed.push(item.itemID);
            if (decision === "keep" && !state.saved.includes(item.itemID)) {
                state.saved.push(item.itemID);
            }
            writeGuestState(state);
            announcement.textContent = decision === "keep"
                ? `${item.name} saved for this browser session.`
                : `${item.name} passed.`;
            await loadNextItem();
            return;
        }

        await apiRequest(`/api/items/${item.itemID}/decision`, {
            method: "POST",
            body: JSON.stringify({ decision })
        });
        announcement.textContent = decision === "keep" ? `${item.name} kept.` : `${item.name} passed.`;
        await loadNextItem();
    } catch (error) {
        console.error("Could not save your item choice.", error);
        announcement.textContent = error.message;
        if (error.status === 409) await loadNextItem();
    } finally {
        choicePending = false;
    }
}

function showGuestSwipeTip() {
    if (!isGuestSession() || !window.matchMedia("(max-width: 520px)").matches ||
        sessionStorage.getItem("found_guest_swipe_tip_seen") === "true") return;

    sessionStorage.setItem("found_guest_swipe_tip_seen", "true");
    document.getElementById("guest-swipe-dialog").showModal();
}

document.getElementById("dismiss-swipe-tip").addEventListener("click", () => {
    document.getElementById("guest-swipe-dialog").close();
});

restoreButton.addEventListener("click", async () => {
    restoreButton.disabled = true;
    restoreStatus.hidden = false;
    restoreStatus.textContent = "Restoring passed items…";
    try {
        const result = await apiRequest("/api/items/restore-passed", { method: "POST" });
        restoreStatus.textContent = result.restored === 1
            ? "1 passed item is back in your review list."
            : `${result.restored} passed items are back in your review list.`;
        announcement.textContent = restoreStatus.textContent;
        await loadNextItem();
    } catch (error) {
        console.error("Could not restore passed items.", error);
        restoreStatus.textContent = error.message;
        announcement.textContent = error.message;
    } finally {
        restoreButton.disabled = false;
    }
});

function handleSignOut() {
    signOut().catch((error) => {
        console.error("Could not sign out.", error);
        announcement.textContent = error.message;
    });
}

document.getElementById("sign-out").addEventListener("click", handleSignOut);
document.getElementById("mobile-sign-out").addEventListener("click", handleSignOut);

document.addEventListener("keydown", (event) => {
    if (event.altKey || event.ctrlKey || event.metaKey ||
        (event.target instanceof HTMLElement && event.target.closest("button, a, input, textarea, select"))) return;
    if (event.key === "ArrowLeft") chooseItem("pass");
    if (event.key === "ArrowRight") chooseItem("keep");
});

(async function startMarketplace() {
    if (isGuestSession()) {
        document.getElementById("account-email").textContent = "Guest session";
        document.getElementById("sign-out").textContent = "Exit guest";
        document.getElementById("mobile-sign-out-label").textContent = "Exit guest";
        guestItems = (await apiRequest("/api/guest/items")).items;
        await loadNextItem();
        showGuestSwipeTip();
        return;
    }

    const user = await requireSignedIn("/");
    if (!user) return;
    document.getElementById("account-email").textContent = user.email;
    await loadNextItem();
})().catch((error) => {
    console.error("Could not load the marketplace.", error);
    itemArea.textContent = error.message;
});
