# CLAUDE.md

Context for working on RefRunner Toolkit. See README.md for what it does and how to install it.

## Layout

| File | Role |
|---|---|
| `manifest.json` | MV3. Permissions: `activeTab`, `scripting`, `contextMenus`, `storage` (only for the dev-server checkbox). Host permission for www.refrunner.com only; localhost:5173 optional. |
| `lib/doi.js` | **Pure** parsing and URL building. No `chrome.*` here so it stays unit-testable in Node. |
| `lib/chrome.js` | Page detection (injects a meta-tag reader), OpenAlex lookup, tab opening. |
| `background.js` | Service worker (ES module): context menu and `openalex-api` shortcut. |
| `popup.*` | Toolbar popup. Detects, renders immediately, then enriches from OpenAlex and re-renders. |
| `overflow.*` | Shown when a reference list is too long for a RefRunner URL: copy, then open `/check`. |
| `ui.css` | Shared styles with light/dark tokens. |
| `tests/doi.test.js` | `node --test` unit tests for `lib/doi.js`. Run `npm test` after any parser change. |
| `tests/smoke.mjs` | Playwright end-to-end run in real Chromium, OpenAlex mocked. `npm run smoke`. |

## Decisions worth keeping

- **One host permission: www.refrunner.com.** Everything else rides on `activeTab`, which Chrome
  grants when the user clicks the button, uses a context-menu item, or presses a shortcut, so the
  install prompt never says "read and change all your data". The RefRunner permission (Oct 2026)
  lets a send go to a RefRunner tab that is already open (`handToOpenTab`): it posts
  `{ type: "refrunner-import", text }` to the tab, which the app takes if it has marked
  `<html data-refrunner-handoff="1">`; otherwise a new tab opens as before. The other direction:
  `lib/marker.js`, a content script on www.refrunner.com, sets `<html data-refrunner-toolkit="<version>">`
  at document_start so the app knows the Toolkit is installed (and skips its install tip); for the
  dev server it's registered at runtime while the localhost permission is granted. The dev server
  (`https://localhost:5173`) is an `optional_host_permissions` entry that the dev checkbox requests,
  so store installs never list localhost. Don't add other hosts without a strong reason.
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
- **OpenAlex web search** is `openalex.org/works?search=<text>` (checked Oct 2026): the popup's
  Search section and the context menu's "OpenAlex page" for plain text use it.
- **Registry-aware links.** `doi.org/ra/<DOI>,<DOI>` says who registered each DOI; DataCite DOIs
  (arXiv, Zenodo, Dryad, datasets) get DataCite links instead of Crossref ones, which would find
  nothing. Until the lookup answers we assume Crossref, except `10.48550/` (arXiv), always DataCite.
- **Free copies come from the same OpenAlex lookup** (`select=…,locations`; no extra request,
  no new permission, and the PDF is only a link). `freeCopies()` lists every direct `pdf_url`
  plus PubMed Central / Europe PMC full text, repositories before the publisher, at most three.
  Other "open" landing pages are skipped because OpenAlex marks index listings (DOAJ,
  FAIRsharing) open too, and `version` is a tooltip hint only (it calls PMC copies "submitted").
- **The privacy policy lives in the app**, at https://www.refrunner.com/privacy-policy#chrome-extension
  (reference-assistant, `PrivacyPolicyPage.jsx`); the Web Store listing links there. If the
  extension starts reading or sending anything new (a new `fetch`, a new permission), update
  that section too. Store listing text and images are in `store/`;
  releasing (tag → CI uploads to the store) is in `store/PUBLISHING.md`.

Planned work lives in ROADMAP.md.
