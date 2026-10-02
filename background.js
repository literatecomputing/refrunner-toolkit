// Service worker: right-click menu and keyboard shortcut.
import {
  parseText, oaApiUrl, oaWebUrl, oaApiDoiUrl, oaSearchUrl, crossrefSearchUrl, doiOrgUrl, refrunnerUrl,
} from './lib/doi.js';
import { detectForTab, lookupWork, openTab, openOverflow } from './lib/chrome.js';

const MAX_TABS = 5;
const CONTEXTS = ['selection', 'link'];
const ITEMS = [
  { id: 'oa-api', title: 'OpenAlex API record' },
  { id: 'oa-web', title: 'OpenAlex page' },
  { id: 'crossref', title: 'Crossref search' },
  { id: 'doi-org', title: 'Open at doi.org' },
  { id: 'sep-1', type: 'separator' },
  { id: 'refrunner', title: 'Send to RefRunner' },
];

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'root', title: 'RefRunner Toolkit', contexts: CONTEXTS });
    for (const item of ITEMS) chrome.contextMenus.create({ ...item, parentId: 'root', contexts: CONTEXTS });
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  handleMenu(info, tab).catch((err) => {
    console.error('RefRunner Toolkit:', err);
    flash(tab, '!');
  });
});

chrome.commands.onCommand.addListener((command, tab) => {
  if (command !== 'openalex-api') return;
  handleShortcut(tab).catch((err) => {
    console.error('RefRunner Toolkit:', err);
    flash(tab, '!');
  });
});

async function handleShortcut(tab) {
  tab ||= (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
  const d = await detectForTab(tab);
  const url = d.openalex ? oaApiUrl(d.openalex) : d.doi ? oaApiDoiUrl([d.doi]) : null;
  if (!url) return flash(tab, '?');
  await openTab(url, tab);
}

async function handleMenu(info, tab) {
  // A selection wins over the link it sits in.
  const text = info.selectionText ? await fullSelection(info, tab) : info.linkUrl || '';
  const parsed = parseText(text);

  if (info.menuItemId === 'refrunner') return sendToRefRunner(parsed, tab);

  const urls = await destinations(info.menuItemId, parsed);
  if (!urls.length) return flash(tab, '?');
  let i = 0;
  for (const url of urls.slice(0, MAX_TABS)) await openTab(url, tab, { offset: i++ });
}

async function destinations(action, p) {
  const needDois = action === 'crossref' || action === 'doi-org';
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
      // No known web-UI search URL, so plain text falls back to an API search.
      if (!out.length && !p.dois.length && p.text) out.push(oaSearchUrl(p.text));
      return out;
    }
    case 'crossref':
      if (dois.length) return dois.map(crossrefSearchUrl);
      return p.text && !p.onlyIds ? [crossrefSearchUrl(p.leftover || p.text)] : [];
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
  const r = refrunnerUrl(parsed);
  if (!r) return flash(tab, '?');
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
  if (tab?.id >= 0) {
    try {
      const [res] = await chrome.scripting.executeScript({
        target: { tabId: tab.id, frameIds: [info.frameId ?? 0] },
        func: () => String(window.getSelection() || ''),
      });
      if (res?.result?.trim()) return res.result;
    } catch {
      // PDF viewer, chrome:// pages, text inside <input>/<textarea>, etc.
    }
  }
  return info.selectionText || '';
}

function flash(tab, text) {
  const scope = tab?.id >= 0 ? { tabId: tab.id } : {};
  chrome.action.setBadgeBackgroundColor({ color: '#b3261e', ...scope });
  chrome.action.setBadgeText({ text, ...scope });
  setTimeout(() => chrome.action.setBadgeText({ text: '', ...scope }), 2500);
}
