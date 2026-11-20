require("dotenv").config();

const crypto = require("node:crypto");
const path = require("node:path");
const express = require("express");
const mysql = require("mysql2/promise");
const nodemailer = require("nodemailer");
const { createMysqlConfig, createMysqlGuestConfig } = require("./mysql-config");
const { createSmtpConfig } = require("./email-config");

const app = express();
const port = Number(process.env.PORT || process.env.APP_PORT || 3000);
const sessionCookieName = "found_session";
const sessionDurationMs = 7 * 24 * 60 * 60 * 1000;
const cookieSecure = process.env.SESSION_COOKIE_SECURE === "true";
let databasePool;
let guestDatabasePool;
const scrypt = (password, salt) => new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 64, (error, derivedKey) => {
        if (error) reject(error);
        else resolve(derivedKey);
    });
});

app.disable("x-powered-by");
app.use(express.json({ limit: "16kb" }));

function asyncRoute(handler) {
    return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

async function withTransaction(callback) {
    const nativeConnection = await databasePool.getConnection();
    const connection = {
        async execute(sql, parameters) {
            const [result] = await nativeConnection.execute(sql, parameters);
            return Array.isArray(result)
                ? { rows: result }
                : { rows: [], rowsAffected: result.affectedRows, insertId: result.insertId };
        },
        commit: () => nativeConnection.commit(),
        rollback: () => nativeConnection.rollback(),
        close: () => nativeConnection.release()
    };
    try {
        const result = await callback(connection);
        await connection.commit();
        return result;
    } catch (error) {
        try {
            await connection.rollback();
        } catch (rollbackError) {
            console.error("MySQL transaction rollback failed.", rollbackError);
        }
        throw error;
    } finally {
        await connection.close();
    }
}

function getCookie(req, name) {
    const cookieHeader = req.headers.cookie || "";
    const cookie = cookieHeader.split(";").map((part) => part.trim())
        .find((part) => part.startsWith(`${name}=`));
    if (!cookie) return null;
    try {
        return decodeURIComponent(cookie.slice(name.length + 1));
    } catch {
        return null;
    }
}

function setSessionCookie(res, token) {
    res.cookie(sessionCookieName, token, {
        httpOnly: true,
        secure: cookieSecure,
        sameSite: "lax",
        path: "/",
        maxAge: sessionDurationMs
    });
}

function clearSessionCookie(res) {
    res.clearCookie(sessionCookieName, {
        httpOnly: true,
        secure: cookieSecure,
        sameSite: "lax",
        path: "/"
    });
}

function sessionHash(token) {
    return crypto.createHash("sha256").update(token).digest("hex");
}

async function createSession(connection, userId) {
    const token = crypto.randomBytes(32).toString("hex");
    await connection.execute(
        `INSERT INTO USER_SESSIONS (TOKEN_HASH, USER_ID, EXPIRES_AT)
         VALUES (:tokenHash, :userId, DATE_ADD(CURRENT_TIMESTAMP(6), INTERVAL 7 DAY))`,
        { tokenHash: sessionHash(token), userId }
    );
    return token;
}

async function requireUser(req, res, next) {
    const token = getCookie(req, sessionCookieName);
    if (!token || !/^[a-f0-9]{64}$/i.test(token)) {
        return res.status(401).json({ error: "Please sign in to continue." });
    }

    try {
        const user = await withTransaction(async (connection) => {
            const result = await connection.execute(
                `SELECT u.USER_ID AS userId, u.EMAIL AS email
                 FROM USER_SESSIONS s
                 JOIN APP_USERS u ON u.USER_ID = s.USER_ID
                 WHERE s.TOKEN_HASH = :tokenHash
                   AND s.EXPIRES_AT > CURRENT_TIMESTAMP(6)`,
                { tokenHash: sessionHash(token) },
            );
            return result.rows[0] || null;
        });

        if (!user) {
            clearSessionCookie(res);
            return res.status(401).json({ error: "Your session has expired. Please sign in again." });
        }
        req.user = user;
        return next();
    } catch (error) {
        return next(error);
    }
}

function normalizeEmail(value) {
    return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function isValidEmail(email) {
    return email.length <= 320 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function validatePassword(password) {
    if (typeof password !== "string" || password.length < 6 || password.length > 128) {
        return "Use a password between 6 and 128 characters.";
    }
    if (!/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[^A-Za-z0-9\s]/.test(password)) {
        return "Include an uppercase letter, a lowercase letter, and a special character.";
    }
    return null;
}

async function sendVerificationEmail(email, token) {
    const config = createSmtpConfig(process.env);
    const transporter = nodemailer.createTransport({
        host: config.host,
        port: config.port,
        secure: config.secure,
        ...(config.auth ? { auth: config.auth } : {}),
        connectionTimeout: 10000,
        greetingTimeout: 10000,
        socketTimeout: 15000
    });
    const verificationUrl = `${config.publicAppUrl}/verify-email.html?token=${encodeURIComponent(token)}`;

    await transporter.sendMail({
        from: config.from,
        to: email,
        subject: "Verify your Found account",
        text: `Welcome to Found!\n\nVerify your email address to create your account:\n${verificationUrl}\n\nThis link expires in 30 minutes. If you did not request this account, you can ignore this email.`,
        html: `<p>Welcome to Found!</p><p>Verify your email address to create your account:</p><p><a href="${verificationUrl}">Verify my email</a></p><p>This link expires in 30 minutes. If you did not request this account, you can ignore this email.</p>`
    });
}

function mapItem(row) {
    return {
        itemID: row.itemID,
        name: row.name,
        description: row.description,
        address: row.address,
        city: row.city,
        state: row.state,
        zipcode: row.zipcode,
        image: row.image,
        imageAlt: `${row.name} listing`
    };
}

async function getItemStats(connection, userId) {
    const result = await connection.execute(
        `SELECT
             (SELECT COUNT(*) FROM ITEMS) AS total,
             (SELECT COUNT(*) FROM USER_ITEMS
              WHERE USER_ID = :userId AND STATUS IN ('AVAILABLE', 'SHOWN')) AS remaining,
             (SELECT COUNT(*) FROM USER_ITEMS
              WHERE USER_ID = :userId AND STATUS = 'KEPT') AS kept,
             (SELECT COUNT(*) FROM USER_ITEM_HISTORY
              WHERE USER_ID = :userId AND STATUS = 'PASSED') AS passed`,
        { userId },
    );
    return result.rows[0];
}

async function ensureUserHasCatalogItems(connection, userId) {
    await connection.execute(
        `INSERT INTO USER_ITEM_HISTORY
            (USER_ID, ITEM_ID, STATUS, SHOWN_COUNT, CREATED_AT, UPDATED_AT)
         SELECT :userId, i.ITEM_ID, 'AVAILABLE', 0, CURRENT_TIMESTAMP(6), CURRENT_TIMESTAMP(6)
         FROM ITEMS i
         WHERE NOT EXISTS (
             SELECT 1 FROM USER_ITEM_HISTORY h
             WHERE h.USER_ID = :userId AND h.ITEM_ID = i.ITEM_ID
         )`,
        { userId }
    );
    await connection.execute(
        `INSERT INTO USER_ITEMS
            (USER_ID, ITEM_ID, NAME, DESCRIPTION, ADDRESS, CITY, STATE, ZIPCODE,
             IMAGE_URL, STATUS, CREATED_AT)
         SELECT :userId, i.ITEM_ID, i.NAME, i.DESCRIPTION, i.ADDRESS, i.CITY,
                i.STATE, i.ZIPCODE, i.IMAGE_URL, 'AVAILABLE', CURRENT_TIMESTAMP(6)
         FROM ITEMS i
         JOIN USER_ITEM_HISTORY h
           ON h.USER_ID = :userId AND h.ITEM_ID = i.ITEM_ID
         WHERE h.STATUS <> 'PASSED'
           AND NOT EXISTS (
               SELECT 1 FROM USER_ITEMS c
               WHERE c.USER_ID = :userId AND c.ITEM_ID = i.ITEM_ID
           )`,
        { userId }
    );
}

app.get("/", (req, res) => res.sendFile(path.join(__dirname, "index.html")));
app.get("/index.html", (req, res) => res.sendFile(path.join(__dirname, "index.html")));
app.get("/saved.html", (req, res) => res.sendFile(path.join(__dirname, "saved.html")));
app.get("/auth.html", (req, res) => res.sendFile(path.join(__dirname, "auth.html")));
app.get("/verify-email.html", (req, res) => res.sendFile(path.join(__dirname, "verify-email.html")));
app.get("/api.js", (req, res) => res.sendFile(path.join(__dirname, "api.js")));
app.get("/marketplace.js", (req, res) => res.sendFile(path.join(__dirname, "marketplace.js")));
app.get("/saved-page.js", (req, res) => res.sendFile(path.join(__dirname, "saved-page.js")));
app.get("/auth.js", (req, res) => res.sendFile(path.join(__dirname, "auth.js")));
app.get("/verify-email.js", (req, res) => res.sendFile(path.join(__dirname, "verify-email.js")));

app.get("/api/guest/items", asyncRoute(async (req, res) => {
    const [rows] = await guestDatabasePool.execute(
        `SELECT ITEM_ID AS itemID, NAME AS name, DESCRIPTION AS description,
                ADDRESS AS address, CITY AS city, STATE AS state, ZIPCODE AS zipcode,
                IMAGE_URL AS image
         FROM ITEMS
         ORDER BY ITEM_ID`
    );
    res.json({ items: rows.map(mapItem) });
}));

app.post("/api/auth/register", asyncRoute(async (req, res) => {
    const body = req.body || {};
    const email = normalizeEmail(body.email);
    const password = body.password;
    if (!isValidEmail(email)) return res.status(400).json({ error: "Enter a valid email address." });
    const passwordError = validatePassword(password);
    if (passwordError) return res.status(400).json({ error: passwordError });

    const salt = crypto.randomBytes(16);
    const passwordHash = `$scrypt$${salt.toString("base64url")}$${(await scrypt(password, salt)).toString("base64url")}`;
    const smtpConfig = createSmtpConfig(process.env);
    const token = crypto.randomBytes(32).toString("hex");
    const tokenHash = sessionHash(token);

    await withTransaction(async (connection) => {
        await connection.execute(
            "DELETE FROM PENDING_REGISTRATIONS WHERE EXPIRES_AT <= CURRENT_TIMESTAMP(6)"
        );
        const existing = await connection.execute(
            `SELECT EMAIL FROM APP_USERS WHERE EMAIL = :email
             UNION ALL
             SELECT EMAIL FROM PENDING_REGISTRATIONS
             WHERE EMAIL = :email AND EXPIRES_AT > CURRENT_TIMESTAMP(6)`,
            { email },
        );
        if (existing.rows.length) {
            const error = new Error("An account or verification request with that email already exists. Try signing in or wait for the pending link to expire.");
            error.status = 409;
            throw error;
        }
        await connection.execute(
            `INSERT INTO PENDING_REGISTRATIONS (EMAIL, PASSWORD_HASH, TOKEN_HASH, EXPIRES_AT)
             VALUES (:email, :passwordHash, :tokenHash, DATE_ADD(CURRENT_TIMESTAMP(6), INTERVAL 30 MINUTE))`,
            { email, passwordHash, tokenHash }
        );
    });

    try {
        await sendVerificationEmail(email, token);
    } catch (error) {
        await withTransaction((connection) => connection.execute(
            `DELETE FROM PENDING_REGISTRATIONS
             WHERE EMAIL = :email AND TOKEN_HASH = :tokenHash`,
            { email, tokenHash }
        ));
        if (!error.status) error.status = 503;
        throw error;
    }

    res.status(202).json({ message: "Check your email for a verification link. Your account will be created after you verify your email." });
}));

app.post("/api/auth/login", asyncRoute(async (req, res) => {
    const body = req.body || {};
    const email = normalizeEmail(body.email);
    const password = body.password;
    if (!isValidEmail(email) || typeof password !== "string" || password.length > 128) {
        return res.status(400).json({ error: "Enter a valid email and password." });
    }

    const result = await withTransaction(async (connection) => {
        const userResult = await connection.execute(
            `SELECT USER_ID AS userId, EMAIL AS email, PASSWORD_HASH AS passwordHash
             FROM APP_USERS WHERE EMAIL = :email`,
            { email },
        );
        const user = userResult.rows[0];
        let validPassword = false;
        if (user) {
            const parts = user.passwordHash.split("$");
            if (parts.length === 4 && parts[1] === "scrypt") {
                const salt = Buffer.from(parts[2], "base64url");
                const expected = Buffer.from(parts[3], "base64url");
                const actual = await scrypt(password, salt);
                validPassword = expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
            }
        }

        if (!validPassword) return null;
        await connection.execute(
            "DELETE FROM USER_SESSIONS WHERE EXPIRES_AT <= CURRENT_TIMESTAMP(6)"
        );
        const token = await createSession(connection, user.userId);
        return { user: { userId: user.userId, email: user.email }, token };
    });

    if (!result) return res.status(401).json({ error: "Email or password is incorrect." });
    setSessionCookie(res, result.token);
    res.json({ user: result.user });
}));

app.post("/api/auth/verify-email", asyncRoute(async (req, res) => {
    const token = req.body?.token;
    if (typeof token !== "string" || !/^[a-f0-9]{64}$/i.test(token)) {
        return res.status(400).json({ error: "This verification link is invalid." });
    }

    const result = await withTransaction(async (connection) => {
        const pendingResult = await connection.execute(
            `SELECT EMAIL AS email, PASSWORD_HASH AS passwordHash
             FROM PENDING_REGISTRATIONS
             WHERE TOKEN_HASH = :tokenHash AND EXPIRES_AT > CURRENT_TIMESTAMP(6)
             FOR UPDATE`,
            { tokenHash: sessionHash(token) },
        );
        const pending = pendingResult.rows[0];
        if (!pending) return null;

        const userResult = await connection.execute(
            `INSERT INTO APP_USERS (EMAIL, PASSWORD_HASH)
             VALUES (:email, :passwordHash)`,
            {
                email: pending.email,
                passwordHash: pending.passwordHash
            }
        );
        const userId = userResult.insertId;
        await connection.execute(
            `INSERT INTO USER_ITEMS
                (USER_ID, ITEM_ID, NAME, DESCRIPTION, ADDRESS, CITY, STATE, ZIPCODE,
                 IMAGE_URL, STATUS, CREATED_AT)
             SELECT :userId, ITEM_ID, NAME, DESCRIPTION, ADDRESS, CITY, STATE, ZIPCODE,
                    IMAGE_URL, 'AVAILABLE', CURRENT_TIMESTAMP(6)
             FROM ITEMS`,
            { userId }
        );
        await connection.execute(
            `INSERT INTO USER_ITEM_HISTORY
                (USER_ID, ITEM_ID, STATUS, SHOWN_COUNT, CREATED_AT, UPDATED_AT)
             SELECT :userId, ITEM_ID, 'AVAILABLE', 0, CURRENT_TIMESTAMP(6), CURRENT_TIMESTAMP(6)
             FROM ITEMS`,
            { userId }
        );
        await connection.execute(
            "DELETE FROM PENDING_REGISTRATIONS WHERE EMAIL = :email",
            { email: pending.email }
        );
        const sessionToken = await createSession(connection, userId);
        return { user: { userId, email: pending.email }, token: sessionToken };
    });

    if (!result) {
        return res.status(400).json({ error: "This verification link is invalid or has expired. Please register again." });
    }
    setSessionCookie(res, result.token);
    res.json({ user: result.user });
}));

app.post("/api/auth/logout", asyncRoute(async (req, res) => {
    const token = getCookie(req, sessionCookieName);
    if (token && /^[a-f0-9]{64}$/i.test(token)) {
        await withTransaction((connection) => connection.execute(
            "DELETE FROM USER_SESSIONS WHERE TOKEN_HASH = :tokenHash",
            { tokenHash: sessionHash(token) }
        ));
    }
    clearSessionCookie(res);
    res.status(204).end();
}));

app.get("/api/me", requireUser, (req, res) => res.json({ user: req.user }));

app.get("/api/items/next", requireUser, asyncRoute(async (req, res) => {
    const result = await withTransaction(async (connection) => {
        await connection.execute(
            "SELECT USER_ID FROM APP_USERS WHERE USER_ID = :userId FOR UPDATE",
            { userId: req.user.userId }
        );
        await ensureUserHasCatalogItems(connection, req.user.userId);

        let itemResult = await connection.execute(
            `SELECT ITEM_ID AS itemID, NAME AS name, DESCRIPTION AS description,
                    ADDRESS AS address, CITY AS city, STATE AS state, ZIPCODE AS zipcode,
                    IMAGE_URL AS image
             FROM USER_ITEMS
             WHERE USER_ID = :userId AND STATUS = 'SHOWN'
             ORDER BY ITEM_ID
             LIMIT 1`,
            { userId: req.user.userId },
        );

        if (!itemResult.rows[0]) {
            itemResult = await connection.execute(
                `SELECT ITEM_ID AS itemID, NAME AS name, DESCRIPTION AS description,
                        ADDRESS AS address, CITY AS city, STATE AS state, ZIPCODE AS zipcode,
                        IMAGE_URL AS image
                 FROM USER_ITEMS
                 WHERE USER_ID = :userId AND STATUS = 'AVAILABLE'
                 ORDER BY ITEM_ID
                 LIMIT 1`,
                { userId: req.user.userId },
            );
            if (itemResult.rows[0]) {
                const itemId = itemResult.rows[0].itemID;
                await connection.execute(
                    `UPDATE USER_ITEMS
                     SET STATUS = 'SHOWN', SHOWN_AT = CURRENT_TIMESTAMP(6)
                     WHERE USER_ID = :userId AND ITEM_ID = :itemId
                       AND STATUS = 'AVAILABLE'`,
                    { userId: req.user.userId, itemId }
                );
                await connection.execute(
                    `UPDATE USER_ITEM_HISTORY
                     SET STATUS = 'SHOWN', SHOWN_COUNT = SHOWN_COUNT + 1,
                         LAST_SHOWN_AT = CURRENT_TIMESTAMP(6), UPDATED_AT = CURRENT_TIMESTAMP(6)
                     WHERE USER_ID = :userId AND ITEM_ID = :itemId`,
                    { userId: req.user.userId, itemId }
                );
            }
        }

        return {
            item: itemResult.rows[0] ? mapItem(itemResult.rows[0]) : null,
            stats: await getItemStats(connection, req.user.userId)
        };
    });
    res.json(result);
}));

app.post("/api/items/:itemId/decision", requireUser, asyncRoute(async (req, res) => {
    const itemId = Number(req.params.itemId);
    const decision = req.body?.decision;
    if (!Number.isSafeInteger(itemId) || itemId < 1 || !["keep", "pass"].includes(decision)) {
        return res.status(400).json({ error: "Choose whether to keep or pass on this item." });
    }

    const result = await withTransaction(async (connection) => {
        await connection.execute(
            "SELECT USER_ID FROM APP_USERS WHERE USER_ID = :userId FOR UPDATE",
            { userId: req.user.userId }
        );
        const currentItem = await connection.execute(
            `SELECT NAME AS name FROM USER_ITEMS
             WHERE USER_ID = :userId AND ITEM_ID = :itemId AND STATUS = 'SHOWN'`,
            { userId: req.user.userId, itemId },
        );
        if (!currentItem.rows[0]) return null;

        if (decision === "keep") {
            await connection.execute(
                `UPDATE USER_ITEMS SET STATUS = 'KEPT'
                 WHERE USER_ID = :userId AND ITEM_ID = :itemId AND STATUS = 'SHOWN'`,
                { userId: req.user.userId, itemId }
            );
            await connection.execute(
                `UPDATE USER_ITEM_HISTORY
                 SET STATUS = 'KEPT', UPDATED_AT = CURRENT_TIMESTAMP(6)
                 WHERE USER_ID = :userId AND ITEM_ID = :itemId`,
                { userId: req.user.userId, itemId }
            );
        } else {
            await connection.execute(
                `DELETE FROM USER_ITEMS
                 WHERE USER_ID = :userId AND ITEM_ID = :itemId AND STATUS = 'SHOWN'`,
                { userId: req.user.userId, itemId }
            );
            await connection.execute(
                `UPDATE USER_ITEM_HISTORY
                 SET STATUS = 'PASSED', UPDATED_AT = CURRENT_TIMESTAMP(6)
                 WHERE USER_ID = :userId AND ITEM_ID = :itemId`,
                { userId: req.user.userId, itemId }
            );
        }

        return { name: currentItem.rows[0].name, stats: await getItemStats(connection, req.user.userId) };
    });

    if (!result) return res.status(409).json({ error: "This item is no longer waiting for a choice." });
    res.json(result);
}));

app.post("/api/items/restore-passed", requireUser, asyncRoute(async (req, res) => {
    const restored = await withTransaction(async (connection) => {
        await connection.execute(
            "SELECT USER_ID FROM APP_USERS WHERE USER_ID = :userId FOR UPDATE",
            { userId: req.user.userId }
        );
        const countResult = await connection.execute(
            `SELECT COUNT(*) AS count FROM USER_ITEM_HISTORY
             WHERE USER_ID = :userId AND STATUS = 'PASSED'`,
            { userId: req.user.userId },
        );
        const count = countResult.rows[0].count;
        if (count === 0) return 0;

        await connection.execute(
            `INSERT INTO USER_ITEMS
                (USER_ID, ITEM_ID, NAME, DESCRIPTION, ADDRESS, CITY, STATE, ZIPCODE,
                 IMAGE_URL, STATUS, CREATED_AT)
             SELECT :userId, i.ITEM_ID, i.NAME, i.DESCRIPTION, i.ADDRESS, i.CITY,
                    i.STATE, i.ZIPCODE, i.IMAGE_URL, 'AVAILABLE', CURRENT_TIMESTAMP(6)
             FROM ITEMS i
             JOIN USER_ITEM_HISTORY h
               ON h.USER_ID = :userId AND h.ITEM_ID = i.ITEM_ID
             WHERE h.STATUS = 'PASSED'
               AND NOT EXISTS (
                   SELECT 1 FROM USER_ITEMS c
                   WHERE c.USER_ID = :userId AND c.ITEM_ID = i.ITEM_ID
               )`,
            { userId: req.user.userId }
        );
        await connection.execute(
            `UPDATE USER_ITEM_HISTORY
             SET STATUS = 'AVAILABLE', UPDATED_AT = CURRENT_TIMESTAMP(6)
             WHERE USER_ID = :userId AND STATUS = 'PASSED'`,
            { userId: req.user.userId }
        );
        return count;
    });
    res.json({ restored });
}));

app.get("/api/items/saved", requireUser, asyncRoute(async (req, res) => {
    const result = await withTransaction((connection) => connection.execute(
        `SELECT ITEM_ID AS itemID, NAME AS name, DESCRIPTION AS description,
                ADDRESS AS address, CITY AS city, STATE AS state, ZIPCODE AS zipcode,
                IMAGE_URL AS image
         FROM USER_ITEMS
         WHERE USER_ID = :userId AND STATUS = 'KEPT'
         ORDER BY ITEM_ID`,
        { userId: req.user.userId },
    ));
    res.json({ items: result.rows.map(mapItem) });
}));

app.delete("/api/items/:itemId/saved", requireUser, asyncRoute(async (req, res) => {
    const itemId = Number(req.params.itemId);
    if (!Number.isSafeInteger(itemId) || itemId < 1) {
        return res.status(400).json({ error: "Invalid item ID." });
    }

    const changed = await withTransaction(async (connection) => {
        await connection.execute(
            "SELECT USER_ID FROM APP_USERS WHERE USER_ID = :userId FOR UPDATE",
            { userId: req.user.userId }
        );
        const result = await connection.execute(
            `UPDATE USER_ITEMS SET STATUS = 'AVAILABLE'
             WHERE USER_ID = :userId AND ITEM_ID = :itemId AND STATUS = 'KEPT'`,
            { userId: req.user.userId, itemId }
        );
        if (result.rowsAffected === 1) {
            await connection.execute(
                `UPDATE USER_ITEM_HISTORY
                 SET STATUS = 'AVAILABLE', UPDATED_AT = CURRENT_TIMESTAMP(6)
                 WHERE USER_ID = :userId AND ITEM_ID = :itemId`,
                { userId: req.user.userId, itemId }
            );
        }
        return result.rowsAffected === 1;
    });

    if (!changed) return res.status(404).json({ error: "That item is not in your saved list." });
    res.status(204).end();
}));

app.use((req, res) => res.status(404).json({ error: "Not found." }));

app.use((error, req, res, next) => {
    console.error("Request failed.", error);
    if (error.status === 409) return res.status(409).json({ error: error.message });
    if (error.status === 503) return res.status(503).json({ error: error.message });
    if (error.code === "ER_DUP_ENTRY") return res.status(409).json({ error: "An account with that email already exists." });
    if (error.code === "EAUTH" || error.code === "ECONNECTION" || error.code === "ETIMEDOUT") {
        return res.status(503).json({ error: "Could not send the verification email. Check the email server settings and try again." });
    }
    if (res.headersSent) return next(error);
    res.status(500).json({ error: "Something went wrong. Please try again." });
});

async function start() {
    const databaseConfig = createMysqlConfig(process.env);
    const guestDatabaseConfig = createMysqlGuestConfig(process.env);
    databasePool = mysql.createPool({
        ...databaseConfig,
        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0
    });
    guestDatabasePool = mysql.createPool({
        ...guestDatabaseConfig,
        waitForConnections: true,
        connectionLimit: 5,
        queueLimit: 0
    });
    try {
        const connection = await databasePool.getConnection();
        connection.release();
        const guestConnection = await guestDatabasePool.getConnection();
        try {
            await guestConnection.execute("SELECT ITEM_ID FROM ITEMS LIMIT 0");
        } finally {
            guestConnection.release();
        }
    } catch (error) {
        await Promise.all([databasePool.end(), guestDatabasePool.end()]);
        throw error;
    }
    app.listen(port, () => console.log(`Found is listening at http://localhost:${port}`));
}

if (require.main === module) {
    start().catch((error) => {
        console.error("Could not start Found.", error);
        process.exitCode = 1;
    });
}

module.exports = app;
module.exports.validatePassword = validatePassword;
