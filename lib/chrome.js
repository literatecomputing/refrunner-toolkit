// Chrome-dependent helpers: page detection, OpenAlex lookups, tab opening.
import {
  findDoiInUrl, arxivDoi, openalexFromUrl, catalogFromUrl, pageCitation, youtubeId, CATALOGS, parseCatalogRecord, cleanDoi, encodeDoiPath, freeCopies, REFRUNNER_BASE, REFRUNNER_DEV_BASE, parseUpdates, parseArxivWithdrawal,
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
  // What a reference needs when there's no DOI: the rest of the citation_* tags, else the
  // page's own (Open Graph, author, published time). See pageCitation in doi.js.
  const get = (sel) => document.querySelector(sel)?.getAttribute('content')?.trim() || '';
  const page = {
    citation: {
      title, authors, date,
      journal: get('meta[name="citation_journal_title"]'),
      conference: get('meta[name="citation_conference_title"]'),
      institution: get('meta[name="citation_dissertation_institution"], meta[name="citation_technical_report_institution"]'),
      publisher: get('meta[name="citation_publisher"]'),
      isbn: get('meta[name="citation_isbn"]'),
      volume: get('meta[name="citation_volume"]'),
      issue: get('meta[name="citation_issue"]'),
      firstpage: get('meta[name="citation_firstpage"]'),
      lastpage: get('meta[name="citation_lastpage"]'),
    },
    title: get('meta[property="og:title"]') || document.title.trim(),
    site: get('meta[property="og:site_name"]'),
    author: get('meta[name="author"]') || get('meta[property="article:author"]'),
    published: get('meta[property="article:published_time"]') || get('meta[itemprop="datePublished"]')
      || get('meta[itemprop="uploadDate"]') || get('meta[name="date"]'),
    // YouTube swaps videos without reloading, leaving the first video's tags behind; this says
    // which video the tags belong to.
    canonical: document.querySelector('link[rel="canonical"]')?.href || get('meta[property="og:url"]'),
  };
  return { candidates, title, authors, year, page };
}

/** A YouTube video's title and channel, from its oEmbed (CORS-enabled, no permission). */
async function youtubeOembed(url, timeoutMs = 5000) {
  try {
    const res = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`,
      { signal: AbortSignal.timeout(timeoutMs) });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

/**
 * Work out what the current tab is about.
 * Returns { doi, openalex, catalog, source, title, authors, year, citation } where source is
 * 'url' | 'arxiv' | 'meta' | 'openalex' | 'openlibrary' | 'eric' | 'wikidata' |
 * 'citation-tags' | 'youtube' | 'webpage' | null, and citation is the page's reference text
 * when there's no identifier.
 */
export async function detectForTab(tab) {
  const url = tab?.url || '';
  const out = {
    doi: null, openalex: openalexFromUrl(url), catalog: catalogFromUrl(url),
    source: null, title: null, authors: [], year: null, citation: null,
  };
  let page = null;

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
        page = meta.page;
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
  if (!out.source && out.catalog) out.source = out.catalog.kind;
  // Nothing to look up: the page itself becomes the reference (citation tags, a YouTube
  // video, or a web page).
  if (!out.source && page) {
    const video = youtubeId(url);
    const oembed = video && (await youtubeOembed(`https://www.youtube.com/watch?v=${video}`));
    const c = pageCitation(page, url, oembed);
    if (c) Object.assign(out, c);
  }
  return out;
}

// ---------- Catalog lookups (Open Library, ERIC) ----------

/**
 * A catalog record's citation parts (see parseCatalogRecord).
 * Returns { found: true, ...parts } | { found: false } | { error }.
 */
export async function lookupCatalog(catalog, { timeoutMs = 6000 } = {}) {
  const { name, api, linked } = CATALOGS[catalog.kind];
  try {
    const res = await fetch(api(catalog.id), { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return { error: `${name} returned ${res.status}` };
    const json = await res.json();
    // Names for the ids the record links to (Wikidata: people and album, then the album's label);
    // a failed request just leaves them out of the citation.
    const entities = {};
    for (let i = 0, more; i < 2 && (more = linked?.(json, catalog.id, entities)); i++) {
      const r = await fetch(more, { signal: AbortSignal.timeout(timeoutMs) })
        .then((x) => (x.ok ? x.json() : null)).catch(() => null);
      if (!r?.entities) break;
      Object.assign(entities, r.entities);
    }
    const rec = parseCatalogRecord(catalog, json, { entities });
    return rec ? { found: true, ...rec } : { found: false };
  } catch (e) {
    return { error: e?.name === 'TimeoutError' ? `${name} timed out` : `${name} lookup failed` };
  }
}

// ---------- OpenAlex lookups ----------

/**
 * Look up a work by OpenAlex id or DOI.
 * Returns { found: true, id, doi, title, authors, year, pdfs } | { found: false } | { error } | null.
 */
export async function lookupWork({ doi, openalex }, { timeoutMs = 6000 } = {}) {
  let path;
  if (openalex?.type === 'works') path = openalex.id;
  else if (doi) path = `doi:${encodeDoiPath(doi)}`;
  else return null;

  const q = new URLSearchParams({ select: 'id,doi,display_name,publication_year,authorships,locations,is_retracted' });
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
      pdfs: freeCopies(j.locations),
      retracted: j.is_retracted === true,
    };
  } catch (e) {
    return { error: e?.name === 'AbortError' ? 'OpenAlex timed out' : 'OpenAlex lookup failed' };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Retractions, corrections and other notices for a DOI: from its Crossref record, or for an
 * arXiv DOI, its DataCite record's withdrawal comment. Both APIs send CORS headers, so no
 * permission. [] when there are none or the registry can't say.
 */
export async function lookupUpdates(doi, { timeoutMs = 6000 } = {}) {
  const arxiv = /^10\.48550\//.test(doi);
  const url = arxiv
    ? `https://api.datacite.org/dois/${encodeDoiPath(doi)}`
    : `https://api.crossref.org/works/${encodeDoiPath(doi)}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return [];
    const json = await res.json();
    return arxiv ? parseArxivWithdrawal(doi, json) : parseUpdates(json.message);
  } catch {
    return [];
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
