// Phone upload: resizes photos in the browser (which strips all EXIF, including GPS),
// then commits them to photos/ in a single commit via the GitHub Git Data API.
// Pushing to main triggers the deploy workflow.

const REPO = 'RenRMT/pics_gallery';
const BRANCH = 'main';
const MAX_EDGE = 2560;
const QUALITY = 0.88;

const API = `https://api.github.com/repos/${REPO}`;
const TOKEN_KEY = 'gh_token';

const $ = (sel) => document.querySelector(sel);
const tokenInput = $('#token');
const tokenStatus = $('#token-status');
const uploadStatus = $('#upload-status');
const filesInput = $('#files');
const previews = $('#previews');
const uploadBtn = $('#upload');
const clearBtn = $('#clear');

let selected = []; // [{ file, li, badge }]

const storage = {
  get: () => { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } },
  set: (v) => { try { localStorage.setItem(TOKEN_KEY, v); } catch {} },
  clear: () => { try { localStorage.removeItem(TOKEN_KEY); } catch {} },
};

function setStatus(el, text, isError = false) {
  el.textContent = text;
  el.classList.toggle('error', isError);
}

async function gh(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${storage.get()}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(body && { 'Content-Type': 'application/json' }),
    },
    body: body && JSON.stringify(body),
  });
  if (!res.ok) {
    const msg = await res.json().then((j) => j.message, () => res.statusText);
    throw new Error(`GitHub ${res.status}: ${msg}`);
  }
  return res.json();
}

// --- token ---------------------------------------------------------------

function showTokenState() {
  const has = !!storage.get();
  tokenInput.value = '';
  tokenInput.hidden = has;
  $('label[for="token"]').textContent = has ? 'GitHub token saved' : 'GitHub token';
  $('#save-token').hidden = has;
  $('#forget-token').hidden = !has;
  $('#upload-section').hidden = !has;
}

$('#save-token').addEventListener('click', async () => {
  const value = tokenInput.value.trim();
  if (!value) return;
  storage.set(value);
  setStatus(tokenStatus, 'Checking…');
  try {
    await gh(`/branches/${BRANCH}`);
    setStatus(tokenStatus, `Connected to ${REPO}.`);
    showTokenState();
  } catch (err) {
    storage.clear();
    setStatus(tokenStatus, `Token rejected — ${err.message}`, true);
  }
});

$('#forget-token').addEventListener('click', () => {
  storage.clear();
  setStatus(tokenStatus, 'Token removed from this device.');
  showTokenState();
});

// --- selection -----------------------------------------------------------

function clearSelection() {
  for (const s of selected) URL.revokeObjectURL(s.url);
  selected = [];
  previews.innerHTML = '';
  filesInput.value = '';
  uploadBtn.disabled = true;
  clearBtn.hidden = true;
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
    selected.push({ file, url, badge });
  }
  filesInput.value = '';
  uploadBtn.disabled = !selected.length;
  clearBtn.hidden = !selected.length;
  setStatus(uploadStatus, selected.length ? `${selected.length} photo(s) ready.` : '');
});

clearBtn.addEventListener('click', () => {
  clearSelection();
  setStatus(uploadStatus, '');
});

// --- processing ----------------------------------------------------------

const pad = (n) => String(n).padStart(2, '0');

// Name files by capture time when the original name has it (e.g. PXL_20261004_101530123.jpg),
// otherwise by the file's modified time. The build sorts on this.
function fileName(file) {
  const m = file.name.match(/(20\d{2})(\d{2})(\d{2})[_-]?(\d{2})(\d{2})(\d{2})/);
  let stamp;
  if (m) {
    stamp = `${m[1]}${m[2]}${m[3]}-${m[4]}${m[5]}${m[6]}`;
  } else {
    const d = new Date(file.lastModified || Date.now());
    stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  }
  const rand = crypto.getRandomValues(new Uint16Array(1))[0].toString(16).padStart(4, '0');
  return `${stamp}-${rand}.jpg`;
}

async function resize(file) {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode image'))), 'image/jpeg', QUALITY));
}

function toBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

// --- upload --------------------------------------------------------------

uploadBtn.addEventListener('click', async () => {
  uploadBtn.disabled = true;
  clearBtn.hidden = true;
  filesInput.disabled = true;
  try {
    const tree = [];
    for (const [i, s] of selected.entries()) {
      setStatus(uploadStatus, `Processing ${i + 1} of ${selected.length}…`);
      s.badge.textContent = '…';
      const blob = await resize(s.file);
      const { sha } = await gh('/git/blobs', {
        method: 'POST',
        body: { content: await toBase64(blob), encoding: 'base64' },
      });
      tree.push({ path: `photos/${fileName(s.file)}`, mode: '100644', type: 'blob', sha });
      s.badge.textContent = '✓';
    }

    setStatus(uploadStatus, 'Committing…');
    const ref = await gh(`/git/ref/heads/${BRANCH}`);
    const parent = await gh(`/git/commits/${ref.object.sha}`);
    const newTree = await gh('/git/trees', { method: 'POST', body: { base_tree: parent.tree.sha, tree } });
    const commit = await gh('/git/commits', {
      method: 'POST',
      body: {
        message: `Add ${tree.length} photo${tree.length > 1 ? 's' : ''}`,
        tree: newTree.sha,
        parents: [ref.object.sha],
      },
    });
    await gh(`/git/refs/heads/${BRANCH}`, { method: 'PATCH', body: { sha: commit.sha } });

    clearSelection();
    setStatus(uploadStatus, `Uploaded ${tree.length} photo(s). The site updates in about 1–2 minutes.`);
  } catch (err) {
    console.error(err);
    setStatus(uploadStatus, `Upload failed — ${err.message}`, true);
    uploadBtn.disabled = !selected.length;
    clearBtn.hidden = !selected.length;
  } finally {
    filesInput.disabled = false;
  }
});

showTokenState();
