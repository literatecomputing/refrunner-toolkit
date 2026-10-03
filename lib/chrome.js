// Chrome-dependent helpers: page detection, OpenAlex lookups, tab opening.
import {
  findDoiInUrl, arxivDoi, openalexFromUrl, cleanDoi, encodeDoiPath, REFRUNNER_BASE, REFRUNNER_DEV_BASE,
} from './doi.js';

// ---------- RefRunner address ----------

// Store installs get an update_url; unpacked (development) copies don't.
export const IS_DEV = !('update_url' in chrome.runtime.getManifest());

/** Where RefRunner links go: the local dev server if the dev-only checkbox is on. */
export async function refrunnerBase() {
  if (!IS_DEV) return REFRUNNER_BASE;
  const { useDevServer } = await chrome.storage.local.get('useDevServer');
  return useDevServer ? REFRUNNER_DEV_BASE : REFRUNNER_BASE;
}

// ---------- page detection ----------

// Injected into the page, so it must be self-contained (no closures, no imports).
function readPageMetadata() {
  const wanted = [
    'citation_doi', 'dc.identifier', 'dc.identifier.doi', 'dcterms.identifier', 'prism.doi',
    'bepress_citation_doi', 'wkhealth_doi', 'doi',
  ];
  const metas = [...document.querySelectorAll('meta[name], meta[property]')];
  const candidates = [];
  for (const want of wanted) {
    for (const m of metas) {
      const name = (m.getAttribute('name') || m.getAttribute('property') || '').toLowerCase();
      const content = m.getAttribute('content') || '';
      if (name === want && /10\.\d{4,9}\//.test(content)) candidates.push(content);
    }
  }
  const title = document.querySelector('meta[name="citation_title"], meta[name="dc.title" i]')
    ?.getAttribute('content') || null;
  const authors = [...document.querySelectorAll('meta[name="citation_author"], meta[name="dc.creator" i]')]
    .map((m) => m.getAttribute('content')).filter(Boolean);
  const date = document.querySelector(
    'meta[name="citation_publication_date"], meta[name="citation_date"], meta[name="dc.date" i]',
  )?.getAttribute('content') || '';
  const year = Number(date.match(/\b(1[5-9]|20)\d{2}\b/)?.[0]) || null;
  return { candidates, title, authors, year };
}

/**
 * Work out what the current tab is about.
 * Returns { doi, openalex, source, title, authors, year } where source is
 * 'url' | 'arxiv' | 'meta' | 'openalex' | null.
 */
export async function detectForTab(tab) {
  const url = tab?.url || '';
  const out = { doi: null, openalex: openalexFromUrl(url), source: null, title: null, authors: [], year: null };

  if ((out.doi = findDoiInUrl(url))) out.source = 'url';
  else if ((out.doi = arxivDoi(url))) out.source = 'arxiv';

  if (!out.doi && !out.openalex && tab?.id >= 0 && /^https?:/i.test(url)) {
    try {
      const [res] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: readPageMetadata });
      const meta = res?.result;
      if (meta) {
        out.title = meta.title;
        out.authors = meta.authors;
        out.year = meta.year;
        for (const c of meta.candidates) {
          const d = cleanDoi(c);
          if (d) { out.doi = d; out.source = 'meta'; break; }
        }
      }
    } catch {
      // Chrome Web Store, chrome:// pages, the built-in PDF viewer, etc. can't be scripted.
    }
  }
  if (!out.source && out.openalex) out.source = 'openalex';
  return out;
}

// ---------- OpenAlex lookups ----------

/**
 * Look up a work by OpenAlex id or DOI.
 * Returns { found: true, id, doi, title, authors, year } | { found: false } | { error } | null.
 */
