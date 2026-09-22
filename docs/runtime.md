# Runtime

The TypeScript engine evaluates one scene graph and sends the resulting state to either the DOM/SVG or Babylon.js renderer. Both backends read the same JSON and use the same animation, hierarchy, camera and deterministic particle evaluation.

The public API is exported by [src/runtime/index.ts](../src/runtime/index.ts). Webpack emits it as dist/runtime/player.js; the player bootstrap loads that module relative to its own URL. Scene asset URLs resolve relative to the scene JSON. This keeps the website independent of its hosting prefix.

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

DOM uses flat retained render surfaces with CSS matrix3d transforms, native pixel dimensions and SVG filters. Entity parenting is evaluated by the shared engine; the DOM does not duplicate the entity/component hierarchy. Surface depth ranks determine composition. Synchronization updates changed attributes and styles while reusing nodes, filters, atlas slots and particle pools. The DOM renderer uses no Canvas, WebGL or WebGPU.

Babylon uses ESM modules, meshes/materials, shaders and thin instances. The same world state and atlas rectangles drive both backends. Pixel artwork uses nearest-neighbor sampling. Procedural texture work runs through a cached worker; live transforms and supported effect parameters remain runtime operations.

The camera expands the visible world beyond the reference aspect: a taller viewport preserves reference width, and a wider viewport preserves reference height. Reference-aspect mode adds letterboxing. Camera fitting, tiled coverage and procedural transition geometry account for dynamic viewport dimensions.

## Time and playback

Integer FrameNumber, rational FrameTime and FrameRate distinguish discrete frame addresses from continuous time. Tracks, binding containers, nested sequences, interpolation packing and weighted Bezier curves are documented in [animation.md](animation.md).

AudioPlayer wraps an Audio element and provides the animation clock. Playback uses performance.now() between media hints, resynchronizing at transport events and actual media advancement. Pause, seek, playback rate and native media controls update the animation. Without an audio clock, AnimationPlayer uses PerformanceClock. Exact frame seeks preserve the frame/rate pair.

SpriteAnimator, Flicker and ParticleEmitter origins use start: {frame, rate}; frame origins are not stored as Float32 seconds. A particle birth ordinal seeds its own Mulberry32 stream, so random access and replay do not depend on rendering cadence. Local particles follow the current parent transform throughout their lifetime.

PlayerControls belongs to the scene and references AnimationPlayer. Its fixed screen overlay retains the full display size when the scene is letterboxed. Buttons reuse their icons; fading, layout and menus use HTML/CSS. Hidden controls stop timeline updates. Clicking the scene reveals controls without toggling playback.

## Entry points

createPlayer creates the complete engine and transport. createRenderer creates a standalone backend. Scene compiles and validates the shared data model; Resources owns cached textures and jobs. Disposal releases renderer surfaces, resources, clocks and controls.

The built index.html accepts renderer=dom or renderer=babylon, a scene URL, an exact frame address, and a controls visibility option. Both paths load final JSON, PNG and MP3 resources from the same Webpack artifact.
