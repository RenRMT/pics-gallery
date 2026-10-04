// Builds the static site into _site/: copies pages and assets and renders the app icons.
// Photos and photos.json live in R2 and are served by the Worker in worker/.

import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = path.join(ROOT, '_site');

const STATIC = ['index.html', 'gallery.html', 'upload.html', 'upload.webmanifest', 'assets'];

async function renderIcons() {
  const svg = await fs.readFile(path.join(ROOT, 'assets', 'icon.svg'));
  for (const size of [192, 512]) {
    await sharp(svg, { density: 300 }).resize(size, size).png().toFile(path.join(OUT, `icon-${size}.png`));
  }
}

async function main() {
  await fs.rm(OUT, { recursive: true, force: true });
  await fs.mkdir(OUT, { recursive: true });

  for (const entry of STATIC) {
    await fs.cp(path.join(ROOT, entry), path.join(OUT, entry), { recursive: true });
  }
  await renderIcons();

  await fs.writeFile(path.join(OUT, '.nojekyll'), '');
  console.log('Built site into _site/');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
