# Wellness Metric Audit

Exact formulas from the current codebase (second-pass repair baseline). Paths are under `hackrice/`.

## Classification key

| Tag | Meaning |
|---|---|
| phone-measured | From phone IMU / gesture pipeline |
| game-derived | From sport sim scores / events |
| Presage-measured | From SmartSpectra / Presage camera SDK |
| derived estimate | Computed from other inputs (MET, ratios) |
| internal-only | Used for adaptation / gates; not a consumer primary |

---

## 1. Performance

**Class:** game-derived → internal-only for adaptation; was incorrectly shown as consumer `%`.

### Per-sport formulas (clamped to `[0, 1]`)

**Boxing** — `src/games/boxing/BoxingScene.ts` ~221–222  
`accuracy = landed / thrown` (0 if none thrown)  
`performance = 0.65 × accuracy + 0.35 × (yourDamage / (yourDamage + houseDamage))`

**Bowling** — `src/games/bowling/BowlingScene.ts` ~184–186  
`performance = score / 200`  
`consistency = 1 − stdev(rolls) / 5` (also clamped)

**Golf** — `src/games/golf/GolfScene.ts` ~276–278  
`performance = 0.7 − toPar × 0.08`  
`consistency = 1 − stdev(strokesPerHole) / 4`

### Session display (pre-repair)

`SessionSummaryScene`: mean of segment `performance` values × 100 → **"Performance 46%"**.

### Adaptation use (keep internal)

`src/wellness/adaptation.ts`:  
- `performance ≥ 0.7` AND `motionIntensity ≥ 0.45` → `+0.03` difficulty  
- `performance < 0.4` AND `motionIntensity ≥ 0.55` → `−0.03`  
- recovery bonus / clamp ±0.05  

**Decision:** keep normalized performance for AdaptationEngine; replace consumer UI with sport-specific result lines.

---

## 2. MotionLoad / Activity Load / Movement Intensity

**Class:** derived estimate from phone-measured epochs (+ small ROM term). Internal 0…1.

**Formula** — `src/wellness/motionLoad.ts`:

Sport weights:

| Sport | accel | rot | active | freq | power | rom |
|---|---|---|---|---|---|---|
| boxing | .28 | .20 | .25 | .14 | .08 | .05 |
| bowling | .20 | .22 | .12 | .18 | .18 | .10 |
| golf | .18 | .22 | .10 | .18 | .20 | .12 |

```
accel     = scale(accelRms ?? mean, 0.35, 6)
rotation  = scale(gyroRms ?? rotation, 15, 450)
active    = clamp01(activeFraction ?? (mean≥0.8 ? 1 : mean/0.8))
frequency = clamp01(swings / 3)
power     = clamp01(actionPower ?? (swings ? peak/18 : 0))
rom       = clamp01(rotation / 360)   // epoch integrated gyro ° — not swing-ROM list
MotionLoad = Σ component × weight   ∈ [0, 1]
```

Session mean = average of per-epoch loads (`src/health/energy.ts` summarize).

**Active-second gate:** `load ≥ 0.16` OR `swings > 0`.

**Consumer (pre-repair):** shown as `26%` / `ACTIVITY LOAD` — opaque.  
**Target:** `MOVEMENT INTENSITY` → LOW / MODERATE / HIGH + bar; keep 0…1 internal.

Suggested bands: LOW `< 0.28`, MODERATE `< 0.55`, else HIGH (matches Tempo Sense HUD).

---

## 3. Calorie / estimated active energy

**Class:** derived estimate (phone MotionLoad + sport MET band + body weight).

**MET** — `src/health/energy.ts`:  
- `load < 0.16` → `MET = 1` (rest)  
- else `MET = lo + (hi−lo) × (load−0.16)/(1−0.16)`  
- bands: boxing `[2.3, 7.5]`, bowling/golf `[2.3, 4.0]`

**Active kcal accumulation (per epoch second):**  
`kcal += max(0, MET(load) − 1) × 3.5 × max(20, weightKg) / 200 / 60`  
`kcal = null` if `weightKg === null`.

**Root causes of bad UI**

