# Prelegal Project

## Overview

This is a SaaS product to allow users to draft legal agreements based on templates in the templates directory.
The user can carry out AI chat in order to establish what document they want and how to fill in the fields.
The available documents are covered in the catalog.json file in the project root, included here:

@catalog.json

All eleven documents in the catalog are supported. See "Current state" at the end of this file.

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
- **PL-6 — Every document.** All eleven catalog documents can be drafted. The conversation starts by working out *which* one you need, and says so plainly when you ask for something we have no template for.
- **PL-7 — Accounts, saved drafts, a disclaimer.** Passwords are real (stdlib `hashlib.scrypt`) and a session is a bearer token the browser holds. Every draft is autosaved — values *and* conversation — so signing back in returns you to what you were doing, and a Documents screen lists what you have written. `/api/chat` now needs a session. Every document says on its face that it is a draft for a lawyer to review. None of it survives a restart; that part is unchanged.

### How it fits together

- `backend/` is a uv project. FastAPI serves `/api/*` and the built frontend from one origin on port 8000 — no reverse proxy, no Node at runtime. Stdlib `sqlite3` plus a small repository in `app/users.py`; no ORM.
- The database is deleted and recreated from `app/schema.sql` on **every startup**, with no volume over it. Nothing survives a restart. Settings: `PRELEGAL_DATABASE_PATH`, `PRELEGAL_FRONTEND_DIR`, `PRELEGAL_DEV_ORIGINS` — all optional, all defaulting to the repo layout. `OPENROUTER_API_KEY` is optional in the sense that the app starts and serves without it, but the chat cannot answer, and the chat is the only way to fill a document in.
- `frontend/` exports to static files (`output: "export"`, `trailingSlash: true`). `/` is the login screen, `/documents/` the list, `/draft/` the workspace — still one route for every document. **Which saved draft you are opening is `?doc=<id>`, not a route segment**, because the export enumerates every route at build time and nobody's ids exist then. The static mount resolves on path alone, so a hard reload of `/draft/?doc=42` serves the same page and the browser reads the query itself.
- `templates/` holds the Common Paper source documents and is the record of what the contracts say; `definitions/` holds one small TOML per document saying what its fill-in values *are*. Neither is read at runtime — both are compiled ahead of time, as below.
- Run it with the `scripts/` above; run the tests with `cd backend && uv run pytest` (306) and `cd frontend && npm test` (338).

### Where a document comes from

A document is **compiled, not hand-written**. `backend/app/documents/build.py` reads
`templates/*.md` and `definitions/*.toml` and writes what both halves read:

```
definitions/<slug>.toml  +  templates/<slug>.md
                     |
                     v
   frontend/lib/documents/generated/
       catalog.json          fields and blurbs      (backend + browser)
       clauses/<slug>.json   contract text          (browser only)
       clauses.ts            a loader per document  (browser only)
```

- Run `cd backend && uv run python -m app.documents.build` after editing either input. **The output is committed**, and `test_documents_build.py` fails if it is stale. It is committed so contract-text changes show up as a reviewable diff, and because the static export has no Node at runtime to build it.
- **The field list is discovered from the contract, not typed out beside it.** Every fillable value in a template is already marked up (`<span class="orderform_link">Pilot Period</span>`). The build **fails** if a template cites a variable no definition describes, or if a definition describes one the template never cites — so a field cannot quietly go missing from the form while the clause needing it stays in the agreement.
- The definition supplies only what the template cannot: each field's type, the label a person hears, whether it is required, and any starting value.
- **Most fields are optional on purpose.** Every template's own Definitions clause says an omitted value means "none" or "not applicable", so only the core is required. Without that the Professional Services Agreement would interrogate you for twenty-four fields.
- It lives under `frontend/` because Turbopack will not resolve an import from outside its project root. The Dockerfile copies `catalog.json` into the runtime image separately, since the frontend stage exports only built pages.
- **The Mutual NDA is the one document not compiled from a template.** It shipped with a published cover page and a verbatim transcription in `lib/nda/standard-terms.ts`, and keeps both, plus its own renderer. Its definition declares `renderer = "mutual-nda"` and no template.

### How the chat works

