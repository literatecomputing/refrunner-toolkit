// Chrome-dependent helpers: page detection, OpenAlex lookups, tab opening.
import {
  findDoiInUrl, arxivDoi, openalexFromUrl, cleanDoi, encodeDoiPath,
} from './doi.js';

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
  const author = authors.length ? authors[0] + (authors.length > 1 ? '...' : '') : null;
  return { candidates, title, author };
}

/**
 * Work out what the current tab is about.
 * Returns { doi, openalex, source, title, author } where source is
 * 'url' | 'arxiv' | 'meta' | 'openalex' | null.
 */
export async function detectForTab(tab) {
  const url = tab?.url || '';
  const out = { doi: null, openalex: openalexFromUrl(url), source: null, title: null, author: null };

  if ((out.doi = findDoiInUrl(url))) out.source = 'url';
  else if ((out.doi = arxivDoi(url))) out.source = 'arxiv';

  if (!out.doi && !out.openalex && tab?.id >= 0 && /^https?:/i.test(url)) {
    try {
      const [res] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: readPageMetadata });
      const meta = res?.result;
      if (meta) {
        out.title = meta.title;
        out.author = meta.author;
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
 * Returns { found: true, id, doi, title, author, year } | { found: false } | { error } | null.
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
      // First author, with "..." when there are more.
      author: j.authorships?.[0]?.author?.display_name
        ? j.authorships[0].author.display_name + (j.authorships.length > 1 ? '...' : '')
        : null,
      year: j.publication_year || null,
    };
  } catch (e) {
    return { error: e?.name === 'AbortError' ? 'OpenAlex timed out' : 'OpenAlex lookup failed' };
  } finally {
    clearTimeout(timer);
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

/** Hand an over-long reference list to the overflow page (copy, then open /check). */
// The list rides in the fragment of an extension URL, so no storage permission is needed.
export async function openOverflow(refs, checkUrl, sourceTab) {
  const q = new URLSearchParams({ check: checkUrl });
  return openTab(chrome.runtime.getURL(`overflow.html?${q}#${encodeURIComponent(refs)}`), sourceTab);
}