1. **No weight at session time** → `kcal = null` → Health shows “Energy not calculated · add weight…” even if epochs exist and weight is set later (no recompute).  
2. **`~${Math.round(kcal)}`** → values in `(0, 0.5)` become **`~0`**.  
3. SQLite stores `kcal` as `0` when null; `toRow` only re-nulls when `weightKg===null && activeSeconds>0`.

**Presage pulse is not an input to calories.**

---

## 4. Range of motion (ROM)

**Class:** phone-measured (gyro integral over swing window).

- Per swing degrees → `roms[]` (`src/health/activity.ts`)  
- Summary: `romMean = avg(swingRoms)`, `romMax = max(swingRoms)` (`energy.ts`)  
- Persisted: `rom_mean` / `rom_max`, `romTrend`, `bySport.romMean` (`server/health.ts`)

**Gap:** tracked and stored, **not rendered** on Session Summary or Health (pre-repair).

Sport labels (consumer): Golf “Swing ROM”, Bowling “Average Swing ROM”, Boxing “Peak Punch Arc” (use max for boxing, mean for others when swings exist).

Do not cross-compare sports.

---

## 5. Expression aggregation

**Class:** Presage-measured; session aggregate is derived.

**Intended** — `src/wellness/expressions.ts` `ExpressionAggregator`: time-weighted probability sums; missing face ≠ Neutral; coverage = valid/total; dominant if coverage ≥ 0.15.

**Gap:** aggregator **only used in tests**. UI used **last live** `dominantExpression` → “Mostly Contempt” + explanatory copy.

**SDK name mismatch:** vitals use `happy` / `angry`; aggregator keys use `happiness` / `anger`.

---

## 6. Presage acceptance thresholds

**Class:** Presage-measured gates.

`src/wellness/physiology.ts` `metricUsable`:  
- value in range (pulse 40–110, breathing 5–40)  
- `stable`  
- `confidence ≥ 40`  
- age ≤ 5000 ms  
- validation not in invalid set (NoFaceFound, ExcessiveMotion, TooDark, …)

`server/vitals.ts`: baseline = median of first **2** usable pulses; breathing also needs confidence ≥ 45; HRV gate confidence ≥ 50 if present.

**Requested metrics (product):**  
CORE `[0, 2, 15]` chest breathing, breathing rate, pulse  
FACE `[11–14]` landmarks, blink, talk, expressions  
On ProcessingFailed(8) with face → restart CORE-only.  
**Not requested:** arterial pressure (16), HRV (17) — historically fail unprovisioned keys.

Official SDK docs (`breathingMetrics` + `cardioMetrics`) include HRV and arterial-pressure **trace** (relative waveform, not BP). Treat as subscription-gated; only surface if present.

---

## 7. Body weight

Stored `GameSettings.weightKg` / `weightUnit` in `localStorage` (`src/agent/sliders.ts`).  
Settings UI **cycled** 70 → +5 → … → 120 → null (`SettingsScene`).

---

## 8. Historical calorie recalculation (target behavior)

If epochs are stored and the user later sets body weight:  
**recompute displayed energy** via `summarize(sport, epochs, roms, currentWeightKg)`.  
Do not mutate raw epochs. Session-row `weight_kg` may remain 0/null for provenance; UI uses current settings weight for estimates when epochs exist.

Document on Health footer: estimates use current body weight when recomputed.

---

## Second-pass repair notes (implemented)

- Consumer Performance % removed; sport result lines kept; internal performance retained for adaptation.
- Activity Load → Movement Intensity (LOW/MODERATE/HIGH + bar).
- ROM restored on summary + Health (sport-labeled); same-sport ROM trend when ≥2 sessions.
- Energy formatting + historical recompute via `GET /health/summary?weightKg=`.
- Body weight: DOM numeric editor (kg/lb), no cycling.
- Presage: DISPLAYABLE vs TRUSTED (`presageQuality.ts`); live HUD can show ESTIMATING.
- Expressions: wired aggregator, SDK name normalize, mixed vs dominant, no “camera-derived” copy.
- HRV / arterial pressure still **not requested** (subscription / ProcessingFailed risk); parsed if present.
- Head-motion boost: boxing-only capped addend on MotionLoad when `epoch.headMotion` set.
