// Stores and serves the gallery's photos from R2.
// Public:  GET /photos.json, GET /img/{size}/{id}.webp
// Keyed:   GET /api/ping, PUT /api/img/{size}/{id}.webp, POST /api/photos, DELETE /api/photos/{id}
// The phone makes the WebP variants; this Worker only checks, stores and serves them.

const READABLE = /^(photos\.json|img\/(thumb|md|full)\/[0-9a-f-]+\.webp)$/;
const ID = /^\d{8}-\d{6}-[0-9a-f]{4}-[0-9a-f]{8}$/;
const SIZES = ['thumb', 'md', 'full'];
const MAX_BYTES = { thumb: 1 << 20, md: 4 << 20, full: 10 << 20 };
const IMMUTABLE = 'public, max-age=31536000, immutable';

export default {
  async fetch(request, env) {
    try {
      return await route(request, env);
    } catch (err) {
      console.error(err);
      return text(request, env, err.message || 'Internal error', 500);
    }
  },
};

async function route(request, env) {
  const { pathname } = new URL(request.url);
  const { method } = request;

  if (method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(request, env) });

  if (!pathname.startsWith('/api/')) {
    return method === 'GET' ? serve(request, env) : text(request, env, 'Method not allowed', 405);
  }

  if (!(await authorized(request, env))) return text(request, env, 'Unauthorized', 401);

  if (method === 'GET' && pathname === '/api/ping') {
    return new Response(null, { status: 204, headers: corsHeaders(request, env) });
  }

  let m;
  if (method === 'PUT' && (m = pathname.match(/^\/api\/img\/([^/]+)\/([^/]+)\.webp$/))) {
    return putImage(request, env, m[1], m[2]);
  }
  if (method === 'POST' && pathname === '/api/photos') return addPhoto(request, env);
  if (method === 'DELETE' && (m = pathname.match(/^\/api\/photos\/([^/]+)$/))) {
    return deletePhoto(request, env, m[1]);
  }
  return text(request, env, 'Not found', 404);
}

// --- helpers -------------------------------------------------------------

function corsHeaders(request, env) {
  const headers = new Headers({ Vary: 'Origin' });
  const origin = request.headers.get('Origin');
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map((o) => o.trim());
  if (origin && allowed.includes(origin)) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Access-Control-Allow-Methods', 'GET, PUT, POST, DELETE');
    headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    headers.set('Access-Control-Max-Age', '86400');
  }
  return headers;
}

function text(request, env, body, status) {
  const headers = corsHeaders(request, env);
  headers.set('Content-Type', 'text/plain; charset=utf-8');
  return new Response(body, { status, headers });
}

function json(request, env, body, status = 200) {
  const headers = corsHeaders(request, env);
  headers.set('Content-Type', 'application/json');
  return new Response(JSON.stringify(body), { status, headers });
}

async function sha256(value) {
  return crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
}

// Constant-time key check: hashing first gives both sides the same length.
async function authorized(request, env) {
  if (!env.UPLOAD_KEY) return false;
  const header = request.headers.get('Authorization') || '';
  const given = header.startsWith('Bearer ') ? header.slice(7) : '';
  const [a, b] = await Promise.all([sha256(given), sha256(env.UPLOAD_KEY)]);
  return crypto.subtle.timingSafeEqual(a, b);
}

// --- public reads --------------------------------------------------------

async function serve(request, env) {
  const key = new URL(request.url).pathname.slice(1);
  if (!READABLE.test(key)) return text(request, env, 'Not found', 404);
  const obj = await env.BUCKET.get(key, { onlyIf: request.headers });
  if (!obj) return text(request, env, 'Not found', 404);
  const headers = corsHeaders(request, env);
  obj.writeHttpMetadata(headers);
  headers.set('ETag', obj.httpEtag);
  return 'body' in obj
    ? new Response(obj.body, { headers })
    : new Response(null, { status: 304, headers }); // If-None-Match matched
}

// --- uploads -------------------------------------------------------------

// Returns an error message, or null if the bytes are a WebP without EXIF/XMP chunks.
function checkWebp(bytes) {
  const tag = (o) => String.fromCharCode(bytes[o], bytes[o + 1], bytes[o + 2], bytes[o + 3]);
  if (bytes.length < 20 || tag(0) !== 'RIFF' || tag(8) !== 'WEBP') return 'Not a WebP file';
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const fourcc = tag(offset);
    if (fourcc === 'EXIF' || fourcc === 'XMP ') return `WebP contains ${fourcc.trim()} metadata`;
    const size = view.getUint32(offset + 4, true);
    offset += 8 + size + (size & 1); // chunks are padded to an even length
  }
  return null;
}

async function putImage(request, env, size, id) {
  if (!SIZES.includes(size) || !ID.test(id)) return text(request, env, 'Bad size or id', 400);
  if ((request.headers.get('Content-Type') || '').split(';')[0].trim() !== 'image/webp') {
    return text(request, env, 'Content-Type must be image/webp', 415);
  }
  const declared = Number(request.headers.get('Content-Length'));
  if (declared > MAX_BYTES[size]) return text(request, env, 'File too large', 413);

  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.length > MAX_BYTES[size]) return text(request, env, 'File too large', 413);
  const problem = checkWebp(bytes);
  if (problem) return text(request, env, problem, 422);

  await env.BUCKET.put(`img/${size}/${id}.webp`, bytes, {
    httpMetadata: { contentType: 'image/webp', cacheControl: IMMUTABLE },
  });
  return new Response(null, { status: 201, headers: corsHeaders(request, env) });
}

// --- manifest ------------------------------------------------------------

async function updateManifest(env, change) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const obj = await env.BUCKET.get('photos.json');
    if (!obj) throw new Error('photos.json missing from bucket');
    const list = change(await obj.json());
    const saved = await env.BUCKET.put('photos.json', JSON.stringify(list), {
      onlyIf: { etagMatches: obj.etag },
      httpMetadata: { contentType: 'application/json', cacheControl: 'no-cache' },
    });
    if (saved) return list; // null means someone else wrote first: re-read and retry
  }
  throw new Error('Manifest busy, try again');
}

const isPositiveInt = (n) => Number.isInteger(n) && n > 0;

async function addPhoto(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return text(request, env, 'Body must be JSON', 400);
  }
  const { id, w, h, t } = body || {};
  if (!ID.test(id) || !isPositiveInt(w) || !isPositiveInt(h) || !Number.isFinite(t)) {
    return text(request, env, 'Expected { id, w, h, t }', 400);
  }

  const heads = await Promise.all(SIZES.map((s) => env.BUCKET.head(`img/${s}/${id}.webp`)));
  const missing = SIZES.filter((_, i) => !heads[i]);
  if (missing.length) return text(request, env, `Missing sizes: ${missing.join(', ')}`, 409);

  const list = await updateManifest(env, (photos) =>
    [...photos.filter((p) => p.id !== id), { id, w, h, t }]
      .sort((a, b) => b.t - a.t || a.id.localeCompare(b.id)));
  return json(request, env, { count: list.length });
}

async function deletePhoto(request, env, id) {
  if (!ID.test(id)) return text(request, env, 'Bad id', 400);
  await updateManifest(env, (photos) => photos.filter((p) => p.id !== id));
  await env.BUCKET.delete(SIZES.map((s) => `img/${s}/${id}.webp`));
  return new Response(null, { status: 204, headers: corsHeaders(request, env) });
}
