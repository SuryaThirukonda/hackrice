# Godot controller migration

## Scope and source of truth

The useful controller implementation is split between the phone web client and Godot:

- `web/src/lib/motion.ts` reads browser sensors and produces the 13-number motion sample.
- `web/src/controller/motionProcessor.ts` calibrates, filters, recognizes gestures, and calculates power.
- `web/src/controller/Controller.tsx` separates continuous D-pad state from discrete actions and gates golf/bowling to a capture window.
- `web/src/controller/ControllerSocket.ts` sequences normalized packets and measures RTT.
- `godot/scripts/controller_manager.gd` authenticates controller slots, rejects duplicates/stale packets, and exposes normalized signals.
- `godot/scripts/match_scene.gd` maps those signals to sport controls. Rules remain separate in `*_match.gd` files.

The latest code takes precedence over older prose in `docs/HANDOFF.md`: calibrated tilt is still implemented and tested, but the normal controller currently sends the touchscreen D-pad vector every 40 ms. Motion sensors determine gesture power, not camera movement.

No controller renderer reads raw sensor packets. The migration keeps that boundary:

```text
phone sensors / phone D-pad / keyboard / fake traces / replay / bots
  -> normalized continuous controls + discrete actions
  -> deterministic TypeScript simulation
  -> immutable snapshot
  -> PlayCanvas presentation
```

## Raw phone input

The browser emits this tuple for each `devicemotion` sample:

```text
[t, ax, ay, az, agx, agy, agz, alphaRate, betaRate, gammaRate,
 orientationAlpha, orientationBeta, orientationGamma]
```

- `t`: phone monotonic timestamp expressed as `performance.timeOrigin + event.timeStamp`; processing converts it back to page-relative milliseconds.
- `a`: linear acceleration in m/s². Native `event.acceleration` is preferred. If unavailable, gravity is removed using orientation; the last fallback is a 750 ms gravity low-pass estimate.
- `ag`: acceleration including gravity in m/s². It is diagnostic/fallback data, not gesture input after normalization.
- rotation rate: browser `alpha`, `beta`, `gamma` in degrees/second. Processing remaps this to `[beta, gamma, alpha]` before filtering so the vector axes align with device X/Y/Z.
- orientation: Euler `alpha`, `beta`, `gamma` in degrees. There is no quaternion path.
- typical physical and synthetic sample rate: 60 Hz. Processing is event-driven and estimates actual Hz over a rolling 1,000 ms window.

Device X/Y acceleration and rotation are rotated into the current screen orientation (0/90/180/270 degrees); Z is preserved. This keeps left/right and up/down screen-relative.

## Calibration, neutral pose, and filtering

Gesture calibration lasts 1,200 ms and requires at least 30 samples. It calculates mean acceleration and rotation biases and the combined per-axis standard deviation. Calibration fails if acceleration noise exceeds 1.15 m/s² or rotation noise exceeds 18 deg/s. A successful calibration subtracts both biases from future samples and resets the filter.

The gesture filter is an interval-corrected exponential moving average. Its alpha is 0.55 at 60 Hz, with sample intervals clamped to 4–100 ms before deriving the rate-adjusted alpha. This makes smoothing approximately stable across sensor rates.

Tilt-stick calibration independently averages screen-relative beta/gamma for the same 1,200 ms/minimum-30-sample window. Its implemented shaping uses 28 degrees for full scale, a radial 0.10 dead zone, radial clamping, and 0.30 smoothing. The latest normal UI does not transmit this sensor-derived stick; it transmits the touchscreen D-pad state instead.

## Continuous state

The normal controller sends D-pad state as a normalized `stick: [x, y]` packet every 40 ms (nominally 25 Hz); the socket also enforces a 30 Hz maximum. Pointer/key release, pointer cancellation, lost capture, tab blur, and visibility changes all reset it to `[0, 0]`.

Godot clamps each component to `[-1, 1]`, normalizes vectors outside the unit circle, and retains only the packet with the newest sequence. Gameplay returns a zero vector when the controller is disconnected or the last stick packet is older than 250 ms. That expiry is essential: a dropped connection cannot leave movement or aim held.

