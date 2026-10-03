import { cp, mkdir, rm } from 'node:fs/promises';
await rm('dist', { recursive: true, force: true });
await mkdir('dist');
await cp('public', 'dist', { recursive: true });
console.log('Built static site in dist/. Cloudflare Pages Functions remain in functions/.');
