# RefRunner Toolkit

A Chrome extension for getting from an article to its records:

- **Toolbar button** (Alt+Shift+D): uses the text you've selected, if any; otherwise finds the DOI or
  OpenAlex ID for the page you're on. It offers
  the OpenAlex API record and page, the Crossref or DataCite record (whichever registry holds the
  DOI, per doi.org), doi.org, Google Scholar, and "Send to RefRunner". It shows the work as
  "Author (year). Title" and fills in whichever of DOI / OpenAlex ID the page didn't have.
- **More searches**, for text: the other places RefRunner suggests when it can't find a
  reference — Semantic Scholar, Google, JSTOR, ERIC, Library of Congress, Open Library, Google
  Books, ResearchGate — each with a link to its raw API results where it has a public one. (The
  keyless Semantic Scholar and Google Books APIs are rate-limited and sometimes answer 429.)
  A DOI gets its Semantic Scholar API record.
- **Right-click** a selection or a link → *RefRunner Toolkit* → same destinations. Selections can be one
  DOI, several DOIs, an OpenAlex ID, a URL, or whole citations.
- **Alt+Shift+O** jumps straight to the OpenAlex API record for the current page.
- **Alt+Shift+C** ("check") sends the selection (or, with nothing selected, the page's DOI) straight to RefRunner.

If a RefRunner tab is already open, what you send goes there instead of a new tab: references join
that tab's list, and a name, title or keywords land in its Live Search. A list too long for a link
needs no copying then. Ctrl/Cmd-click or middle-click a popup link for a new tab anyway.

## Install (unpacked)

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and pick this folder.
3. Pin the extension from the puzzle-piece menu if you want the button visible.

After editing files, click the reload arrow on the extension's card (popup changes show up on
the next open; background changes need the reload).

## Where the DOI comes from

1. The page URL (`/doi/10.1111/...`, `doi.org/...`, `?q=10....`), with landing-page junk like
   `/full`, `/abstract`, `/epdf`, `.pdf` and `?scroll=top` stripped.
2. arXiv URLs, mapped to `10.48550/arXiv.<id>`.
3. The page's `citation_doi` / `dc.identifier` / `prism.doi` meta tags (covers ScienceDirect and
   most publishers whose URLs have no DOI).

OpenAlex pages (`openalex.org/works/W…`, `api.openalex.org/w…`, `?zoom=w…`) give the W-id
directly; authors, sources, institutions etc. work too.

## Settings

None. RefRunner picks the citation style. Unpacked (development) installs show a "Send to dev
server" checkbox in the popup footer that points RefRunner links at `https://localhost:5173`; it's
hidden in Web Store installs. Ticking it asks once for access to localhost, so sends can reach an
open dev-server tab; decline and they open new tabs. Ctrl/Cmd-click or middle-click a popup link to open it in
the background and keep the popup open.

## Development

```
npm test          # parser unit tests (no dependencies)
npm run smoke     # end-to-end in real Chromium; first: npm i -D playwright && npx playwright install chromium
npm run package   # dist/refrunner-toolkit.zip for the Chrome Web Store
```

## License

The code is MIT licensed (see LICENSE). The RefRunner name and logo (`icons/`) are not covered by
that license; please don't use them for a fork you publish.
