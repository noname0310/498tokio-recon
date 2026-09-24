# 498 Tokio reconstruction

The **498 Tokio** music video, reconstructed object by object as animated 3D scenes and rendered in real time with **Babylon.js** or **DOM/SVG**.

Sprites, transforms, keyframe animation and procedural effects are rebuilt from the original video and described in a shared scene format. Both renderers support arbitrary resolutions and dynamic aspect ratios, with continuous animation interpolated at the display refresh rate.

Original music by **ヒゲドライバー (Hige Driver)**; original video by **サーモンラット（クロユキ）**.

[Watch the original music video on YouTube](https://youtu.be/-lHRRVnoE0Y)

[Play on GitHub Pages](https://noname0310.github.io/498tokio-recon/)

![Frame 2396 rendered with Babylon.js](docs/frame-2396.png)

## Run

Use Node.js 24 and run:

```sh
npm ci
npm run preview
```

Open http://127.0.0.1:4980/ for Babylon.js (the default) or http://127.0.0.1:4980/?renderer=dom for DOM/SVG. `npm run preview` builds first and serves only `dist/`. Press **A** to toggle the original aspect ratio.

`?frame=2236` seeks by exact source frame. `?scene=assets/intro_grass/grass.scene.json` selects another scene. URLs also work under a GitHub Pages repository prefix.

## Layout

```text
src/
  runtime/          Shared engine, components, animation and both renderers
  player/           HTML, bootstrap and authored CSS
assets/             Final scene JSON, PNG sprites/atlases and AAC audio (M4A)
tests/              Runtime regressions and small test fixtures
scripts/            Build support, preview server, type and JSON checks
docs/               Runtime and animation contracts
.github/workflows/  GitHub Pages build and deployment
dist/               Generated website; ignored
```

`assets/` is the editable source of truth. The website build compiles the runtime, generates HTML with its entry script through `HtmlWebpackPlugin`, and copies scene JSON, PNGs, audio and styles into `dist/`. Both backends load external images relative to the scene JSON. Only the standalone variant embeds asset data.

Image preparation starts for every image declared in the scene, including assets used later by spawned objects. Playback can start while preparation continues. A centered text status shows the loading stage, completed count and current filename, then disappears. Prepared images and atlas frames stay cached; procedural texture jobs share one persistent worker per loaded scene.

## Build and verify

```sh
npm run build
npx playwright install chromium firefox
npm run check
```

The build also emits **`dist/standalone/index.html`**: a Babylon.js player with the runtime, scene, PNGs, M4A audio, styles and worker code embedded. Copy this one file anywhere and open it directly, including offline. `npm run build:standalone` builds only this variant. It uses the same runtime and scene data as the website.

`npm run check:dist` verifies external files, standalone image bytes, case-sensitive asset paths, M4A range requests and both renderers at root and repository-prefixed URLs. `npm run check:loading` checks progressive image preparation and worker reuse; `npm run check:standalone` checks the portable HTML with external requests blocked. `npm run check:lifetimes` verifies sequence ownership and resource reuse. Other checks cover animation, clocks, scene components and rendering behavior.

For live edits, run `npm run build:watch` and `node scripts/serve.cjs` in separate terminals. Watch mode builds the website; Webpack watches scene JSON and assets as well as TypeScript, HTML and CSS. Refresh the page after a rebuild. `npm run build -- --env site` builds only the website once.

See [build pipeline](docs/build.md), [runtime components and rendering](docs/runtime.md) and [animation/time contracts](docs/animation.md).

## License

Original source code and documentation are dual-licensed under [MIT](LICENSE-MIT) or [Apache 2.0](LICENSE-APACHE), at your option. See [LICENSE](LICENSE) for scope.
