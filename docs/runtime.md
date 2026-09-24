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
| PlaneRenderer / LineRenderer | Analytic planes, filled or hollow ellipses, and lines with camera or fixed coverage |
| SpriteNumberRenderer | Individual atlas glyphs, continuous numeric values and repeated number layout |
| SpriteAnimator / Flicker | Independent sprite cadence or periodic/seeded visibility |
| Glow / DropShadow / GaussianBlur | Component effects attached to a rendered entity |
| SpriteMotionBlur / ParticleMotionBlur | Translation/radial sampling, dilation and directional blur |
| DepthOfField | Camera focus and aperture-driven blur on projected sprite planes |
| ProceduralNoise / OpacityGradient | Seeded secondary texture and live alpha fields |
| ParticleEmitter | Deterministic local or world particle simulation, shape, velocity, lifetime, color and atlas animation |
| Transition | Procedural masks and scene reveals selected by transition kind |
| Vignette / ViewportFrame | Camera viewport effects that adapt to aspect ratio |
| ViewportTransform | Scale, normalized center and opacity of the clipped camera image |
| ColorGrade | Camera color transform with an animatable blend strength |
| AudioPlayer / AnimationPlayer / PlayerControls | Playback transport, sequence clock binding and screen controls |

## Rendering

DOM uses flat retained render surfaces with CSS matrix3d transforms, native pixel dimensions and SVG filters. Entity parenting is evaluated by the shared engine; the DOM does not duplicate the entity/component hierarchy. Surface depth ranks determine composition. Synchronization updates changed attributes and styles while reusing nodes, filters, atlas slots and particle pools. Scene rendering uses no Canvas, WebGL or WebGPU. Image preparation uses browser decoding and temporary OffscreenCanvas contexts to read pixels, separate atlas cells and encode generated textures. Prepared results are cached; transforms and effects remain live.

Babylon uses ESM modules, meshes/materials, shaders and thin instances. The same world state and atlas rectangles drive both backends. Pixel artwork uses nearest-neighbor sampling. Procedural texture work uses one persistent worker per loaded scene, with numbered requests and cached results; live transforms and supported effect parameters remain runtime operations. Disposing a scene terminates its worker and rejects outstanding jobs.

Babylon uploads particle instance buffers only for visible draws; size-sorted runs retain their storage and skip the unused emitter meshes. Hidden transparent meshes do not participate in depth sorting. Sprite glow and shadow masks retain their GPU textures across atlas frame changes in a per-sprite LRU cache, limited to 32 masks or 8 MiB of RGBA data. Currently bound masks remain valid even when they exceed that budget; inactive masks are evicted first. Tint and intensity remain shader parameters, and disposing the sprite releases all retained masks.

The camera expands the visible world beyond the reference aspect: a taller viewport preserves reference width, and a wider viewport preserves reference height. Reference-aspect mode adds letterboxing. Camera fitting, tiled coverage and procedural transition geometry account for dynamic viewport dimensions.

`PlaneRenderer.shape: "ellipse"` supports `innerRadiusRatio` from 0 to 1. Zero (the default) fills the ellipse; a positive ratio makes a concentric hole, and 1 leaves no visible area. DOM uses a retained SVG even-odd clip over the live plane and its transition geometry. Babylon evaluates inner and outer contours analytically with screen-derivative antialiasing. Size, hole ratio and color remain animatable; no ring image is generated.

`PlaneRenderer.blend` defaults to `"normal"`; `"additive"` adds the plane's color, weighted by alpha, to surfaces behind it. Camera coverage can represent an animated light flash across any viewport aspect.

`LineRenderer.coverage: "camera"` extends a world-space line through the finite camera frustum. Its optional `viewportExpansion` (0–1, default 0) adds the extra perpendicular span exposed beyond the camera's reference aspect. Animating it to 1 lets a widening beam cover taller viewports while preserving the authored reference-view width. The line retains its world transform, perspective and camera shake.

## Time and playback

Integer FrameNumber, rational FrameTime and FrameRate distinguish discrete frame addresses from continuous time. Tracks, binding containers, nested sequences, interpolation packing and weighted Bezier curves are documented in [animation.md](animation.md).

AudioPlayer wraps an Audio element and provides the animation clock. Playback uses performance.now() between media hints, resynchronizing at transport events and actual media advancement. Pause, seek, playback rate and native media controls update the animation. Without an audio clock, AnimationPlayer uses PerformanceClock. Exact frame seeks preserve the frame/rate pair.

SpriteAnimator, Flicker and ParticleEmitter origins use start: {frame, rate}; frame origins are not stored as Float32 seconds. A particle birth ordinal seeds its own Mulberry32 stream, so random access and replay do not depend on rendering cadence. Local particles follow the current parent transform throughout their lifetime.

