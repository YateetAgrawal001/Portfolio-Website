# Portfolio Grand Prix

Yateet Agrawal's portfolio as a racing game. You drive an F1-style car around a street circuit, and each of the seven turns shows one section of the portfolio in a banner. "Skip the race" opens the same content as an animated page to read, with a contact form.

- `web/` is the frontend: React 19, TypeScript and Three.js, built with Vite.
- `api/` is the backend: ASP.NET Core (.NET 10) minimal API with SQLite. It serves the content, stores contact messages, and hosts the built frontend.
- `Dockerfile` builds both into one image.

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

## Deploy

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
| [api/Program.cs](api/Program.cs) | The whole API: endpoints, validation, rate limit, security headers, static files. |
| [web/src/engine.ts](web/src/engine.ts) | The game: track, physics, rival, cameras, weather, minimap. Plain Three.js, ported from the prototype. |
| [web/src/store.ts](web/src/store.ts) | The small state store the engine and React share, plus the content types. |
| [web/src/Game.tsx](web/src/Game.tsx) | Mounts the engine and renders the HUD and the turn banner. Loaded lazily with Three.js. |
| [web/src/DetailPage.tsx](web/src/DetailPage.tsx) | The "Skip the race" page and the contact form. |
| [web/src/App.tsx](web/src/App.tsx) | Loads the content, then the intro, start lights and toast. |

The engine never puts per-frame values in React state. It draws the canvas itself and pushes lap, time and speed to the store ten times a second.

## Where this differs from PLAN.md

- The backend is C# and ASP.NET Core with SQLite, not Node, Express, Prisma and PostgreSQL.
- Content is real (from the résumé) and lives in `api/portfolio.json`, not placeholder strings in the frontend.
- The game is plain Three.js in one module driven from React, not React Three Fiber components. Three.js is pinned to r128, the version the prototype was tuned on; newer versions change colour and light handling and would need every light re-tuned.
- One container serves both the site and the API, so there is no CORS setup and no fallback content for "API down".
- Not built: the lap leaderboard, email delivery of contact messages, low-power mode, and the Vitest and Playwright suites. `smoke.ps1` is the automated check.
