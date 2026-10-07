import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cleanDoi, findDoiInUrl, arxivDoi, openalexFromUrl, parseText,
  oaApiDoiUrl, refrunnerUrl, targetsFor, REFRUNNER_MAX_URL,
  surname, citeLine, registryOf, moreSearches, s2ApiDoiUrl, doiSearches,
  catalogFromUrl, parseCatalogRecord, recordCitation, freeCopies,
  parseUpdates, parseArxivWithdrawal,
} from '../lib/doi.js';

const PSYCH = '10.1111/j.1467-9280.2005.01636.x';

test('DOIs from publisher landing-page URLs', () => {
  const cases = {
    'https://journals.sagepub.com/doi/10.1111/j.1467-9280.2005.01636.x': PSYCH,
    'https://journals.sagepub.com/doi/full/10.1111/j.1467-9280.2005.01636.x': PSYCH,
    'https://journals.sagepub.com/doi/pdf/10.1111/j.1467-9280.2005.01636.x?download=true': PSYCH,
    'https://onlinelibrary.wiley.com/doi/10.1111/j.1467-9280.2005.01636.x/abstract': PSYCH,
    'https://onlinelibrary.wiley.com/doi/epdf/10.1111/j.1467-9280.2005.01636.x': PSYCH,
    'https://example.org/doi/10.1111%2Fj.1467-9280.2005.01636.x': PSYCH,
    'https://doi.org/10.1111/j.1467-9280.2005.01636.x': PSYCH,
    'https://search.crossref.org/?from_ui=yes&q=10.1111%2Fj.1467-9280.2005.01636.x': PSYCH,
    'https://www.tandfonline.com/doi/full/10.1080/00221309.2020.1234567?scroll=top&needAccess=true':
      '10.1080/00221309.2020.1234567',
    'https://link.springer.com/article/10.1007/s11192-021-04137-3': '10.1007/s11192-021-04137-3',
    'https://www.science.org/doi/10.1126/science.abc1234': '10.1126/science.abc1234',
    'https://www.jstor.org/stable/10.2307/1234567': '10.2307/1234567',
    'https://www.thelancet.com/journals/lancet/article/PIIS0140-6736(20)30183-5/fulltext': null,
    'https://doi.org/10.1016/S0140-6736(20)30183-5': '10.1016/S0140-6736(20)30183-5',
    'https://www.sciencedirect.com/science/article/pii/S0140673620301835': null,
  };
  for (const [url, want] of Object.entries(cases)) assert.equal(findDoiInUrl(url), want, url);
});

test('cleanDoi trims sentence punctuation but keeps balanced parentheses', () => {
  assert.equal(cleanDoi(`${PSYCH}.`), PSYCH);
  assert.equal(cleanDoi(`(see ${PSYCH})`), PSYCH);
  assert.equal(cleanDoi('10.1016/S0140-6736(20)30183-5.'), '10.1016/S0140-6736(20)30183-5');
  assert.equal(cleanDoi('info:doi/10.1037/0003-066X.59.1.29'), '10.1037/0003-066X.59.1.29');
  assert.equal(cleanDoi('no doi here'), null);
});

test('arXiv URLs map to DataCite DOIs', () => {
  assert.equal(arxivDoi('https://arxiv.org/abs/2101.00001v2'), '10.48550/arXiv.2101.00001');
  assert.equal(arxivDoi('https://arxiv.org/pdf/2101.00001'), '10.48550/arXiv.2101.00001');
  assert.equal(arxivDoi('https://arxiv.org/abs/hep-th/9901001'), '10.48550/arXiv.hep-th/9901001');
  assert.equal(arxivDoi('https://arxiv.org/list/cs.AI/recent'), null);
});

test('OpenAlex IDs from web and API URLs', () => {
  const w = { type: 'works', id: 'W2974823616' };
  assert.deepEqual(openalexFromUrl('https://openalex.org/works/W2974823616'), w);
  assert.deepEqual(openalexFromUrl('https://openalex.org/W2974823616'), w);
  assert.deepEqual(openalexFromUrl('https://api.openalex.org/w2974823616'), w);
  assert.deepEqual(openalexFromUrl('https://api.openalex.org/works/W2974823616?select=id'), w);
  assert.deepEqual(openalexFromUrl('https://openalex.org/works?page=1&zoom=w2974823616'), w);
  assert.deepEqual(openalexFromUrl('https://openalex.org/authors/A5023888391'), { type: 'authors', id: 'A5023888391' });
  assert.equal(openalexFromUrl('https://example.com/works/W2974823616'), null);
});

