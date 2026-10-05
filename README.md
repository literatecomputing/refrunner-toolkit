# RefRunner Toolkit

A Chrome extension for getting from an article to its records:

- **Toolbar button** (Alt+Shift+D): uses the text you've selected, if any; otherwise finds the DOI or
  OpenAlex ID for the page you're on. It offers
  the OpenAlex API record and page, the Crossref or DataCite record (whichever registry holds the
  DOI, per doi.org), Google Scholar, and "Send to RefRunner". It shows the work as
  "Author (year). Title" and fills in whichever of DOI / OpenAlex ID the page didn't have; with a
  DOI, **Open ↗** on the title line opens it at doi.org.
- **Search / API**, for text: every place RefRunner suggests when it can't find a reference —
  Crossref, Google Scholar, Semantic Scholar, Google, JSTOR, ERIC, Library of Congress, Open
  Library, Google Books, ResearchGate — under *Search*, and the raw results of those with a keyless
  public API (OpenAlex, Semantic Scholar, ERIC, LC, Open Library, Google Books) under *API*. (The
  Semantic Scholar and Google Books APIs are rate-limited and sometimes answer 429.) A DOI gets
  the places that look works up by DOI: Google Scholar, Semantic Scholar, Google, PubMed, Europe
  PMC and Wikidata under Search, and their APIs plus OpenCitations' citation count under API. The context menu's *More
  searches* submenu has the search pages.
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

Catalog record pages are looked up in the catalog's API: Open Library editions
(`openlibrary.org/books/OL…M`) and ERIC records (`eric.ed.gov/?id=ED…` or `EJ…`). A record with a
DOI is then handled like an article page; otherwise it becomes a citation (authors, year, title,
journal or publisher, ISBN), which goes to RefRunner and to the catalog searches. The same goes
for such a link (or a bare ERIC number like `ED591473`) that you select, paste, or right-click.

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
