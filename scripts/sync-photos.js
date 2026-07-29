'use strict';

const fs = require('fs');
const path = require('path');

const root = process.cwd();
const fullsDir = path.join(root, 'images', 'fulls');
const thumbsDir = path.join(root, 'images', 'thumbs');
const dataDir = path.join(root, '_data');
const manifestPath = path.join(dataDir, 'photos.yml');
const imagePattern = /\.(jpe?g|png|webp|avif)$/i;

function listImages(dir) {
  return fs.readdirSync(dir)
    .filter((file) => imagePattern.test(file))
    .filter((file) => !file.startsWith('_'))
    .sort();
}

function listPrivateImages(dir) {
  return fs.readdirSync(dir)
    .filter((file) => imagePattern.test(file))
    .filter((file) => file.startsWith('_'))
    .sort();
}

function quote(value) {
  return JSON.stringify(value);
}

function titleFromFile(file) {
  return file
    .replace(/\.[^.]+$/, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function makeBlock(file, order) {
  const title = titleFromFile(file);
  return [
    `- file: ${quote(file)}`,
    `  title: ${quote(title)}`,
    '  category: "portfolio"',
    '  area: ""',
    `  alt: ${quote(`Shioji Ryosukeが撮影したポートフォリオ作品「${title}」`)}`,
    `  order: ${order}`,
    '  featured: false',
    ''
  ].join('\n');
}

fs.mkdirSync(dataDir, { recursive: true });

const fulls = listImages(fullsDir);
const thumbs = new Set(listImages(thumbsDir));
const privateImages = [
  ...listPrivateImages(fullsDir).map((file) => `images/fulls/${file}`),
  ...listPrivateImages(thumbsDir).map((file) => `images/thumbs/${file}`)
];
const missingThumbs = fulls.filter((file) => !thumbs.has(file));

if (missingThumbs.length > 0) {
  console.error('Missing thumbnails:');
  missingThumbs.forEach((file) => console.error(`- ${file}`));
  process.exit(1);
}

if (privateImages.length > 0) {
  console.warn('Skipped Jekyll-private image names. Rename files that start with "_" before publishing:');
  privateImages.forEach((file) => console.warn(`- ${file}`));
}

const rebuild = process.argv.includes('--rebuild');
const current = !rebuild && fs.existsSync(manifestPath)
  ? fs.readFileSync(manifestPath, 'utf8')
  : '# Photo manifest. Run `npm run photos:sync` after adding images.\n\n';
const registered = new Set(
  Array.from(current.matchAll(/^\s*-?\s*file:\s*["']?([^"'\n]+)["']?\s*$/gm)).map((match) => match[1])
);
const missing = fulls.filter((file) => !registered.has(file));

if (missing.length === 0) {
  console.log(`Photo manifest already up to date (${fulls.length} photos).`);
  process.exit(0);
}

const startOrder = registered.size + 1;
const nextBlocks = missing.map((file, index) => makeBlock(file, startOrder + index)).join('\n');
const separator = current.endsWith('\n') ? '' : '\n';
fs.writeFileSync(manifestPath, `${current}${separator}${nextBlocks}`, 'utf8');

console.log(`Added ${missing.length} photo entries to _data/photos.yml.`);
