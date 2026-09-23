# Runtime

The TypeScript engine evaluates one scene graph and sends the resulting state to either the DOM/SVG or Babylon.js renderer. Both backends read the same JSON and use the same animation, hierarchy, camera and deterministic particle evaluation.

The public API is exported by [src/runtime/index.ts](../src/runtime/index.ts). Webpack emits it as dist/runtime/player.js; the bootstrap imports it through the source module graph and shares its module instances. Scene asset URLs resolve relative to the scene JSON. This keeps the website independent of its hosting prefix.

## Scene and components

A scene contains assets, a root entity hierarchy, presentation settings and optional animation data. Each entity has an ID, an active flag, a local Transform, components and children. Local transforms compose into world transforms before rendering. Components describe behavior; renderer objects are retained projections of scene state.

The contracts are defined in [types.ts](../src/runtime/types.ts) and defaults/validation in [components.ts](../src/runtime/components.ts).

| Component family | Behavior |
| --- | --- |
| Camera | Orthographic or perspective projection, reference aspect fitting and camera selection |
| SpriteRenderer / TiledSpriteRenderer | Native pixel artwork, padded atlas selection, live tint/saturation/hue and repeated coverage |
| PlaneRenderer / LineRenderer | Analytic planes, ellipses and lines with camera or fixed coverage |
| SpriteNumberRenderer | Individual atlas glyphs, continuous numeric values and repeated number layout |
| SpriteAnimator / Flicker | Independent sprite cadence or periodic/seeded visibility |
| Glow / DropShadow / GaussianBlur | Component effects attached to a rendered entity |
| SpriteMotionBlur / ParticleMotionBlur | Translation/radial sampling, dilation and directional blur |
| ProceduralNoise / OpacityGradient | Seeded secondary texture and live alpha fields |
| ParticleEmitter | Deterministic local or world particle simulation, shape, velocity, lifetime, color and atlas animation |
| Transition | Procedural masks and scene reveals selected by transition kind |
| Vignette / ViewportFrame | Camera viewport effects that adapt to aspect ratio |
| AudioPlayer / AnimationPlayer / PlayerControls | Playback transport, sequence clock binding and screen controls |

## Rendering

DOM uses flat retained render surfaces with CSS matrix3d transforms, native pixel dimensions and SVG filters. Entity parenting is evaluated by the shared engine; the DOM does not duplicate the entity/component hierarchy. Surface depth ranks determine composition. Synchronization updates changed attributes and styles while reusing nodes, filters, atlas slots and particle pools. Scene rendering uses no Canvas, WebGL or WebGPU. Image preparation uses browser decoding and temporary OffscreenCanvas contexts to read pixels, separate atlas cells and encode generated textures. Prepared results are cached; transforms and effects remain live.

Babylon uses ESM modules, meshes/materials, shaders and thin instances. The same world state and atlas rectangles drive both backends. Pixel artwork uses nearest-neighbor sampling. Procedural texture work uses one persistent worker per loaded scene, with numbered requests and cached results; live transforms and supported effect parameters remain runtime operations. Disposing a scene terminates its worker and rejects outstanding jobs.

The camera expands the visible world beyond the reference aspect: a taller viewport preserves reference width, and a wider viewport preserves reference height. Reference-aspect mode adds letterboxing. Camera fitting, tiled coverage and procedural transition geometry account for dynamic viewport dimensions.

## Time and playback

Integer FrameNumber, rational FrameTime and FrameRate distinguish discrete frame addresses from continuous time. Tracks, binding containers, nested sequences, interpolation packing and weighted Bezier curves are documented in [animation.md](animation.md).

AudioPlayer wraps an Audio element and provides the animation clock. Playback uses performance.now() between media hints, resynchronizing at transport events and actual media advancement. Pause, seek, playback rate and native media controls update the animation. Without an audio clock, AnimationPlayer uses PerformanceClock. Exact frame seeks preserve the frame/rate pair.

