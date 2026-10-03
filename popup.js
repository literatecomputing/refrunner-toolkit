import { parseText, targetsFor, citeLine, doiOrgUrl, bookCitation, REFRUNNER_DEV_BASE } from './lib/doi.js';
import {
  detectForTab, readSelection, IS_DEV, refrunnerBase, lookupWork, lookupBook, lookupRegistries, openTab, openOverflow, handToOpenTab,
} from './lib/chrome.js';

const $ = (sel) => document.querySelector(sel);
const SOURCE_LABELS = {
  url: 'DOI from the page URL',
  arxiv: 'arXiv DOI from the page URL',
  meta: 'DOI from the page metadata',
  openalex: 'OpenAlex record',
  openlibrary: 'Open Library edition',
  manual: 'From what you pasted',
  selection: 'From your selection',
};

let tab;
let pageState = null;
let renderToken = 0;
let base;
let shown = null;

init();

async function init() {
  [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  $('#groups').addEventListener('click', onLinkClick);
  $('#open-doi').addEventListener('click', onLinkClick);
  $('#ids').addEventListener('click', onCopyClick);
  $('#manual').addEventListener('input', debounce(onManualInput, 250));
  // Enter in the paste box sends what's there to RefRunner, without waiting for the debounce.
  $('#manual').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.isComposing || !e.target.value.trim()) return;
    e.preventDefault();
    onManualInput(e);
    $('#groups .refrunner .btn')?.click();
  });
  showShortcuts();
  base = await refrunnerBase();
  if (IS_DEV) setUpDevToggle();

  // Selected text wins over the page, as it does in the right-click menu.
  const selection = await readSelection(tab);
  if (selection) return show((pageState = stateFrom({ ...parseText(selection), source: 'selection' })));

  const d = await detectForTab(tab);
  pageState = stateFrom({
    dois: d.doi ? [d.doi] : [],
    openalex: d.openalex ? [d.openalex] : [],
    openlibrary: d.openlibrary,
    source: d.source,
    title: d.title,
    authors: d.authors,
    year: d.year,
  });
  show(pageState);
  // A book's citation (and its RefRunner button) arrives after the lookup; let that take focus.
  if (!$('#groups .refrunner .btn') && !pageState.openlibrary) $('#manual').focus();
}

function stateFrom({ dois = [], openalex = [], openlibrary = null, source = null, title = null, authors = [], year = null, text, leftover = '', onlyIds = true }) {
  return {
    dois, openalex, openlibrary, isbn: '', source, title, authors, year, leftover, onlyIds,
    text: text ?? [...dois, ...openalex.map((o) => o.id)].join('\n'),
    note: '', ra: {},
  };
}

function onManualInput(e) {
  const value = e.target.value.trim();
  if (!value) return show(pageState);
  const p = parseText(value);
  show(stateFrom({ ...p, source: 'manual' }));
}

/**
 * Render now, then enrich from OpenAlex (title, missing DOI or W-id), then from doi.org
 * (which registry holds each DOI), re-rendering after each.
 */
async function show(state) {
  const token = ++renderToken;
  render(state);
  // One DOI or id, alone or inside a selected citation: look it up either way (the OpenAlex
  // page button needs the W-id). A citation's own text is still what RefRunner gets.
  const single = state.dois.length + state.openalex.length === 1;
  const isWork = state.dois.length || state.openalex[0]?.type === 'works';
  let next = state;
  // An Open Library edition: its record becomes a citation, so it gets the catalog searches
  // (by title) and RefRunner checks the whole reference.
  if (state.openlibrary && !state.dois.length) {
    const b = await lookupBook(state.openlibrary);
    if (token !== renderToken) return;
    if (b.found) {
      render((next = {
        ...state, title: b.subtitle ? `${b.title}: ${b.subtitle}` : b.title, authors: b.authors,
        year: b.year, isbn: b.isbn, text: bookCitation(b), leftover: b.title, onlyIds: false,
      }));
    } else {
      render((next = { ...state, note: b.error || 'Not found in Open Library.' }));
    }
  }
  if (single && isWork) {
    const w = await lookupWork({ doi: state.dois[0], openalex: state.openalex[0] });
    if (token !== renderToken) return;
    if (w) render((next = enrich(state, w)));
  }
  const ra = await lookupRegistries(next.dois);
  if (token !== renderToken || !Object.keys(ra).length) return;
  render({ ...next, ra });
}

function enrich(state, w) {
  const next = { ...state };
  if (w.found) {
    next.title = w.title || state.title;
    if (w.authors.length) next.authors = w.authors;
    next.year = w.year || state.year;
    if (!next.dois.length && w.doi) next.dois = [w.doi];
    if (!next.openalex.length && w.id) next.openalex = [{ type: 'works', id: w.id }];
    if (state.onlyIds) next.text = [...next.dois, ...next.openalex.map((o) => o.id)].join('\n');
  } else if (w.found === false) {
    next.note = 'Not found in OpenAlex.';
  } else if (w.error) {
    next.note = w.error;
  }
  return next;
}

