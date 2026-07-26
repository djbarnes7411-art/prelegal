# prelegal

> **🚧 Status: In Progress**
>
> This project is under active development and is targeted for completion by **August 1, 2026**.

## About

`prelegal` turns [Common Paper](https://github.com/CommonPaper) legal templates into
documents you can fill in and sign. The templates in `templates/` are the canonical
source of record; `catalog.json` lists what is available.

## Running it

Everything runs in one Docker container: a FastAPI backend serving both the API and
the frontend, at **http://localhost:8000**.

```bash
# Mac
scripts/start-mac.sh
scripts/stop-mac.sh

# Linux
scripts/start-linux.sh
scripts/stop-linux.sh
```

```powershell
# Windows
scripts\start-windows.ps1
scripts\stop-windows.ps1
```

The start scripts build the image, bring the container up, and wait until the app
answers before reporting it ready. The first build compiles the frontend and takes a
few minutes; later ones are much faster.

## What's here

| Path | What it is |
| --- | --- |
| `backend/` | FastAPI app (a [uv](https://docs.astral.sh/uv/) project). Serves `/api/*` and the built frontend. |
| `frontend/` | Next.js app, exported to static files at build time. |
| `templates/` | The Common Paper source documents. |
| `scripts/` | Start and stop, per platform. |

### The database is temporary

SQLite, rebuilt from `backend/app/schema.sql` on **every startup**, with no volume
mounted over it. Accounts created in one run are gone the next. That is deliberate
for now — nothing in the product needs to survive a restart yet.

### There is no authentication yet

The login screen creates and looks up accounts for real, but passwords are never
stored or checked, and knowing an email address is enough to sign in as it. The
endpoints have the shape real authentication needs, so adding hashing and sessions
later is a change to two function bodies. Until then, the app says so on the login
screen.

## Development

Docker runs the whole thing, but each half also runs on its own.

### Backend

```bash
cd backend
uv sync --all-groups
uv run pytest                                     # tests
uv run uvicorn app.main:app --reload --port 8000  # server
```

With no frontend build present, the backend serves the API alone and logs a note
saying so.

To let a separately-served frontend call it, allow that origin:

```bash
PRELEGAL_DEV_ORIGINS=http://localhost:3000 uv run uvicorn app.main:app --reload --port 8000
```

```powershell
$env:PRELEGAL_DEV_ORIGINS = 'http://localhost:3000'
uv run uvicorn app.main:app --reload --port 8000
```

Settings are all optional and all default to the repository layout:
`PRELEGAL_DATABASE_PATH`, `PRELEGAL_FRONTEND_DIR`, `PRELEGAL_DEV_ORIGINS`.

### Frontend

```bash
cd frontend
npm install
npm run dev       # http://localhost:3000, calling the backend on :8000
```

`npm test`, `npm run lint`, `npm run typecheck`, and `npm run build` are also
available. `build` writes the static export to `frontend/out/`, which is what the
container serves. See [`frontend/TESTING.md`](frontend/TESTING.md) for what the
automated tests cover and what still has to be checked by hand.

The NDA workspace is at `/nda/` and drafts the document entirely in the browser —
nothing you type into the agreement is sent anywhere.

## Roadmap

- [x] Mutual NDA creator (PL-3)
- [x] V1 foundation: backend, database, container, scripts (PL-4)
- [ ] Real authentication and accounts that persist
- [ ] AI chat to choose a document and fill it in
- [ ] Remaining agreement types from `catalog.json`
- [ ] Target completion — August 1, 2026

## Contributing

The project is not yet ready for outside contributions. Please check back once the
initial implementation is complete.

## License

See [LICENSE](LICENSE).
