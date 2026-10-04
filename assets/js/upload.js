// Phone upload: makes the thumb, md and full WebP sizes in the browser (re-encoding strips
// all EXIF, including GPS), then sends them to the Worker in worker/, which stores them in R2
// and adds the photo to photos.json. Photos are live as soon as the upload finishes.

const API = 'https://pics-upload.late-disk-1f3e.workers.dev';
const KEY_NAME = 'upload_key';

// Same sizes and qualities scripts/build.mjs used, largest first: each is drawn from the previous one.
const VARIANTS = [
  ['full', 2560, 2560, 0.85],
  ['md', 1600, 1600, 0.82],
  ['thumb', 960, 600, 0.78],
];

const $ = (sel) => document.querySelector(sel);
const keyInput = $('#key');
const keyStatus = $('#key-status');
const uploadStatus = $('#upload-status');
const filesInput = $('#files');
const previews = $('#previews');
const uploadBtn = $('#upload');
const clearBtn = $('#clear');

let selected = []; // [{ file, url, li, badge, prepared? }]

const storage = {
  get: () => { try { return localStorage.getItem(KEY_NAME); } catch { return null; } },
  set: (v) => { try { localStorage.setItem(KEY_NAME, v); } catch {} },
  clear: () => { try { localStorage.removeItem(KEY_NAME); } catch {} },
};

// The old GitHub-based uploader kept a repo token here; don't leave it on the device.
try { localStorage.removeItem('gh_token'); } catch {}

function setStatus(el, text, isError = false) {
  el.textContent = text;
  el.classList.toggle('error', isError);
}