function render(state) {
  shown = state;
  const hasIds = state.dois.length || state.openalex.length || state.openlibrary;
  $('#found').hidden = !hasIds;
  $('#empty').hidden = !!hasIds || ['manual', 'selection'].includes(state.source);

  $('#source').textContent = SOURCE_LABELS[state.source] || '';
  $('#title').textContent = citeLine(state);
  $('#note').textContent = state.note || '';

  // The DOI itself, at doi.org: one link on the title line rather than a section of its own.
  const open = $('#open-doi');
  open.hidden = !state.dois.length;
  if (state.dois.length) {
    open.href = doiOrgUrl(state.dois[0]);
    open.title = `Open ${state.dois[0]} at doi.org`;
  }

  const ids = $('#ids');
  ids.replaceChildren(
    ...state.dois.map((d) => idRow('DOI', d)),
    ...state.openalex.map((o) => idRow('OA', o.id)),
    ...(state.openlibrary ? [idRow('OL', state.openlibrary)] : []),
    ...(state.isbn ? [idRow('ISBN', state.isbn)] : []),
  );

  const groups = new Map();
  for (const t of targetsFor(state, { ra: state.ra, base })) {
    if (!groups.has(t.group)) groups.set(t.group, []);
    groups.get(t.group).push(t);
  }
  // RefRunner first, and focused (unless you're typing), so Enter sends it.
  const ordered = [...groups].sort(([a], [b]) => (b === 'RefRunner') - (a === 'RefRunner'));
  $('#groups').replaceChildren(...ordered.map(([name, items]) => groupEl(name, items)));
  const rr = $('#groups .refrunner .btn');
  if (rr && document.activeElement === document.body) rr.focus();
}

function idRow(label, value) {
  const row = el('div', 'id-row');
  row.append(el('span', 'label', label), el('span', 'mono', value));
  const btn = el('button', 'copy', 'Copy');
  btn.dataset.copy = value;
  row.append(btn);
  return row;
}

function groupEl(name, items) {
  const g = el('section', `group${name === 'RefRunner' ? ' refrunner' : ''}`);
  g.append(el('h2', '', name));
  const links = el('div', 'links');
  for (const t of items) {
    const a = el('a', name === 'RefRunner' ? 'btn primary' : 'btn', t.short || t.label);
    a.href = t.url;
    a.title = t.overflow ? 'Too long for a link: copy the text, then paste it into RefRunner' : `${t.label}\n${t.url}`;
    if (t.icon) {
      const img = el('img', `src-logo src-logo-${t.icon}`);
      img.src = `icons/${t.icon}.${['openalex', 'openlibrary'].includes(t.icon) ? 'png' : 'svg'}`;
      img.alt = '';
      a.prepend(img);
      a.setAttribute('aria-label', t.label);
    }
    if (t.overflow) {
      a.dataset.overflow = '1';
      a.dataset.refs = t.refs;
    }
    if (t.handoff) a.dataset.handoff = t.handoff;
    links.append(a);
  }
  g.append(links);
  return g;
}

async function onLinkClick(e) {
  const a = e.target.closest('a.btn');
  if (!a) return;
  e.preventDefault();
  const keepOpen = e.ctrlKey || e.metaKey || e.button === 1;
  // An open RefRunner tab takes it, unless a new tab was asked for (Ctrl/middle-click).
  if (a.dataset.handoff && !keepOpen && (await handToOpenTab(base, a.dataset.handoff))) {
    return window.close();
  }
  if (a.dataset.overflow) {
    await openOverflow(a.dataset.refs, a.href, tab);
    return window.close();
  }
  await openTab(a.href, tab, { background: keepOpen });
  if (!keepOpen) window.close();
}

async function onCopyClick(e) {
  const btn = e.target.closest('button[data-copy]');
  if (!btn) return;
  await navigator.clipboard.writeText(btn.dataset.copy);
  btn.textContent = 'Copied';
  setTimeout(() => { btn.textContent = 'Copy'; }, 1200);
}

function el(tag, className = '', text = '') {
  const n = document.createElement(tag);
  if (className) n.className = className;
  if (text) n.textContent = text;
  return n;
}

function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

// Extensions can't assign their own keys, and Chrome applies the manifest's suggestions only on
// first install, so show what's set and link to Chrome's shortcuts page.
const KEY_LABELS = { _execute_action: 'popup', 'openalex-api': 'OpenAlex', 'send-refrunner': 'RefRunner' };
async function showShortcuts() {
  const cmds = await chrome.commands.getAll();
  $('#keys').replaceChildren(...cmds.flatMap((c, i) => [
    i ? ' · ' : '', el('kbd', '', c.shortcut || 'not set'), ` ${KEY_LABELS[c.name] || c.name}`,
  ]));
  $('#set-keys').addEventListener('click', (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
    window.close();
  });
}

function setUpDevToggle() {
  const box = $('#dev-server');
  const access = $('#dev-access');
  const origins = [`${REFRUNNER_DEV_BASE}/*`];
  // Reaching an open dev-server tab needs host access (optional in the manifest, so store
  // installs never see "localhost"). Asked for on ticking the box, and offered whenever the
  // box is on without it — a box ticked before this existed never asked. Declined: new tabs.
  const showAccess = async () => {
    access.hidden = !box.checked || (await chrome.permissions.contains({ origins }));
  };
  const ask = () => chrome.permissions.request({ origins }).catch(() => false).then(showAccess);
  box.checked = base === REFRUNNER_DEV_BASE;
  $('#dev-label').hidden = false;
  showAccess();
  access.addEventListener('click', (e) => {
    e.preventDefault();
    ask();
  });
  box.addEventListener('change', async () => {
    if (box.checked) await ask();
    else await showAccess();
    await chrome.storage.local.set({ useDevServer: box.checked });
    base = await refrunnerBase();
    if (shown) render(shown);
  });
}
