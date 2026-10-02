# Roadmap

## Next: Phase 2 — add to an already-open RefRunner tab

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

## Later (not started)

- Firefox build (MV3 is close; `background.service_worker` → `background.scripts`).
- Show retraction / Crossref "updated-by" status in the popup.
- Unpaywall OA link in the popup.
- Badge on the toolbar icon when the current page has a DOI.
