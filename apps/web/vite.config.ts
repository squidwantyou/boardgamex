import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// 线上部署在 https://thinktwice.top/bgx/，所有资源与 API 都带 /bgx 前缀。
const BASE = '/bgx/';
const protocolSource = path.resolve(__dirname, '../../packages/protocol/src');
const proxy = {
  [`${BASE}api`]: {
    target: 'http://127.0.0.1:8787',
    changeOrigin: false,
    rewrite: (path: string) => path.replace(/^\/bgx/, ''),
  },
  [`${BASE}socket.io`]: {
    target: 'ws://127.0.0.1:8787',
    ws: true,
    rewrite: (path: string) => path.replace(/^\/bgx/, ''),
  },
};

export default defineConfig({
  base: BASE,
  plugins: [react()],
  resolve: {
    alias: [
      // Workspace rules must stay live; prebundled copies can retain old costs.
      { find: /^@bgx\/protocol$/, replacement: path.join(protocolSource, 'index.ts') },
      { find: /^@bgx\/protocol\/(.+)$/, replacement: `${protocolSource}/$1.ts` },
    ],
    dedupe: ['react', 'react-dom'],
  },
  optimizeDeps: {
    exclude: ['@bgx/protocol'],
    include: [
      'react/jsx-runtime',
      'react/jsx-dev-runtime',
      'react',
      'react-dom',
      'react-router-dom',
    ],
  },
  server: {
    port: 5173,
    proxy,
  },
  preview: {
    port: 4173,
    strictPort: true,
    host: '127.0.0.1',
    allowedHosts: ['127.0.0.1'],
    proxy,
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    target: 'es2022',
  },
  // 应用代码全部是 ESM；两个第三方运行时包仍是 CommonJS，交给
  // Rollup 按 Node 的 CJS 规则转换，不能在浏览器构建里当成 ESM 分析。
  ssr: {
    noExternal: [],
  },
});
