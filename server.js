const express = require('express');
const fetch = require('node-fetch'); // v2 require
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
app.use(express.static(path.join(__dirname, 'public')));

const RANDOM_ORG_API_KEY = process.env.RANDOM_ORG_API_KEY || '';

let frozenData = null;
let previousResult = null;
let finalResult = null;
let lastPreparedKey = null;

// small timeout wrapper
function timeoutFetch(url, options = {}, ms = 8000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), ms);
  return fetch(url, Object.assign({}, options, { signal: controller.signal })).finally(() => clearTimeout(id));
}

async function fetchCSRNG() {
  try {
    const res = await timeoutFetch('https://csrng.net/csrng/csrng.php?min=0&max=9', {}, 5000);
    const j = await res.json();
    if (Array.isArray(j) && j.length > 0 && j[0].random !== undefined) return Number(j[0].random);
  } catch (e) {
    console.error('CSRNG error', e && e.message ? e.message : e);
  }
  return null;
}

async function fetchQRNG() {
  try {
    const res = await timeoutFetch('https://qrng.anu.edu.au/API/jsonI.php?length=1&type=uint8', {}, 5000);
    const txt = await res.text();
    try {
      const j = JSON.parse(txt);
      if (j && Array.isArray(j.data) && j.data.length > 0) return Number(j.data[0]) % 10;
    } catch (e) {
      console.error('QRNG parse error, raw:', txt && txt.slice ? txt.slice(0,200) : txt);
    }
  } catch (e) {
    console.error('QRNG error', e && e.message ? e.message : e);
  }
  return null;
}

async function fetchRandomOrg() {
  if (!RANDOM_ORG_API_KEY) return null;
  try {
    const body = { jsonrpc: '2.0', method: 'generateIntegers', params: { apiKey: RANDOM_ORG_API_KEY, n: 1, min: 0, max: 9, replacement: true }, id: 1 };
    const res = await timeoutFetch('https://api.random.org/json-rpc/4/invoke', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, 8000);
    const j = await res.json();
    if (j && j.result && j.result.random && Array.isArray(j.result.random.data)) return Number(j.result.random.data[0]);
  } catch (e) {
    console.error('Random.org error', e && e.message ? e.message : e);
  }
  return null;
}

function decideFromNumbers(nums) {
  const valid = nums.filter(n => Number.isInteger(n));
  if (valid.length === 0) return null;
  const bigCount = valid.filter(n => n >= 5).length;
  const smallCount = valid.filter(n => n <= 4).length;
  if (valid.length === 3 && bigCount === 3) return 'BIG';
  if (valid.length === 3 && smallCount === 3) return 'SMALL';
  if (bigCount > smallCount) return 'BIG';
  if (smallCount > bigCount) return 'SMALL';
  // frequency
  const freq = {};
  valid.forEach(n => freq[n] = (freq[n] || 0) + 1);
  let max = 0;
  for (const k of Object.keys(freq)) if (freq[k] > max) max = freq[k];
  const candidates = Object.keys(freq).filter(k => freq[k] === max).map(Number);
  if (candidates.length === 1) return candidates[0];
  return candidates[Math.floor(Math.random() * candidates.length)];
}

async function prepareRoundIfNeeded(now) {
  const minuteKey = now.getUTCFullYear()+'-'+(now.getUTCMonth()+1)+'-'+now.getUTCDate()+' '+now.getUTCHours()+':'+now.getUTCMinutes();
  if (lastPreparedKey === minuteKey) return; // already prepared for this minute
  // perform parallel fetches
  try {
    const settled = await Promise.allSettled([fetchCSRNG(), fetchQRNG(), fetchRandomOrg()]);
    const values = settled.map(s => s.status === 'fulfilled' ? s.value : null);
    frozenData = { csrng: values[0], qrng: values[1], randomOrg: values[2] };
    lastPreparedKey = minuteKey;
    console.log('Prepared frozenData for', minuteKey, frozenData);
  } catch (e) {
    console.error('prepareRoundIfNeeded error', e);
    frozenData = { csrng: null, qrng: null, randomOrg: null };
    lastPreparedKey = minuteKey;
  }
}

function finalizeIfNeeded() {
  if (!frozenData) return;
  const nums = [frozenData.csrng, frozenData.qrng, frozenData.randomOrg].filter(n => n !== null);
  if (nums.length === 0) {
    const fb = Math.floor(Math.random() * 10);
    finalResult = fb;
    previousResult = finalResult;
    frozenData = null;
    console.log('All sources failed, fallback', fb);
    return;
  }
  const decided = decideFromNumbers(nums);
  finalResult = decided;
  previousResult = finalResult;
  console.log('Finalized:', { nums, decided });
  frozenData = null;
}

// scheduler every 800ms to be safe
setInterval(async () => {
  try {
    const now = new Date();
    const sec = now.getUTCSeconds();
    if (sec === 25) await prepareRoundIfNeeded(now);
    if (sec === 30) finalizeIfNeeded();
  } catch (e) {
    console.error('Scheduler loop error', e);
  }
}, 800);

// API
app.get('/api/result', (req, res) => {
  res.json({
    previous: previousResult,
    final: finalResult,
    sources: frozenData ? frozenData : { csrng: null, qrng: null, randomOrg: null },
    serverTimeUTC: new Date().toISOString()
  });
});

app.get('/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

process.on('unhandledRejection', (r) => console.error('UnhandledRejection', r));
process.on('uncaughtException', (e) => console.error('UncaughtException', e));

app.listen(PORT, () => console.log('RNG server listening on port', PORT));