Godot maps this channel as follows:

| Sport/mode | X | Y | Rate/limit |
| --- | --- | --- | --- |
| Boxing | strafe | forward/back | 2.5 m/s; ring-clamped; fighters separated |
| Golf/bowling move mode | lateral/forward movement | lateral/forward movement | 2.5 m/s; scene bounds |
| Golf aim mode | heading | club selection | heading 0.7 rad/s; 0.3 s selection repeat |
| Bowling aim mode | heading | hook | heading 0.7 rad/s; hook steps with 0.3 s repeat |

For `version2`, continuous values become semantic control values, never PlayCanvas transforms: boxing `strafe`/`forward`, bowling lane/aim/hook controls, and golf aim/club controls. PlayCanvas continues to consume snapshots only.

## Discrete gestures and actions

The phone emits normalized gesture events named `punch`, `golf_swing`, or `bowling_swing`. Each carries power `0–100`, a normalized direction, dominant axis/label, peak acceleration, peak rotation, duration, a monotonically increasing sequence, and a unique event ID. Direction reporting is independent of power.

Other discrete actions are `block_start`, `block_end`, `emergency_power`, `placeholder_primary` (A/start motion/lock aim), and `placeholder_secondary` (B/cancel or mode toggle). The latest phone UI implements boxing block as a toggle and Emergency Power as a one-shot 10% multiplier, rounded and capped at 100. The boost is consumed by the next punch only.

Golf and bowling use a one-shot flow: A starts a three-second countdown, then enables detection for a two-second capture window; only the highest-power completed gesture in that window is sent once. B cancels an active attempt. Boxing detection remains continuous.

## Gesture detector behavior

All thresholds below operate on calibrated, screen-oriented, EMA-filtered samples.

| Setting | Boxing | Golf | Bowling |
| --- | ---: | ---: | ---: |
| Start acceleration (m/s²) | 7.0 | 6.5 | 5.8 |
| Rotation arm threshold (deg/s) | none | 95 for 34 ms | 78 for 42 ms |
| Arm reset / timeout | n/a | 46 / 420 ms | 38 / 500 ms |
| Release acceleration (m/s²) | 3.8 | 3.2 | 2.8 |
| Release peak ratio | 0.48 | 0.42 | 0.40 |
| Rearm acceleration (m/s²) | 5.5 | 4.0 | 3.8 |
| Accepted duration (ms) | 34–260 | 70–520 | 85–620 |
| Cooldown (ms) | 180 | 260 | 320 |
| Power acceleration max | 36 | 38 | 36 |
| Power rotation max (deg/s) | 600 | 700 | 600 |
| Acceleration / rotation weight | 0.78 / 0.22 | 0.38 / 0.62 | 0.64 / 0.36 |
| Direction acceleration / rotation weight | 0.90 / 0.10 | 0.55 / 0.45 | 0.78 / 0.22 |
| Power curve exponent | 1.35 | 1.35 | 1.35 |

Golf and bowling first require sustained rotation, then start tracking when acceleration crosses the sport threshold. A gesture completes after its positive acceleration falls below the larger of the absolute release threshold and the peak-ratio threshold, or when maximum duration is reached.

Power normalizes acceleration between the start threshold and cap and rotation between its arm threshold (zero for boxing) and cap. Each normalized component is raised to 1.35, weighted, summed, multiplied by 100, rounded, and clamped by construction to `0–100`. This deliberately puts a strong ordinary golf swing around 75–85 rather than saturating every swing.

The detector locks acceleration and rotation directions at gesture start and only accumulates positive projections along those directions. The return stroke therefore cannot increase peak values, power, or reported direction.

Boxing adds forward-direction learning: the first deliberate post-calibration punch fixes the opponent-positive direction. Later negative projection marks retraction; a new punch cannot arm until the phone has been neutral (at or below release acceleration) for 100 ms. This also suppresses the forward braking pulse at the end of retraction. After cooldown, a partial return can rearm; otherwise a new rise of at least 20% of the start threshold is required. These details are what allow combinations without duplicate recoil punches.

