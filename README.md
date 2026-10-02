# RefRunner Toolkit

A Chrome extension for getting from an article to its records:

- **Toolbar button** (Alt+Shift+D): finds the DOI or OpenAlex ID for the page you're on and offers
  the OpenAlex API record, OpenAlex page, Crossref search, Crossref API record, doi.org, and
  "Send to RefRunner". It shows the work's title and fills in whichever of DOI / OpenAlex ID
  the page didn't have.
- **Right-click** a selection or a link → *RefRunner Toolkit* → same destinations. Selections can be one
  DOI, several DOIs, an OpenAlex ID, a URL, or whole citations.
- **Alt+Shift+O** jumps straight to the OpenAlex API record for the current page.

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

None. RefRunner picks the citation style. To point at a dev server, edit `REFRUNNER_BASE` in
`lib/doi.js` (and don't package that). Ctrl/Cmd-click or middle-click a popup link to open it in
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
