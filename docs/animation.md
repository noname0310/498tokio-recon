The animation system evaluates the same scene state before either renderer runs. Tracks store values and curves; **AnimationBinding** connects a track to one scalar property. A master sequence contains object slots, property bindings and nested sequence sections. Scene JSON remains the authored source of truth: sampling creates temporary overrides and active spawn instances, and never writes animated values into the exported JSON.

The animation model follows these Unreal Engine Sequencer concepts:

| Source | Adopted behavior |
| --- | --- |
| `Core/Public/Misc/FrameNumber.h`, `FrameTime.h`, `FrameRate.h` | Separate integer frame indices, fractional frame time and rational frame rate |
| `MovieScene/Public/Channels/MovieSceneFloatChannel.h` | Separate key-time/value storage and arrive/leave tangent data |
| `MovieScene/Private/Channels/MovieSceneInterpolation.cpp` | Weighted Bezier in time/value coordinates; invert X before evaluating Y; choose the largest admissible root |
| `MovieScene/Private/Sections/MovieSceneSubSection.cpp` | Outer-to-inner offset, time scale, time-resolution conversion and loop offsets |
| `MovieScene/Public/MovieSceneBinding.h`, `MovieSceneSpawnable.h` | Object binding slots and sequence-owned spawned entities |

Epic's public references describe [float channels](https://dev.epicgames.com/documentation/en-us/unreal-engine/API/Runtime/MovieScene/FMovieSceneFloatChannel), [tangent data](https://dev.epicgames.com/documentation/en-us/unreal-engine/API/Runtime/MovieScene/FMovieSceneTangentData), and [subsequence sections](https://dev.epicgames.com/documentation/en-us/unreal-engine/API/Runtime/MovieScene/UMovieSceneSubSection). This runtime implements the required subset independently; it does not import engine source or claim full Sequencer compatibility.

`FrameNumber` is a branded, checked signed Int32. Use `Frame.from`, `add`, `subtract`, `multiply`, `divide`, `compare`, `next`, and `previous`. Fractional or overflowing frame indices throw instead of wrapping. TypeScript branding prevents assigning ordinary numeric results back into frame indices; callers must still use the operators rather than force-casting values.

`FrameTime` contains `{frame: FrameNumber, subframe: {numerator: bigint, denominator: bigint}}`. Arithmetic normalizes the fraction to `[0,1)`, including negative times. Integer/rational calculations handle seeks, rate conversion, offsets and looping. The conversion to floating point happens after subtracting key times, for curve evaluation. This avoids losing small offsets near large key indices. Curve values, tangents, weights and rendering still have floating-point precision; a branded type does not remove that limitation.

Each sequence declares `tickResolution` and `displayRate` as `{numerator, denominator}`. All key times and ranges in that sequence are integer **ticks**, while display frames are used for the player controls. For example, with a 24000 Hz tick resolution and a 30 fps display rate, one display frame is 800 ticks. Rates such as 30000/1001 retain fractional ticks exactly. Conversions that exceed the signed Int32 time domain throw. A key array reused in sequences with different tick resolutions is deliberately interpreted in each owning sequence's units.

The three track classes contain no object IDs or property paths:

| Class | `frameNumber` | `value` | `interpolation` | `interpolationParameters` |
| --- | --- | --- | --- | --- |
| `AnimationTrackFloat32` | `Int32Array` | `Float32Array` | `Int32Array` | `Float32Array` |
| `AnimationTrackInt32` | `Int32Array` | `Int32Array` | `Int32Array` | `Float32Array` |
| `AnimationTrackBoolean` | `Int32Array` | `Uint8Array`, 0/1 | `Int32Array` | `Float32Array` |

Boolean has no native JavaScript typed array, so it uses one byte per value. Integer interpolation rounds to the nearest integer and clamps to Int32; use Step for atlas indices. Keys must be strictly increasing. Evaluation uses a cached interval with binary-search fallback, so reverse and random seeks work. Values clamp to the first/last key outside the key span; an empty track supplies its optional `defaultValue` or no contribution. Treat compiled arrays as read-only during playback; edit JSON and reload to recompile. `toJSON()` serializes the arrays back to ordinary JSON arrays.

