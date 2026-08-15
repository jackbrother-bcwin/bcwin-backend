/**
 * Bun test preload — runs before every test file.
 * Usage: bun test --env-file .env --preload ./tests/helpers/preload.ts
 */
process.env.PROCESS_ROLE = process.env.PROCESS_ROLE || "api";
process.env.NODE_ENV = process.env.NODE_ENV || "test";

// Ensure JWT exists (required by auth module)
if (!process.env.JWT_SECRET) {
    process.env.JWT_SECRET = "test-jwt-secret-for-deeptest-only";
}
