import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workerPath = path.join(root, 'worker', 'index.js');
const htmlPath = path.join(root, 'public', 'index.html');
const builtPath = path.join(root, 'worker', 'index.built.js');

if (!fs.existsSync(htmlPath)) {
  throw new Error('public/index.html is missing. The Worker SPA cannot be built.');
}

const workerSource = fs.readFileSync(workerPath, 'utf8');
const appHtml = fs.readFileSync(htmlPath, 'utf8');
const placeholder = "const APP_HTML = '__APP_HTML_PLACEHOLDER__';";

if (!workerSource.includes(placeholder)) {
  throw new Error('worker/index.js does not contain the APP_HTML placeholder.');
}

const builtSource = workerSource.replace(placeholder, `const APP_HTML = ${JSON.stringify(appHtml)};`);
fs.writeFileSync(builtPath, builtSource, 'utf8');

console.log(`Built ${path.relative(root, builtPath)} from ${path.relative(root, htmlPath)}`);
