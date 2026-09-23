const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL, fileURLToPath } = require('node:url');
const { chromium, firefox } = require('playwright');
const { makeServer, root } = require('../scripts/serve.cjs');

const dist = path.join(root, 'dist');
function files(directory) {
  return fs.readdirSync(directory, { recursive: true }).filter(file => fs.statSync(path.join(directory, file)).isFile());
}
async function main() {
  for (const entry of ['index.html', 'runtime/player.js', 'runtime/bootstrap.js', 'styles/controls.css']) {
    assert(fs.statSync(path.join(dist, entry)).isFile(), `Missing build output: ${entry}`);
  }
  for (const file of files(dist)) assert(/^(?:index\.html|LICENSE(?:-MIT|-APACHE)?$|runtime[/\\]|styles[/\\]|assets[/\\]|standalone[/\\]index\.html$)/.test(file), `Unexpected deployment file: ${file}`);
  assert(!fs.readFileSync(path.join(dist, 'runtime/bootstrap.js'), 'utf8').includes('data:image/png;base64,'), 'The website must use external images');
  const portable = fs.readFileSync(path.join(dist, 'standalone/index.html'), 'utf8');
  let references = 0;
  for (const file of files(path.join(root, 'assets'))) {
    const source = path.join(root, 'assets', file);
    const copy = path.join(dist, 'assets', file);
    assert(fs.readFileSync(copy).equals(fs.readFileSync(source)), `Static asset changed during copying: ${file}`);
    if (file.endsWith('.png')) assert(portable.includes(`data:image/png;base64,${fs.readFileSync(source).toString('base64')}`), `Missing exact standalone PNG bytes: ${file}`);
    if (!file.endsWith('.json')) continue;
    for (const asset of Object.values(JSON.parse(fs.readFileSync(copy, 'utf8')).assets || {})) {
      const target = fileURLToPath(new URL(asset.file, pathToFileURL(copy)));
      assert(target.startsWith(path.join(dist, 'assets') + path.sep), `Asset escapes assets: ${asset.file}`);
      // Windows is case-insensitive; Pages is not. Verify the exact spelling.
      let directory = dist;
      for (const segment of path.relative(dist, target).split(path.sep)) {
        assert(fs.readdirSync(directory).includes(segment), `Missing or incorrectly cased asset: ${target}`);
        directory = path.join(directory, segment);
      }
      references++;
    }
  }
  for (const basePath of ['/', '/498tokio-recon/']) {
    const server = makeServer({ basePath });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}${basePath}`;
    try {
      assert.equal((await fetch(base)).status, 200);
      for (const local of ['src/runtime/index.ts', 'tests/fixtures/rect_sprite.png', 'package.json', 'player.html']) {
        assert.equal((await fetch(new URL(local, base))).status, 404, `Local file leaked into preview: ${local}`);
      }
      const range = await fetch(new URL('assets/soundtrack.mp3', base), { headers: { Range: 'bytes=128-255' } });
      assert.equal(range.status, 206); assert.equal((await range.arrayBuffer()).byteLength, 128);
      for (const [name, type, renderer] of [['chromium-dom', chromium, 'dom'], ['chromium-babylon', chromium, 'babylon'], ['firefox-dom', firefox, 'dom']]) {
        const browser = await type.launch({ headless: true });
        try {
          const page = await browser.newPage({ viewport: { width: 640, height: 360 } }), errors = [], images = new Set();
          page.on('pageerror', error => errors.push(error.message));
          page.on('response', response => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
          page.on('request', request => {
            if (request.url().startsWith('http:') && !request.url().startsWith(base)) errors.push(`Request escaped site prefix: ${request.url()}`);
            if (/^https?:.*\.png(?:\?|$)/.test(request.url())) images.add(request.url());
          });
          if (renderer === 'dom') await page.addInitScript(() => { HTMLCanvasElement.prototype.getContext = () => { throw new Error('Canvas forbidden in DOM'); }; });
          await page.goto(`${base}?renderer=${renderer}&frame=2236&controls=0`);
          await page.waitForFunction(() => window.scenePlayer?.ready);
          await page.evaluate(() => scenePlayer.whenIdle());
          assert(await page.evaluate(async () => scenePlayer instanceof (await import(new URL('runtime/player.js', document.baseURI).href)).Engine), 'Bootstrap and public API share the same runtime instance');
          assert(images.size > 40, 'The website fetches all external scene images up front');
          assert(await page.evaluate(() => scenePlayer.scene.isActive('helmet-launch-hull')), 'Initial frame query reaches the exact appearance boundary');
          for (const n of [15, 900, 2200, 2225]) {
            await page.evaluate(async n => {
              const { Frame, frameRate } = await import(new URL('runtime/player.js', document.baseURI).href);
              await scenePlayer.seekFrame(Frame.from(n), frameRate(30)); await scenePlayer.whenIdle();
            }, n);
          }
          assert.deepEqual(errors, [], `${basePath} ${name}`);
          console.log(`${basePath} ${name}: external PNGs, chunks, worker, frame seek and effects passed.`);
        } finally { await browser.close(); }
      }
    } finally { await new Promise(resolve => server.close(resolve)); }
  }
  console.log(`dist: ${references} valid scene asset references; exact external files and standalone inline PNG bytes; source files excluded.`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
