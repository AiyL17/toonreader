/* stamp-version.js
   Updates public/version.json and the data-build-time attribute in
   public/index.html with the current timestamp.
   Run before every git push: npm run stamp
*/
const fs   = require('fs');
const path = require('path');

const buildTime = Date.now();

// ─── Update version.json ──────────────────────────────────────────────────────
const versionPath = path.join(__dirname, '..', 'public', 'version.json');
fs.writeFileSync(versionPath, JSON.stringify({ version: '1.0.0', buildTime }) + '\n');
console.log(`[stamp] version.json → buildTime: ${buildTime}`);

// ─── Update data-build-time in index.html ─────────────────────────────────────
const htmlPath = path.join(__dirname, '..', 'public', 'index.html');
let html = fs.readFileSync(htmlPath, 'utf8');
html = html.replace(
  /(<html[^>]*data-build-time=")[^"]*(")/,
  `$1${buildTime}$2`
);
fs.writeFileSync(htmlPath, html);
console.log(`[stamp] index.html → data-build-time: ${buildTime}`);
