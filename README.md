# Portfolio Grand Prix

Yateet Agrawal's portfolio as a racing game. You drive an F1-style car around a street circuit, and each of the seven turns shows one section of the portfolio in a banner. "Skip the race" opens the same content as an animated page to read, with a contact form.

- `web/` is the frontend: React 19, TypeScript and Three.js, built with Vite.
- `web/functions/` is the production backend on Cloudflare: Pages Functions in TypeScript, with contact messages in Cloudflare D1. See [Deploy on Cloudflare](#deploy-on-cloudflare-free).
- `api/` is the same backend in ASP.NET Core (.NET 10) with SQLite, for local development and as a fallback. It also hosts the built frontend.
- `Dockerfile` builds the frontend and the .NET API into one image.

Both backends serve the same `/api` endpoints from the same content file, [api/portfolio.json](api/portfolio.json).

`PLAN.md` is the original spec and `portfolio-grand-prix.html` is the prototype the game was ported from.

## Run it

With Docker (the whole site on http://localhost:8080):

```
docker compose up --build
```

For development, in two terminals (needs .NET 10 SDK and Node 20+):

```
cd api
dotnet run              # API on http://localhost:5080

cd web
npm install
npm run dev             # site on http://localhost:5173, /api is proxied to the API
```

`npm run build` type-checks and builds the frontend into `web/dist`.

To run the Cloudflare version locally (the built site plus Pages Functions and a local D1 database, on http://localhost:8788):

```
cd web
npm run build
echo ADMIN_KEY=local-dev-key > .dev.vars
npm run cf:dev          # applies migrations to the local database, then starts wrangler pages dev
```

The local database lives in `web/.wrangler/` and `.dev.vars` holds local secrets; both are gitignored. Rebuild after frontend changes, or use `npm run dev` with the .NET API for frontend work.

## Change the content

Everything a visitor reads comes from [api/portfolio.json](api/portfolio.json): name, role, and one station per turn. The API checks the file when it starts and refuses to boot if a field is missing or there are not exactly seven stations, because the track has seven turns.

Left out on purpose: the phone number from the résumé (the site is public), and project links, because the résumé has no repository URLs. To add one, give a project a `"url"` and a "View project" link appears on its card.

## API

| Method and path | What it does |
|---|---|
| `GET /api/health` | Returns `{ "ok": true }`. |
| `GET /api/portfolio` | The content of `portfolio.json`. Cached for 5 minutes. |
| `POST /api/contact` | Stores a message. Body: `name` (up to 80), `email`, `message` (10 to 4000). Returns 202, or 400 with the validation errors. Limited to 5 posts per hour per IP (429 after that). A hidden `website` field is a honeypot: posts that fill it are accepted and dropped. |
| `GET /api/contact` | Your inbox: the latest 200 messages. Needs the header `X-Admin-Key`. Returns 404 unless `ADMIN_KEY` is set and matches. |

Read your messages:

```
curl -H "X-Admin-Key: <your key>" https://<your site>/api/contact
```

## Settings

Environment variables for the API:

| Name | Default | Purpose |
|---|---|---|
| `ADMIN_KEY` | not set | Key for `GET /api/contact`. Use a long random string. For Docker, put `ADMIN_KEY=...` in a `.env` file next to `docker-compose.yml`. |
| `DB_PATH` | `data/portfolio.db` (`/data/portfolio.db` in Docker, on a volume) | Where the SQLite file lives. |
| `ASPNETCORE_FORWARDEDHEADERS_ENABLED` | not set | Set to `true` behind a reverse proxy or a cloud host, so the rate limit counts each visitor's IP and not the proxy's. |

## Check it works

`smoke.ps1` checks a running instance end to end: health, content, validation, the honeypot, the rate limit and the closed inbox.

```
docker compose up -d --build
.\smoke.ps1
```

Run it against a freshly started instance. It uses up the five contact posts allowed per hour on purpose, so a second run needs a restart first.

The Cloudflare backend has its own tests:

```
cd web
npm test
```

This builds the site, type-checks the functions, then starts `wrangler pages dev` on a throwaway local D1 database in a temp folder and tests every endpoint: validation, honeypot, the rate limit (one at a time and 20 at once), admin auth, insert and read back, the seven stations, messages surviving a restart, and that Pages can compile the functions. It never touches a remote database.

Wrangler is pinned to 4.86.0, the last release that runs on Node 20. Once you are on Node 22.12 or later, it can be upgraded.

## Deploy on Cloudflare (free)

Cloudflare Pages serves `web/dist`. Pages Functions in `web/functions/api/` answer `/api/*`, and contact messages are stored in D1. The Pages project settings stay as they are: root directory `web`, build command `npm run build`, output directory `dist`. Pages finds `web/functions` and `web/wrangler.toml` because they are in the root directory.

| Environment | Deploys from | Database | `ADMIN_KEY` |
|---|---|---|---|
| Production | the production branch (`main`) | `portfolio` | production secret |
| Preview | every other branch and pull request | `portfolio-preview` | preview secret |

Preview deployments never see production messages.

### One-time setup

1. Create the two databases, from `web/`:
   ```
   npx wrangler login
   npx wrangler d1 create portfolio
   npx wrangler d1 create portfolio-preview
   ```
   Or use the dashboard: **Storage & Databases → D1 → Create**. Put each `database_id` into [web/wrangler.toml](web/wrangler.toml). IDs aren't secrets, so commit them. Also check that `name` there matches your Pages project name.
2. Create the tables:
   ```
   npx wrangler d1 migrations apply DB --remote               # production
   npx wrangler d1 migrations apply DB --remote --env preview # preview
   ```
3. Set the admin key as a secret, for both Production and Preview. In the dashboard, open your Pages project, then **Settings → Variables and Secrets → Add**, type **Secret**, name `ADMIN_KEY`. For production only, the CLI also works: `npx wrangler pages secret put ADMIN_KEY --project-name portfolio-website`. Use a long random string. It never goes in the repo or the frontend.
4. Push. Pages builds and deploys as before, now with the functions and the D1 binding `DB` from `wrangler.toml`.

Read your messages:

```
curl -H "X-Admin-Key: <your key>" https://<your-project>.pages.dev/api/contact
```

### Changing the database

Migrations live in [web/migrations](web/migrations) and are applied by hand. A deployment never runs them and never touches the data in D1, so messages survive every deploy.

1. Add a new file, such as `migrations/0002_add_column.sql`. Never edit or delete one that has already been applied.
2. See what is pending: `npx wrangler d1 migrations list DB --remote`.
3. Apply it to preview first (`--remote --env preview`), then production (`--remote`), before merging code that needs it.

Prefer additive changes (new tables, new nullable columns) over `DROP` or rewriting tables.

### Backup and recovery

- **Export** (do this before any migration):
  ```
  npx wrangler d1 export portfolio --remote --output portfolio-2026-11-18.backup.sql
  ```
  `*.backup.sql` is gitignored, because the file holds visitors' names and emails.
- **Time Travel:** D1 keeps a point-in-time history: 7 days on the free plan, 30 on paid.
  ```
  npx wrangler d1 time-travel info portfolio
  npx wrangler d1 time-travel restore portfolio --timestamp 2026-11-18T10:00:00Z
  ```
  A restore replaces the current data. It prints a bookmark you can restore back to if it was the wrong point.
- **Restore an export** into a new, empty database: `npx wrangler d1 create portfolio-restored`, then `npx wrangler d1 execute portfolio-restored --remote --file portfolio-2026-11-18.backup.sql`, then point `database_id` at it.

### Free-tier limits

The free tier covers this site:
- Static files are free and unlimited.
- Function calls: 100,000 a day.
- D1: 5 GB of storage, 5 million rows read and 100,000 rows written a day. A contact post writes about three rows.

### How it differs from the .NET API

- The rate-limit hour runs on the clock (it resets on the hour), and it is stored in D1, so it holds across deployments. The visitor's IP comes from Cloudflare's `CF-Connecting-IP` header.
- Name, email and message lengths are checked after trimming. The .NET API checked before trimming, so a message padded with spaces could pass the 10-character minimum.
- A 429 has a `Retry-After` header, the inbox response is `no-store`, and the admin key is hashed before the constant-time compare, so its length doesn't leak.
- Methods an endpoint doesn't support return 404 rather than 405.

## Deploy with Docker

Any host that runs a container works (Azure App Service or Container Apps, Render, Railway, Fly.io). The container listens on port 8080. Three things to set:

1. A persistent volume mounted at `/data`, or contact messages are lost on every redeploy.
2. `ADMIN_KEY`.
3. `ASPNETCORE_FORWARDEDHEADERS_ENABLED=true`, and HTTPS at the host or proxy.

## Controls

| Input | Action |
|---|---|
| `W`, `↑` or `Space` (hold) | Gas. The car only moves while you hold it. |
| `S` or `↓` (hold) | Brake |
| `A` `D` or `←` `→` | Steer |
| `C` | Cockpit or chase view |
| `R` | Rain on or off |
| `O` | Rival on or off |
| `E` | Hide or show the turn banner |
| `Esc` | Hide the banner, or close the list view |

On a touch screen, four buttons replace the keys. The turn buttons and the minimap jump straight to a turn.

## How the code is laid out

| File | Role |
|---|---|
| [api/Program.cs](api/Program.cs) | The whole .NET API: endpoints, validation, rate limit, security headers, static files. |
| [web/functions/api/](web/functions/api) | The Cloudflare API: `health.ts`, `portfolio.ts`, `contact.ts` (POST and the GET inbox), `_middleware.ts` (headers, safe errors), `[[path]].ts` (404 for unknown routes). |
| [web/migrations/](web/migrations) | D1 schema, applied with `wrangler d1 migrations apply`. |
| [web/wrangler.toml](web/wrangler.toml) | Pages and D1 config for production, preview and local. |
| [web/public/_headers](web/public/_headers) | Security and cache headers for the static site on Pages. |
| [web/test/api.test.mjs](web/test/api.test.mjs) | Tests for the Cloudflare API. |
| [web/src/engine.ts](web/src/engine.ts) | The game: track, physics, rival, cameras, weather, minimap. Plain Three.js, ported from the prototype. |
| [web/src/store.ts](web/src/store.ts) | The small state store the engine and React share, plus the content types. |
| [web/src/Game.tsx](web/src/Game.tsx) | Mounts the engine and renders the HUD and the turn banner. Loaded lazily with Three.js. |
| [web/src/DetailPage.tsx](web/src/DetailPage.tsx) | The "Skip the race" page and the contact form. |
| [web/src/App.tsx](web/src/App.tsx) | Loads the content, then the intro, start lights and toast. |

The engine never puts per-frame values in React state. It draws the canvas itself and pushes lap, time and speed to the store ten times a second.

## Where this differs from PLAN.md

- The backend is Cloudflare Pages Functions with D1 in production, plus C# and ASP.NET Core with SQLite for local and Docker use, not Node, Express, Prisma and PostgreSQL.
- Content is real (from the résumé) and lives in `api/portfolio.json`, not placeholder strings in the frontend.
- The game is plain Three.js in one module driven from React, not React Three Fiber components. Three.js is pinned to r128, the version the prototype was tuned on; newer versions change colour and light handling and would need every light re-tuned.
- The site and the API share one origin (one Pages project, or one container), so there is no CORS setup and no fallback content for "API down".
- Not built: the lap leaderboard, email delivery of contact messages, low-power mode, and the Vitest and Playwright suites. `smoke.ps1` and `web/test/api.test.mjs` are the automated checks.
