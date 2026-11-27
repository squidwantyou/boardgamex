import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
const require = createRequire(import.meta.url);
const sharp = require('sharp');
const directory = new URL('../apps/web/src/assets/seasons/', import.meta.url);
await mkdir(new URL('markers/', directory), { recursive: true });
for (let index = 0; index < 4; index++) {
  await sharp(new URL('table/bonuses.png', directory).pathname.replace(/^\/([A-Z]:)/, '$1'))
    .extract({ left: 0, top: index * 55, width: 39, height: 55 })
    .png().toFile(new URL(`markers/badge-${index + 1}.png`, directory).pathname.replace(/^\/([A-Z]:)/, '$1'));
}
for (const year of [2, 3]) {
  await sharp(new URL('table/icons2022.png', directory).pathname.replace(/^\/([A-Z]:)/, '$1'))
    .extract({ left: 0, top: (year - 2) * 150, width: 150, height: 150 })
    .png().toFile(new URL(`markers/year-${year}.png`, directory).pathname.replace(/^\/([A-Z]:)/, '$1'));
}