There is no phone-derived hook/jab classifier in the final path. Godot receives the generic `punch`; its separate rules model uses power, reach, guard, stamina, and step-in momentum. `version2` must choose a deterministic punch kind at the normalized-action boundary (for example by alternating hands or using direction/rotation metadata), not in PlayCanvas.

## Network and latency behavior

- Controller slots are `controller_1` and `controller_2`; a socket must receive a successful `hello` before sending input.
- TCP and WebSocket no-delay are enabled and Godot polls every frame.
- A hello is rejected after 5 seconds; the browser expects its acknowledgement within 4 seconds.
- Sequences survive browser reconnects through local storage. A reconnecting hello supplies the last issued sequence as the new floor.
- Godot rejects any motion, stick, gesture, or action whose sequence is not newer than the last accepted packet.
- Gesture/action event IDs are additionally deduplicated in a rolling 256-ID cache that survives reconnects.
- Gestures are attempted once and are never queued for replay after reconnect. Continuous state is latest-state-wins.
- Ping runs every second. The phone retains 60 RTT samples and reports current, median, and p95 latency.
- Raw diagnostic telemetry is capped at 30 Hz and is optional. It does not drive game rules.
- The 250 ms continuous-state expiry is the only explicit stale-time check. Discrete events rely on sequencing and no-replay behavior rather than comparing unsynchronized clocks.

## Sport behavior worth preserving

### Bowling — first completion target

Preserve continuous lane position, aim and hook adjustment; a discrete A action that locks the sweeping aim/capture window; motion-derived power; exactly one release per accepted gesture; and stale-state neutralization. Feed `{ lanePos, angleDeg, hook, power }` to `BowlingGame.startRoll()`. The deterministic TypeScript lane simulation remains authoritative for gutters, pin collisions, scoring, frames, and match progression.

### Boxing

Preserve continuous strafe/forward movement, continuous block state with a forced release on disconnect, one discrete punch per detector event, forward/retraction suppression, motion power, and the optional one-use 10% boost. Feed normalized commands to `BoxingMatch.step()`. The TypeScript simulation remains authoritative for punch type, reach, hits, blocks, dodges, stamina, damage, knockdowns, and results.

### Golf

Preserve aim/club continuous controls and a single motion-derived shot after the capture window. Feed the resulting club, aim, normalized power, and an explicit deterministic accuracy value into `GolfRound.shoot()`. The TypeScript simulation remains authoritative for flight, bounce, roll, hazards, strokes, holes, and outcome.

## Assets and rendering findings

The Godot project contains no GLB/glTF/FBX/OBJ models, textures, materials, shaders, animation resources, or audio files. Its scene files are script containers and UI nodes; every 3D environment, character, ball, pin, material, light, and camera is created procedurally in GDScript. There is therefore no asset conversion/export step to perform. The existing PlayCanvas procedural worlds are substantially more developed and should remain in place.

Godot visual ideas that may be reinterpreted after parity—not exported—are the bowling neighboring-space contrast, first-person boxing guard arms, fixed-forward translation-only hit feedback, simple overhead/top views for golf and bowling, and clear P1/P2 color coding.

## Verification contract

Automated migration tests should cover:

1. quiet/noisy calibrated samples do not emit;
2. a strong swing crosses the configured threshold and yields expected power;
3. reverse/retraction motion cannot increase power or emit a duplicate punch;
4. cooldown and fresh-rise rules allow intentional combinations;
5. a bowling capture/release produces exactly one normalized throw;
6. continuous state becomes neutral after 250 ms;
7. stale sequence and duplicate event IDs are rejected;
8. keyboard, fake controller, and phone events produce compatible simulation commands;
9. pause/blur/disconnect clears held state;
10. simulations remain deterministic for identical normalized input traces.

Human-only validation remains necessary on both target phones: calibration comfort, false positives while walking/fidgeting, soft/medium/hard power bands, combination cadence, grip/orientation changes, 25–30 Hz D-pad feel, stale-stop behavior under real Wi-Fi loss, and end-to-end iOS permission/tunnel behavior.
