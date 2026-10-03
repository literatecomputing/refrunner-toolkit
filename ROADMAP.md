# Roadmap

## Done: Phase 2 — add to an already-open RefRunner tab

Shipped October 2026 (`handToOpenTab` here, `TabHandoff` in the app). Original plan kept below.

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

## When the store listing is live: an install prompt in RefRunner

Once the Chrome Web Store approves the extension, have the RefRunner app (reference-assistant)
offer it the way Google Scholar offers its button: a small dismissible card with the logo,
"RefRunner Toolkit", **Install** (to the store listing) and **No thanks**, plus a sketch of
the popup over a reference list (Check / Search / Open).

- Show it only in desktop Chrome (and Chromium browsers that use the Chrome store), only when
  the extension isn't already installed, and never again after "No thanks" (remember that in
  the app's own storage).
- Good places: after someone pastes a reference list by hand, and on the landing/getting
  started pages.
- Extension side, so the app can tell it's installed: add
  `"externally_connectable": { "matches": ["https://www.refrunner.com/*"] }` to the manifest
  and answer a `{ type: "ping" }` in `chrome.runtime.onMessageExternal` with the version. The
  app calls `chrome.runtime.sendMessage(EXTENSION_ID, { type: "ping" })`; no answer means not
  installed. (The page can't otherwise see extensions; this adds no install warning.)
- Needs the listing's URL and the store extension ID, which only exist after approval.

## Later (not started)

- Firefox build (MV3 is close; `background.service_worker` → `background.scripts`).
- Show retraction / Crossref "updated-by" status in the popup.
- Unpaywall OA link in the popup.
- Badge on the toolbar icon when the current page has a DOI.
