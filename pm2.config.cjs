module.exports = {
    apps: [
        {
            name: "web-api",
            // migrate deploy then API (see package.json start:api)
            script: "bun",
            args: "run start:api",
            exec_mode: "fork",   // ⚠️ no cluster
            instances: 1,
            max_memory_restart: "1G",
            time: true,
            env_file: ".env",
            env: {
                NODE_ENV: "production",
            },
        },
        {
            name: "engine-api",
            // API process runs migrate; engine just starts
            script: "bun",
            args: "run start:engine",
            exec_mode: "fork",
            instances: 1,
            max_memory_restart: "1G",
            time: true,
            env_file: ".env",
            env: {
                NODE_ENV: "production",
            },
        },
    ],
};