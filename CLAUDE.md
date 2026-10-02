# CLAUDE.md

Context for working on RefRunner Toolkit. See README.md for what it does and how to install it.

## Layout

| File | Role |
|---|---|
| `manifest.json` | MV3. Permissions: `activeTab`, `scripting`, `contextMenus`. No host permissions, no storage. |
| `lib/doi.js` | **Pure** parsing and URL building. No `chrome.*` here so it stays unit-testable in Node. |
| `lib/chrome.js` | Page detection (injects a meta-tag reader), OpenAlex lookup, tab opening. |
| `background.js` | Service worker (ES module): context menu and `openalex-api` shortcut. |
| `popup.*` | Toolbar popup. Detects, renders immediately, then enriches from OpenAlex and re-renders. |
| `overflow.*` | Shown when a reference list is too long for a RefRunner URL: copy, then open `/check`. |
| `ui.css` | Shared styles with light/dark tokens. |
| `tests/doi.test.js` | `node --test` unit tests for `lib/doi.js`. Run `npm test` after any parser change. |
| `tests/smoke.mjs` | Playwright end-to-end run in real Chromium, OpenAlex mocked. `npm run smoke`. |

## Decisions worth keeping

- **No host permissions.** Everything rides on `activeTab`, which Chrome grants when the user clicks
  the button, uses a context-menu item, or presses a shortcut. That keeps the install prompt
  free of "read and change all your data". Don't add `host_permissions` without a strong reason.
  (The smoke test adds `<all_urls>` to its throwaway copy only, because Playwright can't click
  the toolbar button to grant `activeTab`.)
- **OpenAlex fetches need no permission** because api.openalex.org sends
  `Access-Control-Allow-Origin: *`. Crossref's API does too, if we ever want lookups there.
- **Selections are re-read from the page.** `info.selectionText` collapses line breaks, which
  would merge a reference list into one line. `fullSelection()` in background.js calls
  `getSelection()` in the clicked frame and falls back to `selectionText` (PDF viewer,
  `<input>`/`<textarea>`, chrome:// pages).
- **RefRunner URL recipe** comes from https://www.refrunner.com/llms.txt:
  `/<DOI>`, `/cite/<DOI>,<DOI>`, or `/#refs=<percent-encoded, one per line>`; `?style=<id>` before
  the `#`. Fragment form keeps the list out of server logs. Limit ~8,000 chars, after which we
  route to `overflow.html` → `/check`. We tag links `utm_source=chrome-extension`.
- **Bare OpenAlex W-ids are translated to DOIs** (OpenAlex lookup) before going to Crossref,
  doi.org or RefRunner, since those only understand DOIs.
- **parseText decides "ids only" vs "citation text".** If anything besides identifiers and
  separators is selected, RefRunner gets the full text via `#refs=` (so it verifies the whole
  citation), not just the DOI.
- **Context-menu "OpenAlex page" for plain text** falls back to an API search because we don't
  know a stable search URL for the new OpenAlex web UI. Swap in a web URL if one exists.
- arXiv DOIs (`10.48550/...`) are DataCite, so Crossref search won't find them; OpenAlex and
  doi.org will.

## Phase 2: add to an already-open RefRunner tab

Goal: "Send to RefRunner" appends to the list in an open RefRunner tab instead of opening a new
check.

Proposed design:

1. **RefRunner side (reference-assistant repo):** add a `#add=<percent-encoded refs or DOIs>`
   fragment handler (listen on load and `hashchange`), which runs each entry through the same
   path as adding a search result, then clears the hash with `history.replaceState`. This works
   without the extension too (bookmarklets, other tools). Document it in llms.txt.
2. **Extension side:** in `sendToRefRunner()`, `chrome.tabs.query({ url: `${base}/*` })`. If a tab
   exists, `chrome.tabs.update(id, { url: `${base}/${currentPathAndQuery}#add=…`, active: true })`
   (changing only the hash doesn't reload the app) and focus its window; otherwise fall back to
   today's behavior. Note `tabs.query` by URL needs the `tabs` permission or host permission for
   refrunner.com; add `"host_permissions": ["https://www.refrunner.com/*"]` (narrow, low-friction
   prompt) rather than `tabs`.
3. Consider an option: "Add to open RefRunner tab" vs. "Always open a new check".

## Other ideas (not started)

- Firefox build (MV3 is close; `background.service_worker` → `background.scripts`).
- Show retraction / Crossref "updated-by" status in the popup.
- Unpaywall OA link in the popup.
- Badge on the toolbar icon when the current page has a DOI.
