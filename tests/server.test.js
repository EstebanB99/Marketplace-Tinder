const assert = require("node:assert/strict");
const { after, before, test } = require("node:test");
const app = require("../server");
const { sendPasswordResetEmail, sendVerificationEmail, validatePassword } = require("../server");
const { createMysqlConfig, createMysqlGuestConfig } = require("../mysql-config");
const { createResendConfig } = require("../email-config");

let server;
let origin;

async function withResendEnvironment(fetchImplementation, callback) {
    const previousEnvironment = {
        RESEND_API_KEY: process.env.RESEND_API_KEY,
        RESEND_FROM: process.env.RESEND_FROM,
        PUBLIC_APP_URL: process.env.PUBLIC_APP_URL
    };
    const originalFetch = global.fetch;
    process.env.RESEND_API_KEY = "re_test-key";
    process.env.RESEND_FROM = "Found <verify@auth.example.com>";
    process.env.PUBLIC_APP_URL = "https://found.example.com";
    global.fetch = fetchImplementation;
    try {
        return await callback();
    } finally {
        global.fetch = originalFetch;
        for (const [key, value] of Object.entries(previousEnvironment)) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        }
    }
}

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
        "/reset-password.html",
        "/api.js",
        "/marketplace.js",
        "/saved-page.js",
        "/auth.js",
        "/verify-email.js",
        "/reset-password.js"
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

test("rejects malformed password reset requests before accessing the database", async () => {
    const requestReset = await fetch(`${origin}/api/auth/forgot-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "not-an-email" })
    });
    assert.equal(requestReset.status, 400);
    assert.deepEqual(await requestReset.json(), { error: "Enter a valid email address." });

    const invalidToken = await fetch(`${origin}/api/auth/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: "not-a-token", password: "Abcdef!" })
    });
    assert.equal(invalidToken.status, 400);
    assert.deepEqual(await invalidToken.json(), { error: "This password reset link is invalid or has expired." });

    const invalidPassword = await fetch(`${origin}/api/auth/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: "a".repeat(64), password: "NoSpecial1" })
    });
    assert.equal(invalidPassword.status, 400);
    assert.deepEqual(await invalidPassword.json(), {
        error: "Include an uppercase letter, a lowercase letter, and a special character."
    });
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

test("validates Resend configuration and its public verification URL", () => {
    const config = createResendConfig({
        RESEND_API_KEY: "re_test-key",
        RESEND_FROM: "Found <verify@auth.example.com>",
        PUBLIC_APP_URL: "https://found.example.com/path"
    });
    assert.equal(config.apiKey, "re_test-key");
    assert.equal(config.from, "Found <verify@auth.example.com>");
    assert.equal(config.publicAppUrl, "https://found.example.com");
    assert.throws(() => createResendConfig({ RESEND_FROM: "Found <verify@example.com>" }), /RESEND_API_KEY/);
    assert.throws(
        () => createResendConfig({
            RESEND_API_KEY: "re_test-key",
            RESEND_FROM: "Found <verify@example.com>",
            PUBLIC_APP_URL: "javascript:alert(1)"
        }),
        /absolute HTTP or HTTPS URL/
    );
});

test("sends verification email through the Resend HTTPS API", async () => {
    let request;
    await withResendEnvironment(async (url, options) => {
        request = { url, options };
        return { ok: true, status: 200 };
    }, async () => {
        await sendVerificationEmail("person@example.com", "a".repeat(64));
    });

    assert.equal(request.url, "https://api.resend.com/emails");
    assert.equal(request.options.method, "POST");
    assert.equal(request.options.headers.Authorization, "Bearer re_test-key");
    const payload = JSON.parse(request.options.body);
    assert.equal(payload.from, "Found <verify@auth.example.com>");
    assert.deepEqual(payload.to, ["person@example.com"]);
    assert.match(payload.text, /https:\/\/found\.example\.com\/verify-email\.html\?token=/);
    assert.match(payload.html, /Verify my email/);
    assert.ok(request.options.signal instanceof AbortSignal);
});

test("sends password reset email through the Resend HTTPS API", async () => {
    let request;
    await withResendEnvironment(async (url, options) => {
        request = { url, options };
        return { ok: true, status: 200 };
    }, async () => {
        await sendPasswordResetEmail("person@example.com", "b".repeat(64));
    });

    assert.equal(request.url, "https://api.resend.com/emails");
    const payload = JSON.parse(request.options.body);
    assert.equal(payload.subject, "Reset your Found password");
    assert.deepEqual(payload.to, ["person@example.com"]);
    assert.match(payload.text, /https:\/\/found\.example\.com\/reset-password\.html\?token=b{64}/);
    assert.match(payload.html, /Choose a new password/);
});

test("reports Resend API rejection as an email service error", async () => {
    await withResendEnvironment(async () => ({
        ok: false,
        status: 403,
        text: async () => JSON.stringify({ message: "Domain is not verified." })
    }), async () => {
        await assert.rejects(sendVerificationEmail("person@example.com", "a".repeat(64)), {
            message: "Domain is not verified.",
            status: 503
        });
    });
});
