import { chromium } from 'playwright';
import os from 'node:os';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

// Optional end-to-end smoke test. Needs: npm i -D playwright && npx playwright install chromium
// Loads a throwaway copy of the extension (with test-only host permissions so it can script
// a local page), serves two fake article pages, and mocks the OpenAlex API.
// Run with: PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS=1 node tests/smoke.mjs
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const SP = fs.mkdtempSync(path.join(os.tmpdir(), 'refrunner-toolkit-'));
fs.cpSync(ROOT, path.join(SP, 'ext'), { recursive: true, filter: (f) => !/node_modules|\.git/.test(f) });
const manifest = JSON.parse(fs.readFileSync(path.join(SP, 'ext/manifest.json')));
manifest.host_permissions = ['<all_urls>'];
fs.writeFileSync(path.join(SP, 'ext/manifest.json'), JSON.stringify(manifest, null, 2));
fs.appendFileSync(path.join(SP, 'ext/background.js'), '\nglobalThis.__test = { handleMenu, handleShortcut };\n');
fs.mkdirSync(path.join(SP, 'site/doi/10.1111'), { recursive: true });
fs.mkdirSync(path.join(SP, 'site/article'), { recursive: true });
fs.writeFileSync(path.join(SP, 'site/doi/10.1111/j.1467-9280.2005.01636.x'),
  '<!doctype html><p id="p">Smith, J. (2005). One.<br>Jones, K. (2006). Two. https://doi.org/10.1037/0003-066X.59.1.29</p>');
// Stand-ins for an open RefRunner tab: one listening (marked), one on an older build (not).
fs.mkdirSync(path.join(SP, 'site/rr'), { recursive: true });
fs.mkdirSync(path.join(SP, 'site/old'), { recursive: true });
fs.writeFileSync(path.join(SP, 'site/rr/index.html'),
  '<!doctype html><html data-refrunner-handoff="1"><script>window.got=[];addEventListener("message",(e)=>e.data?.type==="refrunner-import"&&got.push(e.data.text))</script></html>');
fs.writeFileSync(path.join(SP, 'site/old/index.html'), '<!doctype html><p>old build</p>');
fs.writeFileSync(path.join(SP, 'site/article/index.html'),
  '<!doctype html><meta name="citation_doi" content="10.1126/science.abc1234"><meta name="citation_title" content="Meta Title"><p>no doi in url</p>');

const server = http.createServer((req, res) => {
  const f = path.join(SP, 'site', decodeURIComponent(req.url.split('?')[0]));
  const file = fs.existsSync(f) && fs.statSync(f).isDirectory() ? path.join(f, 'index.html') : f;
  if (!fs.existsSync(file)) { res.writeHead(404); return res.end('nope'); }
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end(fs.readFileSync(file));
}).listen(8765);

const errors = [];
const ctx = await chromium.launchPersistentContext('', {
  channel: 'chromium',
  headless: true,
  ignoreHTTPSErrors: true,

  args: ['--no-proxy-server', `--disable-extensions-except=${SP}/ext`, `--load-extension=${SP}/ext`],
});
const MOCK = {
  'W2974823616': { id: 'https://openalex.org/W2974823616', doi: 'https://doi.org/10.1037/0003-066X.59.1.29', display_name: 'Mocked OpenAlex Title', publication_year: 2004, authorships: [{ author: { display_name: 'Ann Author' } }, { author: { display_name: 'Bo Second' } }] },
  'doi:10.1111/j.1467-9280.2005.01636.x': { id: 'https://openalex.org/W2118746509', doi: 'https://doi.org/10.1111/j.1467-9280.2005.01636.x', display_name: 'What Children Are Looking at During Shared Storybook Reading', publication_year: 2005 },
};
await ctx.route('https://api.openalex.org/**', (route) => {
  const key = decodeURIComponent(new URL(route.request().url()).pathname.replace('/works/', ''));
  const body = MOCK[key];
  route.fulfill(body ? { status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) } : { status: 404, body: '{}' });
});
let [sw] = ctx.serviceWorkers();
sw ||= await ctx.waitForEvent('serviceworker');
sw.on('console', (m) => m.type() === 'error' && errors.push('SW: ' + m.text()));
const extId = sw.url().split('/')[2];
let failures = 0;
const ok = (cond, msg) => { if (!cond) failures++; console.log(cond ? 'PASS' : 'FAIL', msg); };

// 1. detection: URL DOI, meta DOI
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push('page: ' + e.message));
await page.goto('http://localhost:8765/doi/10.1111/j.1467-9280.2005.01636.x');
const helper = await ctx.newPage();
helper.on('pageerror', (e) => errors.push('helper: ' + e.message));
helper.on('console', (m) => m.type() === 'error' && errors.push('helper: ' + m.text()));
await helper.goto(`chrome-extension://${extId}/overflow.html`);
const detect = (url) => helper.evaluate(async (url) => {
  const { detectForTab } = await import('./lib/chrome.js');
  const [t] = await chrome.tabs.query({ url });
  return detectForTab(t);
}, url);
let d = await detect('http://localhost:8765/doi/*');
ok(d.doi === '10.1111/j.1467-9280.2005.01636.x' && d.source === 'url', `URL detection ${JSON.stringify(d)}`);
const meta = await ctx.newPage();
await meta.goto('http://localhost:8765/article/');
d = await detect('http://localhost:8765/article/*');
ok(d.doi === '10.1126/science.abc1234' && d.source === 'meta' && d.title === 'Meta Title', `meta detection ${JSON.stringify(d)}`);

// 2. OpenAlex lookup through real network
const w = await helper.evaluate(async () => {
  const { lookupWork } = await import('./lib/chrome.js');
  return lookupWork({ doi: '10.1111/j.1467-9280.2005.01636.x' });
});
ok(w?.found && w.id === 'W2118746509', `lookupWork ${JSON.stringify(w)}`);