Each key has a fixed two-Int32 header `[modeBits, parameterIndex]`. Bits 0–1 encode the in mode; bits 2–3 encode the out mode. Bits 4–31 and side tag 3 are reserved and rejected. Use `packInterpolationModes(inMode, outMode)` for the branded numeric bitfield; the brand has no runtime allocation.

`interpolationParameters` is a separate compact Float32 buffer. Each FCurve side contributes `[tangent, weight]`, ordered **in, then out**. Step and Linear contribute **zero parameters**, including when interleaved with curves. If neither side is FCurve, the header index is `-1`; otherwise it is a Float32 element index, not a byte offset. Evaluation reads parameters through that index. Header size remains eight bytes per key; curve payload adds zero, eight or sixteen bytes. Float/Int tracks therefore use 16, 24 or 32 bytes per key including time/value, excluding typed-array object overhead. Runtime stores no key or interpolation variant objects.

```text
// Step/Step, Linear/FCurve, Linear/Linear, FCurve/FCurve
interpolation:           [0, -1, 9, 0, 5, -1, 10, 2]
interpolationParameters: [0.1, -1, 0.2, 0.4, 0.3, -1]
```

Modes are `0 = Step`, `1 = Linear`, `2 = FCurve`. Tangents are **value per tick**. Weights are handle lengths in the two-dimensional **(seconds, value)** space, following UE's weighted interpolation. `-1` selects the unweighted one-third handle. At evaluation, tangents convert to value/second using the owning sequence's tick resolution. FCurve slopes/weights are explicit; the optional authoring helper defaults them to zero slope and an unweighted handle. Omitted interpolation headers mean Step/Step for Boolean or Linear/Linear for numeric tracks, with an empty parameter buffer.

On the interval between keys A and B, A's out mode and B's in mode are independent. If either is Step, A holds until B's exact key. Two Linear sides interpolate linearly. Otherwise a cubic Bezier is used: a Linear side uses the interval's chord tangent, and an FCurve side uses its stored tangent/weight. Boolean only accepts Step. Independent in/out **modes** are the requested extension; Unreal's channel generally chooses interval mode from the outgoing key. The weighted tangent geometry and time inversion follow its implementation.

Use `trackData(type, keys)` to author readable key objects in TypeScript; it packs the JSON arrays:

```ts
import { Frame, Interpolation, trackData } from "../src/runtime/index.js";

const movement = trackData("AnimationTrackFloat32", [
  { frame: Frame.from(0), value: 0, outMode: Interpolation.FCurve,
    outTangent: 2 / 30, outWeight: Math.hypot(0.2, 0.4) },
  { frame: Frame.from(30), value: 1, inMode: Interpolation.FCurve,
    inTangent: 2 / 30, inWeight: Math.hypot(0.4, 0.8) }
]);
```

The outer JSON structure is:

```json
{
  "animation": {
    "master": "main",
    "tracks": {
      "move-x": {
        "type": "AnimationTrackFloat32",
        "frameNumber": [0, 24000],
        "value": [0, 2]
      }
    },
    "sequences": {
      "main": {
        "tickResolution": {"numerator": 24000, "denominator": 1},
        "displayRate": {"numerator": 30, "denominator": 1},
        "playbackRange": {"start": 0, "end": 48000},
        "objects": [{"id": "actor-slot", "kind": "possessable", "target": {"entity": "actor"}}],
        "bindings": [{
          "id": "position-x", "track": "move-x", "object": "actor-slot",
          "property": {"component": "Transform", "path": "localPosition.x"}
        }]
      }
    }
  }
}
```

Property paths address existing numeric or Boolean fields. `Entity.active` controls a subtree; `Transform.localPosition.x` changes one coordinate; `SpriteRenderer.frame` selects an atlas cell; component `enabled` fields can be Boolean tracks. IDs, asset references, object collections and arbitrary dynamic paths are not animated. Integer-only properties require Int32 tracks. Authored values remain available through `find(id)` and export; evaluated values are read through `scene.component`, `transformAt`, `world`, and `active`.