test('parseText: identifiers only vs. a full citation', () => {
  let p = parseText('doi: 10.1111/j.1467-9280.2005.01636.x');
  assert.deepEqual(p.dois, [PSYCH]);
  assert.equal(p.onlyIds, true);

  p = parseText('10.1111/a.1, 10.1111/b.2; https://doi.org/10.1111/c.3');
  assert.deepEqual(p.dois, ['10.1111/a.1', '10.1111/b.2', '10.1111/c.3']);
  assert.equal(p.onlyIds, true);

  p = parseText('Smith, J. (2005). A title. Psychological Science, 16(1), 1-5. https://doi.org/10.1111/j.1467-9280.2005.01636.x');
  assert.deepEqual(p.dois, [PSYCH]);
  assert.equal(p.onlyIds, false);

  // A few words around the DOI are selection noise: just the DOI.
  p = parseText('2257. DOI=http://dx.doi.org/10.1145/2858036.2858198');
  assert.deepEqual(p.dois, ['10.1145/2858036.2858198']);
  assert.equal(p.onlyIds, true);
  assert.equal(refrunnerUrl(p).url.split('?')[0], 'https://www.refrunner.com/10.1145/2858036.2858198');
  // Five words or more is a reference (or most of one): send it all.
  p = parseText('Barrio et al. Improving comprehension of numbers. https://doi.org/10.1145/2858036.2858510');
  assert.equal(p.onlyIds, false);

  p = parseText('W2974823616');
  assert.deepEqual(p.openalex, [{ type: 'works', id: 'W2974823616' }]);
  assert.equal(p.onlyIds, true);

  p = parseText('Highly accurate protein structure prediction');
  assert.deepEqual(p.dois, []);
  assert.equal(p.onlyIds, false);
});

test('OpenAlex API URL for one or many DOIs', () => {
  assert.equal(oaApiDoiUrl([PSYCH]), `https://api.openalex.org/works/doi:${PSYCH}`);
  assert.match(oaApiDoiUrl(['10.1234/a', '10.1234/b']), /works\?filter=doi:https%3A%2F%2Fdoi\.org%2F10\.1234%2Fa\|/);
});

test('RefRunner URLs follow the llms.txt recipe', () => {
  assert.equal(
    refrunnerUrl(parseText(PSYCH)).url,
    `https://www.refrunner.com/${PSYCH}?utm_source=chrome-extension`,
  );
  assert.equal(
    refrunnerUrl(parseText('10.1234/a 10.1234/b')).url,
    'https://www.refrunner.com/cite/10.1234/a,10.1234/b?utm_source=chrome-extension',
  );
  const list = 'Smith (2020). One.\n\nJones (2021). Two.';
  assert.equal(
    refrunnerUrl(parseText(list), { base: 'http://localhost:5173/' }).url,
    'http://localhost:5173/?utm_source=chrome-extension#refs=Smith+%282020%29.+One.%0AJones+%282021%29.+Two.',
  );
  const big = refrunnerUrl(parseText('x'.repeat(REFRUNNER_MAX_URL)));
  assert.equal(big.overflow, true);
  assert.equal(big.url, 'https://www.refrunner.com/check');
});

test('targetsFor offers the expected destinations', () => {
  const labels = (p, ra) => targetsFor(p, { ra }).map((t) => `${t.group}/${t.label}`);
  assert.deepEqual(labels(parseText(PSYCH)), [
    'Metadata sources/OpenAlex API', 'Metadata sources/Crossref search', 'Metadata sources/Crossref API',
    'Search/Google Scholar', 'Search/Semantic Scholar', 'Search/Google', 'Search/PubMed',
    'Search/Europe PMC', 'Search/Wikidata',
    'API/Semantic Scholar', 'API/PubMed', 'API/Europe PMC', 'API/Wikidata',
    'API/OpenCitations (citation count)',
    'RefRunner/Send to RefRunner',
  ]);
  assert.deepEqual(labels(parseText('https://openalex.org/works/W2974823616')), [
    'Metadata sources/OpenAlex API', 'Metadata sources/OpenAlex',
  ]);
  assert.deepEqual(labels(parseText('some title words')), [
    'Search/Crossref', 'Search/OpenAlex', 'Search/Google Scholar', 'Search/Semantic Scholar', 'Search/Google',
    'Search/JSTOR', 'Search/ERIC', 'Search/Library of Congress', 'Search/Open Library',
    'Search/Google Books', 'Search/ResearchGate',
    'API/OpenAlex', 'API/Semantic Scholar', 'API/ERIC', 'API/Library of Congress',
    'API/Open Library', 'API/Google Books',
    'RefRunner/Add to RefRunner References',
  ]);
  const groups = (p, ra) => [...new Set(targetsFor(p, { ra }).map((t) => t.group))];
  // arXiv is DataCite even before doi.org answers; doi.org's answer wins; other registries get no registry links.
  assert.deepEqual(labels(parseText('10.48550/arXiv.2101.00001')).slice(0, 3), [
    'Metadata sources/OpenAlex API', 'Metadata sources/DataCite', 'Metadata sources/DataCite API',
  ]);
  assert.ok(labels(parseText('10.5281/zenodo.123'), { '10.5281/zenodo.123': 'DataCite' }).includes('Metadata sources/DataCite'));
  assert.deepEqual(groups(parseText('10.1400/123'), { '10.1400/123': 'mEDRA' }), ['Metadata sources', 'Search', 'API', 'RefRunner']);
  assert.equal(registryOf('10.1111/X', { '10.1111/x': 'Crossref' }), 'Crossref');
});

