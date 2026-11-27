import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
const sharp = require('sharp');
const assets = path.join(root, 'apps/web/src/assets/seasons');
const manifest = JSON.parse(await fs.readFile(path.join(root, 'docs/seasons-assets.json'), 'utf8'));
if (manifest.draftCards !== 90 || manifest.diceFaces !== 120) throw new Error('Invalid manifest counts');
const mapping = new Map(manifest.cards.map((card) => [card.id, card]));
if (mapping.size !== 91) throw new Error('Expected 90 draft cards plus one generated Replica');
const hashes = new Set();
const indexes = new Set();
for (let id = 1; id <= 90; id++) {
  const map = mapping.get(id);
  if (!map || indexes.has(map.imageIndex)) throw new Error(`Invalid mapping #${id}`);
  indexes.add(map.imageIndex);
  const bytes = await fs.readFile(path.join(assets, map.file));
  const meta = await sharp(bytes).metadata();
  const hash = createHash('sha256').update(bytes).digest('hex');
  if (hash !== map.sha256 || hashes.has(hash) || meta.width !== 293 || meta.height !== 410) {
    throw new Error(`Invalid card face #${id}`);
  }
  hashes.add(hash);
  const full = await fs.readFile(path.join(assets, map.fullFile));
  if (createHash('sha256').update(full).digest('hex') !== map.fullSha256) {
    throw new Error(`Invalid detail face #${id}`);
  }
  // Ignore the narrow Chinese title overlay; both views must show the same card.
  const crop = { left: 0, top: 24, width: 293, height: 386 };
  const labelledPixels = await sharp(bytes).extract(crop).removeAlpha().raw().toBuffer();
  const detailPixels = await sharp(full).extract(crop).removeAlpha().raw().toBuffer();
  let difference = 0;
  for (let pixel = 0; pixel < labelledPixels.length; pixel++) {
    difference += Math.abs(labelledPixels[pixel] - detailPixels[pixel]);
  }
  if (difference / labelledPixels.length > 8) throw new Error(`Mismatched table/detail identity #${id}`);
}
for (const letter of ['w', 's', 'u', 'f']) for (let die = 1; die <= 5; die++) for (let face = 1; face <= 6; face++) {
  const meta = await sharp(path.join(assets, `dice/${letter}${die}r${face}.webp`)).metadata();
  if (!meta.width || !meta.height) throw new Error(`Invalid die ${letter}${die}r${face}`);
}
const replica = mapping.get(222);
if (!replica?.generated || indexes.has(replica.imageIndex)) throw new Error('Invalid generated Replica identity');
const replicaBytes = await fs.readFile(path.join(assets, replica.file));
if (createHash('sha256').update(replicaBytes).digest('hex') !== replica.sha256) throw new Error('Replica hash mismatch');
for (let badge = 1; badge <= 4; badge++) {
  const meta = await sharp(path.join(assets, `markers/badge-${badge}.png`)).metadata();
  if (meta.width !== 39 || meta.height !== 55) throw new Error(`Invalid badge #${badge}`);
}
for (const year of [2, 3]) {
  const meta = await sharp(path.join(assets, `markers/year-${year}.png`)).metadata();
  if (meta.width !== 150 || meta.height !== 150) throw new Error(`Invalid year marker #${year}`);
}
console.log('PASS: 90 unique matching table/detail faces, 120 dice faces, separate Replica #222.');