Object references use either `{entity: "scene-id"}` or `{binding: "slot-id", descendant: "optional-original-child-id"}`. A possessable targets an existing object. A spawnable supplies an `EntityInput` template, an optional parent reference and an optional Boolean `spawnTrack` ID. Without a spawn track it exists throughout its active sequence. Default `idScope: "instance"` namespaces IDs per sequence instance, allowing reusable templates. `idScope: "scene"` preserves template IDs for a uniquely owned chapter; compilation rejects collisions with authored entities or any other instance, even when their time ranges do not overlap. Internal Transition targets follow the spawned instance. Spawned entities inherit the specified local hierarchy. Missing spawned parents suppress their children, and exiting a sequence removes its spawnables. Both renderers reconcile this set incrementally and dispose removed DOM/GPU objects. `scene.isActive(id)` returns false for an entity that is currently absent.

A nested section has `id`, `sequence`, and an outer `range`, plus optional `startOffset`, `endOffset`, `firstLoopOffset`, rational `timeScale`, `loop`, `hierarchicalBias`, and `bindingOverrides`. Ranges are `[start, end)` with integer boundaries. Section ranges use the parent resolution; trim and first-loop offsets use the child resolution. The child can be reused with different overrides in several sections, including overlapping sections. Nesting and spawn-parent cycles are rejected.

```text
innerStart = child.playbackRange.start + startOffset
innerEnd   = child.playbackRange.end   - endOffset
innerTime  = innerStart + firstLoopOffset
             + (outerTime - section.range.start) * childRate / parentRate * timeScale
```

Looping wraps into `[innerStart, innerEnd)`. A negative section time scale needs an authored first-loop offset that starts inside the desired reverse range; zero time scale freezes the child. Master `playbackRange.start` can be nonzero, but player seconds and display-frame seeks are relative to that start.

Bindings support an optional active `range`, integer `priority`, `blend: "replace" | "additive"`, weight in `[0,1]`, and `completionMode: "restore" | "keep"`. Contributions apply in increasing hierarchical bias, then priority, then authored order. Replace blends the current value toward the track; additive adds `value * weight`. Integer contributions round and clamp after blending; sprite frame indices are also checked against the atlas. These are sequential scalar contributions, not Unreal's full blend solver. Boolean values require full-weight replacement. Restore is the default; keep samples the binding's end boundary after its range until the owning sequence exits. Outside the owning sequence all its overrides disappear, and authored state is restored. It does not permanently bake a value or transfer spawn ownership to the scene.

The playback API is:

```js
const { Frame, Time, frameRate } = await import("/runtime/player.js");
const engine = window.scenePlayer;
engine.pause();                                      // hold the current evaluated pose
await engine.seekFrame(Frame.from(57));               // exact master display frame
await engine.seekFrame(Time.fromRatio(115n, 2n));     // 57.5 display frames
await engine.seekFrame(Frame.from(45600), frameRate(24000));
engine.setPlaybackRate(-1);                          // reverse, PerformanceClock only
engine.setPlaybackRate(1, 2);                        // half speed
await engine.play();                                // Audio may reject browser autoplay
await engine.stop();                                // remove spawns and restore authored state
const sceneJSON = engine.exportScene();
```

`PerformanceClock` measures elapsed microseconds from a rational absolute anchor and does not accumulate frame deltas. Exact frame seeks and reverse/zero rates are supported. With an audio clock, `seekFrame` retains the requested rational position until the media position advances; native Audio may quantize the exposed timestamp. Legacy SpriteAnimator/TransformAnimator data still plays from the same selected clock. Avoid writing the same sprite frame with both SpriteAnimator and a new track: the legacy atlas animator runs after the frame property is sampled. Legacy TransformAnimator provides the base transform beneath new track overrides.

`AnimationClock.pauseOffsetHint` is the last evaluated animation offset as a `FrameTime` in rational seconds (rate 1), relative to the transport start. The engine supplies its existing `scene.timelineTime` after evaluation. Both clocks retain this offset when paused; Audio also seeks the media element to it. Player controls, native Audio pause and Media Session pause share this behavior, including when `timeupdate` arrives before `pause`. The rational anchor preserves subframes across media timestamp quantization. A newer explicit/native seek and natural completion take precedence over an older hint. Without a hint, each clock retains its own pause position.

An audio seek retains its rational anchor through decoder settlement, including when the assigned target and final reported media timestamp differ. Queued completion events from earlier seeks cannot complete a newer request. This changes transport bookkeeping; it does not round animation keys or evaluated subframes.

