# Testing the frontend

## Automated

```bash
npm test          # once
npm run test:watch
```

249 tests across twelve files. What they cover:

| File | Covers |
| --- | --- |
| `lib/documents/values.test.ts` | Starting values and defaults, what counts as answered, required-field counting, date and number formatting, how a value reads in the agreement |
| `lib/documents/render.test.ts` | First-use expansion of defined terms, keeping the template's own inflection, emphasis across a value, unknown keys, document title, lazy clause loading |
| `lib/documents/chat-copy.test.ts` | The greeting, the privacy notice, and how the "still missing" sentence reads |
| `lib/nda/render.test.ts` | Date formatting and timezone safety, number-to-words, term phrasing, the clause tokenizer, first-use expansion, unusable term lengths, document title |
| `lib/nda/standard-terms.test.ts` | **Diffs the transcribed legal text against `templates/mutual-nda.md`**, clause by clause |
| `lib/nda/chat-support.test.ts` | Which clauses a change marks in the Mutual NDA |
| `components/NdaDocument.test.tsx` | Rendered cover page and clauses, blanks, checkbox states, signature block, CC BY attribution, cover-page fidelity |
| `components/ChatPanel.test.tsx` | The panel alone: the transcript, who-said-what for screen readers, Enter and Shift+Enter, the pending and failed states |
| `components/DocumentWorkspace.test.tsx` | The whole journey with the assistant substituted: choosing a document, a request we cannot meet, generic and Mutual NDA rendering, clause marking, download gating, focus, the completion message, retrying a failed turn, PDF filename |
| `components/LoginScreen.test.tsx` | Signing in, creating an account, switching between the two, server refusals, the already-signed-in state, and the notice about there being no authentication |
| `lib/api.test.ts` | Request shape, snake_case to camelCase, the chat turn's request and reply, which server errors are shown verbatim and which are replaced, an unreachable server |
| `lib/session.test.ts` | Round trip through storage, and every way a stored value can be unusable |

**No test calls a real model.** `DocumentWorkspace.test.tsx` mocks `sendChatTurn`, and
the backend suite substitutes the completion function. What the assistant would
actually say is not something these tests have an opinion about; what the app does
with what it says is all of it.

The backend has its own suite — see the root [README](../README.md).

### About the fidelity test

`standard-terms.test.ts` exists because an accidental edit to the clause text
would ship altered contract language to whoever signs the output, and no UI test
would notice. It reverses our `{{token}}` markup back to the source's wording and
diffs each clause against `templates/mutual-nda.md`. The only tolerated
differences are listed in `DOCUMENTED_DEVIATIONS` in that file.

**If it fails, read both texts before touching the expectation.** Adding a
deviation is a decision to change contract wording.

The Cover Page is hand-written JSX and cannot be diffed the same way, so it is
pinned by assertions in `NdaDocument.test.tsx` instead. That gap is why the
cover-page wording drifted once already.

## Manual

Automation cannot reach these. Run them before releasing, and after any change to
`app/globals.css` or the print rules.

```bash
npm run dev    # http://localhost:3000
```

Sign in first — the workspace is at `/draft/` and sends you back to `/` without a
session. `npm run dev` needs the backend running on port 8000 for that, and the
backend needs `OPENROUTER_API_KEY` for the chat to answer at all; the root
[README](../README.md) covers both.

### 1. Print and PDF output — highest priority

The print stylesheet is the least testable and most fragile part of the app.
`@media print` rules do not run under jsdom, and pagination cannot be simulated.

- [ ] Fill the agreement in through the chat, click **Download PDF**, choose **Save as PDF**
- [ ] Suggested filename is `<Document> - <Party 1> and <Party 2>`
- [ ] Repeat for a generically rendered document (a Pilot Agreement, say): nested
      clause numbering stays aligned and indented in print
- [ ] The app chrome (top bar, chat panel) does not appear anywhere in the PDF
- [ ] Standard Terms start on a fresh page
- [ ] **No clause is split across a page break**, and no heading is stranded at the foot of a page
- [ ] The signature table is not split across a page break
- [ ] Signature and Date cells are blank and tall enough to sign in
- [ ] The CC BY 4.0 attribution is present in the PDF
- [ ] Blue values are legible when printed in greyscale
- [ ] Repeat with a long Purpose and long modifications text, which changes where pages break
- [ ] Repeat with the perpetual and open-ended term options chosen

### 2. Narrow screens

Never exercised. Verify at 375px, 768px, and either side of the 960px breakpoint.

- [ ] Below ~960px the chat panel stacks above the document
- [ ] Stacked, the panel keeps a height of its own and the composer stays reachable — it must not stretch to the length of the conversation
- [ ] The page scrolls normally when stacked — the two-column layout pins the shell to the viewport height, and that must not leak into the stacked layout
- [ ] Nothing overflows horizontally
- [ ] The top bar wraps without overlapping the Download button
- [ ] Printing still works from a narrow viewport

