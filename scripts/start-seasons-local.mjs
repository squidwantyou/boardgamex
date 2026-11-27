import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const data = path.join(root, '.local', 'seasons-v2');
await mkdir(data, { recursive: true });
const env = {
  ...process.env,
  PORT: '8787',
  HOST: '127.0.0.1',
  PUBLIC_BASE_PATH: '/bgx',
  DB_PATH: process.env.SEASONS_DB_PATH ?? path.join(data, `seasons-${Date.now()}.db`),
  BGX_LOCAL_RESET_ON_START: '0',
};
const children = [
  spawn(process.execPath, ['--experimental-sqlite', 'apps/server/dist/index.js'], {
    cwd: root, env, stdio: 'inherit', windowsHide: true,
  }),
  spawn(process.execPath, [path.join(root, 'apps/web/node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', '5174', '--strictPort'], {
    cwd: path.join(root, 'apps/web'), env, stdio: 'inherit', windowsHide: true,
  }),
];
children[1].on('error', (error) => { console.error(error); process.exitCode = 1; });
for (const child of children) child.on('exit', (code) => {
  if (code) {
    process.exitCode = code;
    for (const sibling of children) if (sibling !== child) sibling.kill();
  }
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
  for (const child of children) child.kill();
});
console.log('Seasons local: http://127.0.0.1:5174/bgx/');
console.log(`Isolated database: ${env.DB_PATH}`);