- `POST /api/chat` is **stateless**. The browser sends the transcript, the document slug, *and* every value the document holds, so the agreement — not the model's memory of the conversation — is what is known. It reads nothing that was saved and writes nothing: since PL-7 the *draft* is saved, by the browser, to `/api/documents`, after the turn. A reload no longer loses everything; a restart still does.
- **One endpoint, two modes.** No slug means "which document do you need?" and returns `{reply, documentSlug}`; a slug means drafting and returns `{reply, patch}`. A slug that is not in the catalog is treated as no choice at all rather than rejected, because the conversation can recover from being asked again and cannot recover from a 422.
- The structured-output schema is **built per document** with `create_model` and cached, so the model is asked for that agreement's values by name rather than for a bag of strings it must label itself. `app/llm.py` owns the provider; `documents/chat.py` owns the prompts.
- **`documents/values.py` is the trust boundary and the only route from a model's output to an agreement.** It drops any field that fails a check rather than rejecting the turn — one bad year should not throw away a good reply and four good fields. It returns *complete* objects: a party arrives with all four fields, because the frontend merges shallowly and a partial one would blank the rest. A blank never clears an answer. Read `test_documents_values.py` before changing it.
- **The assistant always leaves a question on the table.** The prompt asks for it, and `ensure_follow_up` enforces it: if required fields remain and the reply contains no question, one is appended from the next missing field's label. Counted from the state, never recalled by the model. It also bounds the reply length, and the two must happen in that order — clipping first would push the appended question back over the limit, and the transcript is resent every turn.
- Failures are HTTP 503 with a readable `detail`, shown as an error bubble with **Try again**. There is no form to fall back to, so a missing key means the document cannot be filled in at all — say so plainly rather than degrading quietly.
- The greeting, the privacy notice, the "still missing" nudge and the "you're done" message are ours, in `lib/documents/chat-copy.ts`. None of them costs a round trip, and the missing-field list is counted from `missingFields`, never recalled by the model.
- **Focus returns to the composer when a turn succeeds, and only then.** A failed turn puts a "Try again" button in the log, and moving focus off it would hide the one thing worth pressing.
- **The key reaches the app two ways, and is baked into nothing.** `config.py` calls `load_dotenv(REPO_ROOT / ".env", override=False)` at import, so a checkout works; `docker-compose.yml` interpolates `${OPENROUTER_API_KEY}` from that same file, so the container works. `override=False` means a real environment variable always wins over the file. `.env.example` documents the variable; `.env` is gitignored.
- **No test reaches the network.** `test_chat.py` substitutes `complete_structured`, `test_llm.py` substitutes the completion function, and the frontend mocks `sendChatTurn`. An autouse fixture in `conftest.py` also strips `OPENROUTER_API_KEY` from the environment, because `load_dotenv` would otherwise put a live key there and a mocking mistake would spend real money.

### What leaves the browser

Chat messages and the document's values go to the backend and on to the model
provider. **This is a change from PL-3**, where the workspace sent nothing
anywhere — if you find that older claim still written somewhere, it is stale and
should be corrected.

**Since PL-7 they are also saved**, tied to the account, after every turn. So
"nothing is stored after you close the tab" is stale too, wherever it survives.
What is still true is that nothing survives the container restarting, and the
notice above the chat now says both halves. Keep it visible and keep it honest
as scope grows.

### Where the generated documents fall short

Worth knowing before promising anything to a user:

- **Repeating groups are flattened to free text.** The Data Processing
  Agreement's Approved Subprocessors is a table of name/country/task in the
  published form, and the Professional Services Agreement expects several SOWs
  each with their own fees and dates. Both are gathered here as one free-text
  answer. The document that comes out is honest, but it is not the structured
  form Common Paper contemplates. Adding real array fields means breaking
  `merge_patch`'s "always return complete objects" invariant, which the frontend's
  shallow merge depends on — that is the design decision to make first.
- **Some documents are attachments, not agreements.** The SLA's customer,
  provider and subscription period come from a Cloud Service Agreement; the AI
  Addendum layers onto a product agreement; the BAA and DPA supplement an
  existing contract. Each says so on its page and in its prompt, via `attachment`
  in its definition. They still produce a document that references terms defined
  elsewhere. That is inherent to the templates, not a defect to fix in code.
- **The Key Terms page is ours.** Common Paper publishes the standard terms for
  these ten documents but not the fill-in page that accompanies them — only the
  Mutual NDA's cover page is in this repo. `GenericDocument` builds a Key Terms
  page from the field list. It is a faithful presentation of the values the
  contract references, not a reproduction of a published form.
- **The "closest document" suggestion is only as good as the catalog.** Asked for
  a residential lease, the assistant correctly refuses and then offers whatever it
  judges nearest — which may be a poor match, because nothing in a catalog of
  B2B software agreements is close to a lease. The refusal is the part that
  matters; treat the suggestion as a conversation opener.

### Authentication is real, for as long as the container runs

Signing up hashes the password with `hashlib.scrypt` (`app/passwords.py`, stdlib — no new dependency, nothing to compile in the slim image) and stores `scrypt$N$r$p$salt$hash`, parameters and all, so raising the cost later leaves existing hashes verifiable. Signing in re-derives and compares with `hmac.compare_digest`. A hash this code cannot parse fails closed.

A session is an **opaque bearer token** — `secrets.token_urlsafe(32)`, kept in `localStorage`, sent as `Authorization: Bearer`. The `sessions` table holds only `sha256(token)`, so a leaked table is not a working set of credentials. SHA-256 and not scrypt on purpose: 256 random bits have no guessing surface worth slowing every request for. Tokens are opaque rather than signed because that makes sign-out immediate — revoking is deleting the row — and means there is no signing key to keep, which matters when every other piece of state here is deliberately thrown away on restart. `localStorage` rather than an HttpOnly cookie because `next dev` is cross-origin, and a cookie that survives that needs `SameSite=None; Secure`, i.e. HTTPS. The cost is that script on the page could read the token.

