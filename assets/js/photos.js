// Shared helpers for loading the photo manifest built by scripts/build.mjs.
export async function loadPhotos() {
  const res = await fetch('photos.json', { cache: 'no-cache' });
  if (!res.ok) throw new Error(`photos.json: ${res.status}`);
  return res.json(); // [{ id, w, h }], newest first
}

export const src = (id, size) => `img/${size}/${id}.webp`;

export const srcset = (p) =>
  `${src(p.id, 'md')} ${Math.min(p.w, 1600)}w, ${src(p.id, 'full')} ${p.w}w`;

export function showEmpty(container, text = 'No photos yet.') {
  container.innerHTML = '';
  const p = document.createElement('p');
  p.className = 'empty';
  p.textContent = text;
  container.append(p);
}
