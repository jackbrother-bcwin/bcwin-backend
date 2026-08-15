import { defineConfig, env } from "prisma/config";

export default defineConfig({
    schema: "packages/db/schema.prisma",
    datasource: {
        url: env("DATABASE_URL"),
    },
});
