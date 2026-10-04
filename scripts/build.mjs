// Builds the static site into _site/:
//  - copies pages and assets
//  - generates resized, metadata-free WebP variants of every photo in photos/
//  - writes photos.json (newest first)
// Generated variants are cached in .cache/ so rebuilds only process new photos.

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const ROOT = path.resolve(import.meta.dirname, '..');
const PHOTOS = path.resolve(ROOT, process.env.PHOTOS_DIR || 'photos');
const OUT = path.join(ROOT, '_site');
const CACHE = path.join(ROOT, '.cache', 'img');

const STATIC = ['index.html', 'gallery.html', 'upload.html', 'upload.webmanifest', 'assets'];
const IMAGE_EXT = /\.(jpe?g|png|webp|avif|tiff?|heic|heif)$/i;
const VARIANTS = {
  thumb: { width: 960, height: 600, quality: 78 },
  md: { width: 1600, height: 1600, quality: 82 },
  full: { width: 2560, height: 2560, quality: 85 },
};

const exists = (p) => fs.access(p).then(() => true, () => false);

function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'photo';
}

// Sort key: a date in the filename (upload page, Pixel/most camera apps),
// else the commit that added the file, else its mtime.
function dateFromName(name) {
  const m = name.match(/(20\d{2})(\d{2})(\d{2})[_-]?(\d{2})(\d{2})(\d{2})/);
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : null;
}

function gitAddedTimes() {
  const times = new Map();
  try {
    const log = execFileSync('git', ['log', '--diff-filter=A', '--name-only', '--format=@%ct', '--', path.relative(ROOT, PHOTOS)],
      { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    let t = 0;
    for (const line of log.split('\n')) {
      if (line.startsWith('@')) t = +line.slice(1) * 1000;
      else if (line.trim()) times.set(path.basename(line.trim()), t); // log is newest-first; oldest add wins
    }
  } catch { /* not a git checkout */ }
  return times;
}

async function renderIcons() {
  const svg = await fs.readFile(path.join(ROOT, 'assets', 'icon.svg'));
  for (const size of [192, 512]) {
    await sharp(svg, { density: 300 }).resize(size, size).png().toFile(path.join(OUT, `icon-${size}.png`));
  }
}

async function processPhoto(file, gitTimes) {
  const src = path.join(PHOTOS, file);
  const buf = await fs.readFile(src);
  const hash = createHash('sha1').update(buf).digest('hex').slice(0, 8);
  const id = `${slugify(path.parse(file).name)}-${hash}`;
  const metaPath = path.join(CACHE, `${id}.json`);

  let meta;
  if (await exists(metaPath)) {
    meta = JSON.parse(await fs.readFile(metaPath, 'utf8'));
  } else {
    for (const [name, v] of Object.entries(VARIANTS)) {
      const info = await sharp(buf)
        .rotate() // apply EXIF orientation; metadata is dropped on output
        .resize({ width: v.width, height: v.height, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: v.quality })
        .toFile(path.join(CACHE, name, `${id}.webp`));
      if (name === 'full') meta = { w: info.width, h: info.height };
    }
    await fs.writeFile(metaPath, JSON.stringify(meta));
    console.log(`  + ${file}`);
  }

  const { mtimeMs } = await fs.stat(src);
  const t = dateFromName(file) ?? gitTimes.get(file) ?? mtimeMs;
  return { id, ...meta, t };
}

async function main() {
  await fs.rm(OUT, { recursive: true, force: true });
  await fs.mkdir(OUT, { recursive: true });
  for (const name of Object.keys(VARIANTS)) await fs.mkdir(path.join(CACHE, name), { recursive: true });

  for (const entry of STATIC) {
    await fs.cp(path.join(ROOT, entry), path.join(OUT, entry), { recursive: true });
  }
  await renderIcons();

  const files = (await exists(PHOTOS) ? await fs.readdir(PHOTOS) : []).filter((f) => IMAGE_EXT.test(f));
  const gitTimes = gitAddedTimes();
  const photos = [];
  for (const file of files) {
    try {
      photos.push(await processPhoto(file, gitTimes));
    } catch (err) {
      console.warn(`  ! skipped ${file}: ${err.message}`);
    }
  }
  photos.sort((a, b) => b.t - a.t || a.id.localeCompare(b.id));

  // Copy the variants in use; prune cache entries for deleted photos.
  const ids = new Set(photos.map((p) => p.id));
  for (const name of Object.keys(VARIANTS)) {
    await fs.mkdir(path.join(OUT, 'img', name), { recursive: true });
    for (const id of ids) {
      await fs.copyFile(path.join(CACHE, name, `${id}.webp`), path.join(OUT, 'img', name, `${id}.webp`));
    }
    for (const f of await fs.readdir(path.join(CACHE, name))) {
      if (!ids.has(path.parse(f).name)) await fs.rm(path.join(CACHE, name, f));
    }
  }
  for (const f of await fs.readdir(CACHE)) {
    if (f.endsWith('.json') && !ids.has(path.parse(f).name)) await fs.rm(path.join(CACHE, f));
  }

  const manifest = photos.map(({ id, w, h }) => ({ id, w, h }));
  await fs.writeFile(path.join(OUT, 'photos.json'), JSON.stringify(manifest));
  await fs.writeFile(path.join(OUT, '.nojekyll'), '');
  console.log(`Built ${photos.length} photo(s) into _site/`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