test('moreSearches builds each page and API URL from the query', () => {
  const s = Object.fromEntries(moreSearches('Lester  (2019)\ndiscursive').map((m) => [m.label, m]));
  assert.equal(s['Semantic Scholar'].url, 'https://www.semanticscholar.org/search?q=Lester%20(2019)%20discursive');
  assert.match(s['Semantic Scholar'].api, /^https:\/\/api\.semanticscholar\.org\/graph\/v1\/paper\/search\?query=Lester%20/);
  assert.equal(s['Library of Congress'].url, 'https://search.catalog.loc.gov/search?option=keyword&query=Lester%20(2019)%20discursive');
  assert.match(s['Library of Congress'].api, /LCDB\?.*&query=Lester%20and%202019%20and%20discursive$/);
  assert.equal(s.Google.api, null);
  assert.equal(s2ApiDoiUrl(PSYCH).split('?')[0], `https://api.semanticscholar.org/graph/v1/paper/DOI:${PSYCH}`);
  const d = Object.fromEntries(doiSearches(PSYCH).map((m) => [m.label, m]));
  assert.equal(d.PubMed.url, `https://pubmed.ncbi.nlm.nih.gov/?term=${encodeURIComponent(PSYCH)}%5Bdoi%5D`);
  assert.equal(d['OpenCitations (citation count)'].url, null);
});

test('popup heading is APA narrative style', () => {
  assert.equal(surname('Mary Ann Evans'), 'Evans');
  assert.equal(surname('Evans, Mary Ann'), 'Evans');
  assert.equal(surname('Martin Luther King Jr.'), 'King');
  const title = 'A Title';
  assert.equal(citeLine({ authors: ['Jo Ivey'], year: 2026, title }), 'Ivey (2026). A Title');
  assert.equal(citeLine({ authors: ['Jo Ivey', 'Smith, A.'], year: 2026, title }), 'Ivey and Smith (2026). A Title');
  assert.equal(citeLine({ authors: ['Jo Ivey', 'B', 'C'], year: 2026, title }), 'Ivey et al. (2026). A Title');
  assert.equal(citeLine({ authors: ['Jo Ivey'], title }), 'Ivey. A Title');
  assert.equal(citeLine({ year: 2026, title }), 'A Title (2026)');
  assert.equal(citeLine({}), '');
});

