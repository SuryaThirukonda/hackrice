# The House Always Plays: idea finalization

HackRice 16, Rice University, September 11 to 13, 2026. Casino theme.

This document merges three inputs into one final concept and one architecture:

1. The original product: phone-as-motion-remote sports on a projector against AI "House" opponents, wrapped in a play-chip parimutuel betting rail for spectator phones, with OpenAI personas and ElevenLabs voice. See `docs/TECH_PLAN.md` and `docs/RESTART_PROMPT.md`.
2. The adaptive motion-fitness architecture from `~/Downloads/message_hackrice.txt`: three sensing systems (phone motion, game performance, camera physiology via Presage) fused into a player state that adapts the next round of a prebuilt game.
3. Two new constraints from the team: consider PlayCanvas for 3D game play, and commit the visual identity to a comic-book style (bold ink, halftone, primary colors) rather than the purple neon look.

## 1. The one-sentence pitch

An arcade where you swing your phone to play sports on the projector against a talking AI House, the room bets on you with play chips, and the House adapts every round to how you perform and how your body responds.

The casino frame gives the spectacle and the reason a room gathers. The adaptive engine gives the technical story: the House does not just get harder when you score, it reads your performance, your movement intensity, and your physiology, then changes the game between rounds.

## 2. What the message file changes

The message describes a Unity build. We are not using Unity (see section 5), but its architecture transfers almost one to one:

| Idea in the message | How it lands in our platform |
|---|---|
| Three sensing systems: phone motion, game performance, human physiology | Phone remote (already built), game telemetry (new, emitted by each game), Presage human state (new provider) |
| One reusable MotionAnalyzer, games never see raw sensors | Already the case: `backend/app/motion/detectors.py` emits gestures, games consume `motion.gesture` |
| Universal ControllerState with calibration relative to a neutral pose | Already the case: `motion.calib_*` and the calibration step on the remote |
| Adapt an existing game between rounds; never generate a game live | Adopted. Each game exposes parameters and implements one difficulty interface |
| AI is a development-time tool (Astra plus Unity MCP) | For us: Claude Code builds the Phaser or PlayCanvas scenes in the repo before demo day |
| Baseline, calibrate, round, recovery, adapt | Adopted as the session flow, with the betting window and House taunts placed inside the recovery beat |
| Confidence-gated physiology metrics | Adopted. A metric is used only when its confidence passes a threshold |
| MVP is one polished game plus one proof game | Adopted: boxing is the polished game, bowling is the proof game |

## 3. The three signals and the player state

```
                  PLAYER
                     │
          ┌──────────┴──────────┐
        PHONE                 WEBCAM
   DeviceMotion            Presage SDK
          │                     │
     MotionAnalyzer        HumanState
     (gestures)            (confidence gated)
          │                     │
        GAME  ──── telemetry ───┤
          │                     │
          └──────────┬──────────┘
                PLAYER STATE
                     │
              ADAPTATION ENGINE
                     │
            next round parameters
```

Player state, one object per round:

```json
{
  "performance": { "accuracy": 0.86, "reactionTime": 0.29, "scoreTrend": "improving" },
  "movement":    { "gestures": 38, "avgIntensity": 0.72, "peakIntensity": 0.95 },
  "physiology":  { "heartRate": 103, "baselineHeartRate": 74, "heartRateDelta": 29, "recoveryTrend": "fast", "confidence": 0.9 },
  "experience":  { "engagement": 0.83, "expression": "positive" }
}
```

Adaptation rules, evaluated between rounds:

- Accuracy high, reaction fast, heart-rate delta moderate, recovery fast: raise difficulty (House speed up, windows tighter, round longer).
- Accuracy falling, movement intensity falling, heart rate elevated, recovery slow: lower difficulty and lengthen the recovery beat.
- Any physiology metric with confidence below 0.6 is ignored for that window. Physiology is noisiest while the player is swinging, so the recovery beat is where the camera gets its clean read.

The House persona narrates the adaptation. "Pulse 104. The House raises the stakes." This is the moment that sells the idea to judges, so it gets its own voice line and projector card.

## 4. The difficulty interface every game implements

