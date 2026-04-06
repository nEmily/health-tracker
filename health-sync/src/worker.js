// health-sync — Cloudflare Worker relay for Health Tracker PWA ↔ PC sync
// R2 storage: exports/{key}/{date}.zip, results/{key}/{date}.json, metadata/{key}/state.json

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const PAIR_CODE_RE = /^\d{4}$/;
const MAX_ZIP_SIZE = 50 * 1024 * 1024; // 50MB
const MAX_PAIR_TTL = 15 * 60 * 1000; // 15 minutes

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const parts = url.pathname.split('/').filter(Boolean);

    // CORS
    if (request.method === 'OPTIONS') return cors(new Response(null, { status: 204 }), request);

    // GET /health — connection check (no auth required)
    if (parts[0] === 'health' && request.method === 'GET') {
      return cors(json(200, { ok: true, version: '1.0' }));
    }

    // PUT /pair — create a pairing code
    if (parts[0] === 'pair' && parts.length === 1 && request.method === 'PUT') {
      try {
        const { code, syncKey, relay, expires } = await request.json();
        if (!PAIR_CODE_RE.test(code)) return cors(json(400, { error: 'code must be exactly 4 digits' }));
        if (!syncKey) return cors(json(400, { error: 'syncKey required' }));
        if (!expires || expires <= Date.now()) return cors(json(400, { error: 'expires must be in the future' }));
        if (expires - Date.now() > MAX_PAIR_TTL) return cors(json(400, { error: 'expires must be within 15 minutes' }));

        // Check if code already exists and is not expired
        const existing = await env.BUCKET.get(`pairing/${code}.json`);
        if (existing) {
          const data = JSON.parse(await existing.text());
          if (data.expires > Date.now()) {
            return cors(json(409, { error: 'code in use' }));
          }
        }

        await env.BUCKET.put(`pairing/${code}.json`, JSON.stringify({ syncKey, relay, expires }));
        return cors(json(200, { ok: true }));
      } catch (err) {
        if (err instanceof SyntaxError) return cors(json(400, { error: 'invalid JSON' }));
        throw err;
      }
    }

    // GET /pair/{code} — redeem a pairing code
    if (parts[0] === 'pair' && parts.length === 2 && request.method === 'GET') {
      const code = parts[1];
      if (!PAIR_CODE_RE.test(code)) return cors(json(400, { error: 'code must be exactly 4 digits' }));

      const obj = await env.BUCKET.get(`pairing/${code}.json`);
      if (!obj) return cors(json(404, { error: 'invalid or expired code' }));

      const data = JSON.parse(await obj.text());
      if (data.expires <= Date.now()) {
        await env.BUCKET.delete(`pairing/${code}.json`);
        return cors(json(404, { error: 'invalid or expired code' }));
      }

      // Single-use: delete after redeeming
      await env.BUCKET.delete(`pairing/${code}.json`);
      return cors(json(200, { syncKey: data.syncKey, relay: data.relay }));
    }

    // Route: /sync/{key}/...
    if (parts[0] !== 'sync' || parts.length < 2) return cors(json(404, { error: 'not found' }));

    const key = parts[1];
    if (!UUID_RE.test(key)) return cors(json(400, { error: 'invalid key' }));

    const route = parts.slice(2).join('/');

    try {
      const result = await handle(request, env, key, route);
      return cors(result, request);
    } catch (err) {
      console.error(err);
      return cors(json(500, { error: 'internal error' }));
    }
  },
};

