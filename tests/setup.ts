process.env.DATABASE_URL ??= "postgres://kassatrack:kassatrack@localhost:5432/kassatrack_test";
process.env.BETTER_AUTH_SECRET ??= "t".repeat(32);
process.env.BETTER_AUTH_URL ??= "http://localhost:3000";
process.env.GOOGLE_CLIENT_ID ??= "test-id";
process.env.GOOGLE_CLIENT_SECRET ??= "test-secret";
