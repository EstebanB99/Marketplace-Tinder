function createResendConfig(environment) {
    const requiredSettings = ["RESEND_API_KEY", "RESEND_FROM"];
    const missingSettings = requiredSettings.filter((setting) => !environment[setting]);
    if (missingSettings.length) {
        const error = new Error(`Missing email configuration: ${missingSettings.join(", ")}.`);
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
        apiKey: environment.RESEND_API_KEY,
        from: environment.RESEND_FROM,
        publicAppUrl: parsedUrl.origin
    };
}

module.exports = { createResendConfig };
