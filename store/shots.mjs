// Chrome Web Store images: three 1280x800 screenshots and the 440x280 promo tile.
// Run: node store/shots.mjs   (needs the Playwright Chromium from `npm run smoke` setup; uses the network)
import { chromium } from 'playwright';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const OUT = path.join(ROOT, 'store');
const SP = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-shots-'));
const EXT = path.join(SP, 'ext');
fs.cpSync(ROOT, EXT, { recursive: true, filter: (f) => !/node_modules|\.git|store/.test(f) });

// Throwaway copy: script any page (Playwright can't click the toolbar button), look like a
// store install (no dev checkbox; Chrome strips update_url from unpacked copies, so patch
// IS_DEV), hide the shortcut footer (Playwright doesn't assign every key), and let the popup,
// opened as a tab, act on the article tab named in ?target= instead of on itself.
const manifest = JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json')));
manifest.host_permissions = ['<all_urls>'];
fs.writeFileSync(path.join(EXT, 'manifest.json'), JSON.stringify(manifest));
function patch(file, from, to) {
  const f = path.join(EXT, file);
  const src = fs.readFileSync(f, 'utf8');
  if (!src.includes(from)) throw new Error(`${file} no longer contains ${from}; update shots.mjs`);
  fs.writeFileSync(f, src.replace(from, to));
}
patch('popup.js', 'chrome.tabs.query({ active: true, currentWindow: true })',
  "chrome.tabs.query({ url: new URLSearchParams(location.search).get('target') })");
patch('lib/chrome.js', "export const IS_DEV = !('update_url' in chrome.runtime.getManifest());", 'export const IS_DEV = false;');
patch('popup.html', '</style>', 'footer { display: none; }</style>');

const ctx = await chromium.launchPersistentContext('', {
  channel: 'chromium', headless: true, viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1,
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
});
let [sw] = ctx.serviceWorkers();
sw ||= await ctx.waitForEvent('serviceworker');
const extId = sw.url().split('/')[2];

const PLOS = 'https://journals.plos.org/plosmedicine/article?id=10.1371/journal.pmed.0020124';
const ARXIV = 'https://arxiv.org/abs/1512.03385'; // OpenAlex has this one under its arXiv DOI

async function shot(name, url, pattern, prepare = async () => {}) {
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: 'networkidle' }).catch(() => {});
  // Cookie banners: take the option that leaves optional cookies off.
  await page.getByText('Save Selected Preferences and Close').click({ timeout: 3000 })
    .then(() => page.waitForTimeout(1500), () => {}); // let it slide away
  await prepare(page);
  const pageShot = await page.screenshot({ type: 'png' });
  const pop = await ctx.newPage();
  await pop.setViewportSize({ width: 360, height: 800 });
  await pop.goto(`chrome-extension://${extId}/popup.html?target=${encodeURIComponent(pattern)}`);
  await pop.waitForTimeout(4000); // OpenAlex and doi.org lookups
  const popShot = await pop.locator('body').screenshot({ type: 'png' });
  await pop.close();
  await page.close();
  await compose(`${name}.png`, `
    <body style="margin:0;width:1280px;height:800px;overflow:hidden;position:relative;
      background:url(data:image/png;base64,${pageShot.toString('base64')}) no-repeat">
      <img src="data:image/png;base64,${popShot.toString('base64')}" style="position:absolute;top:12px;right:24px;
        width:360px;border-radius:8px;box-shadow:0 8px 32px rgba(0,0,0,.35),0 0 0 1px rgba(0,0,0,.12)">
    </body>`, 1280, 800);
}

async function compose(file, html, width, height) {
  const p = await ctx.newPage();
  await p.setViewportSize({ width, height });
  await p.setContent(html, { waitUntil: 'load' });
  // The store wants 24-bit images; JPEG has no alpha channel.
  await p.screenshot({ path: path.join(OUT, file.replace(/\.png$/, '.jpg')), type: 'jpeg', quality: 92 });
  await p.close();
}

// 1. An article page: author (year), title, DOI, and every destination.
await shot('screenshot-1-article', PLOS, 'https://journals.plos.org/plosmedicine/*');

// 2. Part of its reference list selected: one click checks it in RefRunner.
await shot('screenshot-2-references', PLOS, 'https://journals.plos.org/plosmedicine/*', async (page) => {
  await page.evaluate(() => {
    const refs = [...document.querySelectorAll('ol.references > li')].slice(0, 4);
    if (!refs.length) throw new Error('no reference list found');
    refs[0].scrollIntoView({ block: 'center' });
    const r = document.createRange();
    r.setStartBefore(refs[0]);
    r.setEndAfter(refs.at(-1));
    getSelection().removeAllRanges();
    getSelection().addRange(r);
  });
});

// 3. An arXiv preprint: DataCite links instead of Crossref.
await shot('screenshot-3-arxiv', ARXIV, 'https://arxiv.org/*');

// Small promo tile.
const icon = fs.readFileSync(path.join(ROOT, 'icons/128.png')).toString('base64');
await compose('promo-440x280.png', `
  <body style="margin:0;width:440px;height:280px;display:flex;align-items:center;gap:22px;padding:0 32px;
    box-sizing:border-box;background:#0f6e6a;color:#fff;font-family:system-ui,sans-serif">
    <div style="background:#fff;border-radius:22px;padding:12px;flex:none;line-height:0">
      <img src="data:image/png;base64,${icon}" width="96" height="96">
    </div>
    <div>
      <div style="font-size:30px;font-weight:700;line-height:1.1">RefRunner Toolkit</div>
      <div style="font-size:17px;margin-top:10px;opacity:.92;line-height:1.35">Check a reference list in one click. Jump from any DOI.</div>
    </div>
  </body>`, 440, 280);

await ctx.close();
fs.rmSync(SP, { recursive: true, force: true });
console.log('wrote', fs.readdirSync(OUT).filter((f) => f.endsWith('.jpg')).join(', '));