async function handle(request, env, key, route) {
  const { method } = request;

  // PUT /sync/{key}/day/{date} — upload day ZIP
  const dayUpload = route.match(/^day\/([\d-]+)$/);
  if (dayUpload && method === 'PUT') {
    const date = dayUpload[1];
    if (!DATE_RE.test(date)) return json(400, { error: 'invalid date' });

    const body = await request.arrayBuffer();
    if (!body.byteLength) return json(400, { error: 'empty body' });
    if (body.byteLength > MAX_ZIP_SIZE) return json(413, { error: 'too large' });

    await env.BUCKET.put(`exports/${key}/${date}.zip`, body);
    await updateState(env, key, state => {
      if (!state.pending) state.pending = [];
      if (!state.pending.includes(date)) state.pending.push(date);
      // Increment generation counter so in-flight processing can detect stale reads
      if (!state.gen) state.gen = {};
      state.gen[date] = (state.gen[date] || 0) + 1;
    });
    return json(200, { ok: true, date });
  }

  // GET /sync/{key}/pending — list unprocessed days
  if (route === 'pending' && method === 'GET') {
    const state = await getState(env, key);
    return json(200, { pending: state.pending || [], gen: state.gen || {} });
  }

  // GET /sync/{key}/dates — list ALL dates that have raw data (pending or processed)
  if (route === 'dates' && method === 'GET') {
    const listed = await env.BUCKET.list({ prefix: `exports/${key}/` });
    const dates = listed.objects
      .map(o => o.key.replace(`exports/${key}/`, '').replace('.zip', ''))
      .filter(d => DATE_RE.test(d))
      .sort();
    return json(200, { dates });
  }

  // DELETE /sync/{key}/day/{date} — delete a day's data (ZIP + results)
  if (dayUpload && method === 'DELETE') {
    const date = dayUpload[1];
    if (!DATE_RE.test(date)) return json(400, { error: 'invalid date' });
    await env.BUCKET.delete(`exports/${key}/${date}.zip`);
    await env.BUCKET.delete(`results/${key}/${date}.json`);
    await updateState(env, key, state => {
      state.pending = (state.pending || []).filter(d => d !== date);
      state.newResults = (state.newResults || []).filter(d => d !== date);
    });
    return json(200, { ok: true, deleted: date });
  }

  // DELETE /sync/{key}/all — delete ALL data for this key
  if (route === 'all' && method === 'DELETE') {
    const listed = await env.BUCKET.list({ prefix: `exports/${key}/` });
    const resultsList = await env.BUCKET.list({ prefix: `results/${key}/` });
    const deletes = [
      ...listed.objects.map(o => env.BUCKET.delete(o.key)),
      ...resultsList.objects.map(o => env.BUCKET.delete(o.key)),
      env.BUCKET.delete(`metadata/${key}/state.json`),
    ];
    await Promise.all(deletes);
    return json(200, { ok: true, deleted: listed.objects.length + resultsList.objects.length });
  }

  // GET /sync/{key}/day/{date} — download day ZIP
  if (dayUpload && method === 'GET') {
    const date = dayUpload[1];
    if (!DATE_RE.test(date)) return json(400, { error: 'invalid date' });

    const obj = await env.BUCKET.get(`exports/${key}/${date}.zip`);
    if (!obj) return json(404, { error: 'not found' });

    return new Response(obj.body, {
      headers: { 'Content-Type': 'application/zip', 'Content-Length': obj.size },
    });
  }

  // POST /sync/{key}/day/{date}/done — mark processed + upload results
  const dayDone = route.match(/^day\/([\d-]+)\/done$/);
  if (dayDone && method === 'POST') {
    const date = dayDone[1];
    if (!DATE_RE.test(date)) return json(400, { error: 'invalid date' });

    const body = await request.text();
    if (body) {
      await env.BUCKET.put(`results/${key}/${date}.json`, body);
    }

    // Parse the generation counter the caller read when it fetched /pending.
    // If gen is provided and is stale (a newer upload happened during processing),
    // keep the date in pending so the next watcher run re-processes it.
    const reqGen = parseInt(new URL(request.url).searchParams.get('gen') || '');

    await updateState(env, key, state => {
      const currentGen = (state.gen || {})[date] || 0;
      const isStale = !isNaN(reqGen) && reqGen < currentGen;
      if (!isStale) {
        // Gen matches (or no gen provided — backward compat): remove from pending
        state.pending = (state.pending || []).filter(d => d !== date);
      }
      // Always add to newResults so phone gets the latest analysis regardless
      if (!state.newResults) state.newResults = [];
      if (!state.newResults.includes(date)) state.newResults.push(date);
    });

    // Keep export ZIP — never delete raw user data
    // ZIPs remain in R2 as permanent archive

    return json(200, { ok: true, date });
  }

  // POST /sync/{key}/results/resync — re-mark all results as new (for reinstall recovery)
  if (route === 'results/resync' && method === 'POST') {
    const listed = await env.BUCKET.list({ prefix: `results/${key}/` });
    const dates = listed.objects.map(o => o.key.replace(`results/${key}/`, '').replace('.json', '')).filter(d => DATE_RE.test(d));
    await updateState(env, key, state => {
      state.newResults = dates;
    });
    return json(200, { ok: true, resyncDates: dates });
  }

  // GET /sync/{key}/results/new — check for new results + script version
  if (route === 'results/new' && method === 'GET') {
    const state = await getState(env, key);
    const config = await getGlobalConfig(env);
    const resp = { newResults: state.newResults || [] };
    if (config.scriptVersion) resp.scriptVersion = config.scriptVersion;
    return json(200, resp);
  }

  // GET /sync/{key}/results/{date} — download analysis JSON
  const resultGet = route.match(/^results\/([\d-]+)$/);
  if (resultGet && method === 'GET') {
    const date = resultGet[1];
    if (!DATE_RE.test(date)) return json(400, { error: 'invalid date' });

    const obj = await env.BUCKET.get(`results/${key}/${date}.json`);
    if (!obj) return json(404, { error: 'not found' });

    return new Response(obj.body, {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // POST /sync/{key}/results/{date}/ack — phone acknowledges receipt
  const resultAck = route.match(/^results\/([\d-]+)\/ack$/);
  if (resultAck && method === 'POST') {
    const date = resultAck[1];
    if (!DATE_RE.test(date)) return json(400, { error: 'invalid date' });

    await updateState(env, key, state => {
      state.newResults = (state.newResults || []).filter(d => d !== date);
    });

    // Keep results — never delete user data
    // Results remain in R2 as permanent archive

    return json(200, { ok: true, date });
  }

  // PUT /sync/{key}/health/{date} — store health data (steps, etc.) from Apple Health via Shortcut
  const healthRoute = route.match(/^health\/([\d-]+)$/);
  if (healthRoute && method === 'PUT') {
    const date = healthRoute[1];
    if (!DATE_RE.test(date)) return json(400, { error: 'invalid date' });

    const body = await request.text();
    await env.BUCKET.put(`health/${key}/${date}.json`, body);
    return json(200, { ok: true, date });
  }

  // GET /sync/{key}/health/{date} — retrieve health data for a date
  if (healthRoute && method === 'GET') {
    const date = healthRoute[1];
    if (!DATE_RE.test(date)) return json(400, { error: 'invalid date' });

    const obj = await env.BUCKET.get(`health/${key}/${date}.json`);
    if (!obj) return json(404, { error: 'not found' });
    return new Response(obj.body, { headers: { 'Content-Type': 'application/json' } });
  }

  // PUT /admin/script-version — set the latest script version (requires admin key)
  if (parts[0] === 'admin' && parts[1] === 'script-version' && method === 'PUT') {
    const adminKey = request.headers.get('X-Admin-Key');
    if (!adminKey || adminKey !== env.ADMIN_KEY) return cors(json(403, { error: 'forbidden' }));
    const { version } = await request.json();
    if (!version) return cors(json(400, { error: 'version required' }));
    const config = await getGlobalConfig(env);
    config.scriptVersion = version;
    await env.BUCKET.put('metadata/global/config.json', JSON.stringify(config));
    return cors(json(200, { ok: true, scriptVersion: version }));
  }

  return json(404, { error: 'not found' });
}

// --- State helpers ---

async function getGlobalConfig(env) {
  const obj = await env.BUCKET.get('metadata/global/config.json');
  if (!obj) return {};
  return JSON.parse(await obj.text());
}

async function getState(env, key) {
  const obj = await env.BUCKET.get(`metadata/${key}/state.json`);
  if (!obj) return {};
  return JSON.parse(await obj.text());
}

// updateState uses etag-based optimistic locking to prevent concurrent read-modify-write
// races (e.g. two results arriving simultaneously). Retries up to 3 times on conflict.
async function updateState(env, key, mutator) {
  const MAX_RETRIES = 3;
  const stateKey = `metadata/${key}/state.json`;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    // Read current state + capture etag
    const obj = await env.BUCKET.get(stateKey);
    const etag = obj ? obj.etag : null;
    const state = obj ? JSON.parse(await obj.text()) : {};

    // Apply mutation
    mutator(state);

    // Conditional put: only succeeds if etag hasn't changed since our read
    const putOptions = etag
      ? { onlyIf: { etagMatches: etag } }
      : { onlyIf: { etagDoesNotMatch: '*' } };

    try {
      await env.BUCKET.put(stateKey, JSON.stringify(state), putOptions);
      return; // success
    } catch (err) {
      // Only retry on PreconditionFailed (concurrent write); propagate real errors immediately
      const isPrecondition = err?.message?.includes('PreconditionFailed') || err?.status === 412;
      if (isPrecondition && attempt < MAX_RETRIES - 1) continue;
      if (isPrecondition) throw new Error(`updateState: failed after ${MAX_RETRIES} attempts (concurrent writes)`);
      throw err;
    }
  }
}

// --- Response helpers ---

function json(status, data) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const ALLOWED_ORIGINS = [
  'https://nemily.github.io',
];

function isLocalDev(origin) {
  return /^http:\/\/(localhost|127\.0\.0\.1|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|100\.\d+\.\d+\.\d+)(:\d+)?$/.test(origin);
}

function cors(response, request) {
  const origin = request?.headers?.get('Origin') || '';
  const allowed = (ALLOWED_ORIGINS.includes(origin) || isLocalDev(origin)) ? origin : ALLOWED_ORIGINS[0];
  response.headers.set('Access-Control-Allow-Origin', allowed);
  response.headers.set('Access-Control-Allow-Methods', 'GET, PUT, POST, DELETE, OPTIONS');
  response.headers.set('Access-Control-Allow-Headers', 'Content-Type');
  return response;
}