`TransformNoise` adds seeded local position and rotation offsets after authored tracks. It uses continuous quintic value noise at an explicit frequency, with a frame-based start, duration and animatable strength. Random access has no accumulated simulation state. A camera can inherit an orbit pivot while receiving its own local shake.

`CameraMotionBlur` samples five camera poses across its shutter interval. Projected variance at `focusDistance` drives the shared screen Gaussian in both renderers; `maxSigmaWorld` caps its footprint, and an existing `GaussianBlur` adds in variance. This is a separable approximation at one focal plane, not per-pixel depth blur. The camera hierarchy evaluates each sampled sequence once. Babylon prepares the shared blur shader with the scene's other materials.

`DepthOfField` on a perspective camera uses `focusDistance` and `apertureSigma` in camera world units. `maxSigmaWorld` caps its radius on the reference projection plane in both backends. Defocus varies across a tilted sprite: the signed screen blur is proportional to inverse depth minus inverse focus distance. Babylon samples a fixed Gaussian aperture in the sprite shader. DOM blends a small set of retained Gaussian layers after projection, using the plane's affine inverse-depth field as CSS gradient weights. Filtering is bounded to visible regions and needs no generated frames. The DOM Gaussian levels approximate the continuous aperture kernel. It currently filters SpriteRenderer bodies; camera motion blur still filters the composed scene.

`SpriteRenderer.depthWrite` enables alpha-tested plane occlusion in perspective scenes once the sprite is fully opaque. Babylon draws a colorless depth mesh with an alpha cutoff of 0.5. DOM caches opaque cell runs and clips other surfaces against the same camera rays and plane intersection. Material in front of the plane remains visible, and transparent holes expose material behind it. The atlas itself remains intact; moving or rotating either plane changes the intersection. Defocus softens color separately from this central-ray depth boundary.

`SortingGroup` also applies to particle emitters. It preserves each particle's physical transform and internal depth order while using the group's anchor for composition against other objects. DOM surfaces and Babylon instance batches share this anchor, so tilted billboards can consistently appear over an opaque sprite.

Particle bursts accept `time: {frame, rate}` for exact relative frame offsets (numeric seconds remain supported), plus optional `sizeScale` and `color`. This describes a group followed by smaller satellites without separate clocks or simulations. `cameraContinuation: {padding}` extends a planar local stream through the current camera bounds. Positions, birth IDs and animation phases inside the authored lifetime stay unchanged; the paths continue with endpoint velocity outside it, while size and color curves clamp. This mode requires zero spread, positive speed, planar non-reversing acceleration and no speed-over-life curve. Padding includes the sprite, glow and motion-blur footprint. A reference-sized camera is used when querying particle states without a viewport.

Babylon particle glow uses an isolated, padded GPU atlas with separable Gaussian passes. Instances reuse it until the source or mask/blur parameters change; color, intensity, position and atlas-frame changes do not regenerate it. The same shader factories participate in shader preparation.

DOM particles retain a DOM slot for each living particle. Source colors and alpha remain exact. Single-color sprites use CSS masks for tint and a fixed native layout; multicolor sprites use SVG color matrices at display resolution. Without particle motion blur, the texture worker prepares shared Gaussian glow masks at eight samples per source pixel in the `Textures` stage. Position, scale, RGB tint, opacity and atlas animation reuse them; source, radius, threshold, softness or gain edits invalidate the relevant cache entry. Motion-blurred particles retain live SVG filters. Camera projection is shared by body and glow, and the camera inverse is reused throughout each scene evaluation.

Tiled DOM artwork merges adjacent cells of identical RGBA into exact rectangles. Scrolling moves retained SVG geometry; a stable repeat count covers every phase without rebuilding paths at tile boundaries.

PlayerControls belongs to the scene and references AnimationPlayer. Its fixed screen overlay retains the full display size when the scene is letterboxed. Buttons reuse their icons; fading, layout and menus use HTML/CSS. Hidden controls stop timeline updates. Clicking the scene reveals controls without toggling playback.

`Transition.kind: "radialGrid"` uses `max(abs((p - cellCenter) / halfCellSize)) <= progress - inset + curvature * squaredDistance(p, center)`. The distance is evaluated at each boundary point, producing curved, asymmetric tile outlines. `cellSize`, `origin` and `center` use local world units; `curvature` uses inverse squared units. `inset` (0–0.25, default zero) lets center cells disappear before outer cells. Zero progress hides the plane and full progress covers it. Curvature must be nonnegative and satisfy `curvature * (cellSize.x² + cellSize.y²) < 1`, keeping each cell boundary connected. DOM solves the quadratic contour into one retained union path with shared edges; Babylon evaluates the same field in the fragment shader. Both extend across the current frustum. Run `npm run check:paper-return` for field classification, half-opacity joins, sparse source fits, reverse seeks and expanded viewports.

