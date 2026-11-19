# BidVerse

BidVerse is a freight RFQ and British Auction demo built with React, FastAPI, and PostgreSQL. Buyers create RFQs and configure bidding extensions. Suppliers submit and revise quotes while the auction is active. Both can follow rankings, deadlines, and activity as bids arrive.

[High-level design, architecture diagram, and assignment review](HLD.md) · [Database schema design](Schema%20Design.md)

## Project structure

```text
compose.yaml          Frontend, FastAPI, and PostgreSQL services
.env.example          Local ports and database configuration
HLD.md                Architecture diagram and assignment review
Schema Design.md      Database tables, relationships, and constraints
frontend/
  Dockerfile          Builds React and serves it with Nginx
  nginx.conf          React routes and API/WebSocket proxy
  e2e/                Playwright demo workflow
  index.html          Browser entry point
  package.json        npm scripts and dependencies
  package-lock.json   Resolved npm dependencies
  vite.config.js      React, Tailwind CSS, and the development API proxy
  src/
    api/client.js     Shared Axios client
    components/       Application layout and shared controls
    App.jsx           React Router configuration
    main.jsx          React and TanStack Query entry point
    styles.css        Tailwind CSS theme
backend/
  Dockerfile          Runs Alembic migrations and starts FastAPI
  alembic.ini         Alembic configuration
  alembic/            Migration environment and version directory
  requirements.txt    Python dependencies
  scripts/            Demo seed and browser-test server
  app/
    db.py             SQLAlchemy engine and declarative base
    main.py           FastAPI application
    models.py         RFQ auction database models
```

## Run locally

### Docker Compose

Start Docker Desktop with Linux containers. From the repository root, copy `.env.example` to `.env` on the first run, then build and start the stack.

```powershell
Copy-Item .env.example .env
docker compose up --build
```

For a background start that waits for the health checks, use `docker compose up --build -d --wait`.

