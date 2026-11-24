# Found

Found is a small marketplace app backed by MySQL. Each registered account gets its own copy of the shared `ITEMS` catalog. Guest browsing uses a separate MySQL account that can only read the catalog; guest decisions and saved items stay in the browser session and are cleared when the tab/window closes.

## Connect to MySQL

1. Create `.env` from `.env.example` if you do not already have one.
2. Set `APP_PORT=3000` for the local web server. Add `MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_DATABASE`, `MYSQL_USER`, and `MYSQL_PASSWORD` with the connection details from your MySQL server. This app account is kept on the server and manages registrations, account login records, user item copies, and sessions. `APP_USERS` stores password hashes, never plaintext passwords.
3. Configure `MYSQL_GUEST_USER` and `MYSQL_GUEST_PASSWORD` for a separate database account. Create that account with read-only access to `ITEMS` only. For example, replace the database name, user and password below with your values and run as a MySQL administrator:

   ```sql
   CREATE USER 'found_guest'@'%' IDENTIFIED BY 'use-a-unique-secret';
   GRANT SELECT ON found.ITEMS TO 'found_guest'@'%';
   ```

   Both pools use the same host, port, database and TLS setting. Set `MYSQL_SSL=true` when the server requires TLS with certificate verification; otherwise leave it `false`. Keep both passwords private and do not commit `.env`.
4. Create the database named by `MYSQL_DATABASE` if it does not already exist. Connect to it with a MySQL client and run [items.sql](./items.sql) once. This creates the shared catalog, account/copy/history/session tables, and inserts the sample listings.

## Run the app

1. Install Node.js 20 or newer.
2. Configure `RESEND_API_KEY`, `RESEND_FROM`, and `PUBLIC_APP_URL` in `.env`. Create a Resend API key with Sending access and verify the sender domain in Resend. Set `RESEND_FROM` to a sender on that verified domain (for example, `Found <verify@auth.foundtheapp.com>`), and set `PUBLIC_APP_URL` to the URL users should open from their verification email. Keep the API key private.
3. Run [verification.sql](./verification.sql) once in your MySQL database to create the pending-verification table.
4. Run [password-resets.sql](./password-resets.sql) once to create the password-reset token table. Grant the app database user the following additional access (replace the database, user, and host values as needed):

   ```sql
   GRANT SELECT, INSERT, DELETE ON found.PASSWORD_RESETS TO 'found_app'@'%';
   GRANT UPDATE ON found.APP_USERS TO 'found_app'@'%';
   GRANT DELETE ON found.USER_SESSIONS TO 'found_app'@'%';
   ```

   Reset links expire after 30 minutes and can be used once. Resetting a password invalidates all existing account sessions, so the user must sign in again.
5. Install dependencies and start the server:

   ```powershell
   npm install
   npm start
   ```

6. Open `http://localhost:3000`. Visitors can sign in, create an account, or continue as a guest. New users receive a verification link; their account and item copy are created only after they open that link. Signed-in users can request a password-reset link from the sign-in page. Guests browse using the SELECT-only database account; keeping or passing a guest item affects only the current browser session.

Use HTTPS and set `SESSION_COOKIE_SECURE=true` when deploying outside local development. Do not commit `.env` or use the example database password.

## Free hosting with Render

The included [render.yaml](./render.yaml) creates a free Render web service from this repository. Push the project to a Git provider, connect it in Render, and configure the environment variables marked as `sync: false` in the Render dashboard. Set `PUBLIC_APP_URL` to the deployed HTTPS URL. Render provides `PORT` automatically.

The Render service must be able to reach your MySQL server over the network. Grant the app and guest database users access from the hosting provider; the guest user should have `SELECT` permission on `ITEMS` only. Add `RESEND_API_KEY` and `RESEND_FROM` to Render's environment, and verify the sender domain with Resend. Email is sent over Resend's HTTPS API rather than SMTP. Render's free web service can spin down when idle and may take about a minute to wake; its free tier is intended for testing and hobby projects, not production.

## Item lifecycle

- `ITEMS` is the shared source catalog. New catalog items are copied into existing accounts when they next browse.
- `USER_ITEMS` stores each user's personal item copies. Each listing moves from `AVAILABLE` to `SHOWN`; keeping it moves it to `KEPT`.
- Passing deletes the user's row from `USER_ITEMS`. `USER_ITEM_HISTORY` keeps the per-account status and shown count, preventing passed items from returning by accident.
- **Show passed items again** copies all passed listings back into the user's queue and updates their history state. This is the only action that restores passed items.
- Saved finds are the user's `KEPT` copies. Removing one returns it to that user's review queue.
- Registration requires at least 6 characters, one uppercase letter, one lowercase letter, and one non-alphanumeric special character.
- Pending email verifications are stored as password hashes and one-time token hashes, expire after 30 minutes, and do not create an account or item copy until verified.
