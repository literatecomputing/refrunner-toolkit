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

// Edit locally to point at a dev server, e.g. 'http://localhost:5173'. Don't ship that.
export const REFRUNNER_BASE = 'https://www.refrunner.com';
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

/**
 * Parse selected text, a pasted value, or a link URL.
 * Returns { dois, openalex, leftover, onlyIds, text }.
 * onlyIds is true when nothing but identifiers (and separators) was given.
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

  // One pass over URLs, bare DOIs and bare W-ids, so results keep document order.
  const TOKEN_RE = new RegExp(
    `(${URL_RE.source})|(?:\\bdoi\\s*:?\\s*)?(${DOI_TEXT_RE.source})|\\b(W\\d{6,})\\b`,
    'gi',
  );
  const rest = text.replace(TOKEN_RE, (whole, url, doiText, wid) => {
    if (url) {
      let u = url.replace(/[.,;:'"]+$/, '');
      u = stripUnbalanced(u, '(', ')');
      const oa = openalexFromUrl(u);
      const doi = findDoiInUrl(u) || arxivDoi(u);
      addOa(oa);
      addDoi(doi);
      return oa || doi ? ' ' : whole;
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
  const onlyIds = (dois.length > 0 || openalex.length > 0) && !/[\p{L}\p{N}]/u.test(leftover);
  return { dois, openalex, leftover, onlyIds, text };
}

// ---------- URL builders ----------

/** Encode a DOI for use as a URL path, keeping its slashes readable. */
export const encodeDoiPath = (doi) => encodeURIComponent(doi).replace(/%2F/gi, '/');

export const oaApiUrl = (oa) => `https://api.openalex.org/${oa.type}/${oa.id}`;
export const oaWebUrl = (oa) => `https://openalex.org/${oa.type}/${oa.id}`;
export const oaSearchUrl = (q) =>
  `https://api.openalex.org/works?search=${encodeURIComponent(String(q).slice(0, 300))}`;

export function oaApiDoiUrl(dois) {
  if (dois.length === 1) return `https://api.openalex.org/works/doi:${encodeDoiPath(dois[0])}`;
  const list = dois.slice(0, 50).map((d) => encodeURIComponent(`https://doi.org/${d}`)).join('|');
  return `https://api.openalex.org/works?filter=doi:${list}`;
}

export const crossrefSearchUrl = (q) =>
  `https://search.crossref.org/?from_ui=yes&q=${encodeURIComponent(String(q).slice(0, 500))}`;
export const crossrefApiUrl = (doi) => `https://api.crossref.org/works/${encodeDoiPath(doi)}`;
export const doiOrgUrl = (doi) => `https://doi.org/${encodeDoiPath(doi)}`;

/**
 * RefRunner link, per https://www.refrunner.com/llms.txt:
 *   one DOI      -> /<DOI>
 *   several DOIs -> /cite/<DOI>,<DOI>
 *   anything else-> /#refs=<percent-encoded list, one per line>
 * Returns { url, overflow, refs? } or null. overflow=true means the list was too long
 * for a URL; url is then the /check page and refs holds the text to paste.
 */
export function refrunnerUrl(parsed, { base = REFRUNNER_BASE } = {}) {
  const root = base.replace(/\/+$/, '');
  const qs = `utm_source=${UTM_SOURCE}`;

  if (parsed.dois.length && parsed.onlyIds) {
    const path = parsed.dois.length === 1
      ? encodeDoiPath(parsed.dois[0])
      : 'cite/' + parsed.dois.map(encodeDoiPath).join(',');
    return { url: `${root}/${path}?${qs}`, overflow: false };
  }

  const refs = parsed.text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
  if (!refs) return null;
  // Form encoding (spaces as +), as RefRunner's own share links do; it reads the hash with URLSearchParams.
  const url = `${root}/?${qs}#${new URLSearchParams({ refs })}`;
  if (url.length <= REFRUNNER_MAX_URL) return { url, overflow: false };
  return { url: `${root}/check`, overflow: true, refs };
}

/**
 * Everything the popup offers for a set of identifiers or a text query.
 * Returns [{ group, label, url, overflow?, refs? }].
 */
export function targetsFor(parsed) {
  const { dois, openalex } = parsed;
  const out = [];
  const add = (group, label, url, extra = {}) => out.push({ group, label, url, ...extra });
  const work = openalex.find((o) => o.type === 'works');

  // OpenAlex
  if (openalex.length) {
    for (const o of openalex) {
      add('OpenAlex', openalex.length > 1 ? `API: ${o.id}` : 'API record', oaApiUrl(o));
      add('OpenAlex', openalex.length > 1 ? `Page: ${o.id}` : 'Web page', oaWebUrl(o));
    }
  }
  if (dois.length && !work) add('OpenAlex', dois.length > 1 ? 'API records (all DOIs)' : 'API record', oaApiDoiUrl(dois));
  if (!dois.length && !openalex.length && parsed.text) add('OpenAlex', 'API search', oaSearchUrl(parsed.text));

  // Crossref
  if (dois.length) {
    for (const d of dois.slice(0, 5)) {
      add('Crossref', dois.length > 1 ? `Search: ${d}` : 'Search', crossrefSearchUrl(d));
      add('Crossref', dois.length > 1 ? `API: ${d}` : 'API record', crossrefApiUrl(d));
    }
  } else if (!openalex.length && parsed.text) {
    add('Crossref', 'Search', crossrefSearchUrl(parsed.leftover || parsed.text));
  }

  // doi.org
  for (const d of dois.slice(0, 5)) add('Resolve', dois.length > 1 ? `doi.org: ${d}` : 'doi.org', doiOrgUrl(d));

  // RefRunner (needs DOIs or real reference text; bare OpenAlex IDs don't work there)
  if (dois.length || (parsed.text && !parsed.onlyIds)) {
    const r = refrunnerUrl(parsed);
    if (r) {
      const label = parsed.onlyIds
        ? (dois.length > 1 ? `Send ${dois.length} DOIs to RefRunner` : 'Send to RefRunner')
        : 'Check this text in RefRunner';
      add('RefRunner', label, r.url, { overflow: r.overflow, refs: r.refs });
    }
  }
  return out;
}
