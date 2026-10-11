# Cordly

Cordly is a persisted text-chat app built with Next.js App Router, strict TypeScript, Tailwind CSS, Socket.IO, and MongoDB/Mongoose. It supports accounts, friends, communities, channels, and text messages, with OLED, dark, and light themes. It does not seed demo accounts, communities, or messages.

## Prerequisites

- Node.js 20.9 or newer and npm
- Docker Desktop (recommended for the local authenticated MongoDB service), or a separately managed MongoDB instance

## First run

1. Copy `.env.example` to `.env`.
2. Generate an application secret and replace `AUTH_SECRET`:

   ```powershell
   node -e "console.log(require('node:crypto').randomBytes(48).toString('base64'))"
   ```

3. Paste your own MongoDB URI into `MONGO_URL` in `.env`. A local unauthenticated example is:

   ```text
   mongodb://127.0.0.1:27017/cordly
   ```

   For a hosted authenticated cluster use its provider-issued `mongodb+srv://...` connection string.
4. Install dependencies. If you want the optional local Docker MongoDB instead, also set `MONGO_ROOT_USERNAME` and `MONGO_ROOT_PASSWORD`, then start it:

   ```powershell
   npm install
   docker compose up -d
   ```

5. Create the empty collections and indexes, then start the app:

   ```powershell
   npm run dev
   ```

6. Visit [http://localhost:3000](http://localhost:3000) and check [http://localhost:3000/api/health](http://localhost:3000/api/health).

The MongoDB initializer is idempotent and creates no user, session, community, or message documents. The only initial document is the migration record that tracks the applied database migration.

## Becoming platform Owner

There are no premade accounts. Set `INITIAL_OWNER_EMAIL` before registering; only the first matching registration is eligible for automatic Owner bootstrap. A unique database index prevents concurrent registrations from claiming bootstrap more than once. Leave it empty to disable bootstrap.

To promote an account after it exists, run:

```powershell
npm run staff:promote -- username#1234
```

Promotion defaults to the `owner` role. An optional role can be supplied: `support`, `moderator`, `admin`, or `owner`. Promotion refuses to proceed unless the account already exists.

## Database tools

- `npm run db:init` creates the foundation collections and declared indexes, applying ordered migrations once.
- `npm run db:status` reports the configured database, collection counts, and indexes.
- `npm run db:reset` drops the configured database only after typing its exact name; it refuses to run with `NODE_ENV=production`.

## Configuration

All runtime configuration is parsed and validated at startup in `src/lib/env.ts`. Startup errors name the invalid variable. Production requires an `AUTH_SECRET` of at least 32 characters. Do not commit `.env`; `.env.example` is the safe template.

## Architecture

- `src/app/`: App Router UI, authentication and chat APIs, and health route
- `src/lib/`: validated environment, MongoDB connection cache, IDs, logging, and rate limiting
- `src/server/`: authenticated Socket.IO server, presence, and server-side services
- `src/models/`: strict Mongoose account, session, friendship, community, channel, community-message, and direct-message schemas with explicit indexes
- `src/server/services/`: registration, session, and server services
- `server.ts`: custom Next.js HTTP entry point that hosts Socket.IO on the same origin and port
- `src/scripts/`: idempotent initialization, status, development reset, staff promotion, and migration runner

Internal MongoDB `_id` values are for server-side relations only. Public-facing records use sortable public IDs. Account settings include profile details, appearance and accessibility preferences, username, profile pictures, two-factor authentication, active sessions, and presence status. Uploaded profile images are limited by the configured upload size.

## Community and account features

Communities include channels and categories, invite links, member profiles, member privacy preferences, and per-community channel favorites. Chat supports persisted community and direct messages, file attachments in channels and DMs, reactions, pins, reports, replies, and typing indicators. Authenticated Socket.IO connections deliver new and changed messages, typing, friend-request changes, online status, new DM conversations, and session revocation to authorized clients in real time. Channel and DM room access is checked against the signed-in session, community membership, and accepted friendship; leaving a community, blocking a friend, and revoking a session revoke corresponding live access. HTTP polling remains as a recovery path, checking active messages every 2.5 seconds while connected and every 1.8 seconds while disconnected. Right-clicking community messages, members, friends, or your account opens keyboard-accessible quick actions backed by existing message, profile, friendship, and account features. Successful account, community, friend, and message changes display an auto-dismissing confirmation toast. Friends include searchable online/all/pending views; the Online filter includes online, idle, and do-not-disturb friends. New incoming DMs display an unread-count badge on the C home icon and an unread marker in the conversation list, with optional desktop notifications when enabled and permitted. Accepted friends can open persistent one-to-one direct-message conversations, which remain available in the C home sidebar. Recently visited conversations show their cached messages immediately while the latest history refreshes in the background. Expanded profiles open full-screen while compact profile cards remain docked to the side. Account settings include profile editing, password changes, authenticator-based two-factor authentication, session revocation, and account export/deactivation.

## VPS deployment

The custom server hosts both Next.js and Socket.IO on the same port. Use one Node.js process per app instance; Socket.IO rooms and presence are process-local, so running multiple workers requires a shared Socket.IO adapter and sticky sessions. Do not enable Next.js `output: 'standalone'` with this custom server.

1. Install Node.js 20.9 or newer, clone the repository, and create `.env` from `.env.example`. Set a production `AUTH_SECRET` (at least 32 characters), `MONGO_URL`, and the public `APP_URL`.
2. Install, initialize the database if this is a new deployment, build, and run:

   ```sh
   npm ci
   npm run db:init
   npm run build
   npm start
   ```

   Keep the Node process alive with a process manager such as systemd or PM2. The server binds to `0.0.0.0` by default; set `HOST` or `PORT` to override this.
3. If using Nginx, proxy normal HTTP requests and Socket.IO upgrades to the same app port. Forward the original `Host`, `X-Forwarded-Host`, and `X-Forwarded-Proto` headers; allow WebSocket upgrades on `/socket.io/` and use a long read timeout. The socket endpoint accepts same-origin connections only.

Socket transport is transient; MongoDB remains the source of truth. If a client disconnects, reconnecting clients reload recent persisted messages through the existing APIs. Do not expose MongoDB or the Node port publicly when a reverse proxy is used.

The sign-in and registration screen uses a responsive split layout consistent with Cordly's dark indigo design. Interface transitions respect both the system reduced-motion preference and the in-app Reduce motion setting.

## Validation

```powershell
npm test
npm run lint
npm run build
```
