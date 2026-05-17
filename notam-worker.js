/**
 * NOTAM Proxy — Cloudflare Worker
 * ================================
 * Uses SkyLink API (RapidAPI) — FAA SWIM real-time feed.
 * Free tier: 1,000 requests/month. No credit card required.
 *
 * SETUP:
 * 1. Sign up free at: https://rapidapi.com/skylink-api-skylink-api-default/api/skylink-api
 * 2. Subscribe to the free tier, copy your RapidAPI key
 * 3. In Cloudflare dashboard → mission-card-notam → Settings → Variables and Secrets:
 *      RAPIDAPI_KEY = your RapidAPI key
 * 4. Deploy this worker
 *
 * USAGE:
 *   GET https://your-worker.workers.dev/?apt=KLTS
 *   GET https://your-worker.workers.dev/?apt=KLTS,KDFW,KLAW
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    const apt = (url.searchParams.get('apt') || '').trim().toUpperCase();
    const debug = url.searchParams.get('debug') === '1';

    if (!apt) {
      return json({ error: 'Missing apt parameter. Usage: ?apt=KLTS or ?apt=KLTS,KDFW' }, 400);
    }

    if (!env.RAPIDAPI_KEY) {
      return json({ error: 'Worker not configured — RAPIDAPI_KEY secret required. See setup instructions in notam-worker.js.' }, 500);
    }

    const icaos = apt.split(',').map(s => s.trim()).filter(Boolean);
    const results = {};

    for (const icao of icaos) {
      try {
        const resp = await fetch(
          `https://skylink-api.p.rapidapi.com/notams/${encodeURIComponent(icao)}`,
          {
            headers: {
              'x-rapidapi-key':  env.RAPIDAPI_KEY,
              'x-rapidapi-host': 'skylink-api.p.rapidapi.com'
            }
          }
        );

        if (!resp.ok) {
          const body = await resp.text();
          results[icao] = debug ? { error: `HTTP ${resp.status}`, body: body.slice(0, 300) } : null;
          continue;
        }

        const data = await resp.json();
        // Response shape: { icao, total_count, notams: [...] }
        const items = Array.isArray(data.notams) ? data.notams : (Array.isArray(data) ? data : []);

        results[icao] = items.map(n => ({
          number:         n.notam_id  || '?',
          text:           n.body      || '',
          raw:            n.raw       || n.body || '',
          effectiveStart: n.effective  || '',
          effectiveEnd:   n.expiration || '',
          type:           n.type      || '',
          location:       n.location  || icao,
          source:         'SkyLink/FAA-SWIM'
        }));

      } catch (e) {
        results[icao] = debug ? { error: e.message } : null;
      }
    }

    return json(results, 200);
  }
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json', 'Cache-Control': 'max-age=300' }
  });
}
