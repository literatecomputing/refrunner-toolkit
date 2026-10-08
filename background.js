// Service worker: right-click menu and keyboard shortcut.
import {
  parseText, oaApiUrl, oaWebUrl, oaApiDoiUrl, oaSearchUrl, oaWebSearchUrl, crossrefSearchUrl, doiOrgUrl, refrunnerUrl,
  datacitePageUrl, scholarUrl, registryOf, moreSearches, doiSearches,
  recordCitation,
} from './lib/doi.js';
import {
  detectForTab, readSelection, refrunnerBase, lookupWork, lookupCatalog, lookupRegistries, openTab, openOverflow, handToOpenTab,
} from './lib/chrome.js';

const MAX_TABS = 5;
const CONTEXTS = ['selection', 'link'];
const ITEMS = [
  { id: 'oa-api', title: 'OpenAlex API record' },
  { id: 'oa-web', title: 'OpenAlex page' },
  { id: 'crossref', title: 'Crossref / DataCite' },
  { id: 'doi-org', title: 'Open at doi.org' },
  { id: 'scholar', title: 'Google Scholar' },
  { id: 'more', title: 'More searches' },
  { id: 'sep-1', type: 'separator' },
  { id: 'refrunner', title: 'Send to RefRunner' },
];
// Submenu of 'more': the searches RefRunner suggests for a reference it can't find.
const MORE = moreSearches('').map((s) => s.label);

// The install marker (lib/marker.js) on the dev server too, while the dev checkbox's localhost
// permission is granted; www.refrunner.com gets it from the manifest. Registered scripts
// persist, so this only needs to follow permission changes.
const DEV_MARKER = { id: 'dev-marker', matches: ['https://localhost:5173/*'], js: ['lib/marker.js'], runAt: 'document_start' };
async function syncDevMarker() {
  const granted = await chrome.permissions.contains({ origins: DEV_MARKER.matches });
  const [registered] = await chrome.scripting.getRegisteredContentScripts({ ids: [DEV_MARKER.id] });
  if (granted && !registered) await chrome.scripting.registerContentScripts([DEV_MARKER]);
  if (!granted && registered) await chrome.scripting.unregisterContentScripts({ ids: [DEV_MARKER.id] });
}
chrome.permissions.onAdded.addListener(syncDevMarker);
chrome.permissions.onRemoved.addListener(syncDevMarker);

chrome.runtime.onInstalled.addListener(() => {
  syncDevMarker();
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'root', title: 'RefRunner Toolkit', contexts: CONTEXTS });
    for (const item of ITEMS) chrome.contextMenus.create({ ...item, parentId: 'root', contexts: CONTEXTS });
    for (const label of MORE) {
      chrome.contextMenus.create({ id: `more:${label}`, title: label, parentId: 'more', contexts: CONTEXTS });
    }
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  handleMenu(info, tab).catch((err) => {
    console.error('RefRunner Toolkit:', err);
    flash(tab, '!');
  });
});

chrome.commands.onCommand.addListener((command, tab) => {
  handleShortcut(command, tab).catch((err) => {
    console.error('RefRunner Toolkit:', err);
    flash(tab, '!');
  });
});

