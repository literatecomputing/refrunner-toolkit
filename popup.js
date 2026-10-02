import { parseText, targetsFor } from './lib/doi.js';
import { detectForTab, lookupWork, openTab, openOverflow } from './lib/chrome.js';

const $ = (sel) => document.querySelector(sel);
const SOURCE_LABELS = {
  url: 'DOI from the page URL',
  arxiv: 'arXiv DOI from the page URL',
  meta: 'DOI from the page metadata',
  openalex: 'OpenAlex record',
  manual: 'From what you pasted',
};

let tab;
let pageState = null;
let renderToken = 0;

init();

async function init() {
  [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  $('#groups').addEventListener('click', onLinkClick);
  $('#ids').addEventListener('click', onCopyClick);
  $('#manual').addEventListener('input', debounce(onManualInput, 250));

  const d = await detectForTab(tab);
  pageState = stateFrom({
    dois: d.doi ? [d.doi] : [],
    openalex: d.openalex ? [d.openalex] : [],
    source: d.source,
    title: d.title,
    author: d.author,
  });
  show(pageState);
  if (!pageState.dois.length && !pageState.openalex.length) $('#manual').focus();
}

function stateFrom({ dois = [], openalex = [], source = null, title = null, author = null, text, leftover = '', onlyIds = true }) {
  return {
    dois, openalex, source, title, author, leftover, onlyIds,
    text: text ?? [...dois, ...openalex.map((o) => o.id)].join('\n'),
    year: null, note: '',
  };
}

function onManualInput(e) {
  const value = e.target.value.trim();
  if (!value) return show(pageState);
  const p = parseText(value);
  show(stateFrom({ ...p, source: 'manual' }));
}

/** Render now, then enrich from OpenAlex (title, missing DOI or W-id) and render again. */
async function show(state) {
  const token = ++renderToken;
  render(state);
  const single = state.onlyIds && state.dois.length + state.openalex.length === 1;
  const isWork = state.dois.length || state.openalex[0]?.type === 'works';
  if (!single || !isWork) return;

  const w = await lookupWork({ doi: state.dois[0], openalex: state.openalex[0] });
  if (token !== renderToken || !w) return;
  const next = { ...state };
  if (w.found) {
    next.title = w.title || state.title;
    next.author = w.author || state.author;
    next.year = w.year;
    if (!next.dois.length && w.doi) next.dois = [w.doi];
    if (!next.openalex.length && w.id) next.openalex = [{ type: 'works', id: w.id }];
    next.text = [...next.dois, ...next.openalex.map((o) => o.id)].join('\n');
  } else if (w.found === false) {
    next.note = 'Not found in OpenAlex.';
  } else if (w.error) {
    next.note = w.error;
  }
  render(next);
}

function render(state) {
  const hasIds = state.dois.length || state.openalex.length;
  $('#found').hidden = !hasIds;
  $('#empty').hidden = !!hasIds || state.source === 'manual';

  $('#source').textContent = SOURCE_LABELS[state.source] || '';
  const title = state.title ? `${state.title}${state.year ? ` (${state.year})` : ''}` : '';
  $('#title').textContent = [state.author, title].filter(Boolean).join(' — ');
  $('#note').textContent = state.note || '';

  const ids = $('#ids');
  ids.replaceChildren(
    ...state.dois.map((d) => idRow('DOI', d)),
    ...state.openalex.map((o) => idRow('OA', o.id)),
  );

  const groups = new Map();
  for (const t of targetsFor(state)) {
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
