// Pure parsing and URL-building functions.
// No chrome.* APIs in this file, so it can be unit-tested in Node (see tests/).

const DOI_CORE = String.raw`10\.\d{4,9}\/`;
// A DOI inside free text: runs until whitespace or a quote/angle bracket.
const DOI_TEXT_RE = new RegExp(DOI_CORE + String.raw`[^\s"'<>]+`, 'gi');
// A DOI inside a URL path: additionally stops at ? and #.
const DOI_URLPART_RE = new RegExp(DOI_CORE + String.raw`[^\s"'<>?#]+`, 'i');
const URL_RE = /https?:\/\/[^\s"'<>]+/gi;

// Path segments publishers append after the DOI on landing pages.
const LANDING_SUFFIX_RE =
  /(?:\/(?:full|abstract|abs|pdf|epdf|pdfdirect|epub|fulltext|full-text|html|meta|references|summary|figures|tables|suppl|supplemental|citedby|cited-by|metrics|reader|download|info|toc))+\/?$/i;

const OA_ENTITY = {
  W: 'works', A: 'authors', S: 'sources', I: 'institutions',
  P: 'publishers', F: 'funders', T: 'topics', C: 'concepts',
};

export const REFRUNNER_BASE = 'https://www.refrunner.com';
// Offered by a checkbox in the popup of unpacked (development) installs only.
export const REFRUNNER_DEV_BASE = 'https://localhost:5173';
export const REFRUNNER_MAX_URL = 8000;
export const UTM_SOURCE = 'chrome-extension';

/** Decode percent-encoding (up to twice, for double-encoded URLs) without throwing. */
export function safeDecode(s) {
  let out = String(s ?? '');
  for (let i = 0; i < 2; i++) {
    if (!/%[0-9a-f]{2}/i.test(out)) break;
    try { out = decodeURIComponent(out); } catch { break; }
  }
  return out;
}

const count = (s, c) => s.split(c).length - 1;
function stripUnbalanced(s, open, close) {
  while (s.endsWith(close) && count(s, open) < count(s, close)) s = s.slice(0, -1);
  return s;
}

/**
 * Pull one clean DOI out of a string, or return null.
 * fromUrl: also strip landing-page junk (/full, /abstract, .pdf, ;jsessionid, ?query).
 */
export function cleanDoi(raw, { fromUrl = false } = {}) {
  if (!raw) return null;
  const m = safeDecode(raw).trim().match(new RegExp(DOI_CORE + String.raw`[^\s"'<>]+`, 'i'));
  if (!m) return null;
  let d = m[0];
  let prev;
  if (fromUrl) {
    d = d.replace(/[?#].*$/, '').replace(/;jsessionid=.*$/i, '');
    do {
      prev = d;
      d = d.replace(LANDING_SUFFIX_RE, '').replace(/\.pdf$/i, '').replace(/\/+$/, '');
    } while (d !== prev);
  }
  do {
    prev = d;
    d = d.replace(/[.,;:'"’”]+$/, '');
    d = stripUnbalanced(d, '(', ')');
    d = stripUnbalanced(d, '[', ']');
    d = stripUnbalanced(d, '{', '}');
  } while (d !== prev);
  return /^10\.\d{4,9}\/\S+$/.test(d) ? d : null;
}

/** Find a DOI in a page URL: path first, then query values, then the hash. */
export function findDoiInUrl(url) {
  let u;
  try { u = new URL(url); } catch { return null; }
  const path = safeDecode(u.pathname).match(DOI_URLPART_RE);
  if (path) {
    const d = cleanDoi(path[0], { fromUrl: true });
    if (d) return d;
  }
  for (const [, v] of u.searchParams) {
    const d = cleanDoi(v, { fromUrl: true });
    if (d) return d;
  }
  const hash = safeDecode(u.hash.slice(1)).match(DOI_URLPART_RE);
  return hash ? cleanDoi(hash[0], { fromUrl: true }) : null;
}

/** arXiv abstract/PDF URL -> its DataCite DOI (10.48550/arXiv.<id>). */
export function arxivDoi(url) {
  let u;
  try { u = new URL(url); } catch { return null; }
  if (!/(^|\.)arxiv\.org$/i.test(u.hostname)) return null;
  const m = u.pathname.match(/^\/(?:abs|pdf|html)\/(.+?)(?:v\d+)?(?:\.pdf)?\/?$/i);
  if (!m) return null;
  const id = m[1];
  if (/^\d{4}\.\d{4,5}$/.test(id) || /^[a-z-]+(?:\.[A-Z]{2})?\/\d{7}$/i.test(id)) {
    return `10.48550/arXiv.${id}`;
  }
  return null;
}

function oaRef(letter, num) {
  const L = letter.toUpperCase();
  return OA_ENTITY[L] ? { type: OA_ENTITY[L], id: L + num } : null;
}

/** OpenAlex web or API URL -> { type: 'works', id: 'W123' }, or null. */
export function openalexFromUrl(url) {
  let u;
  try { u = new URL(url); } catch { return null; }
  if (!/(^|\.)openalex\.org$/i.test(u.hostname)) return null;
  const places = [u.pathname, u.searchParams.get('zoom') || '', u.hash];
  for (const place of places) {
    for (const seg of place.split(/[/,?#&=]+/)) {
      const m = seg.match(/^([WASIPFTC])(\d{2,})(?!\w)/i);
      if (m) return oaRef(m[1], m[2]);
    }
  }
  return null;
}

// An ISBN after "ISBN" (10 or 13 digits, hyphens or spaces), or a bare 978-/979- one with hyphens.
const ISBN_RE = /\bISBN(?:-?1[03])?\s*:?\s*(97[89](?:[- ]?\d){10}|\d(?:[- ]?\d){8}[- ]?[\dXx])(?![\d-])|\b(97[89](?:-?\d){10})(?![\d-])/;

/** "0-441-17271-7" -> "0441172717" when the check digit is right, else null. */
export function cleanIsbn(raw) {
  const d = String(raw).replace(/[\s-]/g, '').toUpperCase();
  if (/^\d{9}[\dX]$/.test(d)) {
    const sum = [...d].reduce((t, c, i) => t + (c === 'X' ? 10 : Number(c)) * (10 - i), 0);
    return sum % 11 === 0 ? d : null;
  }
  if (/^97[89]\d{10}$/.test(d)) {
    const sum = [...d].reduce((t, c, i) => t + Number(c) * (i % 2 ? 3 : 1), 0);
    return sum % 10 === 0 ? d : null;
  }
  return null;
}

/**
 * Parse selected text, a pasted value, or a link URL.
 * Returns { dois, openalex, catalog, leftover, onlyIds, text }. catalog is the first Open Library
 * edition, ERIC record or Wikidata item ({ kind, id }) named by a link, a bare ERIC number
 * (ED591473), or an ISBN ("ISBN 0-441-17271-7", or a bare hyphenated 978-…/979-… one).
 * onlyIds is true when the identifiers are all that matters: nothing else, or a few stray words.
 */
export function parseText(input) {
  const text = String(input ?? '').trim();
  const dois = [];
  const openalex = [];
  const addDoi = (d) => {
    if (d && !dois.some((x) => x.toLowerCase() === d.toLowerCase())) dois.push(d);
  };
  const addOa = (o) => {
    if (o && !openalex.some((x) => x.id === o.id)) openalex.push(o);
  };
  let catalog = null;

  // One pass over URLs, bare DOIs and bare W-ids, so results keep document order.
  const TOKEN_RE = new RegExp(
    `(${URL_RE.source})|(?:\\bdoi\\s*:?\\s*)?(${DOI_TEXT_RE.source})|\\b(W\\d{6,})\\b|\\b(E[DJ]\\d{6,7})\\b|${ISBN_RE.source}`,
    'gi',
  );
  const rest = text.replace(TOKEN_RE, (whole, url, doiText, wid, ericId, isbnTagged, isbnBare) => {
    if (url) {
      let u = url.replace(/[.,;:'"]+$/, '');
      u = stripUnbalanced(u, '(', ')');
      const oa = openalexFromUrl(u);
      const doi = findDoiInUrl(u) || arxivDoi(u);
      const cat = !oa && !doi && catalogFromUrl(u);
      addOa(oa);
      addDoi(doi);
      catalog ||= cat || null;
      return oa || doi || cat ? ' ' : whole;
    }
    if (ericId) {
      catalog ||= { kind: 'eric', id: ericId.toUpperCase() };
      return ' ';
    }
    if (isbnTagged || isbnBare) {
      const id = cleanIsbn(isbnTagged || isbnBare);
      if (!id) return whole;
      catalog ||= { kind: 'isbn', id };
      return ' ';
    }
    if (doiText) {
      const d = cleanDoi(doiText);
      if (!d) return whole;
      addDoi(d);
      return ' ';
    }
    if (wid && wid[0] === 'W') {
      addOa(oaRef('W', wid.slice(1)));
      return ' ';
    }
    return whole;
  });

  const leftover = rest.replace(/[\s,;|]+/g, ' ').trim();
  // A few stray words around an identifier are selection noise, not a citation:
  // "2257. DOI=http://dx.doi.org/10.1145/2858036.2858198" is just the DOI. More than that
  // (a reference, or most of one) goes to RefRunner whole.
  // ponytail: word count only; raise FEW_WORDS if real selections land on the wrong side.
  const FEW_WORDS = 4;
  const strayWords = leftover.split(' ').filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
  const onlyIds = (dois.length > 0 || openalex.length > 0 || !!catalog) && strayWords <= FEW_WORDS;
  return { dois, openalex, catalog, leftover, onlyIds, text };
}

// ---------- URL builders ----------

/** Encode a DOI for use as a URL path, keeping its slashes readable. */
export const encodeDoiPath = (doi) => encodeURIComponent(doi).replace(/%2F/gi, '/');

export const oaApiUrl = (oa) => `https://api.openalex.org/${oa.type}/${oa.id}`;
export const oaWebUrl = (oa) => `https://openalex.org/${oa.type}/${oa.id}`;
export const oaSearchUrl = (q) =>
  `https://api.openalex.org/works?search=${encodeURIComponent(String(q).slice(0, 300))}`;
/** The OpenAlex web UI's search (checked Oct 2026: openalex.org/works?search= lists results). */
export const oaWebSearchUrl = (q) =>
  `https://openalex.org/works?search=${encodeURIComponent(String(q).replace(/\s+/g, ' ').trim().slice(0, 300))}`;

export function oaApiDoiUrl(dois) {
  if (dois.length === 1) return `https://api.openalex.org/works/doi:${encodeDoiPath(dois[0])}`;
  const list = dois.slice(0, 50).map((d) => encodeURIComponent(`https://doi.org/${d}`)).join('|');
  return `https://api.openalex.org/works?filter=doi:${list}`;
}

export const crossrefSearchUrl = (q) =>
  `https://search.crossref.org/?from_ui=yes&q=${encodeURIComponent(String(q).slice(0, 500))}`;
export const crossrefApiUrl = (doi) => `https://api.crossref.org/works/${encodeDoiPath(doi)}`;
export const doiOrgUrl = (doi) => `https://doi.org/${encodeDoiPath(doi)}`;
export const datacitePageUrl = (doi) => `https://commons.datacite.org/doi.org/${encodeDoiPath(doi)}`;
export const dataciteApiUrl = (doi) => `https://api.datacite.org/dois/${encodeDoiPath(doi)}`;
export const scholarUrl = (q) =>
  `https://scholar.google.com/scholar?q=${encodeURIComponent(String(q).slice(0, 300))}`;

/**
 * The searches RefRunner's card offers when a reference isn't found (Google, Semantic Scholar,
 * JSTOR, ERIC, ResearchGate), plus the catalogs it asks behind the scenes (Library of Congress,
 * Open Library, Google Books). Each is { label, url, api } — api is the raw JSON results where
 * the source has a public, keyless API, else null.
 */
/** Words for an LC SRU query: letters and digits only, since CQL would read the rest as syntax. */
const locWords = (q) =>
  String(q).slice(0, 300).split(/\s+/).map((w) => w.replace(/[^\p{L}\p{N}]/gu, '')).filter(Boolean).slice(0, 12);

export function moreSearches(q) {
  const e = encodeURIComponent(String(q).replace(/\s+/g, ' ').trim().slice(0, 300));
  return [
    // Google first, in every list (Nov 2026). udm=14 is Google's plain "Web" results: no AI Overview.
    { label: 'Google', url: `https://www.google.com/search?q=${e}`, api: null },
    { label: 'Google/NO AI', url: `https://www.google.com/search?udm=14&q=${e}`, api: null },
    {
      label: 'Semantic Scholar',
      url: `https://www.semanticscholar.org/search?q=${e}`,
      api: `https://api.semanticscholar.org/graph/v1/paper/search?query=${e}&limit=10&fields=title,authors,year,venue,externalIds`,
    },
    { label: 'JSTOR', url: `https://www.jstor.org/action/doBasicSearch?Query=${e}`, api: null },
    {
      label: 'ERIC',
      url: `https://eric.ed.gov/?q=${e}`,
      api: `https://api.ies.ed.gov/eric/?search=${e}&format=json&rows=10`,
    },
    {
      // The LC catalog, as RefRunner searches it — not loc.gov/books, which is the website's
      // search of digitized items and ranks badly. The API is the same SRU catalog endpoint
      // the app uses (plain HTTP, XML; Dublin Core is readable), every word required.
      label: 'Library of Congress',
      url: `https://search.catalog.loc.gov/search?option=keyword&query=${e}`,
      api: `http://lx2.loc.gov:210/LCDB?version=1.1&operation=searchRetrieve&maximumRecords=10&recordSchema=dc&query=${encodeURIComponent(locWords(q).join(' and '))}`,
    },
    {
      label: 'Open Library',
      url: `https://openlibrary.org/search?q=${e}`,
      api: `https://openlibrary.org/search.json?q=${e}&limit=10`,
    },
    {
      label: 'Google Books',
      url: `https://www.google.com/search?tbm=bks&q=${e}`,
      api: `https://www.googleapis.com/books/v1/volumes?q=${e}`,
    },
    { label: 'ResearchGate', url: `https://www.researchgate.net/search?q=${e}`, api: null },
    {
      // Matches item labels and aliases, so a title (song, film, book) finds its item.
      label: 'Wikidata',
      url: `https://www.wikidata.org/w/index.php?search=${e}`,
      api: `https://www.wikidata.org/w/api.php?action=wbsearchentities&format=json&language=en&limit=10&search=${e}`,
    },
  ];
}

/** Semantic Scholar's API record for a DOI (its site has no stable page-by-DOI URL). */
export const s2ApiDoiUrl = (doi) =>
  `https://api.semanticscholar.org/graph/v1/paper/DOI:${encodeDoiPath(doi)}?fields=title,authors,year,venue,externalIds,url`;

/**
 * The places that look a work up by its DOI, same shape as moreSearches. Each was checked to
 * find a real DOI (Oct 2026); ERIC's API, Open Library, LC and Google Books don't search DOIs.
 * Wikidata matches its P356 (DOI) property in any case.
 */
export function doiSearches(doi) {
  const e = encodeURIComponent(doi);
  const quoted = encodeURIComponent(`"${doi}"`);
  return [
    { label: 'Google', url: `https://www.google.com/search?q=${quoted}`, api: null },
    { label: 'Google/NO AI', url: `https://www.google.com/search?udm=14&q=${quoted}`, api: null },
    { label: 'Google Scholar', url: scholarUrl(doi), api: null },
    { label: 'Semantic Scholar', url: `https://www.semanticscholar.org/search?q=${e}`, api: s2ApiDoiUrl(doi) },
    {
      label: 'PubMed',
      url: `https://pubmed.ncbi.nlm.nih.gov/?term=${e}%5Bdoi%5D`,
      api: `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&retmode=json&term=${e}%5Bdoi%5D`,
    },
    {
      label: 'Europe PMC',
      url: `https://europepmc.org/search?query=DOI%3A${quoted}`,
      api: `https://www.ebi.ac.uk/europepmc/webservices/rest/search?format=json&query=DOI:${quoted}`,
    },
    {
      label: 'Wikidata',
      url: `https://www.wikidata.org/w/index.php?search=haswbstatement%3AP356%3D${e}`,
      api: `https://www.wikidata.org/w/api.php?action=query&list=search&format=json&srsearch=haswbstatement:P356=${e}`,
    },
  ];
}

/**
 * Which registration agency holds a DOI: 'Crossref', 'DataCite', 'mEDRA', ...
 * ra is { lowercased DOI: agency } from doi.org/ra. Until that answers, assume Crossref,
 * except arXiv DOIs, which are always DataCite.
 */
export function registryOf(doi, ra = {}) {
  return ra[doi.toLowerCase()] || (/^10\.48550\//.test(doi) ? 'DataCite' : 'Crossref');
}

/**
 * RefRunner link, per https://www.refrunner.com/llms.txt:
 *   one DOI      -> /<DOI>
 *   several DOIs -> /cite/<DOI>,<DOI>
 *   anything else-> /#refs=<percent-encoded list, one per line>
 * Returns { url, overflow, refs?, handoff } or null. overflow=true means the list was too
 * long for a URL; url is then the /check page and refs holds the text to paste.
 * handoff is the same content as text, for a RefRunner tab that is already open.
 */
export function refrunnerUrl(parsed, { base = REFRUNNER_BASE } = {}) {
  const root = base.replace(/\/+$/, '');
  const qs = `utm_source=${UTM_SOURCE}`;

  if (parsed.dois.length && parsed.onlyIds) {
    const path = parsed.dois.length === 1
      ? encodeDoiPath(parsed.dois[0])
      : 'cite/' + parsed.dois.map(encodeDoiPath).join(',');
    return { url: `${root}/${path}?${qs}`, overflow: false, handoff: parsed.dois.join('\n') };
  }

  const refs = parsed.text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
  if (!refs) return null;
  // Form encoding (spaces as +), as RefRunner's own share links do; it reads the hash with URLSearchParams.
  const url = `${root}/?${qs}#${new URLSearchParams({ refs })}`;
  if (url.length <= REFRUNNER_MAX_URL) return { url, overflow: false, handoff: refs };
  return { url: `${root}/check`, overflow: true, refs, handoff: refs };
}

// ---------- Free copies (OpenAlex locations) ----------

const PMC_RE = /^https?:\/\/(?:www\.ncbi\.nlm\.nih\.gov\/pmc\/|pmc\.ncbi\.nlm\.nih\.gov\/|europepmc\.org\/)/i;
const VERSION_LABELS = {
  submittedVersion: 'preprint',
  acceptedVersion: 'accepted manuscript',
  publishedVersion: 'published version',
};

/**
 * Where a work can be read free, from its OpenAlex `locations`: every direct PDF, plus
 * PubMed Central / Europe PMC full text (often there with no pdf_url). Other "open" landing
 * pages are skipped: OpenAlex marks index listings (DOAJ, FAIRsharing) open too.
 * Repository copies come first, the publisher's last; at most three.
 * Returns [{ url, host, pdf, version, repository }]. `version` is OpenAlex's guess (it calls
 * PMC copies "submitted"), so it is shown as a hint only.
 */
export function freeCopies(locations = []) {
  const seen = new Set();
  const out = [];
  for (const l of locations || []) {
    const pmc = l?.is_oa && PMC_RE.test(l.landing_page_url || '');
    const url = l?.pdf_url || (pmc ? l.landing_page_url : null);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    let host = l.source?.display_name;
    if (!host) try { host = new URL(url).hostname.replace(/^www\./, ''); } catch { host = 'Copy'; }
    out.push({
      url,
      host,
      pdf: !!l.pdf_url,
      version: VERSION_LABELS[l.version] || null,
      repository: l.source?.type === 'repository',
    });
  }
  return out.sort((a, b) => b.repository - a.repository).slice(0, 3);
}

/**
 * Everything the popup offers for a set of identifiers or a text query.
 * Returns [{ group, label, url, overflow?, refs? }].
 */
export function targetsFor(parsed, { ra = {}, base = REFRUNNER_BASE } = {}) {
  const { dois, openalex } = parsed;
  const out = [];
  const add = (group, label, url, extra = {}) => out.push({ group, label, url, ...extra });
  const work = openalex.find((o) => o.type === 'works');

  // Free copies OpenAlex knows of (popup only, after the lookup): right under RefRunner.
  for (const c of parsed.pdfs || []) {
    add('Free copy', c.pdf ? `${c.host} PDF` : `${c.host} full text`, c.url, { detail: c.version });
  }

  // Metadata sources, on one row: OpenAlex, then Crossref or DataCite (whichever holds the DOI;
  // other registries are covered by doi.org).
  // The buttons show the source's logo and `short`; `label` is the full name (tooltip, screen
  // readers). Several ids or DOIs keep full labels, since the logo can't say which one.
  if (parsed.catalog) {
    const c = CATALOGS[parsed.catalog.kind];
    // A logo says which catalog; without one the button needs its name.
    add('Metadata sources', c.name, c.page(parsed.catalog.id), { icon: c.icon, short: c.icon && 'Page' });
    add('Metadata sources', `${c.name} API`, c.api(parsed.catalog.id), { icon: c.icon, short: c.icon && 'API' });
  }
  const oneOA = openalex.length <= 1;
  if (openalex.length) {
    for (const o of openalex) {
      add('Metadata sources', oneOA ? 'OpenAlex API' : `OpenAlex API: ${o.id}`, oaApiUrl(o), { icon: 'openalex', short: oneOA && 'API' });
      add('Metadata sources', oneOA ? 'OpenAlex' : `OpenAlex: ${o.id}`, oaWebUrl(o), { icon: 'openalex', short: oneOA && 'Page' });
    }
  }
  if (dois.length && !work) {
    add('Metadata sources', dois.length > 1 ? 'OpenAlex API (all DOIs)' : 'OpenAlex API', oaApiDoiUrl(dois), { icon: 'openalex', short: 'API' });
  }

  const many = dois.length > 1;
  for (const d of dois.slice(0, 5)) {
    const reg = registryOf(d, ra);
    const of = many ? `: ${d}` : '';
    if (reg === 'Crossref') {
      add('Metadata sources', `Crossref search${of}`, crossrefSearchUrl(d), { icon: 'crossref', short: !many && 'Search' });
      add('Metadata sources', `Crossref API${of}`, crossrefApiUrl(d), { icon: 'crossref', short: !many && 'API' });
    } else if (reg === 'DataCite') {
      add('Metadata sources', `DataCite${of}`, datacitePageUrl(d), { icon: 'datacite', short: !many && 'Page' });
      add('Metadata sources', `DataCite API${of}`, dataciteApiUrl(d), { icon: 'datacite', short: !many && 'API' });
    }
  }
  // A DOI: everywhere that looks a work up by DOI, as search pages and API results.
  for (const d of dois.slice(0, 5)) {
    for (const s of doiSearches(d)) if (s.url) add('Search', many ? `${s.label}: ${d}` : s.label, s.url);
  }
  for (const d of dois.slice(0, 5)) {
    for (const s of doiSearches(d)) if (s.api) add('API', many ? `${s.label}: ${d}` : s.label, s.api);
  }

  // Text: every search RefRunner suggests for a reference it can't find, as search pages,
  // then the raw API results where the source has a keyless public API.
  if (!dois.length && !openalex.length && parsed.text) {
    const q = parsed.leftover || parsed.text;
    const more = moreSearches(q);
    const google = more.slice(0, 2); // Google, Google/NO AI lead the row
    for (const s of google) add('Search', s.label, s.url);
    add('Search', 'Crossref', crossrefSearchUrl(q));
    add('Search', 'OpenAlex', oaWebSearchUrl(q));
    add('Search', 'Google Scholar', scholarUrl(q));
    for (const s of more.slice(2)) add('Search', s.label, s.url);
    add('API', 'OpenAlex', oaSearchUrl(parsed.text));
    for (const s of more) if (s.api) add('API', s.label, s.api);
  }

  // RefRunner (needs DOIs or real reference text; bare OpenAlex IDs don't work there)
  if (dois.length || (parsed.text && !parsed.onlyIds)) {
    const r = refrunnerUrl(parsed, { base });
    if (r) {
      const label = parsed.onlyIds
        ? (dois.length > 1 ? `Send ${dois.length} DOIs to RefRunner` : 'Send to RefRunner')
        : 'Add to RefRunner References';
      add('RefRunner', label, r.url, { overflow: r.overflow, refs: r.refs, handoff: r.handoff });
    }
  }
  return out;
}

// ---------- Catalog records (Open Library, ERIC) ----------

/**
 * A catalog record page the popup can turn into a citation, as { kind, id }, or null:
 *   openlibrary.org/books/OL483046M/...  -> { kind: 'openlibrary', id: 'OL483046M' }  (editions)
 *   eric.ed.gov/?id=ED591473             -> { kind: 'eric', id: 'ED591473' }  (ED documents, EJ articles)
 *   wikidata.org/wiki/Q62019993          -> { kind: 'wikidata', id: 'Q62019993' }
 */
// ponytail: Open Library work (/works/OL…W) and /isbn/ pages could resolve to an edition later.
export function catalogFromUrl(url) {
  const u = String(url);
  const ol = u.match(/^https?:\/\/(?:www\.)?openlibrary\.org\/books\/(OL\d+M)\b/i);
  if (ol) return { kind: 'openlibrary', id: ol[1].toUpperCase() };
  const olIsbn = u.match(/^https?:\/\/(?:www\.)?openlibrary\.org\/isbn\/([\dXx-]{10,17})\b/i);
  if (olIsbn && cleanIsbn(olIsbn[1])) return { kind: 'isbn', id: cleanIsbn(olIsbn[1]) };
  const eric = u.match(/^https?:\/\/(?:www\.)?eric\.ed\.gov\/[^#]*[?&]id=(E[DJ]\d+)\b/i);
  if (eric) return { kind: 'eric', id: eric[1].toUpperCase() };
  const wd = u.match(/^https?:\/\/(?:www\.|m\.)?wikidata\.org\/(?:wiki|entity)\/(Q\d+)\b/i);
  if (wd) return { kind: 'wikidata', id: wd[1].toUpperCase() };
  return null;
}

const ERIC_FIELDS = 'id,title,author,source,publicationdateyear,publicationtype,publisher,isbn,issn,url,peerreviewed,description,subject';

// Both APIs send CORS headers, so the extension needs no permission for them.
export const CATALOGS = {
  openlibrary: {
    name: 'Open Library', idLabel: 'OL', icon: 'openlibrary',
    page: (id) => `https://openlibrary.org/books/${id}`,
    api: (id) => `https://openlibrary.org/api/books?bibkeys=OLID:${id}&jscmd=data&format=json`,
  },
  isbn: {
    name: 'Open Library', idLabel: 'ISBN', icon: 'openlibrary',
    page: (id) => `https://openlibrary.org/isbn/${id}`,
    api: (id) => `https://openlibrary.org/api/books?bibkeys=ISBN:${id}&jscmd=data&format=json`,
  },
  eric: {
    name: 'ERIC', idLabel: 'ERIC', icon: null,
    page: (id) => `https://eric.ed.gov/?id=${id}`,
    // `url` (where a DOI lives) isn't among ERIC's default fields, so name them all.
    api: (id) => `https://api.ies.ed.gov/eric/?search=id:${id}&format=json&fields=${ERIC_FIELDS}`,
  },
  wikidata: {
    name: 'Wikidata', idLabel: 'WD', icon: null,
    page: (id) => `https://www.wikidata.org/wiki/${id}`,
    // origin=* makes the API send CORS headers, so no permission is needed.
    api: (id) => wikidataApi([id]),
    // Claims name people, journals and albums by Q-id; a second request gets their names, and
    // a third the album's record label. prev is the linked items fetched so far.
    linked: (json, id, prev = {}) => {
      const e = json?.entities?.[id];
      const album = prev[wdItem(e, 'P361')[0]];
      const ids = [...wikidataLinked(e), ...wdItem(album, 'P264')].filter((q) => !prev[q]);
      return ids.length ? wikidataApi([...new Set(ids)].slice(0, 50)) : null;
    },
  },
};

const wikidataApi = (ids) =>
  `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${ids.join('%7C')}&props=labels%7Cclaims&languages=en&format=json&origin=*`;

// Wikidata properties, in the order a citation wants them. Authors come with their place in the
// author list (P1545 qualifier); a song or film without authors falls back to its performer,
// composer, creator or director.
const WD_PEOPLE = ['P175', 'P86', 'P170', 'P57'];
// Instance of (P31) or form (P7937) that make an item a song: song, single, musical work,
// musical composition.
const WD_SONG = new Set(['Q7366', 'Q134556', 'Q105543609', 'Q207628']);
// ... and an album: album, studio, live, compilation, EP.
const WD_ALBUM = new Set(['Q482994', 'Q208569', 'Q209939', 'Q222910', 'Q169930']);
const wdClaims = (e, p) => (e?.claims?.[p] || []).filter((c) => c.mainsnak?.datavalue)
  .sort((a, b) => (Number(a.qualifiers?.P1545?.[0]?.datavalue?.value) || 0) - (Number(b.qualifiers?.P1545?.[0]?.datavalue?.value) || 0));
const wdValue = (c) => c.mainsnak.datavalue.value;
const wdItem = (e, p) => wdClaims(e, p).map((c) => wdValue(c)?.id).filter(Boolean);
/** The Q-ids a Wikidata item's citation needs names for (and the container's date). */
function wikidataLinked(e) {
  const ids = [...wdItem(e, 'P50'), ...WD_PEOPLE.flatMap((p) => wdItem(e, p)), ...wdItem(e, 'P1433'),
    ...wdItem(e, 'P361'), ...wdItem(e, 'P123'), ...wdItem(e, 'P264')];
  return [...new Set(ids)].slice(0, 50); // the API's limit per request
}

const yearOf = (s) => Number(String(s ?? '').match(/\b(1[5-9]|20)\d{2}\b/)?.[0]) || null;

/**
 * A catalog API response (and, for Wikidata, the linked items' response) as citation parts:
 * { title, subtitle, authors, year, container, publisher, isbn, doi } or null if it has no record.
 */
export function parseCatalogRecord({ kind, id }, json, linked = null) {
  if (kind === 'openlibrary' || kind === 'isbn') {
    const b = json?.[`${kind === 'isbn' ? 'ISBN' : 'OLID'}:${id}`];
    if (!b) return null;
    const ids = b.identifiers || {};
    return {
      title: b.title || '', subtitle: b.subtitle || '',
      authors: (b.authors || []).map((a) => a.name).filter(Boolean),
      year: yearOf(b.publish_date), container: '', publisher: b.publishers?.[0]?.name || '',
      isbn: ids.isbn_13?.[0] || ids.isbn_10?.[0] || '', doi: null,
    };
  }
  if (kind === 'wikidata') {
    const e = json?.entities?.[id];
    if (!e || e.missing !== undefined) return null;
    const others = linked?.entities || {};
    const label = (q) => others[q]?.labels?.en?.value || '';
    // Authors: items (P50) and plain names (P2093), merged in author-list order.
    const people = [...wdClaims(e, 'P50'), ...wdClaims(e, 'P2093')]
      .sort((a, b) => (Number(a.qualifiers?.P1545?.[0]?.datavalue?.value) || 0) - (Number(b.qualifiers?.P1545?.[0]?.datavalue?.value) || 0))
      .map((c) => (typeof wdValue(c) === 'string' ? wdValue(c) : label(wdValue(c)?.id)));
    let authors = people.filter(Boolean);
    for (const p of WD_PEOPLE) if (!authors.length) authors = wdItem(e, p).map(label).filter(Boolean);
    // Published in (a journal). Not "part of" (P361), which is as often a list or series
    // ("Chicago's albums in chronological order") as a song's album.
    const containerId = wdItem(e, 'P1433')[0];
    const date = (x) => wdClaims(x, 'P577')[0] && yearOf(wdValue(wdClaims(x, 'P577')[0]).time);
    const isbn = wdClaims(e, 'P212')[0] || wdClaims(e, 'P957')[0];
    const doi = wdClaims(e, 'P356')[0];
    const title = wdClaims(e, 'P1476')[0] ? wdValue(wdClaims(e, 'P1476')[0]).text : e.labels?.en?.value || '';
    const types = [...wdItem(e, 'P31'), ...wdItem(e, 'P7937')];
    const medium = types.some((q) => WD_SONG.has(q)) ? 'Song' : types.some((q) => WD_ALBUM.has(q)) ? 'Album' : null;
    if (medium) {
      // APA's song or album: the recording artist, a person as "Dacus, L.", a band as is.
      // A song's date and label come from its album when it has none of its own.
      const artist = wdItem(e, 'P175')[0] || wdItem(e, 'P86')[0];
      const person = wdItem(others[artist], 'P31').includes('Q5');
      const album = medium === 'Song' ? others[wdItem(e, 'P361')[0]] : null;
      return {
        medium, title, album: album ? label(wdItem(e, 'P361')[0]) : '',
        authors: artist && label(artist) ? [person ? apaName(label(artist)) : label(artist)] : [],
        year: date(e) || date(album) || null,
        publisher: label(wdItem(e, 'P264')[0] || wdItem(album, 'P264')[0]),
        subtitle: '', container: '', isbn: '', doi: null,
      };
    }
    return {
      title, subtitle: '', authors,
      year: date(e) || null,
      container: containerId ? label(containerId) : '',
      publisher: label(wdItem(e, 'P123')[0]), isbn: isbn ? wdValue(isbn) : '',
      doi: doi ? cleanDoi(wdValue(doi)) : null,
    };
  }
  if (kind === 'eric') {
    const r = json?.response?.docs?.[0];
    if (!r) return null;
    return {
      title: r.title || '', subtitle: '', authors: r.author || [], year: yearOf(r.publicationdateyear),
      // EJ records are journal articles and `source` is the journal; an ED's source is often
      // just "Grantee Submission". ERIC's publisher field runs on into an address, so keep its name.
      container: id.startsWith('EJ') ? r.source || '' : '',
      publisher: id.startsWith('ED') ? (r.publisher || '').split(/[.;]/)[0].trim() : '',
      isbn: r.isbn?.[0] || '', doi: findDoiInUrl(r.url || ''),
    };
  }
  return null;
}

/** A record as one reference line for RefRunner: "Authors (year). Title: Subtitle. Journal. Publisher. ISBN …". */
export function recordCitation({ authors = [], year = null, title = '', subtitle = '', container = '', publisher = '', isbn = '', medium = null, album = '', url = '' }) {
  const who = authors.join(', ');
  if (medium) {
    // APA song or album: "Dacus, L. (2018). Night shift [Song]. On Historian [Album]. Matador Records."
    return [
      who && `${who.replace(/\.$/, '')}.`, `(${year || 'n.d.'}).`, `${title} [${medium}].`,
      album && `On ${album} [Album].`, publisher && `${publisher}.`,
    ].filter(Boolean).join(' ');
  }
  return [
    who ? `${who}${year ? ` (${year})` : ''}.` : year ? `(${year}).` : '',
    title && sentence(subtitle ? `${title}: ${subtitle}` : title),
    container && `${container}.`,
    publisher && `${publisher}.`,
    isbn && `ISBN ${isbn}${url ? '.' : ''}`,
    url,
  ].filter(Boolean).join(' ');
}

// ---------- A page without an identifier ----------

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
  'September', 'October', 'November', 'December'];

/** "2024-03-05T10:00:00Z" or "2024/03/05" -> "2024, March 5"; "2024" -> "2024"; else null. */
export function apaDate(s) {
  const m = String(s ?? '').match(/\b((?:1[5-9]|20)\d{2})(?:[-/](\d{1,2})(?:[-/](\d{1,2}))?)?/);
  if (!m) return null;
  const [, y, mo, d] = m;
  if (!mo || mo < 1 || mo > 12) return y;
  return `${y}, ${MONTHS[mo - 1]}${d && Number(d) ? ` ${Number(d)}` : ''}`;
}

/** The 11-character id of a YouTube video (watch, youtu.be or shorts URL), or null. */
export function youtubeId(url) {
  const m = String(url).match(/^https?:\/\/(?:(?:www\.|m\.)?youtube\.com\/(?:watch\?(?:[^#]*&)?v=|shorts\/)|youtu\.be\/)([\w-]{11})/i);
  return m?.[1] || null;
}

/** The page address for a reference: no fragment, no utm_ tracking parameters. */
function referenceUrl(url) {
  try {
    const u = new URL(url);
    u.hash = '';
    for (const k of [...u.searchParams.keys()]) if (/^utm_/i.test(k)) u.searchParams.delete(k);
    return u.href;
  } catch {
    return String(url);
  }
}

// A title keeps its own ? or !; anything else gets a period.
const sentence = (s) => (/[.?!]$/.test(s) ? s : `${s}.`);

/**
 * A reference for a page with no DOI or catalog record, from what readPageMetadata found:
 *  - Google Scholar's citation_* tags (repositories, theses, conference sites): authors, year,
 *    title, journal/conference/institution, publisher, ISBN, URL.
 *  - a YouTube video, APA style: "Channel. (2024, March 5). Title [Video]. YouTube. URL"
 *    (oembed: YouTube's { title, author_name } for the video, which is right even after
 *    in-page navigation; the page's date is used only if its tags are for this video).
 *  - any other page, APA style: "Author. (2024, March 5). Title. Site. URL"; the site stands in
 *    for a missing author.
 * Returns { source, title, authors, year, citation } or null.
 */
export function pageCitation(page, url, oembed = null) {
  if (!page) return null;
  const c = page.citation || {};
  const link = referenceUrl(url);
  if (c.title) {
    const pages = c.firstpage ? (c.lastpage ? `${c.firstpage}–${c.lastpage}` : c.firstpage) : '';
    const issue = c.volume && `${c.volume}${c.issue ? `(${c.issue})` : ''}`;
    const journal = c.journal && [c.journal, issue, pages].filter(Boolean).join(', ');
    const year = yearOf(c.date);
    return {
      source: 'citation-tags', title: c.title, authors: c.authors || [], year,
      citation: recordCitation({
        authors: c.authors || [], year, title: c.title, container: journal || c.conference || c.institution,
        publisher: c.publisher, isbn: c.isbn, url: link,
      }),
    };
  }
  const video = youtubeId(url);
  if (video) {
    const own = (page.canonical || '').includes(video); // the page's tags are for this video
    const title = oembed?.title || (own ? page.title.replace(/ - YouTube$/, '') : '');
    if (!title) return null;
    const channel = oembed?.author_name || '';
    const date = own ? apaDate(page.published) : null;
    return {
      source: 'youtube', title, authors: channel ? [channel] : [], year: yearOf(date),
      citation: [channel && sentence(channel), `(${date || 'n.d.'}).`, `${title} [Video].`, 'YouTube.',
        `https://www.youtube.com/watch?v=${video}`].filter(Boolean).join(' '),
    };
  }
  const title = (page.title || '').trim();
  if (!title) return null;
  const author = /^https?:/i.test(page.author || '') ? '' : (page.author || '').trim();
  const site = (page.site || '').trim();
  const who = author || site;
  const date = apaDate(page.published);
  return {
    source: 'webpage', title, authors: author ? [author] : [], year: yearOf(date),
    citation: (who
      ? [sentence(who), `(${date || 'n.d.'}).`, sentence(title), site && site !== who && sentence(site), link]
      : [sentence(title), `(${date || 'n.d.'}).`, link]).filter(Boolean).join(' '),
  };
}

// ---------- Retractions and other updates ----------

// Crossref update types that withdraw a work; every other notice (correction, erratum,
// expression of concern, addendum, ...) is shown as a caution.
const WITHDRAWN = new Set(['retraction', 'withdrawal', 'removal', 'partial_retraction']);

/**
 * Notices about a work from its Crossref record's `updated-by` (Crossref's own and Retraction
 * Watch's, which Crossref merges in): [{ type, label, doi, year, severe }], oldest first.
 * The same notice reported by both sources appears once.
 */
export function parseUpdates(message) {
  const seen = new Set();
  const out = [];
  for (const u of message?.['updated-by'] || []) {
    const type = String(u.type || '').toLowerCase();
    const doi = u.DOI ? cleanDoi(u.DOI) : null;
    const key = `${type}|${(doi || '').toLowerCase()}`; // DOIs are case-insensitive
    if (!type || seen.has(key)) continue;
    seen.add(key);
    const label = type === 'retraction' ? 'Retracted'
      : u.label || type.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
    out.push({ type, label, doi, year: u.updated?.['date-parts']?.[0]?.[0] || null, severe: WITHDRAWN.has(type) });
  }
  return out.sort((a, b) => (a.year || 0) - (b.year || 0));
}

/**
 * An arXiv paper's withdrawal, from its DataCite record (arXiv DOIs are DataCite's). arXiv has
 * no formal notice: its free-text comment, which DataCite keeps as an "Other" description, says
 * "withdrawn". Returns [{ type, label, url, note, severe }] (the arXiv page shows the withdrawal)
 * or [].
 */
// ponytail: word match on an author comment, so "supersedes the withdrawn v1" also counts; the
// tag's tooltip shows the comment so a reader can judge.
export function parseArxivWithdrawal(doi, datacite) {
  const id = String(doi).match(/^10\.48550\/arxiv\.(.+)$/i)?.[1];
  const comment = (datacite?.data?.attributes?.descriptions || [])
    .find((d) => d.descriptionType === 'Other' && /\bwithdrawn\b/i.test(d.description || ''));
  if (!id || !comment) return [];
  return [{
    type: 'withdrawal', label: 'Withdrawn', url: `https://arxiv.org/abs/${id}`,
    note: comment.description.trim(), year: null, severe: true,
  }];
}

// ---------- popup heading ----------

/**
 * "Mary Ann Evans" or "Evans, Mary Ann" -> "Evans". Trailing Jr./III dropped. An organization
 * ("World Health Organization (WHO)") keeps its whole name, as APA does.
 */
// ponytail: last word only, so "Ludwig van Beethoven" -> "Beethoven"; add particles if that bites.
const ORG = /\b(organi[sz]ation|association|institute|society|council|department|agency|committee|commission|university|college|foundation|bureau|office|ministry|board|group|centre|center|nations|bank)\b/i;
export function surname(name) {
  const n = name.trim().replace(/,?\s+(jr|sr|ii|iii|iv)\.?$/i, '');
  if (ORG.test(n)) return n.replace(/\s*\([^)]*\)$/, '');
  return n.includes(',') ? n.split(',')[0].trim() : n.split(/\s+/).at(-1);
}

/** "Lucy Dacus" -> "Dacus, L."; "Mary Ann Evans" -> "Evans, M. A." */
export function apaName(name) {
  const parts = name.trim().split(/\s+/);
  if (parts.length < 2) return name.trim();
  return `${parts.at(-1)}, ${parts.slice(0, -1).map((p) => `${p[0]}.`).join(' ')}`;
}

/** APA narrative style: "Ivey (2026). Title", "Ivey and Smith (2026). …", "Ivey et al. (2026). …". */
export function citeLine({ authors = [], year = null, title = null }) {
  if (!authors.length) return title ? `${title}${year ? ` (${year})` : ''}` : '';
  const [a, b] = authors.map(surname);
  const who = authors.length === 1 ? a : authors.length === 2 ? `${a} and ${b}` : `${a} et al.`;
  const head = year ? `${who} (${year})` : who;
  return title ? `${head}. ${title}` : head;
}