An `AnimationPlayer` component selects its sequence and optionally references an `AudioPlayer` component. `PlayerControls` references the active `AnimationPlayer`. Put these on a root-level `Playback` entity so camera changes do not own or recreate playback. References identify entity/components:

```json
{
  "id": "playback",
  "name": "Playback",
  "components": [
    {"type": "AudioPlayer", "asset": "soundtrack", "title": "498 Tokio", "volume": 1, "muted": false, "loop": false, "preservesPitch": false},
    {"type": "AnimationPlayer", "sequence": "master", "clock": {"entity": "playback", "component": "AudioPlayer"}},
    {"type": "PlayerControls", "player": {"entity": "playback", "component": "AnimationPlayer"}, "hideDelayMs": 3000}
  ]
}
```

The referenced asset is `{ "type": "Audio", "file": "soundtrack.mp3" }`. `AudioPlayer` owns the actual `HTMLAudioElement`, loading, native playback, volume and Media Session handlers. Both renderers use the shared `AnimationClock` interface. During playback, `performance.now()` interpolates between advancing media-time hints; transport events and bounded corrections keep it synchronized with the audio. Playback and seeks wait for actual media advancement before counting output-startup time. Pause preserves the evaluated animation offset and aligns the media position; native seeks, rate changes, end, and Media Session commands drive the pose and controls. `engine.audioPlayers.get(entityId)` exposes a component instance; `engine.audioPlayer` is the currently selected audio clock. A missing/null reference falls back to `PerformanceClock`. Currently one active AnimationPlayer transport drives the scene; independent clips are nested sequences. Player components must be authored entities, not spawnable templates. Audio volume/rate automation tracks and independent simultaneous AnimationPlayers are outside the current scope.

`PlayerControls` mounts as a fixed DOM overlay covering the browser screen in both renderers. Letterboxing resizes only the rendered scene; the toolbar and speed popup retain their screen positions. Its optional null `player` reference selects the active transport. Only one enabled, active controls component may own the screen. Disabling/re-enabling it does not reset the clock or position. A declared inactive/disabled component suppresses automatic UI; legacy animated scenes without any declaration retain automatic controls. `controls=0` or the engine's `controls: false` option disables all automatic UI. Explicit scalar animation tracks do not target transport components.

Controls retain their SVG icon nodes and update buttons on state changes. `engine.onStateChange` emits for transport changes, explicit seeks, scene edits and view changes, not every animation sample. A separate visible-only timer refreshes timeline progress at most 10 Hz; hidden/paused/background-tab controls have no progress timer. CSS and native controls handle layout, fade transitions, slider input and menu sizing. Scene clicks/taps reveal controls without toggling playback; buttons and keyboard shortcuts operate the transport.

`AudioPlayer.preservesPitch` defaults to `false`, so changing playback speed changes pitch as well. It maps directly to [HTMLMediaElement.preservesPitch](https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/preservesPitch). The speed popup combines presets with a native 0.25–2× slider in 0.01 increments, and reflects native audio rate changes.

