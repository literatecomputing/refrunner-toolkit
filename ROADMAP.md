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

## Overleaf: wait for evidence first

Written Oct 4 2026, after [OverCite](https://github.com/cheyanneshariat/OverCite). OverCite is
a Chrome/Firefox/VS Code extension: type `\citep{Dirac1928}`, press Alt+Shift+E, pick from NASA
ADS/SciX (an API token is needed), and it writes the entry into the project's `.bib`. RefRunner
already has the server half: a saved list's `.bib` at a secret link
(`hub.refrunner.com/citation-wizard/bib/<token>.bib`), which Overleaf's free plan adds with New
file → From External URL. What's missing is the editor half.

**Don't start until someone other than Jay uses the Overleaf link.** To know that, the plugin's
`bibs_controller` should record each fetch of a link (count and last fetch, per saved list), and
the Visitors page should show them. Overleaf's fetches come from its servers, so a fetch means a
project really uses the link.

### Step 1: Refresh for you (small)

The one manual step left is clicking Refresh on the linked file in Overleaf.

- An optional host permission, `https://www.overleaf.com/project/*`, is requested only when the
  user turns on "Overleaf" in the popup. The base install stays narrow for the store review.
- On an Overleaf project page, find the linked files whose source is a RefRunner `.bib` link,
  and refresh them. To verify first: Overleaf's linked-file refresh is a private endpoint
  (something like `POST /project/<id>/linked_file/<file_id>/refresh`, using the page's CSRF
  token). If it's unusable, click the file's own Refresh button instead.
- When: a popup button ("Refresh RefRunner .bib"). Later, automatically after the RefRunner tab
  saves: the app posts a message, and the extension refreshes the open Overleaf tab.
- Fragile by nature: keep it in one function, and when it fails, say "click Refresh on the file
  yourself" rather than failing silently.

### Step 2: Cite from the editor (OverCite's workflow, with checking)

- A shortcut in the Overleaf editor reads the `\cite{…}` argument at the cursor, or the selected
  text ("Dirac 1928").
- It opens RefRunner's Live Search with that query (the app's `#refs=` search already does this:
  `liveSearchQueryFor`). The user picks a paper, which is added to the open list, checked, and
  the list saves itself and republishes the `.bib`.
- The app sends back the reference's frozen cite key (`bibKey`, which `buildBib` sets on first
  publish). The extension writes it into the `\cite{}` (CodeMirror 6: `insertText` into the
  focused editor), then runs Step 1 so `\cite` resolves on the next compile.

### Not doing

Writing entries into the project's `.bib` text directly, as OverCite does. The RefRunner list
stays the one source of truth, and the link serves it; otherwise the two copies drift apart.

## Later (not started)

- Firefox build (MV3 is close; `background.service_worker` → `background.scripts`).
- Show retraction / Crossref "updated-by" status in the popup.
- Unpaywall OA link in the popup.
- Badge on the toolbar icon when the current page has a DOI.
