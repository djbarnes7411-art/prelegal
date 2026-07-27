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
mounted over it. Accounts, sessions and saved documents created in one run are gone
the next. Still deliberate: a reload keeps your session and your drafts, a restart
does not, and nothing here is meant to be a record of anything.

### Authentication, for as long as the container runs

The login screen checks a real password — hashed with `hashlib.scrypt`, never stored
in the clear — and signing in issues a session token the browser keeps and sends
back on every request that needs an account behind it. Signing out revokes it.

What is still missing: password reset, email verification, and any rate limiting on
sign-up, sign-in, or the chat endpoint. That last one matters most — `/api/chat`
needs an account now, but an account is free to make, so it is narrowed rather than
protected. And the accounts themselves are exactly as temporary as everything else
above.

### Your documents are saved, until they aren't

Every draft is saved as you go — the values *and* the conversation — so you can close
the tab, sign back in, and pick it up from the Documents screen. Same caveat as the
rest of the database: it does not survive the server restarting.

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

`OPENROUTER_API_KEY` is the exception worth knowing about. Copy `.env.example` to
`.env` at the repo root and fill it in — the backend reads that file on startup,
and `docker compose` passes the value through to the container. Without it the app
still starts and serves, but the chat cannot answer, and the chat is the only way
to fill a document in.

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

The workspace is at `/draft/`. You describe what you need, the assistant works
out which of the eleven documents fits, and then asks about each field and fills
the document in as you answer. Ask for something we have no template for and it
says so, and offers the closest thing it can draft.

### Adding or changing a document

Documents are compiled from `templates/*.md` plus a definition in
`definitions/*.toml`:

```bash
cd backend
uv run python -m app.documents.build           # writes the generated catalog
uv run python -m app.documents.build --check    # verifies it is committed and current
```

The build fails if a template cites a fill-in value no definition describes, or
if a definition describes one the template never uses — so a field cannot go
missing from the form while the clause that needs it stays in the agreement.

### What leaves the browser

What you type into the chat, and the document's values as they stand, are sent to
the backend on each turn and forwarded to the model provider. That is a change
from how this workspace started: it used to be a form that sent nothing anywhere.

They are also saved to your account, after each turn, so the draft is still there
when you come back — which is a change from how this started too. None of it
survives the server restarting. The app says all of this above the chat.

Every document it produces says on its own face that it is a draft, prepared with
an AI assistant, that a lawyer should read before anyone signs it. That line is
part of the document, so it is part of the PDF.

## Roadmap

- [x] Mutual NDA creator (PL-3)
- [x] V1 foundation: backend, database, container, scripts (PL-4)
- [x] AI chat to fill the document in (PL-5)
- [x] AI chat to choose *which* document to draft, and every agreement type from `catalog.json` (PL-6)
- [x] Real accounts: hashed passwords, sessions you can sign out of (PL-7)
- [x] Saved documents you can come back to, and a screen to find them (PL-7)
- [ ] Accounts and documents that survive a restart
- [ ] Rate limiting and spend control on the chat endpoint
- [ ] Password reset and email verification
- [ ] Structured repeating fields (DPA subprocessors, multiple SOWs)
- [ ] Target completion — August 1, 2026

## Contributing

The project is not yet ready for outside contributions. Please check back once the
initial implementation is complete.

## License

See [LICENSE](LICENSE).
