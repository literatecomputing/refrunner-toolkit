import { parseText, targetsFor, citeLine, REFRUNNER_DEV_BASE } from './lib/doi.js';
import { detectForTab, readSelection, IS_DEV, refrunnerBase, lookupWork, lookupRegistries, openTab, openOverflow } from './lib/chrome.js';

const $ = (sel) => document.querySelector(sel);
const SOURCE_LABELS = {
  url: 'DOI from the page URL',
  arxiv: 'arXiv DOI from the page URL',
  meta: 'DOI from the page metadata',
  openalex: 'OpenAlex record',
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
  $('#ids').addEventListener('click', onCopyClick);
  $('#manual').addEventListener('input', debounce(onManualInput, 250));
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
    source: d.source,
    title: d.title,
    authors: d.authors,
    year: d.year,
  });
  show(pageState);
  if (!pageState.dois.length && !pageState.openalex.length) $('#manual').focus();
}

function stateFrom({ dois = [], openalex = [], source = null, title = null, authors = [], year = null, text, leftover = '', onlyIds = true }) {
  return {
    dois, openalex, source, title, authors, year, leftover, onlyIds,
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
  const single = state.onlyIds && state.dois.length + state.openalex.length === 1;
  const isWork = state.dois.length || state.openalex[0]?.type === 'works';
  let next = state;
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
    next.text = [...next.dois, ...next.openalex.map((o) => o.id)].join('\n');
  } else if (w.found === false) {
    next.note = 'Not found in OpenAlex.';
  } else if (w.error) {
    next.note = w.error;
  }
  return next;
}

function render(state) {
  shown = state;
  const hasIds = state.dois.length || state.openalex.length;
  $('#found').hidden = !hasIds;
  $('#empty').hidden = !!hasIds || ['manual', 'selection'].includes(state.source);

  $('#source').textContent = SOURCE_LABELS[state.source] || '';
  $('#title').textContent = citeLine(state);
  $('#note').textContent = state.note || '';

  const ids = $('#ids');
  ids.replaceChildren(
    ...state.dois.map((d) => idRow('DOI', d)),
    ...state.openalex.map((o) => idRow('OA', o.id)),
  );

  const groups = new Map();
  for (const t of targetsFor(state, { ra: state.ra, base })) {
    if (!groups.has(t.group)) groups.set(t.group, []);
    groups.get(t.group).push(t);
  }
  $('#groups').replaceChildren(...[...groups].map(([name, items]) => groupEl(name, items)));
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
    const a = el('a', name === 'RefRunner' ? 'btn primary' : 'btn', t.label);
    a.href = t.url;
    a.title = t.overflow ? 'Too long for a link: copy the text, then paste it into RefRunner' : t.url;
    if (t.overflow) {
      a.dataset.overflow = '1';
      a.dataset.refs = t.refs;
    }
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
  box.checked = base === REFRUNNER_DEV_BASE;
  $('#dev-label').hidden = false;
  box.addEventListener('change', async () => {
    await chrome.storage.local.set({ useDevServer: box.checked });
    base = await refrunnerBase();
    if (shown) render(shown);
  });
}
