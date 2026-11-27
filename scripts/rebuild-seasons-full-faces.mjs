import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
const sharp = require('sharp');
const atlas = process.argv[2] ?? path.join(root, 'docs/reference/seasons-card-atlas.jpg');
const manifestPath = path.join(root, 'docs/seasons-assets.json');
const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
const columns = [13, 307, 600, 893, 1187, 1480, 1774, 2068, 2360, 2654, 2934];
const rows = [12, 421, 832, 1240, 1651, 2060, 2469, 2880, 3288, 3697, 4096];
const assets = path.join(root, 'apps/web/src/assets/seasons');

for (const card of manifest.cards.filter((item) => !item.generated)) {
  const column = card.imageIndex % 10;
  const row = Math.floor(card.imageIndex / 10);
  const bytes = await sharp(atlas).extract({
    left: columns[column], top: rows[row],
    width: columns[column + 1] - columns[column],
    height: rows[row + 1] - rows[row],
  }).resize(293, 410, { fit: 'fill' }).png().toBuffer();
  card.fullFile = `cards-bga/${card.id}.png`;
  card.fullSha256 = createHash('sha256').update(bytes).digest('hex');
  await fs.writeFile(path.join(assets, card.fullFile), bytes);
}
await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
console.log('Rebuilt 90 detail faces using the same identity map as table cards.');
