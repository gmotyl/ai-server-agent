const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PANEL = path.join(__dirname, '..');
const PUBLIC = path.join(PANEL, 'public');
const readManifest = () => JSON.parse(fs.readFileSync(path.join(PUBLIC, 'manifest.webmanifest'), 'utf8'));

// PNG width/height live in the IHDR chunk at bytes 16..23.
function pngSize(file) {
  const b = fs.readFileSync(file);
  assert.equal(b.subarray(1, 4).toString(), 'PNG', `${file} is not a PNG`);
  return `${b.readUInt32BE(16)}x${b.readUInt32BE(20)}`;
}

test('manifest has required installable fields', () => {
  const m = readManifest();
  for (const k of ['name', 'short_name', 'theme_color', 'background_color']) assert.ok(m[k], `missing ${k}`);
  assert.equal(m.start_url, '/');
  assert.equal(m.scope, '/');
  assert.equal(m.display, 'standalone');
  const sizes = m.icons.map((i) => i.sizes);
  assert.ok(sizes.includes('192x192'));
  assert.ok(sizes.includes('512x512'));
  assert.ok(m.icons.some((i) => (i.purpose || '').includes('maskable')));
});

test('manifest icons exist on disk with declared sizes', () => {
  for (const icon of readManifest().icons) {
    const file = path.join(PUBLIC, icon.src.replace(/^\//, ''));
    assert.ok(fs.existsSync(file), `${icon.src} missing`);
    assert.equal(pngSize(file), icon.sizes);
  }
});

test('index.html links the manifest and theme color', () => {
  const html = fs.readFileSync(path.join(PANEL, 'index.html'), 'utf8');
  assert.match(html, /<link rel="manifest" href="\/manifest\.webmanifest">/);
  assert.match(html, /<meta name="theme-color" content="#[0-9a-fA-F]{6}">/);
  const apple = html.match(/<link rel="apple-touch-icon" href="([^"]+)">/);
  assert.ok(apple, 'apple-touch-icon link missing');
  assert.ok(fs.existsSync(path.join(PUBLIC, apple[1].replace(/^\//, ''))));
});

test('no service worker is registered', () => {
  const src = fs.readFileSync(path.join(PANEL, 'src', 'main.tsx'), 'utf8');
  assert.doesNotMatch(src, /serviceWorker/);
  assert.ok(!fs.existsSync(path.join(PUBLIC, 'sw.js')));
});
