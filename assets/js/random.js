import { loadPhotos, src, srcset, showEmpty } from './photos.js';

const main = document.querySelector('main');
const img = document.querySelector('.random-frame img');
const btn = document.querySelector('#another');

let photos = [];
let bag = []; // shuffled queue: every photo is shown once before any repeats
let current = null;
let upcoming = null;

function draw() {
  if (!bag.length) {
    bag = photos.map((_, i) => i);
    for (let i = bag.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [bag[i], bag[j]] = [bag[j], bag[i]];
    }
    // don't start a new round with the photo currently on screen
    const last = bag.length - 1;
    if (last > 0 && photos[bag[last]] === current) [bag[0], bag[last]] = [bag[last], bag[0]];
  }
  return photos[bag.pop()];
}

function preload(p) {
  const pre = new Image();
  pre.sizes = '100vw';
  pre.srcset = srcset(p);
  pre.src = src(p.id, 'md');
}

function show(p) {
  current = p;
  img.classList.remove('loaded');
  img.width = p.w;
  img.height = p.h;
  img.sizes = '100vw';
  img.srcset = srcset(p);
  img.src = src(p.id, 'md');
  img.decode().catch(() => {}).finally(() => {
    if (current === p) img.classList.add('loaded');
  });
  upcoming = draw();
  preload(upcoming);
}

function next() {
  if (photos.length > 1) show(upcoming);
}

btn.addEventListener('click', next);
document.addEventListener('keydown', (e) => {
  if (e.target.closest('button, a, input')) return;
  if (e.key === ' ' || e.key === 'ArrowRight') {
    e.preventDefault();
    next();
  }
});

try {
  photos = await loadPhotos();
  if (!photos.length) {
    showEmpty(main);
  } else {
    btn.hidden = photos.length < 2;
    show(draw());
  }
} catch (err) {
  console.error(err);
  showEmpty(main, 'Could not load photos.');
}
