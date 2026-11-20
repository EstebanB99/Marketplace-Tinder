function createSmtpConfig(environment) {
    const requiredSettings = ["SMTP_HOST", "SMTP_PORT", "SMTP_FROM"];
    const missingSettings = requiredSettings.filter((setting) => !environment[setting]);
    if (missingSettings.length) {
        const error = new Error(`Missing email configuration: ${missingSettings.join(", ")}.`);
        error.status = 503;
        throw error;
    }

    const port = Number(environment.SMTP_PORT);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        const error = new Error("SMTP_PORT must be a valid TCP port.");
        error.status = 503;
        throw error;
    }

    const hasUser = Boolean(environment.SMTP_USER);
    const hasPassword = Boolean(environment.SMTP_PASSWORD);
    if (hasUser !== hasPassword) {
        const error = new Error("Set both SMTP_USER and SMTP_PASSWORD, or leave both blank for an unauthenticated relay.");
        error.status = 503;
        throw error;
    }

    const publicAppUrl = environment.PUBLIC_APP_URL || "http://localhost:3000";
    let parsedUrl;
    try {
        parsedUrl = new URL(publicAppUrl);
    } catch {
        const error = new Error("PUBLIC_APP_URL must be an absolute HTTP or HTTPS URL.");
        error.status = 503;
        throw error;
    }
    if (!["http:", "https:"].includes(parsedUrl.protocol) || parsedUrl.username || parsedUrl.password) {
        const error = new Error("PUBLIC_APP_URL must be an absolute HTTP or HTTPS URL without embedded credentials.");
        error.status = 503;
        throw error;
    }

    return {
        host: environment.SMTP_HOST,
        port,
        secure: environment.SMTP_SECURE === "true",
        ...(hasUser ? { auth: { user: environment.SMTP_USER, pass: environment.SMTP_PASSWORD } } : {}),
        from: environment.SMTP_FROM,
        publicAppUrl: parsedUrl.origin
    };
}

module.exports = { createSmtpConfig };
