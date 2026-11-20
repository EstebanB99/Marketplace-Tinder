const assert = require("node:assert/strict");
const { after, before, test } = require("node:test");
const app = require("../server");
const { validatePassword } = require("../server");
const { createMysqlConfig, createMysqlGuestConfig } = require("../mysql-config");
const { createSmtpConfig } = require("../email-config");

let server;
let origin;

before(async () => {
    server = app.listen(0);
    await new Promise((resolve) => server.once("listening", resolve));
    origin = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

test("serves the account and marketplace pages with their client scripts", async () => {
    for (const route of [
        "/",
        "/saved.html",
        "/auth.html",
        "/verify-email.html",
        "/api.js",
        "/marketplace.js",
        "/saved-page.js",
        "/auth.js",
        "/verify-email.js"
    ]) {
        const response = await fetch(`${origin}${route}`);
        assert.equal(response.status, 200, `${route} should be available`);
    }
});

test("offers guest browsing and browser-session-only saves", async () => {
    const authPage = await fetch(`${origin}/auth.html`);
    assert.match(await authPage.text(), /Continue as guest/);

    const apiScript = await fetch(`${origin}/api.js`);
    assert.match(await apiScript.text(), /found_guest_state/);
});

test("requires an account before returning the user's item queue", async () => {
    const response = await fetch(`${origin}/api/items/next`);
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: "Please sign in to continue." });
});

test("rejects malformed registration before accessing the database", async () => {
    const response = await fetch(`${origin}/api/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "not-an-email", password: "a-secure-password" })
    });
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: "Enter a valid email address." });
});

test("enforces the registration password policy before accessing the database", async () => {
    for (const password of ["short!", "lowercase!", "UPPERCASE!", "NoSpecial1"]) {
        const response = await fetch(`${origin}/api/auth/register`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: "person@example.com", password })
        });
        assert.equal(response.status, 400, `${password} should not satisfy the password policy`);
    }

    assert.equal(validatePassword("Abcdef!"), null);
    assert.match(validatePassword("NoSpecial1"), /special character/);
});

test("rejects invalid email verification tokens without creating an account", async () => {
    const response = await fetch(`${origin}/api/auth/verify-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: "not-a-token" })
    });
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: "This verification link is invalid." });
});

test("builds a MySQL connection config", () => {
    const config = createMysqlConfig({
        MYSQL_USER: "account",
        MYSQL_PASSWORD: "local-secret",
        MYSQL_HOST: "db.example.com",
        MYSQL_PORT: "3306",
        MYSQL_DATABASE: "found"
    });

    assert.equal(config.user, "account");
    assert.equal(config.password, "local-secret");
    assert.equal(config.host, "db.example.com");
    assert.equal(config.port, 3306);
    assert.equal(config.database, "found");
    assert.equal(config.namedPlaceholders, true);
    assert.equal(config.ssl, undefined);
    assert.deepEqual(createMysqlConfig({
        MYSQL_USER: "account",
        MYSQL_PASSWORD: "local-secret",
        MYSQL_HOST: "db.example.com",
        MYSQL_PORT: "3306",
        MYSQL_DATABASE: "found",
        MYSQL_SSL: "true"
    }).ssl, { rejectUnauthorized: true });
});

test("rejects invalid MySQL port configuration", () => {
    const configuration = {
        MYSQL_USER: "account",
        MYSQL_PASSWORD: "local-secret",
        MYSQL_HOST: "db.example.com",
        MYSQL_PORT: "3306",
        MYSQL_DATABASE: "found"
    };

    assert.throws(() => createMysqlConfig({ ...configuration, MYSQL_PORT: "0" }), /MYSQL_PORT/);
    assert.throws(() => createMysqlConfig({ ...configuration, MYSQL_SSL: "enabled" }), /MYSQL_SSL/);
});

test("uses a separate MySQL guest account for read-only browsing", () => {
    const config = createMysqlGuestConfig({
        MYSQL_HOST: "db.example.com",
        MYSQL_PORT: "3306",
        MYSQL_DATABASE: "found",
        MYSQL_USER: "app-account",
        MYSQL_PASSWORD: "app-secret",
        MYSQL_GUEST_USER: "guest-account",
        MYSQL_GUEST_PASSWORD: "guest-secret"
    });

    assert.equal(config.user, "guest-account");
    assert.equal(config.password, "guest-secret");
    assert.equal(config.host, "db.example.com");
    assert.equal(config.database, "found");
    assert.throws(
        () => createMysqlGuestConfig({ MYSQL_HOST: "db.example.com", MYSQL_PORT: "3306", MYSQL_DATABASE: "found" }),
        /MYSQL_GUEST_USER, MYSQL_GUEST_PASSWORD/
    );
});

test("validates SMTP configuration and its public verification URL", () => {
    const config = createSmtpConfig({
        SMTP_HOST: "smtp.example.com",
        SMTP_PORT: "587",
        SMTP_SECURE: "false",
        SMTP_USER: "sender",
        SMTP_PASSWORD: "secret",
        SMTP_FROM: "Found <no-reply@example.com>",
        PUBLIC_APP_URL: "https://found.example.com/path"
    });
    assert.equal(config.port, 587);
    assert.equal(config.secure, false);
    assert.equal(config.publicAppUrl, "https://found.example.com");
    assert.equal(config.auth.user, "sender");
    assert.throws(() => createSmtpConfig({ SMTP_HOST: "smtp.example.com", SMTP_PORT: "bad", SMTP_FROM: "a" }), /SMTP_PORT/);
});