## Entry points

createPlayer creates the complete engine and transport. Its optional onError callback is registered before image preparation begins. createRenderer creates a standalone backend. Scene compiles and validates the shared data model; Resources owns cached textures and jobs. Disposal releases renderer surfaces, resources, clocks and controls.

The built index.html accepts renderer=dom or renderer=babylon, a scene URL, an exact frame address, and a controls visibility option. Babylon.js is the default for both the page and the createPlayer/createRenderer APIs. The website loads JSON, PNG and M4A files by URL; it has no bundled image map. Images resolve relative to the loaded JSON, so an external scene can provide its own assets.

The standalone entry imports the final scene and Babylon backend, embeds PNGs and M4A using `asset/inline`, and supplies `resolveAsset(url)` to map original scene paths to embedded data. The worker uses the loader's inline mode. Its single HTML needs no server or companion files. Exported scene JSON retains its original paths; scene evaluation, resource preparation and rendering stay shared. See [build pipeline](build.md).

## Resource preparation and progress

Scene URLs load through `XMLHttpRequest` with native JSON decoding. Its `progress` events report the filename and received bytes before scene construction, including a percentage when the response length is known. Download status updates are limited to 10 per second; replacing or disposing the player aborts a pending request.

After the JSON is loaded, active AudioPlayers initialize before image preparation starts. Player readiness, controls and the first scene update wait for audio metadata and renderer initialization. The selected clock supplies the duration; an audio clock uses the media duration. Images, generated textures and shader preparation continue independently, and their completion does not gate playback. Babylon draws available objects while other texture jobs are pending, coalescing these partial updates into animation frames.

`Resources.preload` starts all declared sprite images at scene load, including assets referenced only by future spawnables. DOM additionally prepares and decodes each atlas cell once. Renderers skip unfinished images and refresh when preparation completes; playback does not await the whole set. `engine.whenIdle()` is an explicit completion barrier for editors and verification, not part of the playback loop.

Procedural noise declarations are collected from authored entities and nested spawnable templates. Generated pixels and decoded DOM noise URLs belong to the scene resource cache and survive despawns. A sprite never applies a noise filter before its image is available. DOM depth ordering also commits independently of unfinished texture work.

Babylon adds a `Shaders` stage after image and procedural texture preparation. An isolated Babylon scene on the same engine reuses the live component constructors and material factories, including particle thin-instance buffers. Representative materials use `forceCompilationAsync`; postprocess and morphology passes use the same shared effect factories as playback. Animated dilation bounds include weighted-Bezier control points and additive bindings, so intermediate shader loop sizes are prepared without sampling every frame. Prepared programs stay referenced until scene disposal. New scenes restart preparation; runtime edits outside the loaded declarations can still introduce new variants.

`engine.loadingProgress.begin(stage, item)` returns an idempotent completion function with an `update(item)` method for changing task details. Stages accumulate completed/total counts and pending item names; `subscribe` reports changes, `complete` marks the end of the preparation pipeline, and `reset` invalidates callbacks from the old scene. `LoadingStatus` shows the source and renderer during download, then adds the scene name, declared asset counts and reference frame rate. It retains the complete loading log for the current scene in a stable-width HTML/CSS overlay. Native scrolling remains available on short screens while the scrollbar is hidden. When preparation finishes before first playback, a successful completion line remains until playback starts. If playback has already started, the overlay disappears as soon as preparation finishes. This belongs to the runtime, outside camera and component lifetimes. Additional preparation stages use the same interface without per-frame UI updates.

`ViewportTransform` belongs to a camera. Its uniform `scale`, `centerViewport`
(+Y up, default 0.5/0.5), and `opacity` affect the completed camera image. Scaling
retains the currently fitted viewport aspect, clips scene content before the
transform, and leaves the player controls unchanged. The shared presentation
layer uses a retained CSS transform for both backends; it does not change the
camera projection or bake the scene into an image.

`ColorGrade` applies a row-major 3×4 affine matrix to sRGB: each row contains
three RGB coefficients followed by a constant offset. Output RGB is clamped
then passed through per-channel piecewise linear curves with fixed black/white
endpoints and an editable `midpoint` (default 0.5). The graded result is mixed
with the original color using `strength`; alpha is preserved. DOM uses a retained SVG color matrix and arithmetic composite on
the viewport, while Babylon uses a prepared post-process shader. A zero
strength bypasses the filter/pass. Both components restore their authored
values when a sequence stops owning their animation bindings.