export async function lookupWork({ doi, openalex }, { timeoutMs = 6000 } = {}) {
  let path;
  if (openalex?.type === 'works') path = openalex.id;
  else if (doi) path = `doi:${encodeDoiPath(doi)}`;
  else return null;

  const q = new URLSearchParams({ select: 'id,doi,display_name,publication_year,authorships' });
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`https://api.openalex.org/works/${path}?${q}`, { signal: ctrl.signal });
    if (res.status === 404) return { found: false };
    if (!res.ok) return { error: `OpenAlex returned ${res.status}` };
    const j = await res.json();
    return {
      found: true,
      id: (j.id || '').replace(/^https?:\/\/openalex\.org\//i, '') || null,
      doi: j.doi ? j.doi.replace(/^https?:\/\/(dx\.)?doi\.org\//i, '') : null,
      title: j.display_name || null,
      authors: (j.authorships || []).map((a) => a.author?.display_name).filter(Boolean),
      year: j.publication_year || null,
    };
  } catch (e) {
    return { error: e?.name === 'AbortError' ? 'OpenAlex timed out' : 'OpenAlex lookup failed' };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The selected text in one frame of the tab, line breaks intact ('' if none or no access:
 * PDF viewer, chrome:// pages, text inside <input>/<textarea>).
 */
export async function readSelection(tab, frameId = 0) {
  if (!(tab?.id >= 0)) return '';
  try {
    const [res] = await chrome.scripting.executeScript({
      target: { tabId: tab.id, frameIds: [frameId] },
      func: () => String(window.getSelection() || ''),
    });
    return res?.result?.trim() ? res.result : '';
  } catch {
    return '';
  }
}

/**
 * Ask doi.org which registry holds each DOI (it sends CORS headers, so no permission needed).
 * Returns { lowercased DOI: 'Crossref' | 'DataCite' | ... }, or {} on any failure.
 */
// ponytail: comma-joined batch, so a DOI that itself contains a comma confuses it; such DOIs are rare.
export async function lookupRegistries(dois, { timeoutMs = 4000 } = {}) {
  if (!dois.length) return {};
  try {
    const res = await fetch(`https://doi.org/ra/${dois.slice(0, 5).map(encodeDoiPath).join(',')}`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return {};
    const out = {};
    for (const r of await res.json()) if (r.DOI && r.RA) out[r.DOI.toLowerCase()] = r.RA;
    return out;
  } catch {
    return {};
  }
}

/** Open a URL next to the source tab. offset keeps several new tabs in order. */
export async function openTab(url, sourceTab, { offset = 0, background = false } = {}) {
  const props = { url, active: !background };
  if (sourceTab?.id >= 0) {
    props.index = sourceTab.index + 1 + offset;
    props.windowId = sourceTab.windowId;
    props.openerTabId = sourceTab.id;
  }
  return chrome.tabs.create(props);
}

// Injected into a RefRunner tab. The app marks <html data-refrunner-handoff="1"> once it
// listens; a tab on an older build has no mark, and gets a new tab instead.
function postToRefRunner(text) {
  if (document.documentElement.dataset.refrunnerHandoff !== '1') return false;
  window.postMessage({ type: 'refrunner-import', text }, location.origin);
  return true;
}

/**
 * Give the text to a RefRunner tab that is already open (the most recently used one at
 * base), and bring it forward. Needs host access to base: refrunner.com is in the manifest;
 * the dev server is an optional permission the dev checkbox asks for. Returns false when no
 * tab took it, so the caller opens a new one.
 */
export async function handToOpenTab(base, text) {
  if (!text) return false;
  let tabs;
  try {
    tabs = await chrome.tabs.query({ url: `${base.replace(/\/+$/, '')}/*` });
  } catch {
    return false;
  }
  tabs.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
  for (const t of tabs) {
    try {
      const [res] = await chrome.scripting.executeScript({
        target: { tabId: t.id }, func: postToRefRunner, args: [text],
      });
      if (!res?.result) continue;
      await chrome.tabs.update(t.id, { active: true });
      await chrome.windows.update(t.windowId, { focused: true });
      return true;
    } catch {
      // No access (the dev permission was never granted) or the tab is gone: try the next.
    }
  }
  return false;
}

/** Hand an over-long reference list to the overflow page (copy, then open /check). */
// The list rides in the fragment of an extension URL, so no storage permission is needed.
export async function openOverflow(refs, checkUrl, sourceTab) {
  const q = new URLSearchParams({ check: checkUrl });
  return openTab(chrome.runtime.getURL(`overflow.html?${q}#${encodeURIComponent(refs)}`), sourceTab);
}