// 3. menu handler: select two references (with a line break) and send to RefRunner
await page.bringToFront();
await page.evaluate(() => {
  const r = document.createRange();
  r.selectNodeContents(document.getElementById('p'));
  getSelection().removeAllRanges();
  getSelection().addRange(r);
});
const tabId = await helper.evaluate(async () => (await chrome.tabs.query({ url: 'http://localhost:8765/doi/*' }))[0].id);
const sel = await helper.evaluate(async (tabId) => {
  const { readSelection } = await import('./lib/chrome.js');
  return readSelection(await chrome.tabs.get(tabId));
}, tabId);
ok(sel.includes('One.\nJones'), `popup's selection reader keeps line breaks: ${JSON.stringify(sel.slice(0, 60))}`);
const newPage = ctx.waitForEvent('page');
await sw.evaluate(async (tabId) => {
  const tab = await chrome.tabs.get(tabId);
  await __test.handleMenu({ menuItemId: 'refrunner', selectionText: 'Smith, J. (2005). One. Jones (flattened)', frameId: 0 }, tab);
}, tabId);
let p2 = await newPage;
ok(p2.url().includes('#refs=Smith%2C+J.+%282005%29.+One.%0AJones'), `RefRunner refs link keeps line break: ${p2.url().slice(0, 140)}`);
await p2.close();

// Alt+Shift+C: same selection, straight to RefRunner
const p3wait = ctx.waitForEvent('page');
await sw.evaluate(async (tabId) => __test.handleShortcut('send-refrunner', await chrome.tabs.get(tabId)), tabId);
const p3 = await p3wait;
ok(p3.url().includes('#refs=Smith%2C+J.+%282005%29.+One.%0AJones'), `Alt+Shift+C sends the selection: ${p3.url().slice(0, 100)}`);
await p3.close();

// 4. menu handler: selected DOI -> OpenAlex page via lookup
const np = ctx.waitForEvent('page');
await sw.evaluate(async (tabId) => {
  const tab = await chrome.tabs.get(tabId);
  await __test.handleMenu({ menuItemId: 'oa-web', linkUrl: 'https://doi.org/10.1111/j.1467-9280.2005.01636.x', frameId: 0 }, tab);
}, tabId);
p2 = await np;
ok(p2.url().startsWith('https://openalex.org/works/W2118746509'), `oa-web from link: ${p2.url()}`);
await p2.close();

// 5. popup UI, manual input
const popup = await ctx.newPage();
popup.on('pageerror', (e) => errors.push('popup: ' + e.message));
popup.on('console', (m) => m.type() === 'error' && errors.push('popup: ' + m.text()));
await popup.goto(`chrome-extension://${extId}/popup.html`);
await popup.fill('#manual', 'https://openalex.org/works/W2974823616');
await popup.waitForFunction(() => document.querySelectorAll('#ids .id-row').length >= 2, null, { timeout: 10000 }).catch(() => {});
const ui = await popup.evaluate(() => ({
  ids: [...document.querySelectorAll('#ids .mono')].map((n) => n.textContent),
  title: document.querySelector('#title').textContent,
  links: [...document.querySelectorAll('#groups a')].map((a) => `${a.textContent} -> ${a.href}`),
}));
ok(ui.ids.includes('W2974823616') && ui.ids.length === 2 && ui.links.length >= 5, 'popup enriches OpenAlex id with DOI');
ok(ui.title === 'Author and Second (2004). Mocked OpenAlex Title', `popup shows APA-style author (year): ${ui.title}`);

// dev-server checkbox (smoke runs unpacked, so IS_DEV is true)
const bases = await helper.evaluate(async () => {
  const { refrunnerBase, IS_DEV } = await import('./lib/chrome.js');
  const before = await refrunnerBase();
  await chrome.storage.local.set({ useDevServer: true });
  const after = await refrunnerBase();
  await chrome.storage.local.remove('useDevServer');
  return { IS_DEV, before, after };
});
ok(bases.IS_DEV && bases.before === 'https://www.refrunner.com' && bases.after === 'https://localhost:5173', `dev-server toggle ${JSON.stringify(bases)}`);

// 6. overflow page
const big = 'Ref line number one, a reasonably long citation string.\n'.repeat(200);
const op = ctx.waitForEvent('page');
await helper.evaluate(async (big) => {
  const { openOverflow } = await import('./lib/chrome.js');
  await openOverflow(big, 'https://www.refrunner.com/check', null);
}, big);
const ov = await op;
await ov.waitForFunction(() => document.getElementById('refs').value.length > 0);
ok((await ov.inputValue('#refs')).length === big.length, 'overflow page shows the full list');

// 7. hand-off to an open RefRunner tab, at any length; a tab without the app's mark is left alone
const rr = await ctx.newPage();
await rr.goto('http://localhost:8765/rr/');
const old = await ctx.newPage();
await old.goto('http://localhost:8765/old/');
const handed = await helper.evaluate(async (big) => {
  const { handToOpenTab } = await import('./lib/chrome.js');
  return {
    rr: await handToOpenTab('http://localhost:8765/rr', big),
    old: await handToOpenTab('http://localhost:8765/old', 'Lester (2019)'),
  };
}, big);
const got = await rr.evaluate(() => window.got);
ok(handed.rr && got.length === 1 && got[0] === big, 'open tab receives the full text');
ok(handed.old === false, 'a tab without the hand-off mark falls back to a new tab');

console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no console errors');
await ctx.close();
server.close();
fs.rmSync(SP, { recursive: true, force: true });
process.exit(errors.length || failures ? 1 : 0);
