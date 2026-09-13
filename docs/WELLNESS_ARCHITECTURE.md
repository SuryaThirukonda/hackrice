# Tempo wellness architecture

Updated 2026-09-13. This document records the implementation audit, current first-party research, and the target architecture. Tempo is a wellness/entertainment product, not a medical device.

## Canonical repository and baseline

The canonical application is the tracked repository root (`hackrice/`) on `gauravbranch`. Untracked `version2/`, `web/`, `backend/`, and files suffixed ` 2` are obsolete duplicates and were not used. The starting baseline after `npm ci` was 27 test files and 241 tests passing; typecheck and build passed. Baseline warnings: Node 25 is outside Vitest 5's declared engine range; Vite warns about future native config loading and `__dirname`; PlayCanvas worker imports are browser-externalized; the main bundle is over 500 kB.

## Existing system audit

Before this iteration, each sport constructed a `HealthTracker` when its Phaser scene started and ended it on result or scene shutdown. The phone reduced roughly 60 Hz DeviceMotion samples into one-second epochs and sent batches through the existing controller relay. Each epoch contained elapsed time, mean and peak bias-removed acceleration magnitude, swing count, and integrated gyro magnitude. A separate ring buffer integrated gyro magnitude over the gesture window for an approximate swing ROM.

The browser posted the epochs to the local Node service. `server/health.ts` used the existing `data/health.sqlite` database with `sessions`, `epochs`, `swings`, and `vitals` tables. Daily and sport summaries were recomputed from completed sessions. The old model called mean acceleration over 0.8 m/s² active, mapped it linearly to a sport MET band, and called a minute active after 20 moving seconds. It also added one kcal for every swing. That swing bonus was unsupported and has been removed. The old “fatigue” value was only the ratio of late-session to early-session moving acceleration; it was not physiological fatigue and is no longer promoted in consumer UI.

The existing Presage bridge opened a camera in the Node service, requested breathing and cardio bundles, and exposed the last pulse, breathing and HRV values to a React lab. It used SDK `stable` plus a single confidence floor, collected 12 stable pulse values for a baseline, and stored stable derived values. It did not connect baseline or recovery to any sport or adaptation. Raw camera frames were not written to SQLite or the controller WebSocket.

Metric provenance is explicit: active time and MotionLoad are `motion-measured`; sport performance is `game-derived`; active energy is `energy-estimate`; pulse/breathing are `presage`; recovery and PlayerState are `wellness-derived`.

## Presage / SmartSpectra research

The installed `@smartspectra/node-sdk` is 3.3.0 and declares Node >=20; its current README recommends Node 24 LTS. The current Node API is `new SmartSpectraSDK(options)`, event registration with `on`, `useCamera({deviceIndex,width,height,fps})`, synchronous `start()`, async `stopAsync()`, and async idempotent `destroy()`. Lifecycle failures expose numeric code, message and retryability. Tempo uses 1280×720 at 30 fps, requests breathing plus cardio metrics, and disables accumulated output and telemetry.

