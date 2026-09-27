const axios = require('axios');
const crypto = require('node:crypto');
const OldEngine = require('./douyu-engine');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const md5 = (s) => crypto.createHash('md5').update(s, 'utf8').digest('hex');
const trunc = (s, n = 70) => (s && s.length > n ? s.slice(0, n) + '...' : s);

// ---------- NEW flow: PR #1347 (websec/getEncryption + getH5PlayV1) ----------
async function newFlowGetStreamUrl(rid) {
  const did = '10000000000000000000000000003306';
  const headers = { 'User-Agent': UA, 'Referer': `https://www.douyu.com/${rid}` };
  const keyRes = await axios.get(
    `https://www.douyu.com/wgapi/livenc/liveweb/websec/getEncryption?did=${did}`,
    { headers, timeout: 15000 }
  );
  const keyData = keyRes.data;
  if (keyData.error !== 0) throw new Error(`getEncryption error=${keyData.error}`);
  const enc = keyData.data;
  const ts = Math.floor(Date.now() / 1000);
  const signStr = enc.is_special === 1 ? '' : `${rid}${ts}`;
  let auth = enc.rand_str;
  for (let i = 0; i < enc.enc_time; i++) auth = md5(auth + enc.key);
  auth = md5(auth + enc.key + signStr);
  const postData =
    `enc_data=${enc.enc_data}` +
    `&tt=${ts}` +
    `&did=${did}` +
    `&auth=${auth}` +
    `&cdn=&rate=-1&hevc=0&fa=0&ive=0`;
  const res = await axios.post(`https://www.douyu.com/lapi/live/getH5PlayV1/${rid}`, postData, {
    headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' },
    timeout: 15000,
  });
  if (res.data.error !== 0) throw new Error(`getH5PlayV1 error=${res.data.error} msg=${res.data.msg}`);
  const { rtmp_url, rtmp_live } = res.data.data;
  return `${rtmp_url}/${rtmp_live}`;
}

// ---------- live room discovery ----------
async function findLiveRoom() {
  const candidates = ['216132'];
  for (const rid of candidates) {
    try {
      const info = await OldEngine.getInfo(rid);
      console.log(`[discover] candidate ${rid}: isLive=${info.isLive} realId=${info.realId}`);
      if (info.isLive) return info.realId;
    } catch (e) {
      console.log(`[discover] candidate ${rid} getInfo failed: ${e.message}`);
    }
  }
  // fallback: scrape directory page for room ids
  try {
    const res = await axios.get('https://www.douyu.com/directory/all', {
      headers: { 'User-Agent': UA }, timeout: 15000,
    });
    const html = typeof res.data === 'string' ? res.data : '';
    const ids = [...new Set([...html.matchAll(/"rid":(\d+)/g)].map((m) => m[1]))].slice(0, 12);
    console.log(`[discover] directory gave ${ids.length} room ids`);
    for (const rid of ids) {
      try {
        const info = await OldEngine.getInfo(rid);
        if (info.isLive) {
          console.log(`[discover] using live room ${rid} (${info.roomName})`);
          return info.realId;
        }
      } catch {}
    }
  } catch (e) {
    console.log(`[discover] directory scrape failed: ${e.message}`);
  }
  return null;
}

(async () => {
  console.log('=== DOUYU FLOW PROBE ===');
  console.log('time:', new Date().toISOString());
  const rid = await findLiveRoom();
  if (!rid) {
    console.log('RESULT: no live room found, cannot test');
    console.log('=== END ===');
    setInterval(() => {}, 3600000);
    return;
  }
  console.log('live_room:', rid);

  try {
    const url = await OldEngine.getStreamUrl(rid);
    console.log('[OLD] getH5Play: OK', trunc(url));
  } catch (e) {
    console.log('[OLD] getH5Play: FAIL', e.message);
  }

  try {
    const url = await newFlowGetStreamUrl(rid);
    console.log('[NEW] getH5PlayV1: OK', trunc(url));
  } catch (e) {
    console.log('[NEW] getH5PlayV1: FAIL', e.message);
  }

  console.log('=== END ===');
  setInterval(() => {}, 3600000); // keep service alive for log reading
})().catch((e) => {
  console.log('PROBE CRASH:', e.message);
  setInterval(() => {}, 3600000);
});
