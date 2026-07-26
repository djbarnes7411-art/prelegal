# Prelegal Project

## Overview

This is a SaaS product to allow users to draft legal agreements based on templates in the templates directory.
The user can carry out AI chat in order to establish what document they want and how to fill in the fields.
The available documents are covered in the catalog.json file in the project root, included here:

@catalog.json

Only the Mutual NDA is supported so far. See "Current state" at the end of this file.

## Development process

When instructed to build a feature:
1. Use your Atlassian tools to read the feature instructions from Jira
2. Develop the feature - do not skip any step from the feature-dev 7 step process
3. Thoroughly test the feature with unit tests and integration tests and fix any issues
4. Submit a PR using your github tools

## AI design

When writing code to make calls to LLMs, use your Cerebras skill to use LiteLLM via OpenRouter to the 'openrouter/openai/gpt-oss-120b' model with Cerebras as the inference provider. You should use Structured Outputs so that you can interpret the results and populate fields in the legal document.

There is an OPENROUTER_API_KEY in the .env file in the project root.

## Technical design

The entire project should be packaged into a Docker container.  
The backend should be in backend/ and be a uv project, using FastAPI.  
The frontend should be in frontend/  
The database should use SQLite and be created from scratch each time the Docker container is brought up, allowing for a users table with sign up and sign in.  
The frontend is statically exported and served by FastAPI — this works, and keeps the whole product on one port.  
There should be scripts in scripts/ for:  
```bash
# Mac
scripts/start-mac.sh    # Start
scripts/stop-mac.sh     # Stop

# Linux
scripts/start-linux.sh
scripts/stop-linux.sh

# Windows
scripts/start-windows.ps1
scripts/stop-windows.ps1
```
Backend available at http://localhost:8000

## Color Scheme
- Accent Yellow: `#ecad0a`
- Blue Primary: `#209dd7`
- Purple Secondary: `#753991` (submit buttons)
- Dark Navy: `#032147` (headings)
- Gray Text: `#888888`

## Current state

Done, on `main`:

- **PL-3 — Mutual NDA creator.** Cover Page beside a live document; "Download PDF" hands it to the browser's print dialog.
- **PL-4 — V1 foundation.** FastAPI backend, temporary SQLite database, static frontend served by that backend, Docker container, start/stop scripts.
- **PL-5 — AI chat.** The form is gone. You draft the agreement by talking to an assistant, which asks about the fields and fills the document in as you answer.

### How it fits together

- `backend/` is a uv project. FastAPI serves `/api/*` and the built frontend from one origin on port 8000 — no reverse proxy, no Node at runtime. Stdlib `sqlite3` plus a small repository in `app/users.py`; no ORM.
- The database is deleted and recreated from `app/schema.sql` on **every startup**, with no volume over it. Nothing survives a restart. Settings: `PRELEGAL_DATABASE_PATH`, `PRELEGAL_FRONTEND_DIR`, `PRELEGAL_DEV_ORIGINS` — all optional, all defaulting to the repo layout. `OPENROUTER_API_KEY` is optional in the sense that the app starts and serves without it, but the chat cannot answer, and the chat is the only way to fill a document in.
- `frontend/` exports to static files (`output: "export"`, `trailingSlash: true`). `/` is the login screen, `/nda/` the NDA workspace.
- Run it with the `scripts/` above; run the tests with `cd backend && uv run pytest` (99) and `cd frontend && npm test` (235).

### How the chat works

- `POST /api/nda/chat` is **stateless**. The browser sends the transcript *and* the whole cover page every turn, so the agreement — not the model's memory of the conversation — is what is known. Nothing is stored at either end; a reload loses everything.
- One structured LiteLLM call per turn returns `{reply, patch}` together. `app/llm.py` owns the provider; `app/nda_chat.py` owns the prompt and `merge_patch`.
- **`merge_patch` is the trust boundary and the only route from a model's output to the agreement.** It drops any field that fails a check rather than rejecting the turn — one bad year should not throw away a good reply and four good fields. It also returns *complete* objects: a party arrives with all four fields, because the frontend merges shallowly and a partial one would blank the rest. Read the tests in `test_nda_chat.py` before changing it.
- Failures are HTTP 503 with a readable `detail`, shown as an error bubble with **Try again**. There is no form to fall back to, so a missing key means the document cannot be filled in at all — say so plainly rather than degrading quietly.
- The greeting, the privacy notice, the "still missing" nudge and the "you're done" message are ours, in `lib/nda/chat-copy.ts`. None of them costs a round trip, and the missing-field list is counted from `validateCoverPage`, never recalled by the model.
- **The key reaches the app two ways, and is baked into nothing.** `config.py` calls `load_dotenv(REPO_ROOT / ".env", override=False)` at import, so a checkout works; `docker-compose.yml` interpolates `${OPENROUTER_API_KEY}` from that same file, so the container works. `override=False` means a real environment variable always wins over the file. `.env.example` documents the variable; `.env` is gitignored.
- **No test reaches the network.** `test_chat.py` substitutes `complete_structured`, `test_llm.py` substitutes the completion function, and the frontend mocks `sendChatTurn`. An autouse fixture in `conftest.py` also strips `OPENROUTER_API_KEY` from the environment, because `load_dotenv` would otherwise put a live key there and a mocking mistake would spend real money.

### What leaves the browser

Chat messages and the cover-page values go to the backend and on to the model
provider. **This is a change from PL-3**, where the workspace sent nothing
anywhere — if you find that older claim still written somewhere, it is stale and
should be corrected. The notice above the chat says so in the product; keep it
visible and keep it honest as scope grows.

### There is no authentication yet

`/api/auth/signup` and `/api/auth/login` create and look up accounts for real, but the password is **never stored, hashed, or compared** — there is no password column. Knowing an email address is enough to sign in as it, and the login screen says so. Adding real auth means changing those two function bodies, not the wiring.

**Since PL-5 that has a cost attached.** `/api/nda/chat` takes no session and has no rate limit, so anyone who can reach the port can spend the OpenRouter key. The only bounds today are the request model's caps on message count and length. That is fine on localhost and not fine on a public address — this is the thing to fix before the app is ever exposed, ahead of the login screen itself.

### Conventions worth knowing

- **Two palettes, deliberately.** The colours above are the platform's, used on the login screen. The NDA workspace keeps its own dark-panel palette so the document beside it reads as paper — don't "correct" it to brand colours. Note `#888888` is only 3.5:1 on a light card, so body copy uses a darkened sibling.
- **`frontend/lib/nda/standard-terms.test.ts` diffs the contract text against `templates/mutual-nda.md`.** If it fails, read both before touching the expectation — that is a decision to change contract wording.
- `frontend/TESTING.md` holds the manual checklist that automation cannot reach: print/PDF output, narrow screens, keyboard and screen reader, and the assistant's actual behaviour — no test calls a real model.
- `*.sh` is pinned to LF in `.gitattributes` and the scripts carry the exec bit. A CRLF shebang is unrunnable on macOS and Linux, and this repo is edited on Windows.

### Not built yet

Choosing *which* document to draft (the chat only knows the Mutual NDA), every document other than the Mutual NDA, real authentication, any rate limiting or spend control on the chat endpoint, and persistence of any kind — including the conversation, which is lost on reload.