Sources: [Node API reference](https://smartspectra.presagetech.com/docs/nodejs/api-reference), [metric configuration](https://smartspectra.presagetech.com/docs/nodejs/metrics), [payload data types](https://smartspectra.presagetech.com/docs/data-types/), [model cards and limitations](https://smartspectra.presagetech.com/docs/model-cards-and-limitations/), and [telemetry/privacy](https://smartspectra.presagetech.com/docs/telemetry-and-privacy/).

- Pulse is a 12-second average, valid from 40–110 BPM. `stable` corresponds to the vendor's accepted pulse error threshold (confidence >=40), but Tempo also requires valid framing, supported range, and freshness.
- Breathing is a 30-second average, 5–40 breaths/min. It needs a stable camera, a stationary player, visible face and chest, good illumination, and confidence >=45. Talking, body motion, dark/striped clothing, or handheld capture can invalidate it.
- HRV is a 60-second window; confidence is zero until the window completes. The payload may include RMSSD, mean NN, SDNN and Baevsky index. Tempo's schema can decode it, but the product does not request HRV or arterial-pressure models and never uses them for adaptation.
- The SDK validation codes include OK, no face, multiple faces, off-center/incorrect-size/too-close/too-far/too-high/too-low/non-forward face, too dark/bright, chest not visible, camera tuning, low frame rate and excessive motion. Consumer UI maps these to short positioning guidance and never exposes raw SDK errors.
- Large head/body/camera motion and flickering illumination can produce inaccurate pulse/HRV values even with high confidence. Therefore confidence alone is never sufficient.
- SDK telemetry is aggregate, opt-out and excludes frames, metric values and stable identifiers. Tempo sets `enableTelemetry:false`. SmartSpectra still authenticates and performs its documented remote service work; the UI claims only that Tempo stores no frames, not that all processing is offline.

MVP selection: starting pulse and recovery pulse are the physiology inputs. Breathing may warm opportunistically and appears only when usable. HRV, expressions, pressure waveforms and LLM insights are excluded from adaptation. Expressions are not interpreted as stress, frustration or mental state.

## Quality gate and failure modes

`PhysiologyState` normalizes connection, lifecycle phase, validation, pulse, breathing, optional HRV and timestamp. The live product requests only chest breathing, breathing rate, and pulse rate. A pulse is usable only when value is finite and 40–110 BPM, SDK `stable` is true, confidence is at least 40, validation is not an invalid framing/motion state, and the sample is no more than five seconds old. Breathing additionally requires 5–40 brpm and confidence >=45; optional diagnostic HRV data would require stability, confidence >=50 and a completed window.

`PRESAGE_MODE=live|mock|off` is supported. Mock drives the same reducer; off reports unavailable. Missing key, camera, permission, credits, service, stable data, or range-valid data never blocks gameplay. Fallback is phone motion plus authoritative game performance.

## MotionLoad and activity epochs

Epochs remain one second and now also carry acceleration RMS, gyro RMS, active sample fraction and peak normalized action power. `MotionLoad` is a bounded weighted sum of acceleration, rotation, active fraction, action frequency, action power and ROM participation. Inputs are normalized against 0.35–6 m/s² acceleration, 15–450°/s rotation, three actions/second and 360° rotation. Weights are explicit in `src/wellness/motionLoad.ts`:

| Sport | Accel | Rotation | Active fraction | Action frequency | Power | ROM |
|---|---:|---:|---:|---:|---:|---:|
| Boxing | .28 | .20 | .25 | .14 | .08 | .05 |
| Bowling | .20 | .22 | .12 | .18 | .18 | .10 |
| Golf | .18 | .22 | .10 | .18 | .20 | .12 |

This avoids equal weighting and reflects sustained boxing movement versus brief, deliberate bowling/golf actions. Stored legacy epochs remain readable through fallbacks.

## Energy estimate

The [2024 Adult Compendium video-game table](https://pacompendium.com/video-games/) anchors upper-body/light exergaming at 2.3 MET, moderate total-body exergaming at 4.0, moderate-to-vigorous at 5.0, and vigorous at 7.5. The [sport table](https://pacompendium.com/sports/) lists bowling around 3.0–3.8 and much higher values for real boxing; those real competitive-boxing values are intentionally not used for Tempo. Production bands are boxing 2.3–7.5, bowling 2.3–4.0, and golf 2.3–4.0. The mapping from MotionLoad is monotonic for each one-second epoch; inactive epochs use 1 MET.

The Compendium's [unit conversion](https://pacompendium.com/unite-conversions/) is `kcal/min = MET × 3.5 × weightKg / 200`. Tempo active energy uses `max(MET - 1, 0)` and integrates each epoch. There is no per-swing bonus. Body weight is optional, accepts kg/lb in Settings, converts internally to kg, and is stored locally. Without weight, absolute kcal is null and UI shows movement/activity load. Confidence is deterministic from weight availability, known sport, duration, phone coverage and calibration; values are rounded and always labeled estimated.

## Recovery, PlayerState and adaptation

Recovery compares valid values to the player's own session baseline. When baseline, post-activity, current value or signal quality is missing/stale, recovery is null. A post-activity rise under 8 BPM is too small to interpret. Otherwise `progress = clamp(1 - max(current-baseline,0)/(post-baseline),0,1)`. No recovery value is fabricated.

PlayerState fields are bounded 0..1: sport-specific authoritative performance, MotionLoad, exertion, recovery/null, sport consistency, participation-based engagement and physiology confidence. It records which sources were present. No field is a diagnosis, fitness score or medical readiness score.

`AdaptationEngine` is deterministic, bounded to at most ±10% and applied only at segment boundaries. Strong performance plus good recovery can raise challenge 5%; high exertion with missing/limited recovery holds challenge and lengthens recovery; low performance plus high exertion lowers challenge 5%; strong motion/game data without physiology can raise it 3%; otherwise it holds. Reason codes are persisted and mapped to fixed copy. An LLM is never in the decision path. Replays use the stored PlayerState and decision.

## Session planner and information architecture

`SessionPlanner` deterministically maps ENERGIZE, MOVE, FOCUS, RESET or JUST PLAY plus 5/10/15 minutes to baseline, active sport segments, recovery boundaries, cooldown and summary. Boxing is higher-intensity; bowling is coordination/active recovery; golf is precision/control. Fight Night stays outside wellness.

The consumer experience is split into Tempo Session setup, explicit-consent baseline, game, recovery/adaptation, session summary, and separate history. The history page now answers activity, last session, body response, weekly trend and how Tempo adapted. Active minutes replace kcal as the default goal. Weight moved to Settings. Raw confidence floats, SDK codes, sensor RMS, database identifiers and interpolation details remain diagnostics only.

SQLite is migrated additively: existing tables remain; epoch load/MET/energy/confidence columns, session load/confidence columns, richer vital metadata, and an `adaptation_decisions` table are added in place. Only derived epochs, movement events, vital windows, PlayerState snapshots and decisions are persisted. Raw webcam video/frames are never stored or forwarded over game WebSockets.