```ts
export interface GameParameters {
  speed: number        // House action speed, 0.5 .. 1.5
  window: number       // timing window scale, 0.6 .. 1.4
  targetSize: number   // hit box scale, 0.7 .. 1.3
  roundSeconds: number
  spawnRate: number    // pitches, balls, or punches per minute
}

export interface RoundTelemetry {
  score: number; accuracy: number; reactionMs: number
  gestures: number; avgIntensity: number; peakIntensity: number
}

export interface AdaptiveGame {
  setParameters(p: GameParameters): void
  getTelemetry(): RoundTelemetry
}
```

The adaptation engine computes one scalar difficulty in 0 to 1 plus a fitness mode, and each game maps that to its own parameters. Modes worth building because they change what the player feels, not just how hard it is:

- Cardio: more events, faster spawn, continuous movement.
- Precision: fewer, smaller targets, specific directions.
- Reaction: shorter windows, telegraphs shrink.
- Recovery: slow round, larger targets, longer rest.

## 5. Engine decision: Phaser, PlayCanvas, or Unity

| | Phaser 3 | PlayCanvas | Unity |
|---|---|---|---|
| Runs in the browser, hosts on Cloudflare, works with the existing QR and WebSocket flow | Yes | Yes | Only as a WebGL build with long build times and a separate toolchain |
| 3D physics for bat, club, sword, ball | No | Yes, ammo.js rigid bodies and glTF import | Yes, the best tooling |
| Animation tooling | Code and sprite sheets | Anim state graph in the editor, glTF animations | Best in class |
| Iteration speed in a 36 hour build with Claude Code | Fastest, plain TypeScript and Vite | Fast in engine-only mode (npm `playcanvas`, TypeScript, no editor required) | Slowest for this team |
| Comic 2D look | Natural fit | Possible with toon shaders and 2D screen layers, more work | Possible, more work |
| Risk | Lowest | Medium: new engine to learn, asset pipeline | Highest |

Decision:

- Phaser is the shell and the HUD (menus, tutorial, betting, cards). The comic template in `version2/` is the shell.
- PlayCanvas, engine-only from npm in TypeScript, renders the games on its own canvas behind the Phaser canvas. Boxing, bowling, and golf are first-person 3D comic games built from primitives with ink outlines; a deterministic simulation per sport is the physics authority and the 3D layer only renders it.
- Unity is out. Its main benefit, editor and animation tooling, does not pay back inside the hackathon window, and its WebGL build would break the "scan a QR and play" flow that is already working.

## 6. Session flow (the demo script)

1. Welcome on the projector, comic title screen (version2).
2. Baseline: "Look at the camera." Presage measures 20 to 30 seconds. Heart rate 74. Baseline ready.
3. Connect: QR on the projector, phone opens the remote, calibrates in one tap.
4. Choose mode and game: 1 player vs the House, boxing.
5. Betting window opens on the rail. The House talks trash.
6. Round 1, 45 seconds. Phone gestures drive the fight. Telemetry accumulates.
7. Recovery beat, 15 to 30 seconds: bets settle, leaderboard flips, the House comments, the camera gets a clean read. Heart rate 101, 96, 91.
8. Player state card on the projector: performance strong, recovery fast. Next round difficulty up. Odds for round 2 shift accordingly.
9. Round 2 with new parameters. Repeat.

The pitch line for judges: traditional games adapt to how well you score; the House adapts to how you perform and how your body responds, and the room bets on the result.

## 7. Runtime architecture (what runs on demo day)

```
Phone (web remote, DeviceMotion, 50 ms batches)
   │ WebSocket
   ▼
FastAPI arena (single writer loop)           Laptop webcam
   ├─ MotionAnalyzer → motion.gesture             │
   ├─ Rooms, seats, QR join                  Presage SDK (browser or sidecar)
   ├─ Market: parimutuel, sponsor moves           │
   ├─ Persona (OpenAI) + Voice (ElevenLabs)       ▼
   └─ game.* bridge  ◄──────────────────  HumanState provider (confidence gated)
        │                                          │
        ▼                                          │
Game client (Phaser shell, Phaser 2D games,        │
optional PlayCanvas 3D game)                       │
        │ round telemetry                          │
        └──────────────► Player State Engine ◄─────┘
                               │
                        Adaptation Engine
                               │
                    setParameters(next round)
```

Projector, host, and rail pages stay as they are in the restart brief. The player state engine and the human state provider are new backend modules; both must run with a stub provider so the demo never depends on the camera working.