SpriteAnimator, Flicker and ParticleEmitter origins use start: {frame, rate}; frame origins are not stored as Float32 seconds. A particle birth ordinal seeds its own Mulberry32 stream, so random access and replay do not depend on rendering cadence. Local particles follow the current parent transform throughout their lifetime.

PlayerControls belongs to the scene and references AnimationPlayer. Its fixed screen overlay retains the full display size when the scene is letterboxed. Buttons reuse their icons; fading, layout and menus use HTML/CSS. Hidden controls stop timeline updates. Clicking the scene reveals controls without toggling playback.

## Entry points

createPlayer creates the complete engine and transport. Its optional onError callback is registered before image preparation begins. createRenderer creates a standalone backend. Scene compiles and validates the shared data model; Resources owns cached textures and jobs. Disposal releases renderer surfaces, resources, clocks and controls.

The built index.html accepts renderer=dom or renderer=babylon, a scene URL, an exact frame address, and a controls visibility option. The website loads JSON, PNG and MP3 files by URL; it has no bundled image map. Images resolve relative to the loaded JSON, so an external scene can provide its own assets.

The standalone entry imports the final scene and Babylon backend, embeds PNGs and MP3 using `asset/inline`, and supplies `resolveAsset(url)` to map original scene paths to embedded data. The worker uses the loader's inline mode. Its single HTML needs no server or companion files. Exported scene JSON retains its original paths; scene evaluation, resource preparation and rendering stay shared. See [build pipeline](build.md).

## Resource preparation and progress

Scene URLs load through `XMLHttpRequest` with native JSON decoding. Its `progress` events report the filename and received bytes before scene construction, including a percentage when the response length is known. Download status updates are limited to 10 per second; replacing or disposing the player aborts a pending request.

After the JSON and renderer are initialized, controls and prepared geometry appear immediately. Audio metadata, images, generated textures and shader preparation continue independently. Until audio metadata arrives, controls use the authored timeline duration; the audio clock still governs playback and buffering. Babylon draws available objects while other texture jobs are pending, coalescing these partial updates into animation frames.

`Resources.preload` starts all declared sprite images at scene load, including assets referenced only by future spawnables. DOM additionally prepares and decodes each atlas cell once. Renderers skip unfinished images and refresh when preparation completes; playback does not await the whole set. `engine.whenIdle()` is an explicit completion barrier for editors and verification, not part of the playback loop.

Procedural noise declarations are collected from authored entities and nested spawnable templates. Generated pixels and decoded DOM noise URLs belong to the scene resource cache and survive despawns. A sprite never applies a noise filter before its image is available. DOM depth ordering also commits independently of unfinished texture work.

Babylon adds a `Shaders` stage after image and procedural texture preparation. An isolated Babylon scene on the same engine reuses the live component constructors and material factories, including particle thin-instance buffers. Representative materials use `forceCompilationAsync`; postprocess and morphology passes use the same shared effect factories as playback. Animated dilation bounds include weighted-Bezier control points and additive bindings, so intermediate shader loop sizes are prepared without sampling every frame. Prepared programs stay referenced until scene disposal. New scenes restart preparation; runtime edits outside the loaded declarations can still introduce new variants.

`engine.loadingProgress.begin(stage, item)` returns an idempotent completion function with an `update(item)` method for changing task details. Stages accumulate completed/total counts and pending item names; `subscribe` reports changes, `complete` marks the end of the preparation pipeline, and `reset` invalidates callbacks from the old scene. `LoadingStatus` shows the source and renderer during download, then adds the scene name, declared asset counts and reference frame rate. It retains the complete loading log for the current scene in a stable-width HTML/CSS overlay. Native scrolling remains available on short screens while the scrollbar is hidden. When preparation finishes before first playback, a successful completion line remains until playback starts. If playback has already started, the overlay disappears as soon as preparation finishes. This belongs to the runtime, outside camera and component lifetimes. Additional preparation stages use the same interface without per-frame UI updates.