**A wrong password is a 401 and an unknown address is a 404**, kept apart deliberately. That lets a caller learn whether an address has an account. It is accepted because the login screen already told people which mistake they made, because merging the two would not close enumeration while signup still answers 409, and because closing it properly is one piece of work with rate limiting. Say so rather than half-fixing it.

**`/api/chat` requires a session since PL-7**, so spending the OpenRouter key takes a registered account rather than only a reachable port. That narrows the hole; it does not close it, because an account is free to make and there is still no rate limit or spend cap. The other bounds are unchanged: the request model's caps on message count and length, plus `normalise`. Rate limiting is now the thing to fix before this is ever exposed.

Still missing: password reset, email verification, rate limiting. And accounts are exactly as temporary as everything else here.

### Where a saved draft lives

`drafts` in SQL and `app/drafts.py` in Python; `/api/documents` at the edge, because "document" is the product's word and `app/documents/` already means the compiled catalog — the same split `routers/auth.py` already makes against `users.py`.

- **Ownership is part of every query, not a check after the fetch.** Every function in `drafts.py` takes a `user_id` that goes into the `WHERE`, so another account's row is never loaded. A mismatch answers **404, never 403** — a 403 would confirm the id belongs to *someone*, turning the autoincrement id into a way to count other people's work.
- **`normalise` runs on the way in and on the way out.** In because a client can send anything; out because what is on disk was written against whatever the catalog said at the time. Both directions return *complete* objects — every field the document defines — which is the invariant the browser's shallow merge depends on. The workspace merges a restored draft onto `createEmptyState` for the same reason.
- A draft whose slug has left the catalog is **410 on open** (the draft is real and yours; the *type* is gone), left out of the list rather than failing it, and still deletable — being unable to open something is no reason to be stuck with it.
- `db.connect` sets `PRAGMA foreign_keys = ON`. It is off per *connection*, not per database, so without it the `ON DELETE CASCADE` in `schema.sql` is silently inert.
- Autosave is debounced a second after the last change, coalescing a turn's document and transcript updates into one request. **Three things stop it losing work**: only one save is in flight at a time, and a change that lands during one sets `owed` so the loop goes round again rather than waiting for the user to say something else; unmount flushes the pending timer, which covers navigating away inside the app; and `pagehide` flushes with `keepalive: true`, which covers closing the tab — that unmounts nothing, and an ordinary fetch started on the way out is cancelled. The `pagehide` flush is skipped while a save is in flight, because a second create before the first returns an id would leave two rows for one conversation.
- A failed save is a quiet mark in the top bar and nothing more — the chat's error bubble and its focus handling are reserved for turns that failed, and the next turn retries the save anyway.
- **Concurrency is last-write-wins.** Two tabs on one draft will overwrite each other. Not worth a version column for a product where nothing survives a restart.

### Conventions worth knowing

- **Two palettes, deliberately.** The colours above are the platform's, used on the login screen and the Documents list (`entry-*` and `library-*`). The drafting workspace keeps its own dark-panel palette so the document beside it reads as paper — don't "correct" it to brand colours. Note `#888888` is only 3.5:1 on a light card, so body copy uses a darkened sibling. PL-7's polish reached the shell, the entry screen and the list; the chat panel and the `.doc` surface were left alone, for the reason this bullet already gives. The one thing spanning both worlds is the top bar (`topbar-*`), which stays in the machine palette on every screen — following the surface under it would make the two read as different applications.
- **The disclaimer is on the paper, not just in the app.** `DRAFT_DISCLAIMER` in `chat-copy.ts` is one constant rendered by `Disclaimer.tsx` inside *both* renderers, so the wording cannot drift between the Mutual NDA's hand-built page and the ten generated ones. It is on the document because the PDF is the copy that leaves this product, and that is the copy the warning has to reach; it is in the print rules' `break-inside: avoid` group so it is never split across a page.
- **`frontend/lib/nda/standard-terms.test.ts` diffs the contract text against `templates/mutual-nda.md`.** If it fails, read both before touching the expectation — that is a decision to change contract wording. The other ten documents get the same guarantee a different way: `test_documents_parse.py` parses the whole corpus and fails if any word of a template is lost or any markup leaks into the page.
- **Adding a document is a definition file, not a code change.** Drop the template in `templates/`, write `definitions/<slug>.toml`, run the build. The build tells you exactly which variables you have not accounted for.
- `frontend/TESTING.md` holds the manual checklist that automation cannot reach: print/PDF output, narrow screens, keyboard and screen reader, and the assistant's actual behaviour — no test calls a real model.
- `*.sh` is pinned to LF in `.gitattributes` and the scripts carry the exec bit. A CRLF shebang is unrunnable on macOS and Linux, and this repo is edited on Windows.

### Not built yet

Rate limiting or spend control on `/api/chat` — narrower now that it takes a
session, but an account is free to make, so this is shrunk rather than solved,
and it is the next thing to build. Password reset and email verification.
Structured repeating fields (see "Where the generated documents fall short").
And durable storage of any kind: accounts, sessions and saved drafts all come
back empty from `schema.sql` on every startup, which PL-7 did not change and
which is still deliberate.
