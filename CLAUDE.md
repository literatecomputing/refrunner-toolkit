# CLAUDE.md

Context for working on RefRunner Toolkit. See README.md for what it does and how to install it.

## Layout

| File | Role |
|---|---|
| `manifest.json` | MV3. Permissions: `activeTab`, `scripting`, `contextMenus`, `storage` (only for the dev-server checkbox). No host permissions. |
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
  `Access-Control-Allow-Origin: *`. So does doi.org/ra (registry lookup, batched with commas)
  and Crossref's API.
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
- **Registry-aware links.** `doi.org/ra/<DOI>,<DOI>` says who registered each DOI; DataCite DOIs
  (arXiv, Zenodo, Dryad, datasets) get DataCite links instead of Crossref ones, which would find
  nothing. Until the lookup answers we assume Crossref, except `10.48550/` (arXiv), always DataCite.

Planned work lives in ROADMAP.md.