test('catalog records: id from the URL, a citation, links, and searches by title', () => {
  assert.deepEqual(catalogFromUrl('https://openlibrary.org/books/OL483046M/Female_genital_mutilation'), { kind: 'openlibrary', id: 'OL483046M' });
  assert.equal(catalogFromUrl('https://openlibrary.org/works/OL123W'), null);
  assert.equal(catalogFromUrl('https://example.com/books/OL483046M'), null);
  assert.deepEqual(catalogFromUrl('https://eric.ed.gov/?id=ED591473'), { kind: 'eric', id: 'ED591473' });
  assert.deepEqual(catalogFromUrl('https://eric.ed.gov/?q=social+media&id=EJ1172284'), { kind: 'eric', id: 'EJ1172284' });

  // Open Library (Books API shape, trimmed)
  const ol = parseCatalogRecord({ kind: 'openlibrary', id: 'OL483046M' }, { 'OLID:OL483046M': {
    title: 'Female genital mutilation', subtitle: 'an overview', authors: [{ name: 'World Health Organization (WHO)' }],
    publish_date: '1998', publishers: [{ name: 'World Health Organization' }], identifiers: { isbn_10: ['9241561912'] },
  } });
  assert.equal(recordCitation(ol), 'World Health Organization (WHO) (1998). Female genital mutilation: an overview. World Health Organization. ISBN 9241561912');
  assert.equal(surname('World Health Organization (WHO)'), 'World Health Organization');
  assert.equal(citeLine({ authors: ol.authors, year: 1998, title: 'X' }), 'World Health Organization (1998). X');
  const targets = targetsFor({ dois: [], openalex: [], catalog: { kind: 'openlibrary', id: 'OL483046M' }, text: recordCitation(ol), leftover: ol.title, onlyIds: false });
  const urls = Object.fromEntries(targets.map((t) => [`${t.group}/${t.label}`, t.url]));
  assert.equal(urls['Metadata sources/Open Library API'], 'https://openlibrary.org/api/books?bibkeys=OLID:OL483046M&jscmd=data&format=json');
  assert.match(urls['Search/Open Library'], /search\?q=Female%20genital%20mutilation$/);
  assert.match(urls['RefRunner/Add to RefRunner References'], /#refs=World\+Health/);

  // ERIC (API shape, trimmed): an ED dissertation, and a record that carries a DOI
  const ed = parseCatalogRecord({ kind: 'eric', id: 'ED591473' }, { response: { docs: [{
    title: 'Social Media and the College Student Journey', author: ['Horvath-Plyman, Melissa'], publicationdateyear: 2018,
    publisher: 'ProQuest LLC. 789 East Eisenhower Parkway, P.O. Box 1346', isbn: ['978-0-4385-3145-1'],
  }] } });
  assert.equal(recordCitation(ed), 'Horvath-Plyman, Melissa (2018). Social Media and the College Student Journey. ProQuest LLC. ISBN 978-0-4385-3145-1');
  assert.equal(ed.doi, null);
  const withDoi = parseCatalogRecord({ kind: 'eric', id: 'ED663658' }, { response: { docs: [{ title: 'T', url: 'https://doi.org/10.1353/jaie.2020.0012' }] } });
  assert.equal(withDoi.doi, '10.1353/jaie.2020.0012');
  assert.equal(parseCatalogRecord({ kind: 'eric', id: 'ED1' }, { response: { docs: [] } }), null);
  const ericLinks = targetsFor({ dois: [], openalex: [], catalog: { kind: 'eric', id: 'ED591473' }, text: 'x y', onlyIds: false })
    .filter((t) => t.group === 'Metadata sources').map((t) => `${t.label}|${t.short || ''}|${t.url}`);
  assert.deepEqual(ericLinks, ['ERIC||https://eric.ed.gov/?id=ED591473', 'ERIC API||https://api.ies.ed.gov/eric/?search=id:ED591473&format=json&fields=id,title,author,source,publicationdateyear,publicationtype,publisher,isbn,issn,url,peerreviewed,description,subject']);
});

test('free copies from OpenAlex locations: PDFs and PMC, repositories first, no index listings', () => {
  // AlphaFold (10.1038/s41586-021-03819-2), OpenAlex locations trimmed: the publisher's PDF,
  // a PMC copy with no pdf_url, and "open" index listings that are not copies.
  const alphafold = [
    { is_oa: true, pdf_url: 'https://www.nature.com/articles/s41586-021-03819-2.pdf', landing_page_url: 'https://doi.org/10.1038/s41586-021-03819-2', version: 'publishedVersion', source: { display_name: 'Nature', type: 'journal' } },
    { is_oa: false, pdf_url: null, landing_page_url: 'https://pubmed.ncbi.nlm.nih.gov/34265844', source: { display_name: 'PubMed', type: 'repository' } },
    { is_oa: true, pdf_url: null, landing_page_url: 'https://www.ncbi.nlm.nih.gov/pmc/articles/8371605', version: 'submittedVersion', source: { display_name: 'PubMed Central', type: 'repository' } },
    { is_oa: true, pdf_url: null, landing_page_url: 'https://doi.org/10.25504/fairsharing.246086', source: { display_name: 'FAIRsharing.org', type: 'repository' } },
  ];
  const copies = freeCopies(alphafold);
  assert.deepEqual(copies.map((c) => [c.host, c.pdf, c.url]), [
    ['PubMed Central', false, 'https://www.ncbi.nlm.nih.gov/pmc/articles/8371605'],
    ['Nature', true, 'https://www.nature.com/articles/s41586-021-03819-2.pdf'],
  ]);
  const links = targetsFor({ dois: ['10.1038/s41586-021-03819-2'], openalex: [], pdfs: copies, text: 'x', onlyIds: true })
    .filter((t) => t.group === 'Free copy').map((t) => `${t.label}|${t.detail}`);
  assert.deepEqual(links, ['PubMed Central full text|preprint', 'Nature PDF|published version']);
  // A repository PDF (arXiv) leads; duplicates and junk drop out; at most three.
  const arxiv = { is_oa: true, pdf_url: 'https://arxiv.org/pdf/2101.00001', version: 'submittedVersion', source: { display_name: 'arXiv', type: 'repository' } };
  assert.equal(freeCopies([alphafold[0], arxiv, arxiv])[0].host, 'arXiv');
  assert.equal(freeCopies([alphafold[0], arxiv, alphafold[2], { ...arxiv, pdf_url: 'https://x.org/a.pdf', source: null }]).length, 3);
  assert.deepEqual(freeCopies(undefined), []);
});

test('parseText: ERIC and Open Library links and bare ERIC numbers name a catalog record', () => {
  const link = parseText('https://eric.ed.gov/?id=ED591473');
  assert.deepEqual([link.catalog, link.onlyIds, link.dois], [{ kind: 'eric', id: 'ED591473' }, true, []]);
  assert.deepEqual(parseText('ERIC Number: EJ1172284').catalog, { kind: 'eric', id: 'EJ1172284' });
  assert.deepEqual(parseText('https://openlibrary.org/books/OL483046M/Female_genital_mutilation').catalog,
    { kind: 'openlibrary', id: 'OL483046M' });
  // A citation that contains the link keeps its text for RefRunner.
  const cite = parseText('Horvath-Plyman, M. (2018). Social media and the college student journey. https://eric.ed.gov/?id=ED591473');
  assert.deepEqual([cite.catalog?.id, cite.onlyIds], ['ED591473', false]);
  // Other links and words are not catalog records.
  assert.equal(parseText('https://example.com/?id=ED591473x').catalog, null);
  assert.equal(parseText('Reduced costs').catalog, null);
});

test('parseUpdates: retraction and correction notices from Crossref updated-by', () => {
  // Wakefield et al. 1998 (10.1016/S0140-6736(97)11096-0), as Crossref returns it (trimmed).
  const wakefield = { 'updated-by': [
    { DOI: '10.1016/s0140-6736(04)15715-2', type: 'correction', label: 'Correction', source: 'retraction-watch', updated: { 'date-parts': [[2004, 3, 6]] } },
    { DOI: '10.1016/s0140-6736(10)60175-4', type: 'retraction', label: 'Retraction', source: 'retraction-watch', updated: { 'date-parts': [[2010, 2, 6]] } },
    // The same retraction deposited by the publisher too: shown once.
    { DOI: '10.1016/S0140-6736(10)60175-4', type: 'retraction', label: 'Retraction', source: 'publisher', updated: { 'date-parts': [[2010, 2, 6]] } },
  ] };
  assert.deepEqual(parseUpdates(wakefield).map((u) => [u.label, u.year, u.severe, u.doi]), [
    ['Correction', 2004, false, '10.1016/s0140-6736(04)15715-2'],
    ['Retracted', 2010, true, '10.1016/s0140-6736(10)60175-4'],
  ]);
  assert.deepEqual(parseUpdates({ 'updated-by': [{ DOI: '10.1/x', type: 'expression_of_concern' }] })
    .map((u) => [u.label, u.severe]), [['Expression of concern', false]]);
  assert.deepEqual(parseUpdates({}), []);
  assert.deepEqual(parseUpdates(undefined), []);
});

test('parseArxivWithdrawal: an arXiv comment saying "withdrawn", from DataCite', () => {
  // 10.48550/arXiv.1003.2568 as DataCite returns it (trimmed).
  const rec = (comment) => ({ data: { attributes: { descriptions: [
    { descriptionType: 'Abstract', description: 'Spectroscopically identified white dwarfs ... later withdrawn from the catalog' },
    ...(comment ? [{ descriptionType: 'Other', description: comment }] : []),
  ] } } });
  assert.deepEqual(parseArxivWithdrawal('10.48550/arXiv.1003.2568', rec('withdrawn')),
    [{ type: 'withdrawal', label: 'Withdrawn', url: 'https://arxiv.org/abs/1003.2568', note: 'withdrawn', year: null, severe: true }]);
  assert.equal(parseArxivWithdrawal('10.48550/arXiv.math/9911108', rec('This paper has been withdrawn by the author'))[0].url,
    'https://arxiv.org/abs/math/9911108');
  // The abstract mentioning the word doesn't count; nor does a comment without it.
  assert.deepEqual(parseArxivWithdrawal('10.48550/arXiv.1003.2568', rec(null)), []);
  assert.deepEqual(parseArxivWithdrawal('10.48550/arXiv.1003.2568', rec('15 pages, 3 figures')), []);
  assert.deepEqual(parseArxivWithdrawal('10.1037/x', rec('withdrawn')), []);
});