async function api(path, { method = 'GET', body, type } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${storage.get()}`,
      ...(type && { 'Content-Type': type }),
    },
    body,
  });
  if (!res.ok) {
    const msg = await res.text().catch(() => '') || res.statusText;
    throw new Error(`${res.status}: ${msg}`);
  }
  return res;
}

// --- key -----------------------------------------------------------------

function showKeyState() {
  const has = !!storage.get();
  keyInput.value = '';
  keyInput.hidden = has;
  $('label[for="key"]').textContent = has ? 'Upload key saved' : 'Upload key';
  $('#save-key').hidden = has;
  $('#forget-key').hidden = !has;
  $('#upload-section').hidden = !has;
}

$('#save-key').addEventListener('click', async () => {
  const value = keyInput.value.trim();
  if (!value) return;
  storage.set(value);
  setStatus(keyStatus, 'Checking…');
  try {
    await api('/api/ping');
    setStatus(keyStatus, 'Key accepted.');
    showKeyState();
  } catch (err) {
    storage.clear();
    setStatus(keyStatus, `Key rejected — ${err.message}`, true);
  }
});

$('#forget-key').addEventListener('click', () => {
  storage.clear();
  setStatus(keyStatus, 'Key removed from this device.');
  showKeyState();
});

// --- selection -----------------------------------------------------------

function updateButtons() {
  uploadBtn.disabled = !selected.length;
  clearBtn.hidden = !selected.length;
}

function clearSelection() {
  for (const s of selected) URL.revokeObjectURL(s.url);
  selected = [];
  previews.innerHTML = '';
  filesInput.value = '';
  updateButtons();
}

filesInput.addEventListener('change', () => {
  for (const file of filesInput.files) {
    if (!file.type.startsWith('image/')) continue;
    const url = URL.createObjectURL(file);
    const li = document.createElement('li');
    const img = document.createElement('img');
    img.src = url;
    img.alt = '';
    const badge = document.createElement('span');
    badge.className = 'badge';
    li.append(img, badge);
    previews.append(li);
    selected.push({ file, url, li, badge });
  }
  filesInput.value = '';
  updateButtons();
  setStatus(uploadStatus, selected.length ? `${selected.length} photo(s) ready.` : '');
});

clearBtn.addEventListener('click', () => {
  clearSelection();
  setStatus(uploadStatus, '');
});

// --- processing ----------------------------------------------------------

const pad = (n) => String(n).padStart(2, '0');

// Name photos by capture time when the original name has it (e.g. PXL_20261004_101530123.jpg),
// otherwise by the file's modified time. The gallery sorts on this.
function fileStem(file) {
  const m = file.name.match(/(20\d{2})(\d{2})(\d{2})[_-]?(\d{2})(\d{2})(\d{2})/);
  let stamp;
  if (m) {
    stamp = `${m[1]}${m[2]}${m[3]}-${m[4]}${m[5]}${m[6]}`;
  } else {
    const d = new Date(file.lastModified || Date.now());
    stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  }
  const rand = crypto.getRandomValues(new Uint16Array(1))[0].toString(16).padStart(4, '0');
  return `${stamp}-${rand}`;
}

// Capture time in ms from a stem like 20261004-110313-271e, parsed as UTC like the old build did.
function timeFromStem(stem) {
  const m = stem.match(/^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})/);
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
}

function drawInside(source, sw, sh, maxW, maxH) {
  const scale = Math.min(1, maxW / sw, maxH / sh);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(sw * scale));
  canvas.height = Math.max(1, Math.round(sh * scale));
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function encodeWebp(canvas, quality) {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => {
      if (!b) reject(new Error('Could not encode image'));
      else if (b.type !== 'image/webp') reject(new Error('This browser cannot encode WebP. Use a Chromium-based browser.'));
      else resolve(b);
    }, 'image/webp', quality));
}

async function makeVariants(file) {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const blobs = {};
  let source = bitmap;
  let w = bitmap.width;
  let h = bitmap.height;
  let full;
  try {
    for (const [size, maxW, maxH, quality] of VARIANTS) {
      const canvas = drawInside(source, w, h, maxW, maxH);
      blobs[size] = await encodeWebp(canvas, quality);
      if (size === 'full') full = { w: canvas.width, h: canvas.height };
      source = canvas;
      w = canvas.width;
      h = canvas.height;
    }
  } finally {
    bitmap.close();
  }
  return { blobs, ...full };
}

// Made once per photo, so a retry re-sends the same id and bytes instead of leaving orphans.
async function prepare(s) {
  if (s.prepared) return s.prepared;
  const { blobs, w, h } = await makeVariants(s.file);
  const digest = await crypto.subtle.digest('SHA-256', await blobs.full.arrayBuffer());
  const hash = [...new Uint8Array(digest).slice(0, 4)].map((b) => b.toString(16).padStart(2, '0')).join('');
  const stem = fileStem(s.file);
  s.prepared = { id: `${stem}-${hash}`, blobs, w, h, t: timeFromStem(stem) };
  return s.prepared;
}

// --- upload --------------------------------------------------------------

async function uploadOne(s) {
  const p = await prepare(s);
  await Promise.all(Object.keys(p.blobs).map((size) =>
    api(`/api/img/${size}/${p.id}.webp`, { method: 'PUT', body: p.blobs[size], type: 'image/webp' })));
  await api('/api/photos', {
    method: 'POST',
    body: JSON.stringify({ id: p.id, w: p.w, h: p.h, t: p.t }),
    type: 'application/json',
  });
}

uploadBtn.addEventListener('click', async () => {
  uploadBtn.disabled = true;
  clearBtn.hidden = true;
  filesInput.disabled = true;
  const done = [];
  let lastError;
  try {
    for (const [i, s] of selected.entries()) {
      setStatus(uploadStatus, `Uploading ${i + 1} of ${selected.length}…`);
      s.badge.textContent = '…';
      try {
        await uploadOne(s);
        s.badge.textContent = '✓';
        done.push(s);
      } catch (err) {
        console.error(err);
        s.badge.textContent = '!';
        lastError = err;
      }
    }
  } finally {
    // Successful photos leave the list; failed ones keep their preview for a retry.
    for (const s of done) {
      URL.revokeObjectURL(s.url);
      s.li.remove();
    }
    selected = selected.filter((s) => !done.includes(s));
    filesInput.disabled = false;
    updateButtons();
  }

  if (!lastError) {
    setStatus(uploadStatus, `Uploaded ${done.length} photo(s). They're live now.`);
  } else {
    const prefix = done.length ? `Uploaded ${done.length}, ` : '';
    setStatus(uploadStatus, `${prefix}${selected.length} failed — ${lastError.message}. Tap Upload to retry.`, true);
  }
});

showKeyState();
