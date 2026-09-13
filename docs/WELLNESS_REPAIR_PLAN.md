# Wellness Repair Plan

**Date:** 2026-09-13  
**Canonical repo:** `/Users/gaurav/Desktop/HackRice2026/hackrice` on branch `gauravbranch`  
**Remote:** `https://github.com/SuryaThirukonda/hackrice.git`  
**Baseline:** 250 tests · typecheck pass · production build pass  

Untracked duplicates (`version2/`, `web/`, `backend/`, `* 2.*`) are obsolete and out of scope.

---

## Current consumer flow (broken experience)

```
Main Menu
  → TEMPO SESSION (pick intent + 5/10/15 — duration is mostly cosmetic)
  → TEMPO CHECK-IN (drawn silhouette, no live camera)
       ENABLE CAMERA → POST /vitals/start (Node opens hidden camera)
       or START NOW  → skip physiology
  → Sport (phone optional; must have been connected separately)
  → Recovery (optional Presage)
  → Summary → Menu
  → WELLNESS page (separate; overloaded cards)
```

Phone connect and `/vitals.html` sit **outside** this loop. The player cannot see whether the camera works.

---

## KEEP (useful infrastructure)

| Piece | Why |
|-------|-----|
| `HealthStore` + `data/health.sqlite` | Local sessions/epochs/swings/vitals/adaptation |
| Phone → 1s epochs → relay → `HealthTracker` | Strongest activity signal Tempo has |
| `MotionLoad` + MET energy estimate | Sound phone-primary calorie path |
| Optional body weight in Settings | Needed for kcal; absence → no fake kcal |
| `VitalsBridge` + `PRESAGE_MODE` | Live / mock / off; never blocks play |
| Validation code mapping + guidance | Positioning feedback exists server-side |
| Deterministic `AdaptationEngine` | Bounded, no LLM in the loop |
| Join/QR/`ControllerRelay` | Reuse for Ready-Up; do not reinvent |
| `/vitals.html` as **dev lab only** | Already not linked from Phaser menus |
| Skip-camera path | Correct product rule |

---

## SIMPLIFY

| Today | Target consumer model |
|-------|------------------------|
| Intent × duration × planner × multi-segment recovery | Sport select → Ready-Up → Play → Summary |
| PlayerState seven scalars in product story | Internal only |
| Engagement / consistency / exertion / physiologyConfidence in UI | Diagnostics only |
| Dual “active minutes” definitions | One: **ACTIVE TIME** = moving seconds (`activeSeconds`) |
| Recovery as mandatory gate | Optional body-response section |
| Adaptation using many inputs | Performance + movement (+ optional recovery ±2%) |
| Silhouette “check-in” | Live preview + validation on Ready-Up |

**Consumer vocabulary:** MOVEMENT · ENERGY · PULSE/BREATHING · RECOVERY · EXPRESSIONS · PERFORMANCE · TEMPO RESPONSE

---

## REMOVE FROM CONSUMER UI

- Any instruction to open `/vitals.html`
- Drawn person silhouette as camera stand-in
- Second Tempo consent checkbox (lab-style) in the product path
- Goal/intent/duration planner as the first Tempo screen (keep planner as optional/advanced later)
- Fake zeros for missing recovery / expressions
- Raw validation codes, MET values, confidence floats on consumer screens
- Hidden demo key **D** without a labeled MOCK SENSOR badge

---

## FIX

### Active-minute / daily goal (must-fix)

**Root causes (confirmed):**

1. **Display truncates progress:** home card uses `Math.floor(activeSeconds/60)`, so 90s → `1 / 30` instead of `1.5 / 30`.
2. **Health dashboard never shows the daily goal** — only a weekly bar chart; home and Wellness tell different stories.
3. **Parallel metric confusion:** `sessions.active_minutes` uses the ≥20 moving-seconds / clock-minute rule and is **never** aggregated into `/health/summary` day totals; UI invents minutes as `activeSeconds/60`. Product repair adopts **ACTIVE TIME = activeSeconds** (per acceptance: 90s → `1:30` and `1.5 / 30 MIN`).
4. **Trailing phone epochs can be dropped** between matches: phone reports every 5s; next `HealthTracker` constructor `drainActivity()` discards backlog.
5. **Week chart weekday labels** use `new Date('YYYY-MM-DD')` (UTC) → wrong day in US timezones.

