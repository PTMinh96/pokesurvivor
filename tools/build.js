/* Bundle the game for release: one minified JS file instead of ~60.
 *   node tools/build.js
 *
 * - dev.html is the "source" page: it loads each script separately for easier
 *   development and debugging. EDIT dev.html, not index.html.
 * - index.html is generated from dev.html, replacing the script block with
 *   js/app.min.js (with a URL fingerprint to avoid stale cache).
 * - node tools/build.js --sin-seo  ->  omit SEO markup (until pokesurvivor.com is ready).
 * - Then regenerate en/index.html: python tools/make_seo_pages.py
 */
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const { execFileSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const DEV = path.join(ROOT, 'dev.html'), OUT = path.join(ROOT, 'index.html');
const BEGIN = '<!-- scripts:begin -->', END = '<!-- scripts:end -->';

const dev = fs.readFileSync(DEV, 'utf8');
const i = dev.indexOf(BEGIN), j = dev.indexOf(END);
if (i < 0 || j < 0) throw new Error('dev.html no tiene las marcas ' + BEGIN + ' / ' + END);
const block = dev.slice(i, j + END.length);
const files = [...block.matchAll(/<script[^>]*src="(js\/[^"]+\.js)"/g)].map(m => m[1]);

// Join files in order, separating each with ';' in case one lacks a trailing semicolon.
let joined = files.map(f => `/* ${f} */\n` + fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n;\n');
// Anti-cheat: the released game is WRAPPED in a function:
// G is no longer available in the browser console (F12), along with shortcuts
// for invincibility, skipping the timer, etc. (dev.html remains unchanged for development).
//   --expose   do not wrap or obfuscate (for automated tests)
const EXPOSE = process.argv.includes('--expose');
if (!EXPOSE) {
  const WIN_G = 'window.G = window.G || {};';
  if (!joined.includes(WIN_G)) throw new Error('util.js ya no crea G como se esperaba: revisa build.js');
  joined = '(() => {\n' + joined.replace(WIN_G, 'var G = {};') + '\n})();\n';
}
const tmp = path.join(ROOT, 'tools', 'cache', 'app.js');
fs.mkdirSync(path.dirname(tmp), { recursive: true });
fs.writeFileSync(tmp, joined);
const outJs = path.join(ROOT, 'js', 'app.min.js');
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const shell = process.platform === 'win32';
execFileSync(npx, ['--yes', 'terser@5', tmp, '--compress', 'passes=1', '--mangle', '--comments', 'false', '--ecma', '2020', '-o', outJs],
  { stdio: 'inherit', shell });
// Also obfuscate: the code becomes unreadable and breaks if reformatted for
// editing. Strings are stored in an encoded table (only some, to avoid slowing
// the game). Fixed seed: the same code always produces the same file.
if (!EXPOSE) {
  execFileSync(npx, ['--yes', 'javascript-obfuscator@4.1.1', outJs, '--output', outJs,
    '--compact', 'true', '--self-defending', 'true', '--seed', '7',
    '--string-array', 'true', '--string-array-encoding', 'base64', '--string-array-threshold', '0.1',
    '--identifier-names-generator', 'hexadecimal', '--rename-globals', 'false', '--transform-object-keys', 'false',
    '--split-strings', 'false', '--control-flow-flattening', 'false', '--dead-code-injection', 'false',
    '--unicode-escape-sequence', 'false', '--target', 'browser'], { stdio: 'inherit', shell });
}
const min = fs.readFileSync(outJs);
// The fingerprint includes CSS too: even a styles-only change is a new version (version.json).
const hash = crypto.createHash('sha1').update(min).update(fs.readFileSync(path.join(ROOT, 'css', 'style.css'))).digest('hex').slice(0, 10);

// French, Italian, Portuguese, and Chinese dictionaries (js/lang/), one per language:
// locales.js requests them with the same ?v= fingerprint to avoid stale cached translations.
const { build: buildLangs } = require('./build_langs');
const langSizes = buildLangs();
const LOC = '<script src="js/core/locales.js"></script>';
const locHash = crypto.createHash('sha1').update(fs.readFileSync(path.join(ROOT, 'js', 'core', 'locales.js')));
for (const f of fs.readdirSync(path.join(ROOT, 'js', 'lang')).sort()) locHash.update(fs.readFileSync(path.join(ROOT, 'js', 'lang', f)));
if (!dev.includes(LOC)) throw new Error('dev.html no carga ' + LOC + ' como se esperaba: revisa build.js');

let html = dev.slice(0, i) + `<script defer src="js/app.min.js?v=${hash}"></script>` + dev.slice(j + END.length);
html = html.replace(LOC, `<script src="js/core/locales.js?v=${locHash.digest('hex').slice(0, 10)}"></script>`);
// Fingerprint the stylesheet too; otherwise, the browser could combine the new page
// with an old cached style.css.
const CSS = '<link rel="stylesheet" href="css/style.css">';
if (!dev.includes(CSS)) throw new Error('dev.html no carga ' + CSS + ' como se esperaba: revisa build.js');
const cssHash = crypto.createHash('sha1').update(fs.readFileSync(path.join(ROOT, 'css', 'style.css'))).digest('hex').slice(0, 10);
html = html.replace(CSS, `<link rel="stylesheet" href="css/style.css?v=${cssHash}">`);
html = html.replace(/<meta name="robots" content="noindex">\s*/, '');
// --sin-seo: omit canonical/social/structured data and page links
// (for publishing before the pokesurvivor.com domain is ready).
const SIN_SEO = process.argv.includes('--sin-seo');
html = SIN_SEO ? html.replace(/<!-- seo:begin -->[\s\S]*?<!-- seo:end -->\n?/g, '') : html.replace(/<!-- seo:(begin|end) -->\n?/g, '');
html = html.replace(/<!-- dev.html: página fuente[^>]*-->/, '<!-- Generated from dev.html by tools/build.js: do not edit by hand (edit dev.html instead). -->');
fs.writeFileSync(OUT, html);
// Release version: players check it every 5 minutes; if it changes, the game
// updates automatically (in the menu or after the run). See js/core/updater.js.
// --forzar: mandatory update; also ends active runs after saving them.
const FORZAR = process.argv.includes('--forzar');
fs.writeFileSync(path.join(ROOT, 'version.json'), JSON.stringify(Object.assign({ v: hash, at: new Date().toISOString() }, FORZAR ? { force: true } : {})) + '\n');
console.log('ok: diccionarios ' + langSizes.join(' · '));
console.log(`${FORZAR ? '[OBLIGATORIA] ' : ''}${SIN_SEO ? '[sin SEO] ' : ''}${EXPOSE ? '[SIN PROTEGER, sólo pruebas] ' : ''}ok: ${files.length} scripts · ${(joined.length / 1024).toFixed(0)} KB -> ${(min.length / 1024).toFixed(0)} KB (app.min.js?v=${hash})`);
