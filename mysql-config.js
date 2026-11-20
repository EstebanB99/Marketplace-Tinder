function createMysqlConfig(environment) {
    const requiredSettings = [
        "MYSQL_HOST",
        "MYSQL_PORT",
        "MYSQL_DATABASE",
        "MYSQL_USER",
        "MYSQL_PASSWORD"
    ];
    const missingSettings = requiredSettings.filter((setting) => !environment[setting]);
    if (missingSettings.length) {
        throw new Error(`Missing MySQL configuration: ${missingSettings.join(", ")}. Copy .env.example to .env and configure it.`);
    }

    const port = Number(environment.MYSQL_PORT);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error("MYSQL_PORT must be a valid TCP port.");
    }
    const sslSetting = (environment.MYSQL_SSL || "false").toLowerCase();
    if (!["true", "false"].includes(sslSetting)) {
        throw new Error("MYSQL_SSL must be true or false.");
    }

    const config = {
        host: environment.MYSQL_HOST,
        port,
        database: environment.MYSQL_DATABASE,
        user: environment.MYSQL_USER,
        password: environment.MYSQL_PASSWORD,
        namedPlaceholders: true,
        supportBigNumbers: true,
        bigNumberStrings: false
    };
    if (sslSetting === "true") {
        config.ssl = { rejectUnauthorized: true };
    }
    return config;
}

function createMysqlGuestConfig(environment) {
    if (!environment.MYSQL_GUEST_USER || !environment.MYSQL_GUEST_PASSWORD) {
        throw new Error("Missing MySQL guest configuration: MYSQL_GUEST_USER, MYSQL_GUEST_PASSWORD.");
    }
    return createMysqlConfig({
        ...environment,
        MYSQL_USER: environment.MYSQL_GUEST_USER,
        MYSQL_PASSWORD: environment.MYSQL_GUEST_PASSWORD
    });
}

module.exports = { createMysqlConfig, createMysqlGuestConfig };
