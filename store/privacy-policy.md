# RefRunner Toolkit (Chrome extension) privacy policy

_Effective October 2, 2026_

RefRunner Toolkit is a browser extension from Literate Computing that helps you check and look up
scholarly references. This policy covers the extension. Your use of RefRunner itself is covered by
the [RefRunner privacy policy](https://www.refrunner.com/privacy-policy).

## What the extension reads

Only when you click the toolbar button, choose an item from its right-click menu, or press one of
its keyboard shortcuts, the extension reads, from the page you're on:

- the text you have selected, and
- the page's address and its citation metadata (the DOI, title, authors and publication date that
  publishers put in the page for reference managers).

It never reads pages in the background, and it does not see your browsing history.

## What it sends, and where

Only what is needed for the action you chose:

- **OpenAlex** (api.openalex.org): a DOI or OpenAlex ID, to show the work's title, authors and
  year and to fill in the other identifier.
- **doi.org**: DOIs, to learn whether Crossref or DataCite registered them.
- **RefRunner** (www.refrunner.com): the references or DOIs you send to it. Reference text travels
  in the part of the link after `#`, which stays in your browser and is not sent to RefRunner's
  servers. If a RefRunner tab is already open, the extension hands the references to that tab.
- **Links you click** (OpenAlex, Crossref, DataCite, doi.org, Google Scholar) open in a new tab with
  the DOI or text in the address, exactly as if you had typed it.

## What it stores

Nothing about you. The extension keeps one setting used only by its developers (whether to use a
local test server). It has no accounts, cookies, analytics or tracking, and it does not sell or
share data with anyone.

RefRunner links carry `utm_source=chrome-extension` so RefRunner can count visits that came from
the extension. That tag identifies the extension, not you.

## Changes and contact

If this policy changes, the new version will be posted here with a new effective date. Questions:
open an issue at https://github.com/literatecomputing/refrunner-toolkit/issues.