For Audio, duration and loop come from the media element/AudioPlayer; for PerformanceClock they come from the master range and `timeline.loop`. `timeline.autoplay` requests playback after loading, subject to browser autoplay policy. `play()` returns the native playback promise; blocked autoplay leaves the player paused. Controls expose positive rates only; negative/zero rates remain available through the PerformanceClock API. The preview server serves MP3 with MIME, Content-Length and byte ranges to support native seeking. Media Session is feature-detected. Platform behavior follows [HTMLMediaElement.currentTime](https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/currentTime), [play()](https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/play), and the [Media Session API](https://developer.mozilla.org/en-US/docs/Web/API/Media_Session_API).

The default [final_animation scene](../assets/final_animation.scene.json) contains the complete extracted MP3, a 230-second master at 24,000 ticks/second, and an intro section at 30 ticks/second covering source frames 0–558. Its scalar tracks animate reveal, shared moon/flame scale, a six-frame stepped palette with a 108-frame period, ship/grass arrival, grass parallax and live blur, the ship's late turn, and three shrinking warp lines. Four reusable flame sequences spawn their objects under the moon in each measured cycle. The ship owns the red pilot and seeded local exhaust emitter. Both runtimes read the same graph and packed track data. Nested chapters now cover the star field, forward flight, paper landscape, gate interior, helmet/launch sequence, and asteroid field and beam evasions, the perspective deck pass and boss arrival through source frame 2685. Chromium reports a gapless audio duration of 230.016871 seconds, matching the source AAC duration; the MP3 container includes additional encoder padding. No arbitrary offset is applied.

The 18-second [demo JSON](../assets/animation_demo/demo.scene.json) reuses the existing background, moon and pilot PNGs. It demonstrates hue/weighted-height tracks, atlas frames, two nested instances at different time resolutions, object overrides, local parent transforms and spawn gates. **The demo motion is not fitted to the source video.** Open `/index.html?scene=assets/animation_demo/demo.scene.json&renderer=dom`, or choose `renderer=babylon`. Future reconstruction work can replace the authored keys without changing either runtime.

Current scope excludes event tracks, camera-cut tracks, automatic curve fitting/tangents, root-motion extraction, arbitrary mesh animation, and Unreal's full spawn-ownership/completion/blending policies. Particle emitters remain analytic functions of current component values; animating their emission rate does not integrate a historical variable-rate schedule. These extensions require separate semantics, while ordinary scalar Transform/effect/atlas tracks use the system above.

The final scene keeps only its root, seven cameras and playback entity resident. The intro, starfield, forward flight, paper flight, landscape, interior, launch, asteroid, deck-pass and boss-arrival sequences own their chapter entities as spawnables. Transition overlap remains part of the section ranges. The helmet-room sequence is nested in the interior chapter, retaining that room until frame 2196. Landscape ends at 1727, interior at 2196, launch at 2256, asteroid field at 2537, deck pass at 2611 and boss arrival at 2686; their tracks do not continue to the audio endpoint. Image and procedural-result caches belong to Resources and survive chapter exits, while DOM/GPU render objects are disposed. Re-entering a chapter reconstructs the same pose from its tracks.

The deck-pass reconstruction covers source frames 2537–2610 with a perspective camera, a fixed tiled floor, the existing ship/blue pilot/missile assets, five impacts and measured beam appearances. Eleven cubic heading keys describe the approximately 110-degree camera turn. Floor edges and texture cells retain measured shake; the explosion's native grid supplies relative orientation observations while the floor is hidden. The disconnected floor tracks are joined by selecting a nearby integer tile translation before interpolating the missing longitudinal camera positions. The unprojected star tile belongs to the camera while its spawn lifetime belongs to the chapter. The ship and its nearly coplanar pilot are fitted against this fixed camera using exactly three position keys at 2537, 2551 and 2610, with independent weighted Bezier handles per axis. The ship's local and world rotations are zero and its scale is constant; no animated parent or additive position track supplies extra motion. A single fixed world basis aligns the axes with the hull and is shared by the floor and all measured planes.

Impacts use independently fitted 3D planes and a padded, 16-frame atlas. All five occurrences are fitted again after selecting the camera's tile phase. Three distant repeats use two position keys; the two occurrences crossing the tracking gap use additional cubic pose keys to retain the observed native grid and floor intersections. Lasers retain a common fixed horizontal heading relative to the floor and cross it as actual planes. The integer tile phase, fully hidden motion, occluded hull landmarks and some near-impact contact positions remain estimates.

The middle deck interval is fitted directly to the visible strip of floor, with quadratic continuity constraints to reject isolated tile aliases. The near explosion grid is registered against source pixels independently of the previous scene's transforms. The selected late floor phase is one period ahead of the shortest endpoint-distance candidate; repeated texture cannot determine that choice from endpoint distance alone.

`SortingGroup` gives descendant sprites a common depth anchor while `SpriteRenderer.sortingOrder` controls their internal draw order. The nearest enabled group owns a sprite; its `anchor` is in the group's local coordinates. Larger orders draw later, with each sprite's shadow and glow preceding its body. Actual geometry, projection and opaque-plane depth tests remain unchanged. The ship uses this to keep its nearly coplanar pilot behind the hull as the camera turns. DOM retains flat render surfaces, and Babylon uses the same anchor for alpha sorting. `npm run check:sorting-group` verifies the ordering from both camera directions and relative to other objects.

`LineRenderer.coverage` is `segment` for authored endpoints, `camera` for a line extended in both directions across the camera frustum, or `ray` for an authored start extended only toward `end`. Ray bounds follow the finite near/far frustum on resize, so an expanded portrait viewport does not expose a fixed-length cap. Projection, width, glow and floor intersections stay in the object's 3D plane.

`GaussianBlur` on a camera blurs the composed scene without affecting player controls. Its `sigmaWorld` axes are measured on the camera's reference projection plane and scale with the viewport. The deck camera uses the spread of isolated background stars to measure the shared screen blur; heavily occluded frames use the observed phase of other impacts. DOM applies a retained SVG Gaussian filter. Babylon uses reusable separable post-process passes, prepares their shader during the loading stage, and detaches each pass when its sigma is zero. `npm run check:camera-blur` checks both axes, sharp-frame bypass, camera cuts, rewind and DOM reuse.

Hard-cropped opaque tiled planes write Babylon's depth buffer. DOM surfaces are clipped against the corresponding camera rays and finite plane boundaries, including disjoint visible regions; clipping includes line glow and sprite effects. This supports intersections with opaque tiled planes without requiring a DOM canvas. Soft crop effects retain alpha blending. Run `npm run check:deck` for camera cuts, a static floor, zero hull rotation, position/size observations, lifetimes, atlas padding, browser replay and planar occlusion checks.

Full two-axis DOM repeats retain one native SVG pattern. Perspective backing rectangles grow in guard bands without quantizing camera motion or texture coordinates. Rectangular crops trim the fill geometry directly; near/far clipping is projected into a viewport-sized mask with camera-blur overscan. This avoids rebuilding repeated paths and rasterizing long local masks as the camera turns. `node tests/check-deck.cjs --edge` also runs the deck replay and retained-artwork checks in an installed Microsoft Edge.

Beam geometry extends below the floor. Babylon's opaque tiled material writes depth, clipping both core and glow. For perspective scenes, the DOM renderer draws fully opaque, infinite tiled planes first and clips transparent surfaces against their camera-facing half-spaces. Finite, alpha and transition surfaces retain their existing sorting. The DOM line surface uses projection-adjusted SVG units to avoid oversized filter textures. `npm run check:planar-depth` verifies core/glow occlusion under floor-parent movement and changing aspect ratios in Chromium, Firefox and Babylon. Source cuts close to the floor's vanishing line constrain depth weakly; their finite fit is approximate rather than a unique recovered distance.

Run `npm run check` to build production bundles and validate type contracts, frame arithmetic, mixed/weighted interpolation, nested rates, loops, restoration, graph rejection and both browser backends. Browser checks verify no Canvas scene rendering in DOM, no global Babylon script, progressive loading, exact rewind results, spawn resource counts, pause/reverse/half-speed playback and existing scene baselines.

`CylindricalSpriteRenderer` maps a shared sprite around an open local +Z cylinder. Radius, axial bounds, axial tile length, facet count and UV offsets are scene properties. U runs clockwise from +X and V toward -Z. Ambient and Lambert diffuse lighting use a local light direction; the shared albedo is unaffected. DOM retains CSS facets with repeating images; Babylon retains one mesh and updates UV uniforms. Both use the same geometry and local transforms. Sprite brightness is followed by an optional `contrast` operation, with a neutral default of one. `SpriteMotionBlur.clipToSprite` optionally clips the exposure to the unexpanded sprite rectangle; it defaults to false.

Boss arrival uses a camera-aligned capital ship, four cubic position keys per axis, a fitted radial zoom exposure clipped to the source rectangle, seven measured beams and a six-frame white ring atlas. The extended 100 x 100 star tile preserves the original 100 x 72 crop and adds three stars recovered from two cylindrical views. The full square repeat is shared with the earlier planar backgrounds. The close-up uses native colors fitted across 18 enlarged frames, with two-endpoint saturation and black-level curves; its original white-flash alpha mask is unchanged. Cylinder pose and lighting are fitted estimates; occluded first-ring cells and compressed color details are approximate. Source frame 2685 is black. `npm run check:boss` verifies measured star projections, retained geometry during scrolling, camera cuts, ring lifetimes, viewport expansion and deterministic seeking in both backends.
