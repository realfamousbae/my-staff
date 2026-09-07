import pg from "pg";

const email = process.argv[2]?.trim().toLowerCase();
if (!email || !process.env.DATABASE_URL) {
  console.error(
    "Usage: DATABASE_URL=... node scripts/catalog-editor.mjs person@example.com",
  );
  process.exit(2);
}
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const result = await pool.query(
  "UPDATE users SET role='editor' WHERE email=$1 RETURNING id,email,role",
  [email],
);
await pool.end();
if (!result.rowCount) {
  console.error("No account with that email");
  process.exit(1);
}
console.log(`Granted editor role to ${result.rows[0].email}`);