async function handleShortcut(command, tab) {
  tab ||= (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
  if (command === 'send-refrunner') {
    // Selection first, as in the popup; otherwise the page's DOI, OpenAlex id, or catalog record.
    let text = await readSelection(tab);
    if (!text) {
      const d = await detectForTab(tab);
      text = d.doi || d.openalex?.id || (d.catalog ? tab.url : '');
    }
    return sendToRefRunner(await resolveCatalog(parseText(text)), tab);
  }
  if (command !== 'openalex-api') return;
  const d = await detectForTab(tab);
  const url = d.openalex ? oaApiUrl(d.openalex) : d.doi ? oaApiDoiUrl([d.doi]) : null;
  if (!url) return flash(tab, '?');
  await openTab(url, tab);
}

/**
 * A bare Open Library or ERIC link/id stands for its record: its DOI if it has one, else its
 * citation. Anything else (a citation that merely contains such a link) is left as it is.
 */
async function resolveCatalog(parsed) {
  if (!parsed.catalog || !parsed.onlyIds || parsed.dois.length || parsed.openalex.length) return parsed;
  const r = await lookupCatalog(parsed.catalog);
  return r.found ? parseText(r.doi || recordCitation(r)) : parsed;
}

async function handleMenu(info, tab) {
  // A selection wins over the link it sits in.
  const text = info.selectionText ? await fullSelection(info, tab) : info.linkUrl || '';
  const parsed = await resolveCatalog(parseText(text));

  if (info.menuItemId === 'refrunner') return sendToRefRunner(parsed, tab);

  const urls = await destinations(info.menuItemId, parsed);
  if (!urls.length) return flash(tab, '?');
  let i = 0;
  for (const url of urls.slice(0, MAX_TABS)) await openTab(url, tab, { offset: i++ });
}

async function destinations(action, p) {
  if (action.startsWith('more:')) {
    // A selection of DOIs is searched as the DOIs; anything else as its words.
    const q = p.onlyIds ? p.dois.join(' ') : p.leftover || p.text;
    const byDoi = p.onlyIds && p.dois.length ? doiSearches(p.dois[0]) : [];
    const s = q && [...byDoi, ...moreSearches(q)].find((m) => m.url && `more:${m.label}` === action);
    return s ? [s.url] : [];
  }
  const needDois = action === 'crossref' || action === 'doi-org' || action === 'scholar';
  const dois = p.dois.length || !needDois ? p.dois : await doisFromOpenAlex(p);
  switch (action) {
    case 'oa-api': {
      const out = p.openalex.map(oaApiUrl);
      if (p.dois.length) out.unshift(oaApiDoiUrl(p.dois));
      if (!out.length && p.text) out.push(oaSearchUrl(p.text));
      return out;
    }
    case 'oa-web': {
      const out = p.openalex.map(oaWebUrl);
      for (const doi of p.dois.slice(0, MAX_TABS)) {
        const w = await lookupWork({ doi });
        if (w?.found && w.id) out.push(`https://openalex.org/works/${w.id}`);
      }
      // Plain text: the web UI's own search.
      if (!out.length && !p.dois.length && p.text) out.push(oaWebSearchUrl(p.leftover || p.text));
      return out;
    }
    case 'crossref': {
      if (!dois.length) return p.text && !p.onlyIds ? [crossrefSearchUrl(p.leftover || p.text)] : [];
      const ra = await lookupRegistries(dois);
      return dois.map((d) => (registryOf(d, ra) === 'DataCite' ? datacitePageUrl(d) : crossrefSearchUrl(d)));
    }
    case 'scholar':
      if (dois.length) return dois.map(scholarUrl);
      return p.text && !p.onlyIds ? [scholarUrl(p.leftover || p.text)] : [];
    case 'doi-org':
      return dois.map(doiOrgUrl);
    default:
      return [];
  }
}

async function sendToRefRunner(p, tab) {
  let parsed = p;
  // RefRunner takes DOIs, not OpenAlex ids: translate bare W-ids first.
  if (p.onlyIds && !p.dois.length) {
    const dois = await doisFromOpenAlex(p);
    if (!dois.length) return flash(tab, '?');
    parsed = { ...p, dois };
  }
  const base = await refrunnerBase();
  const r = refrunnerUrl(parsed, { base });
  if (!r) return flash(tab, '?');
  // An open RefRunner tab takes it, at any length; otherwise a new tab as before.
  if (await handToOpenTab(base, r.handoff)) return;
  if (r.overflow) return openOverflow(r.refs, r.url, tab);
  await openTab(r.url, tab);
}

async function doisFromOpenAlex(p) {
  const out = [];
  for (const oa of p.openalex.filter((o) => o.type === 'works').slice(0, MAX_TABS)) {
    const w = await lookupWork({ openalex: oa });
    if (w?.doi) out.push(w.doi);
  }
  return out;
}

/**
 * info.selectionText collapses line breaks, which would merge a pasted reference
 * list into one line. Re-read the selection from the page when we can.
 */
async function fullSelection(info, tab) {
  return (await readSelection(tab, info.frameId ?? 0)) || info.selectionText || '';
}

function flash(tab, text) {
  const scope = tab?.id >= 0 ? { tabId: tab.id } : {};
  // The tab may close before the badge clears; that's fine, so ignore the rejection.
  const ignore = () => {};
  chrome.action.setBadgeBackgroundColor({ color: '#b3261e', ...scope }).catch(ignore);
  chrome.action.setBadgeText({ text, ...scope }).catch(ignore);
  setTimeout(() => chrome.action.setBadgeText({ text: '', ...scope }).catch(ignore), 2500);
}