## 8. Presage: what to verify before committing

- Presage Technologies ships SmartSpectra SDKs for camera-based heart rate and breathing. Confirm the current platforms (web, iOS, Android, or a REST API), pricing, and whether a hackathon key can be obtained on day one.
- If only mobile SDKs are practical, run the camera on a second phone as a "sensor station" that posts HumanState to the backend.
- Always keep the stub: a host slider for heart rate and a simulated recovery curve, so the adaptation demo works without the camera.
- Never present physiology values as medical measurements. Label them "estimated".

## 9. Development plan (games first, then the layers)

Phase 0, shell: the comic template in `version2/` becomes the app shell. Title, menu, mode select, game select, host links. Done as a visual template; wire it to the arena next.

Phase 1, boxing polished: real-time 2D boxing in Phaser with keyboard and phone input, hit physics, stamina and health, three rounds, 3-2-1, sound. It implements `AdaptiveGame`.

Phase 2, bowling and golf: same input layer and 3D layer, different games. Each implements the difficulty interface. Baseball is dropped.

Phase 3, player state and adaptation: telemetry from both games, stub human state, adaptation between rounds, projector state card, persona line for the adaptation moment.

Phase 4, Presage integration behind the stub interface, with confidence gating and the baseline and recovery beats.

Phase 5, rail and spectacle on top: betting windows aligned to rounds, odds influenced by the player state, sponsor moves, Fight Night card.

Optional, only after Phase 3: one PlayCanvas 3D game (sword arena) reusing the same input and bridge.

Reuse everything listed in `docs/RESTART_PROMPT.md`. Delete what that brief says to delete.

## 10. Visual identity (final)

Comic book, not neon. Reference: `version2/`.

- Ink 0x141414 outlines at 5 to 7 px, cream paper 0xfff1cf panels, Ben-Day dot overlays, sunburst rays, action bursts (POW, BAM, KO, ZAP), speed lines, a red floor band, and an ink panel frame around every screen.
- Primary colors: red 0xff3a3a, gold 0xffd50a, blue 0x2f6cf6, green 0x35d06b, orange 0xff8c1a, magenta 0xff2e88, cyan 0x2ad4ff.
- Type: Lilita One for display, Nunito 900 for body and labels.
- Motion: bounce-in logos with squash and stretch, staggered slide-in menus, hover lift and wobble, stamp on select, diagonal ink wipe between screens, a pixel trail and drawn arrow cursor.
- Boxers, pins, and balls are drawn in the same ink-outline style so the games and the menus read as one comic.

## 11. Cut list if time runs short

1. PlayCanvas 3D game. 2. Presage live integration (keep the stub and the adaptation moment). 3. Fitness modes beyond one difficulty scalar. 4. Golf. 5. Sponsor moves and crate. 6. Voice (keep subtitles). 7. Real persona (keep offline taunts).

Never cut: the comic shell, polished boxing, the phone remote, the betting window, and the adaptation card between rounds.

## 12. Open decisions for the team

- [ ] Confirm Presage SDK access and platform on day one; otherwise plan on the stub for the demo.
- [ ] Decide whether a PlayCanvas 3D sword arena is worth the second day, or whether a 2D comic sword mode inside Phaser is enough.
- [ ] Decide whether the casino betting rail stays a headline feature or becomes the spectator layer under the adaptive-fitness headline. Recommendation: fitness adaptation is the technical headline, betting is the crowd feature, both in the pitch.
- [ ] Choose the demo game pair: boxing plus bowling (recommended, both partly built) or boxing plus sword.

## 13. Update: what is built in `version2/` (September 2026)

- First-person 3D boxing vs a deterministic bot (sliders, presets, seed), guided tutorial, key rebinding, deep sim tests.
- Fight Night: two LLM agents (OpenAI `gpt-5.6-luna` through a small Node service that keeps the key server-side) fight each other on a symmetric ~2 s cadence with scripted actions, a high-reasoning plan between rounds, taunts, and play-chip betting with fixed odds; scripted fallbacks keep the fight going when the API is slow or down.
- Bowling and golf: deterministic sims with tests and first-person 3D scenes on the same layers.
- Player-vs-bot play never calls the network; agent latency only ever affects the spectator mode.
