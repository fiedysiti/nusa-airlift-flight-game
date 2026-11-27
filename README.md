# Nusa Airlift

[![make.fun · best-flight-game-20261126-0057](https://make.fun/badge/best-flight-game-20261126-0057.svg)](https://make.fun/bounty/best-flight-game-20261126-0057?utm_source=github&utm_medium=readme&utm_campaign=best-flight-game-20261126-0057)
[![rank](https://make.fun/badge/best-flight-game-20261126-0057/fiedysiti/nusa-airlift-flight-game/rank.svg)](https://make.fun/bounty/best-flight-game-20261126-0057/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=best-flight-game-20261126-0057)
[![reward](https://make.fun/badge/best-flight-game-20261126-0057/fiedysiti/nusa-airlift-flight-game/reward.svg)](https://make.fun/bounty/best-flight-game-20261126-0057?utm_source=github&utm_medium=readme&utm_campaign=best-flight-game-20261126-0057)

**Nusa Airlift** is a complete original 3D flight game: you are a courier pilot
hopping cargo between island airstrips in an Indonesian archipelago. Fly
through 8 rings, manage fuel, and land on the runway with PAPI guidance —
twice, once at each island, with landing grades for how soft you touch down.

Built for the [make.fun best-flight-game competition](https://make.fun/bounty/best-flight-game-20261126-0057)
(referral code: `3debkpg7`).

## The game

- **3D world** (three.js, vendored under `game/vendor/`): two seeded islands
  with terrain, sea, clouds, runways with PAPI lights and windsocks.
- **Flight model**: lift scales with speed squared, real stall behaviour,
  chase and cockpit views, glass-cockpit HUD (altitude, speed, heading,
  attitude indicator).
- **Missions**: 8 rings plus 2 cargo legs (NUSA → KARANG → NUSA), fuel and
  landing-grade decisions, synthesized WebAudio engine and wind sound
  (verified non-silent by `tools/audio-test.mjs`; M or the SUARA button mutes).
- **Cockpit**: chase and cockpit views — the cockpit view now has a real 3D
  panel with live speed / altitude / heading dials, plus the glass-cockpit
  HUD (altitude, speed, heading, attitude indicator).
- **Landing grades**: transparent and repeatable — every landing is scored
  0–500 from three published 0–5 components (Lembut / Tengah / Kecepatan:
  sink rate, centreline offset, touchdown speed) and the breakdown is shown
  on screen with the grade.
- **Controls**: keyboard to fly — throttle, pitch and roll — and land on the
  runway. No network needed; the game runs fully offline.

## How to run

```sh
node serve.ts            # serves game/ on http://127.0.0.1:8080
```

Or open `game/index.html` directly in desktop Chrome.

## Hand-in

`main.ts` (Node 22, standard library only) copies the game and its
screenshots to the output directory and writes the dossier the judge reads:

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
```

Running it twice produces byte-identical output.

## Layout

- `game/` — the game itself (`index.html`, `src/`, `vendor/three.module.min.js`)
- `game/src/` — one file per job: rng, terrain, aircraft, flight, missions,
  audio, input, hud, clouds, cockpit, shots, main
- `screenshots/` — 4 real renders of the game (cover, cockpit, ring, landing)
- `tools/` — development helpers (headless playtest, autopilot, shot capture,
  audio smoke test)
- `main.ts` — hand-in program, `serve.ts` — tiny local server
