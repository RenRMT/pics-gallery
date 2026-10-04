import { loadPhotos, src, srcset, showEmpty } from './photos.js';

const grid = document.querySelector('.gallery');
const dlg = document.querySelector('.lightbox');
const lbImg = dlg.querySelector('img');

let photos = [];
let index = 0;

function renderGrid() {
  const frag = document.createDocumentFragment();
  photos.forEach((p, i) => {
    const a = document.createElement('a');
    a.className = 'tile';
    a.href = src(p.id, 'full');
    a.style.setProperty('--r', (p.w / p.h).toFixed(4));
    a.dataset.index = i;

    const img = document.createElement('img');
    img.src = src(p.id, 'thumb');
    img.width = p.w;
    img.height = p.h;
    img.loading = 'lazy';
    img.decoding = 'async';
    img.alt = '';
    a.append(img);
    frag.append(a);
  });
  grid.append(frag);
}

function preload(i) {
  const p = photos[(i + photos.length) % photos.length];
  const pre = new Image();
  pre.sizes = '100vw';
  pre.srcset = srcset(p);
}

function show(i) {
  index = (i + photos.length) % photos.length;
  const p = photos[index];
  // Thumbnail as a backdrop so something shows instantly while the large image loads.
  lbImg.style.background = `center / contain no-repeat url("${src(p.id, 'thumb')}")`;
  lbImg.width = p.w;
  lbImg.height = p.h;
  lbImg.sizes = '100vw';
  lbImg.srcset = srcset(p);
  lbImg.src = src(p.id, 'md');
  if (photos.length > 1) {
    preload(index + 1);
    preload(index - 1);
  }
}

// The lightbox pushes a history entry so the Android back button closes it.
function open(i) {
  show(i);
  if (!dlg.open) {
    dlg.showModal();
    history.pushState({ lightbox: true }, '');
  }
}

function requestClose() {
  if (history.state?.lightbox) history.back();
  else dlg.close();
}

addEventListener('popstate', () => {
  if (dlg.open) dlg.close();
});

grid.addEventListener('click', (e) => {
  const tile = e.target.closest('.tile');
  if (!tile) return;
  e.preventDefault();
  open(+tile.dataset.index);
});

dlg.addEventListener('cancel', (e) => {
  e.preventDefault();
  requestClose();
});
dlg.querySelector('.lb-close').addEventListener('click', requestClose);
dlg.querySelector('.lb-prev').addEventListener('click', () => show(index - 1));
dlg.querySelector('.lb-next').addEventListener('click', () => show(index + 1));

dlg.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowRight') show(index + 1);
  else if (e.key === 'ArrowLeft') show(index - 1);
});

// Swipe left/right to navigate; tap outside the photo to close.
let start = null;
dlg.addEventListener('pointerdown', (e) => {
  if (e.isPrimary) start = { x: e.clientX, y: e.clientY, t: e.timeStamp };
});
dlg.addEventListener('pointerup', (e) => {
  if (!start || !e.isPrimary) return;
  const dx = e.clientX - start.x;
  const dy = e.clientY - start.y;
  const quick = e.timeStamp - start.t < 600;
  start = null;
  if (quick && Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) {
    show(index + (dx < 0 ? 1 : -1));
  } else if (Math.abs(dx) < 10 && Math.abs(dy) < 10 && e.target === dlg) {
    requestClose();
  }
});
dlg.addEventListener('pointercancel', () => { start = null; });

try {
  photos = await loadPhotos();
  if (photos.length) renderGrid();
  else showEmpty(grid.parentElement);
} catch (err) {
  console.error(err);
  showEmpty(grid.parentElement, 'Could not load photos.');
}
