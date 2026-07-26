# Testing the frontend

## Automated

```bash
npm test          # once
npm run test:watch
```

197 tests across eight files. What they cover:

| File | Covers |
| --- | --- |
| `lib/nda/render.test.ts` | Date formatting and timezone safety, number-to-words, term phrasing, the clause tokenizer, first-use expansion of defined terms, unusable term lengths, document title |
| `lib/nda/validate.test.ts` | Every required field, whitespace-only answers, year-count rules, error ordering (which decides where focus lands) |
| `lib/nda/standard-terms.test.ts` | **Diffs the transcribed legal text against `templates/mutual-nda.md`**, clause by clause |
| `components/NdaDocument.test.tsx` | Rendered cover page and clauses, blanks, checkbox states, signature block, CC BY attribution, cover-page fidelity |
| `components/NdaWorkspace.test.tsx` | The whole journey through the real UI: typing, live document updates, clause linking, download gating, focus management, PDF filename |
| `components/LoginScreen.test.tsx` | Signing in, creating an account, switching between the two, server refusals, the already-signed-in state, and the notice about there being no authentication |
| `lib/api.test.ts` | Request shape, snake_case to camelCase, which server errors are shown verbatim and which are replaced, an unreachable server |
| `lib/session.test.ts` | Round trip through storage, and every way a stored value can be unusable |

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

Sign in first — the workspace is at `/nda/` and sends you back to `/` without a
session. `npm run dev` needs the backend running on port 8000 for that; the root
[README](../README.md) covers starting it.

### 1. Print and PDF output — highest priority

The print stylesheet is the least testable and most fragile part of the app.
`@media print` rules do not run under jsdom, and pagination cannot be simulated.

- [ ] Fill in every field, click **Download PDF**, choose **Save as PDF**
- [ ] Suggested filename is `Mutual NDA - <Party 1> and <Party 2>`
- [ ] The app chrome (top bar, form panel) does not appear anywhere in the PDF
- [ ] Standard Terms start on a fresh page
- [ ] **No clause is split across a page break**, and no heading is stranded at the foot of a page
- [ ] The signature table is not split across a page break
- [ ] Signature and Date cells are blank and tall enough to sign in
- [ ] The CC BY 4.0 attribution is present in the PDF
- [ ] Blue values are legible when printed in greyscale
- [ ] Repeat with a long Purpose and long modifications text, which changes where pages break
- [ ] Repeat with the perpetual and open-ended term options selected

### 2. Narrow screens

Never exercised. Verify at 375px, 768px, and either side of the 960px breakpoint.

- [ ] Below ~960px the form stacks above the document
- [ ] The page scrolls normally when stacked — the two-column layout pins the shell to the viewport height, and that must not leak into the stacked layout
- [ ] Nothing overflows horizontally
- [ ] The top bar wraps without overlapping the Download button
- [ ] Printing still works from a narrow viewport

### 3. Keyboard and screen reader

Automated tests assert the ARIA attributes exist; they cannot confirm the
experience.

- [ ] Tab through the whole form — order is sensible, nothing is skipped or trapped
- [ ] The focus ring is clearly visible on every control, on both the dark panel and the paper
- [ ] Click Download with fields empty: focus lands on the first missing field and the screen reader announces "Required"
- [ ] Clear the years field and Download: the reason is announced, not just an invalid state
- [ ] The radio groups announce their legends
- [ ] The document does not chatter on every keystroke (it is deliberately not a live region)
- [ ] Run axe DevTools on the page in both empty and complete states

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
- [ ] Visit `/nda/` in a fresh profile: it redirects to `/` without flashing the
      workspace
- [ ] Already signed in, visit `/`: "Welcome back" appears without flashing the form
- [ ] The card is usable at 375px
- [ ] Tab order runs email → password → submit → switch link, and the focus ring is
      visible on the purple button

### 7. Legal review — not an engineering task

- [ ] A lawyer confirms the two documented clause 9 deviations ("such State", "such courts") are acceptable
- [ ] A lawyer confirms resolving cover-page references inline in the Standard Terms does not change their meaning
