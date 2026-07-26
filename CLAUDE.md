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

### How it fits together

- `backend/` is a uv project. FastAPI serves `/api/*` and the built frontend from one origin on port 8000 — no reverse proxy, no Node at runtime. Stdlib `sqlite3` plus a small repository in `app/users.py`; no ORM.
- The database is deleted and recreated from `app/schema.sql` on **every startup**, with no volume over it. Nothing survives a restart. Settings: `PRELEGAL_DATABASE_PATH`, `PRELEGAL_FRONTEND_DIR`, `PRELEGAL_DEV_ORIGINS` — all optional, all defaulting to the repo layout. `OPENROUTER_API_KEY` is optional in the sense that the app starts and serves without it, but the chat cannot answer, and the chat is the only way to fill a document in.
- `frontend/` exports to static files (`output: "export"`, `trailingSlash: true`). `/` is the login screen, `/draft/` the workspace — one route for every document, since which one you are drafting is session state and nothing is persisted.
- Run it with the `scripts/` above; run the tests with `cd backend && uv run pytest` (197) and `cd frontend && npm test` (249).

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

- `POST /api/chat` is **stateless**. The browser sends the transcript, the document slug, *and* every value the document holds, so the agreement — not the model's memory of the conversation — is what is known. Nothing is stored at either end; a reload loses everything.
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
should be corrected. The notice above the chat says so in the product; keep it
visible and keep it honest as scope grows.

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

### There is no authentication yet

`/api/auth/signup` and `/api/auth/login` create and look up accounts for real, but the password is **never stored, hashed, or compared** — there is no password column. Knowing an email address is enough to sign in as it, and the login screen says so. Adding real auth means changing those two function bodies, not the wiring.

**Since PL-5 that has a cost attached.** `/api/chat` takes no session and has no rate limit, so anyone who can reach the port can spend the OpenRouter key. The only bounds today are the request model's caps on message count and length, plus `normalise`, which keeps only the fields the chosen document defines and clamps each one — so the prompt is bounded by the document rather than by whatever the client sent. That is fine on localhost and not fine on a public address — this is the thing to fix before the app is ever exposed, ahead of the login screen itself.

### Conventions worth knowing

- **Two palettes, deliberately.** The colours above are the platform's, used on the login screen. The drafting workspace keeps its own dark-panel palette so the document beside it reads as paper — don't "correct" it to brand colours. Note `#888888` is only 3.5:1 on a light card, so body copy uses a darkened sibling.
- **`frontend/lib/nda/standard-terms.test.ts` diffs the contract text against `templates/mutual-nda.md`.** If it fails, read both before touching the expectation — that is a decision to change contract wording. The other ten documents get the same guarantee a different way: `test_documents_parse.py` parses the whole corpus and fails if any word of a template is lost or any markup leaks into the page.
- **Adding a document is a definition file, not a code change.** Drop the template in `templates/`, write `definitions/<slug>.toml`, run the build. The build tells you exactly which variables you have not accounted for.
- `frontend/TESTING.md` holds the manual checklist that automation cannot reach: print/PDF output, narrow screens, keyboard and screen reader, and the assistant's actual behaviour — no test calls a real model.
- `*.sh` is pinned to LF in `.gitattributes` and the scripts carry the exec bit. A CRLF shebang is unrunnable on macOS and Linux, and this repo is edited on Windows.

### Not built yet

Real authentication, any rate limiting or spend control on the chat endpoint,
structured repeating fields (see "Where the generated documents fall short"),
and persistence of any kind — including the conversation and the chosen
document, both lost on reload.
