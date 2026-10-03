# Chrome Web Store listing

Copy each block into the matching field of the developer dashboard
(https://chrome.google.com/webstore/devconsole). Images in this folder come from
`node store/shots.mjs`.

## Store listing tab

**Name** (from the manifest): RefRunner Toolkit

**Summary** (from the manifest, 132 characters max):
Check a selected reference list in RefRunner, or jump from a page's DOI or OpenAlex ID to OpenAlex, Crossref, DataCite, and Scholar.

**Category:** Productivity → Education (or Tools)

**Language:** English

**Description:**

```
Select a reference list on any page and check it in RefRunner with one keystroke. On an article page, get straight to its records in OpenAlex, Crossref or DataCite, doi.org, and Google Scholar.

CHECK REFERENCES
• Select one citation or a whole reference list, then press Alt+Shift+C (or click the toolbar button and press Enter). RefRunner checks every entry against the scholarly record, flags what's wrong or can't be found, and formats the corrected list.
• Right-click a selection → RefRunner Toolkit → Send to RefRunner does the same.
• Line breaks are kept, so a pasted list stays one reference per line.
• If RefRunner is already open in a tab, the references are added to its list; otherwise a new tab opens.

JUMP FROM ANY ARTICLE
• Finds the DOI from the page address or the publisher's metadata tags (works on most journal sites, including ones whose URLs don't show the DOI), and arXiv IDs.
• Shows the work as "Author (year). Title", with its DOI and OpenAlex ID ready to copy and an Open button for doi.org.
• Metadata sources: the OpenAlex record and page, and the Crossref or DataCite record (whichever registered the DOI, so arXiv preprints and datasets go to DataCite).
• Search the DOI or citation in Google Scholar, Semantic Scholar, Google, PubMed, Europe PMC, Wikidata, JSTOR, ERIC, the Library of Congress, Open Library, Google Books, and ResearchGate, with the matching API records one click away.
• Alt+Shift+O opens the OpenAlex API record for the page you're on.
• Paste a DOI, OpenAlex ID, URL, or citation into the popup to look it up, or press Enter to send it to RefRunner.

PRIVATE BY DESIGN
• Reads a page only when you click the button, use the right-click menu, or press a shortcut.
• No account, no tracking, no analytics. Nothing about you or your browsing is stored or sent anywhere except the identifiers and text you choose to look up.
• Open source (MIT): https://github.com/literatecomputing/refrunner-toolkit

Shortcuts can be changed at chrome://extensions/shortcuts (there's a link at the bottom of the popup).
```

**Screenshots** (1280×800):
1. `screenshot-1-article.jpg`: an article page; DOI from the URL, author (year) and title, metadata sources, searches and APIs.
2. `screenshot-2-references.jpg`: a selected reference list; "Add to RefRunner References" ready for Enter.
3. `screenshot-3-arxiv.jpg`: an arXiv preprint; DataCite links instead of Crossref.

**Small promo tile** (440×280): `promo-440x280.jpg`

**Official URL / homepage:** https://www.refrunner.com
**Support URL:** https://github.com/literatecomputing/refrunner-toolkit/issues

## Privacy practices tab

**Single purpose:**

```
Help researchers check and look up scholarly references: send selected citations to RefRunner for verification, and open a work's records and searches (OpenAlex, Crossref/DataCite, doi.org, Google Scholar and other scholarly indexes) from its DOI, OpenAlex ID, or citation.
```

**Permission justifications:**

| Permission | Justification |
|---|---|
| activeTab | Lets the extension read the current page only after the user clicks the toolbar button, uses the right-click menu, or presses a shortcut. Used to find the page's DOI and the user's selected text. No access to any page otherwise. |
| scripting | Runs a small function in the active tab (only after the user acts, under activeTab) that reads the selected text and the page's citation meta tags (citation_doi, citation_title, citation_author, publication date). Nothing is changed on the page. |
| contextMenus | Adds the "RefRunner Toolkit" right-click menu for selected text and links (OpenAlex, Crossref/DataCite, doi.org, Google Scholar, more searches, Send to RefRunner). |
| storage | Remembers one developer setting (whether to send RefRunner links to a local development server). That option is only shown in unpacked development copies; store installs never use it. No user data is stored. |
| Host permission: https://www.refrunner.com/* | When the user sends references to RefRunner and a RefRunner tab is already open, the extension finds that tab and hands the references to it instead of opening a new one. No other site is accessed with this permission. |

(The `https://localhost:5173/*` entry is an optional permission requested only from the
development checkbox. Store users are never asked for it. If the form asks about it, say so.)

**Remote code:** No, I am not using remote code. (All JavaScript ships in the package; the
extension only fetches JSON data from api.openalex.org and doi.org.)

**Data usage:** tick **Website content** only. The extension reads the selected text and
citation metadata of the page the user acts on, and sends identifiers and text the user chose
to look up to the services the user picked. It collects nothing else: no personally
identifiable information, health, financial, authentication, personal communications,
location, web history, or user activity data.

Then certify all three:
- I do not sell or transfer user data to third parties, outside of the approved use cases.
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
- I do not use or transfer user data to determine creditworthiness or for lending purposes.

**Privacy policy URL:** https://www.refrunner.com/privacy-policy#chrome-extension

## Distribution tab

- Visibility: **Unlisted** for the first release (install by link), then Public.
- Regions: all.
