# Build pipeline

[webpack.config.cjs](../webpack.config.cjs) defines two Webpack compilers: the website and portable HTML. There is no custom bundler or HTML assembly plugin.

| Output | Entry and processing |
| --- | --- |
| Website runtime | `src/runtime/index.ts` → TypeScript via `ts-loader` → public ESM library, lazy DOM/Babylon backends and normal worker chunks |
| Website bootstrap | `src/player/bootstrap.ts` imports the runtime from source; its `dependOn: "player"` entry shares the public runtime's modules |
| Website HTML | `html-loader` reads the plain HTML template; `HtmlWebpackPlugin` injects module entries and Webpack generates dependency paths |
| Website data | `CopyWebpackPlugin` copies CSS, licenses, scene JSON, PNGs and MP3 without changing their contents |
| Portable HTML | `src/player/standalone.ts` directly imports Babylon and final scene JSON; PNGs and MP3 use Webpack `asset/inline` |
| Portable HTML document | `html-webpack-plugin` renders `src/player/standalone.html`; CSS and notices use `asset/source`; `html-inline-script-webpack-plugin` embeds the entry script |
| Portable worker | `worker-rspack-loader`, which supports Webpack 5, compiles the worker with `inline: "no-fallback"`; no intermediate worker file or extra build phase |

`LimitChunkCountPlugin` keeps the standalone script in one chunk. `TerserPlugin` minifies it while keeping license comments inline instead of emitting companion license files. The HTML template also embeds project licenses and dependency notices.

Both entries use `src/runtime/player-host.ts` for initialization, error reporting, initial seeks and disposal. The portable entry supplies Babylon directly, so it does not include the DOM backend.

Babylon imports use `@babylonjs/core/pure` with explicit extension registration. Animation drives `TargetCamera` directly; free-camera input handlers, camera collision coordination, GPU readback and Babylon's file-loader registration are omitted. Meshes, shader materials, thin instances, render targets and postprocessing remain part of the renderer.

## Commands

| Command | Result |
| --- | --- |
| `npm run build` | Website and `dist/standalone/index.html` |
| `npm run build -- --env site` | Website only |
| `npm run build:standalone` | Portable HTML only |
| `npm run build:watch` | Website watch build |

The npm `prebuild` hooks run the project's type checks before Webpack. `ts-loader` also reports TypeScript diagnostics during compilation. Website and standalone outputs are separate; the website build preserves the standalone directory.

## Project-specific code

- `src/player/bundled-assets.ts` connects the standalone scene's original URLs to inline data through a small resolver. The normal website does not import it. Webpack's static context collects PNGs; there is no custom asset loader or JSON dependency parser.
- `src/player/create-inline-texture-worker.ts` adapts the inline worker constructor to the same disposal interface as the website worker. A standard resolve alias selects it for standalone builds.
- `scripts/check-types.cjs` checks project rules, including the explicit `any` ban and branded-frame type fixtures. It is validation, not a code transform.
- `scripts/format-json.cjs` wraps FracturedJson and verifies that formatting preserves JSON values.
- `scripts/serve.cjs` is the local preview/test HTTP server, including MP3 byte ranges and test prefix support. It does not participate in the build.

`check:dist` validates external files and hosting prefixes. `check:standalone` moves the single document to another directory, opens it through `file://` with network requests blocked, and compares Babylon frames with the website in Chromium and Firefox. `check:loading` delays image responses to verify early playback, status text, cached image preparation and persistent worker reuse. `check:startup` covers early and late asset failures and initialization cleanup; `check:images` compares browser-decoded colors and alpha with source PNGs.