- Open [BidVerse](http://localhost:5173), [FastAPI Docs](http://127.0.0.1:8000/docs), or the [database health endpoint through the frontend](http://localhost:5173/api/health/db).
- Run `docker compose ps` to check service health or `docker compose logs -f backend` to watch migrations and API logs.
- Run `docker compose down` to stop the stack. PostgreSQL data stays in the `postgres_data` named volume.

Compose waits for PostgreSQL to pass its health check. The backend applies `alembic upgrade head` before starting FastAPI. Nginx starts after the API is healthy and serves the built React app. Its `/api/` proxy forwards HTTP and WebSocket traffic to `backend:8000`. To inspect the applied migration, run `docker compose exec backend alembic current`.

Set `FRONTEND_PORT`, `BACKEND_PORT`, or `POSTGRES_PORT` in `.env` if a host port is busy. Published ports bind to `127.0.0.1`. Compose services use their internal ports and service names, with FastAPI connecting to `db:5432`. PostgreSQL uses `POSTGRES_DB`, `POSTGRES_USER`, and `POSTGRES_PASSWORD` to initialize a fresh volume. Rebuild with `docker compose up --build` after changing application code or adding a migration.

### Host development with hot reload

For host development, use Python 3.12 or newer and Node.js 22.12 or newer. With `.env` in place, start just PostgreSQL from the repository root. Use `docker compose stop frontend backend` first if the app containers are already running on the default ports.

```powershell
docker compose up -d --wait db
```

Start FastAPI from the repository root.

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m alembic upgrade head
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload
```

In a separate terminal, start Vite from the repository root.

```powershell
cd frontend
npm.cmd ci
npm.cmd run dev
```

Open the URL printed by Vite, normally `http://localhost:5173`. The Vite proxy forwards same-origin `/api` requests to FastAPI at `http://127.0.0.1:8000`. If the host FastAPI server runs on a different address, copy `frontend/.env.example` to `frontend/.env.local` and set `BIDVERSE_API_TARGET`.

## Features

- **Auction list** (`/auctions`) shows the lowest valid bid, the current and forced close, and the server-calculated status. Search by RFQ name or reference ID and filter by status. The visible page refreshes every 15 seconds.
- **New RFQ** (`/rfqs/new`) captures the buyer, bidding schedule, service date, and British Auction settings. It converts local bidding times to UTC and keeps the service date as a calendar date. British Auction is enabled by default with a 10-minute window and a 5-minute extension.
- **Auction details** (`/auctions/:rfqId`) shows a live countdown, supplier rankings, every bid sorted by price, and activity with extension reasons. Expand a bid to see charges, transit time, and validity.
- **Supplier quote** lets a supplier submit or revise a quote while the auction is active. It previews the total in the RFQ currency and refreshes the details and history after acceptance. Bidding is available for RFQs with British Auction enabled.

## Local demo

With the [Compose stack running](#docker-compose), seed the database from the repository root.

```powershell
docker compose exec backend python -m scripts.seed_demo
```

If you are running FastAPI on the host, use `.\.venv\Scripts\python.exe -m scripts.seed_demo` from `backend/`.

The command creates two demo buyers, three demo suppliers, and a fresh batch of three active auctions. It prints their reference IDs, direct links, and deadlines in UTC. If your frontend uses a different port, open the printed paths on that port. Every run reuses the same accounts and keeps earlier auctions, bids, and activity. The normal schedule starts with 10 to 14 minutes of bidding and sets the forced deadline 23 minutes after seeding.

| Seeded auction | What to try |
|---|---|
| Any bid | Submit a quote and watch it extend the deadline. |
| Any rank change | Submit totals of 200, 250, and 300 from three suppliers. Revise the third supplier to 225 to swap L2 and L3 while L1 stays the same. |
| L1 change | Submit a quote, then undercut it with a second supplier to move L1 and extend the deadline. |

1. Open **New RFQ** and choose a demo buyer. Use a unique reference ID, a bid start in the past, a future initial close, and a later forced close. Set a future service date and leave British Auction enabled. Create the RFQ and confirm it opens on the auction details page.
2. Open the same auction details URL in a second browser window or profile. Wait for **Live updates** in both. Use one of the seeded auctions above, or use the RFQ you created with the corresponding trigger and a window that covers the current time.
3. In the first session, submit quotes using the demo suppliers. Enter a carrier, the freight, origin and destination charges, transit days, and a validity time beyond the deadline. Verify that the second session updates its rankings, bid history, current deadline, and activity log without a reload. Expand a history entry to inspect its quote details.
4. To demo the forced close quickly, run the seed command again with `--quick` and open the newly printed **Any bid** auction. Its initial deadline is one minute after seeding, the forced close is three minutes after seeding, and each accepted quote adds one minute. Submit at least two bids in time to move the current deadline to the forced deadline. At that deadline, the details show **Force closed** and disable quote submission.

## Auction rules

- The RFQ schedule requires `bid start < initial close < forced close`. The current close starts at the initial close. The server accepts bids from the start instant up to the current close, exclusive. If the current close reaches the forced deadline, closing at that instant results in **Force closed**. An RFQ that closes earlier keeps **Closed** status.
- Every accepted revision stays in bid history. The latest unexpired quote represents each supplier, even if a previous quote had a lower total. If it expires, an older still-valid quote can rank. Rankings and the lowest bid use the total of freight, origin, and destination charges. Ties favor the earlier submission, then the smaller bid ID.
- A qualifying bid in the last X minutes adds Y minutes to the current close, capped at the forced close. The window includes its opening instant and moves with each extension. A single transaction saves the bid, deadline change, and activity log before the API sends a WebSocket notification.

| Trigger | When an accepted bid extends the auction |
|---|---|
| `bid_received` | The bid arrives during the trigger window. |
| `supplier_rank_changed` | At least one previously ranked supplier changes position. |
| `lowest_bidder_changed` | A different supplier replaces the existing L1 bidder. |

The first bid qualifies only for `bid_received`. Rank triggers compare both rankings at the same server timestamp. Expiry by itself leaves the deadline unchanged.

## RFQ API

| Endpoint | Behavior |
|---|---|
| `POST /rfqs` | Create an RFQ and return it with HTTP 201. |
| `GET /rfqs` | List RFQs newest first with the current `lowest_bid`. Pass `auction_only=true` to list British Auctions. |
| `GET /rfqs/{rfq_id}` | Fetch an RFQ by ID. |
| `GET /buyers` | List buyer IDs and names for the creation form. |

The request and response schemas are available in Swagger UI at http://127.0.0.1:8000/docs. Creation takes an existing buyer's `buyer_id`, a unique reference ID, a name, a three-letter currency code, a service date, and timezone-aware bidding timestamps. The timestamps must satisfy `bid_start_at < original_close_at < forced_close_at`. The server initializes the current close to the original close.

Include `auction_configuration` to enable British Auction mode. The trigger window and extension duration are positive whole minutes. RFQ reads include the configuration and a status calculated with server time.

The listing returns `lowest_bid` as a decimal string in the RFQ currency, or `null` when no quote is currently valid. It uses each supplier's most recent unexpired bid, matching the rankings endpoint.

Use the [demo seed](#local-demo) to populate the buyer and supplier lists in a fresh local database.

## Bid API

| Endpoint | Behavior |
|---|---|
| `POST /rfqs/{rfq_id}/bids` | Submit a quote as an existing supplier during an active British Auction. Returns HTTP 201. |
| `GET /suppliers` | List existing supplier IDs and names for the quote form. |
| `GET /rfqs/{rfq_id}/bids` | Show every accepted quote, including superseded and expired quotes, sorted by total price. |
| `GET /rfqs/{rfq_id}/rankings` | Show L1, L2, L3 and subsequent positions using one valid quote per supplier. |

For submissions, send `supplier_id`, `carrier_name`, `freight_charge`, `origin_charge`, `destination_charge`, `transit_time_days`, and `valid_until`. Charges support two decimal places and use the RFQ currency. The API returns money values as decimal strings. Quote validity must have a timezone and be later than the server's submission timestamp.

## Auction activity API

`GET /rfqs/{rfq_id}/activity` returns events oldest first, using the event ID to order events with the same timestamp. Each event includes its ID, RFQ ID, bid ID, type, and UTC timestamp. A `time_extended` event includes `extension_trigger` as its reason, plus `previous_close_at` and `new_close_at`. A `bid_submitted` event returns those three fields as `null`.

An existing RFQ with no events returns an empty array. RFQ detail, bids, rankings, and activity return HTTP 422 for malformed or out-of-range IDs and HTTP 404 for IDs that do not exist. RFQ and bid responses format timestamps in UTC and monetary amounts as two-decimal strings.

## Real-time auction updates

The browser opens a WebSocket at `/api/rfqs/{rfq_id}/ws`. Nginx in Compose and Vite in host development both forward the upgrade to FastAPI's `/rfqs/{rfq_id}/ws` endpoint.

After a bid commits, the RFQ's subscribers receive an `auction_updated` notification with the bid ID and `bid_submitted` in its `events` array. The array also contains `time_extended` when that bid extends the deadline. The browser refetches the current data on each notification and on reconnect. While the tab is visible, it polls every 10 seconds if the stream is unavailable and reconciles every 60 seconds while connected.

Run a single Uvicorn worker for local use. The subscription registry lives in the worker process, so delivery across multiple workers requires a shared broker.

## Testing

### API tests

Start the [Compose stack](#docker-compose) or follow [host development](#host-development-with-hot-reload) to start PostgreSQL and apply the migrations. Set up the Python environment on the host, then run from `backend/`:

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
.\.venv\Scripts\python.exe -m pytest -q
.\.venv\Scripts\python.exe -m alembic check
```

The tests run against the configured PostgreSQL database. They use rolled-back transactions and temporary schemas for concurrent requests.

### Frontend tests and build

From `frontend/`, run `npm.cmd test` for the listing, RFQ creation, auction details, quote submission, and real-time update tests. Run `npm.cmd run build` to check the production bundle.

### Browser end-to-end test

Start PostgreSQL and install the backend and frontend dependencies on the host as shown under [host development](#host-development-with-hot-reload). From `frontend/`, run:

```powershell
npx.cmd playwright install chromium
npm.cmd run test:e2e
```

To use a locally installed Google Chrome, set `$env:BIDVERSE_E2E_BROWSER_CHANNEL = 'chrome'` and run the test command. The test builds the frontend, starts Vite preview and FastAPI on local ephemeral ports, and removes its temporary PostgreSQL schema on teardown. It uses `backend/.venv` by default. Set `BIDVERSE_E2E_PYTHON` to use a different Python executable.

The test creates an RFQ through the UI, submits and revises supplier quotes, and verifies that a second browser session receives WebSocket notifications and refreshes the rankings, history, and activity. It checks repeated extensions and advances the test server and browser clocks to exercise forced closing at the exact boundary, including HTTP 409 for a late bid.