**Fix plan:** aggregate and display `today.activeSeconds` consistently; show fractional goal progress; surface goal on Health; stop discarding cross-match epochs (or attribute them to the ending session); add regression tests for 90 active seconds → summary → UI math.

### Camera / consent

- Baseline silhouette → live browser preview
- One Enable Camera action (OS permission only once)
- Map Presage validation → human guidance (debounced)
- Stop requiring Node-hidden camera without preview
- Prefer browser `getUserMedia` → local `useCustomInput`/`sendFrame` if feasible; else Node camera + same-screen preview (document choice)

### Face analysis

- Request `faceMetrics` (landmarks, blink, talking, expressions)
- Aggregate session expression distribution; coverage %; no mental-health claims

### Baseline duration

- `BASELINE_READINGS = 12` over-interprets Presage’s ~12s pulse window
- Accept after usable stable pulse in supported range (~12–18s total under good conditions)

### UI overlap

- `healthBadge(30, 96)` collides with boxing KD stack / golf hole banner
- Need `SafeArea` + sport-declared occupied regions + `?layoutDebug=1`

### Tempo Session UX

- Phone QR must live on Ready-Up
- Camera optional; keyboard always allowed
- Session still completable when Presage off / bad key / permission denied

---

## ADD

1. **TEMPO READY-UP** scene (phone card + camera card + Start)
2. Live camera preview + framing guide + validation rows
3. Browser-owned frame pipeline (preferred) or documented Node+preview fallback
4. `FaceState` + expression aggregation + session summary / Health visuals
5. Compact **TEMPO SENSE** in-game HUD in a safe slot
6. `src/ui/SafeArea.ts` + layout debug overlay
7. Redesigned Session Summary + Health dashboard (comic style, real charts)
8. Regression tests for Ready-Up, camera lifecycle, active minutes, energy, expressions

---

## Camera architecture decision (to confirm in M3)

| Option | Pros | Cons |
|--------|------|------|
| **A. Browser MediaStream → preview + local `sendFrame`** | One permission; user sees exact frames; no hidden Node camera | Need bounded local WS/IPC; monotonic timestamps; drop-old queue |
| **B. Keep Node `useCamera` + browser preview** | Less rewrite of `VitalsBridge` | Two camera opens or no true “same frames”; worse UX |

**Preference:** Option A. Fallback to B only if custom-input path proves unstable on this SDK/OS after spike.

SDK 3.3.0 confirms: `useCustomInput()`, `sendFrame()`, `faceMetrics` `[11,12,13,14]`, `PixelFormat`, validation codes 0–17.

---

## Milestone order

| # | Milestone | Exit criteria |
|---|-----------|---------------|
| 1 | This plan | Document merged |
| 2 | Active-minute pipeline | Test: 90 active s → summary ≥90; UI 1:30 / 1.5·30; no epoch drop |
| 3 | Ready-Up + live preview + single consent | No `/vitals` in consumer path |
| 4 | Validation feedback | Debounced human states |
| 5 | Face analysis | Expressions in summary when coverage enough |
| 6 | Baseline simplify | ~12–18s under good conditions |
| 7 | Calorie simplify | Phone-primary; pulse not driving kcal |
| 8 | SafeArea + Tempo Sense | No overlap at listed resolutions |
| 9 | Tempo Session simplify | Sport → Ready-Up → Play |
| 10 | Session Summary redesign | Sections only when data exists |
| 11 | Health dashboard redesign | Charts + goal + expressions |
| 12 | Visual QA + real camera/phone | Manual checklist green |

After each milestone: `npm test` · `npm run typecheck` · `npm run build` · separate commit.

---

## Non-goals

- Changing boxing/bowling/golf physics or gesture thresholds
- New controller protocol
- Second SQLite database
- Storing video, landmarks dumps, or frames
- Medical/mental-health claims from expressions
- Growing PlayerState consumer surface
