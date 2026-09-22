# 498 Tokio reconstruction

Pixel-art animation reconstructed as a shared scene graph, with DOM/SVG and Babylon.js rendering backends. The animation currently covers frames 0–2256 at the source rate of 30 fps; continuous tracks interpolate at the display refresh rate. Both renderers use the same scene JSON, component model and audio clock.

## Run

Use Node.js 24 and run:

```sh
npm ci
npm run preview
```

Open http://127.0.0.1:4980/ for DOM or http://127.0.0.1:4980/?renderer=babylon for Babylon. `npm run preview` builds first and serves only `dist/`. Press **A** to toggle the original aspect ratio.

`?frame=2236` seeks by exact source frame. `?scene=assets/intro_grass/grass.scene.json` selects another scene. URLs also work under a GitHub Pages repository prefix.

## Layout

```text
src/
  runtime/          Shared engine, components, animation and both renderers
  player/           HTML, bootstrap and authored CSS
assets/             Final scene JSON, PNG sprites/atlases and MP3 audio
tests/              Runtime regressions and small test fixtures
scripts/            Build support, preview server, type and JSON checks
docs/               Runtime and animation contracts
.github/workflows/  GitHub Pages build and deployment
dist/               Generated website; ignored
```

`assets/` is the editable source of truth. Webpack compiles the runtime and uses `CopyWebpackPlugin` to copy HTML, styles and final data into `dist/`. JSON and images remain independent resources; both backends load the same copies.

## Build and verify

```sh
npm run build
npx playwright install chromium firefox
npm run check
```

`npm run check:dist` verifies copied files, case-sensitive asset paths, MP3 range requests and both renderers at root and repository-prefixed URLs. Other checks cover animation, clocks, scene components and rendering behavior. Diagnostic captures go into ignored `test-results/`.

For live edits, run `npm run build:watch` and `node scripts/serve.cjs` in separate terminals. Webpack watches scene JSON and assets as well as TypeScript, HTML and CSS; refresh the page after a rebuild.

See [runtime components and rendering](docs/runtime.md) and [animation/time contracts](docs/animation.md).

## License

Original source code and documentation are dual-licensed under [MIT](LICENSE-MIT) or [Apache 2.0](LICENSE-APACHE), at your option. See [LICENSE](LICENSE) for scope.