### 3. Keyboard and screen reader

This is where the chat costs the most. It replaced a form of labelled fields —
which screen readers navigate very well — with a log and one text box, and only
manual testing will say whether that trade landed. Automated tests assert the ARIA
attributes exist; they cannot confirm the experience.

- [ ] Tab order runs chat box → Send → Download, and nothing is skipped or trapped
- [ ] The focus ring is clearly visible on the box, Send, and Try again
- [ ] A new reply is announced once, as one message — not the whole conversation re-read
- [ ] The waiting state is announced ("Assistant is replying…"), not just shown as dots
- [ ] Each message is attributed — you can tell who said what without seeing the layout
- [ ] Click Download with the agreement incomplete: the missing fields are announced and focus lands in the chat box
- [ ] Stop the backend and send: the failure is announced as an alert and **Try again** is reachable by keyboard
- [ ] Long replies do not scroll the log out from under the reader
- [ ] The document does not chatter as it fills in (it is deliberately not a live region)
- [ ] Run axe DevTools on the page in the empty, mid-conversation, and complete states

### 3a. The assistant

None of this is covered automatically — every test substitutes the model.

**Choosing a document** (new in PL-6):

- [ ] Ask for something we have no template for ("a residential lease", "an
      employment contract") — it says plainly that it cannot draft it, names the
      closest thing it can, and asks whether to start that. It must never imply
      it can produce something outside the catalog
- [ ] Ask vaguely ("I need some paperwork") — it asks what you are trying to
      achieve rather than guessing
- [ ] Ask in your own words ("let a customer try our product for a month") — it
      picks the Pilot Agreement and asks the first question in the same reply
- [ ] Draft each of the eleven documents at least once: the Key Terms page fills
      in, the standard terms resolve, and nothing renders as raw markup
- [ ] On an attachment (SLA, AI Addendum, BAA, DPA), it says the document
      accompanies another agreement rather than standing alone

**Filling one in:**

- [ ] The greeting appears instantly, with the backend stopped
- [ ] **Every reply ends with a question** while anything required is still
      missing — the one thing a conversation-only product cannot get wrong
- [ ] After a reply lands, the cursor is back in the composer: you can type the
      next answer without reaching for the mouse
- [ ] It does not march through optional fields one at a time — it offers them
      together once the required ones are done
- [ ] Say everything at once ("Acme and Beta, I sign as CEO, Delaware law…") — it fills in what you gave and asks only for the rest
- [ ] Correct something already answered ("no, make it New York") — the document changes and it confirms
- [ ] Ask it for advice ("what term should I pick?") — it declines rather than recommending
- [ ] Ask it something off-topic — it does not wander off the document
- [ ] Watch the Standard Terms as an answer lands: the clauses it feeds are marked, then unmark
- [ ] Unset `OPENROUTER_API_KEY` and restart: sending says the assistant is not configured, and the app is otherwise intact
- [ ] Go offline mid-conversation: the failure names an unreachable server, your message is still there, and **Try again** resends it
- [ ] Reload the page: the conversation is gone and the document is blank again — nothing persists, by design

### 4. Browsers

Only Chrome has been exercised.

- [ ] Chrome — form, live document, print
- [ ] Firefox — especially `@page` margins and `break-inside`
- [ ] Safari — especially `100dvh` on the shell and `color-mix()` in the underline colour
- [ ] Edge

### 5. Real-world content

- [ ] Long company names (60+ characters) do not break the signature table
- [ ] A multi-paragraph Purpose renders and prints sensibly
- [ ] Non-ASCII names and addresses (accents, non-Latin scripts) render in the chosen fonts
- [ ] Right-to-left text degrades acceptably
- [ ] A very large year count (e.g. 99) reads correctly in both the cover page and clause 5

### 6. Login screen

Covered by `LoginScreen.test.tsx` with the router and API mocked, so the real
round trip and the layout still need eyes.

- [ ] Create an account, then restart the container and confirm the same email is
      unknown again — the accounts really are temporary
- [ ] Sign in with the wrong password: it works, and the notice on the card says
      why. If that ever stops being true, this file is out of date
- [ ] Stop the backend and submit: the message names an unreachable server rather
      than showing a raw fetch error
- [ ] Visit `/draft/` in a fresh profile: it redirects to `/` without flashing the
      workspace
- [ ] Already signed in, visit `/`: "Welcome back" appears without flashing the form
- [ ] The card is usable at 375px
- [ ] Tab order runs email → password → submit → switch link, and the focus ring is
      visible on the purple button

### 7. Legal review — not an engineering task

- [ ] A lawyer confirms the two documented clause 9 deviations ("such State", "such courts") are acceptable
- [ ] A lawyer confirms resolving cover-page references inline in the Standard Terms does not change their meaning
