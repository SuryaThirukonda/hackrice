# Controller Action Controls — Sep 12 Update

## What changed

Replaced the broken VOL+/VOL− styled controls with two plain boxing buttons:

1. **Block** — tap to start blocking, tap again to stop.
2. **Emergency Power (+10%)** — arms a one-shot boost for the next punch.

Physical phone volume buttons are still unused. Safari does not expose them to
web pages.

## Emergency Power behavior

- Tap once to arm the boost.
- The next detected boxing punch score is multiplied by `1.10`, rounded, and
  capped at `100`.
- Direction / axis labels are unchanged by the boost.
- After that punch is scored, the boost clears automatically.
- Gesture packets include `emergencyBoostApplied: true` when the boost was used.
- Godot still receives an `emergency_power` action when the button is armed.

## Why the old buttons failed

- They relied on press-and-hold pointer capture (`VOL +`) that was unreliable
  on phones.
- Both buttons were disabled until the WebSocket was connected, so taps did
  nothing in the common “motion on, game not connected yet” state.
- Emergency Power only sent a Godot signal and never changed the scored power.

## Files

- `web/src/controller/actions.ts` — `applyEmergencyPower()`
- `web/src/controller/Controller.tsx` — simple Block / Emergency Power buttons
- `web/src/controller/ControllerSocket.ts` — forwards `emergencyBoostApplied`
- `web/src/controller/controller.css` — simple button styles
- `web/src/controller/actions.test.ts` — +10% boost coverage

## How to try it

1. Open boxing on the phone controller.
2. Tap **Emergency Power (+10%)** so it shows armed.
3. Throw a punch; the shown score should be about 10% higher than the raw hit.
4. Tap **Block** to toggle block state independently of punching.
