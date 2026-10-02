import { REFRUNNER_BASE } from './lib/doi.js';

const refs = document.getElementById('refs');
const go = document.getElementById('go');
const checkUrl = new URLSearchParams(location.search).get('check') || `${REFRUNNER_BASE}/check`;

refs.value = decodeURIComponent(location.hash.slice(1));
const updateCount = () => {
  const lines = refs.value.split('\n').filter((l) => l.trim()).length;
  document.getElementById('count').textContent = `${lines} lines, ${refs.value.length.toLocaleString()} characters`;
};
refs.addEventListener('input', updateCount);
updateCount();

go.addEventListener('click', async () => {
  await navigator.clipboard.writeText(refs.value);
  go.textContent = 'Copied. Opening RefRunner…';
  location.href = checkUrl;
});
