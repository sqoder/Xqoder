const fs = require('node:fs');
const path = require('node:path');

const distDir = path.join(process.cwd(), 'dist');
fs.mkdirSync(distDir, { recursive: true });
fs.writeFileSync(
    path.join(distDir, 'index.html'),
    '<!doctype html><html><body><h1>XQoder Fixture</h1></body></html>\n',
    'utf-8',
);
