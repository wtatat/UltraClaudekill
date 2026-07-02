# ULTRACLAUDEKILL — 0-1 // INTO THE FIRE

A fully playable, ULTRAKILL-inspired first level that runs in the browser.
Fast movement, style meter, blood-fuelled healing, three enemy types, a
mid-boss and a wave arena — built with Three.js and zero external assets.

Everything you see and hear is generated in code: level textures are drawn
onto canvases at runtime, enemy and weapon models are assembled from
primitives, and every sound effect plus the combat music is synthesized
with the WebAudio API. No assets from the original game are used — this is
an original fan homage, not a copy. (ULTRAKILL is by Arsi "Hakita" Patala /
New Blood Interactive — go buy it, it's great.)

## Run it

Any static file server works (ES modules require http://, not file://):

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

## Controls

| Input | Action |
|---|---|
| WASD | Move |
| Mouse | Look |
| Space | Jump (buffered — pressing just before landing works); near a wall in the air — wall jump (up to 3 per airtime) |
| Shift | Dash — costs 1 of 3 stamina bars, regen 0.7/s (pauses while sliding) |
| Ctrl or C (ground) | Slide — keeps speed, slide-jump for a boost |
| Ctrl or C (air) | Ground slam — keeps accelerating the longer it falls; keep holding to come out sliding (faster after a long fall) |
| LMB | Fire |
| RMB (revolver) | Hold to charge a piercing shot (3s cooldown) |
| F | Punch. Reflects projectiles at your crosshair; parries yellow-flashing attacks |
| 1 / 2 / Q | Switch weapons |
| R | Restart after death / victory |

## Mechanics

- **Blood is fuel** — damaging an enemy within ~5 m heals you for half the
  damage dealt. Stay aggressive to stay alive.
- **Style meter** — kills, aerial finishes, point-blank shots, slams,
  multi-kills and weapon swapping raise your rank from **D — DRAB** up to
  **U — ULTRACLAUDEKILL**. It decays when you play passively and drops when
  you take hits.
- **Parry** — punching an enemy orb reflects it towards your crosshair
  with boosted damage (orbs stay parryable for a split second even after
  touching you). A successful parry fully restores stamina, heals, and
  pays out big style. Spamming punches raises the punch cooldown.
- **Dashing grants brief invulnerability.** Hazards do not care about
  your mercy window.
- **Slam jump** — jump right after a slam lands to launch much higher,
  scaling with how far you fell. Wall-jumping mid-slam converts the fall
  into a bigger burst (slam storage).
- **Wall cling** — hold a direction into a wall while falling to slow
  your descent with friction; the grip wears off the longer you hang on.
- **Enemies** (behavior researched from the original):
  - *Filth* — armless rusher, faster than your walk speed, jumping bite.
    The bite can't be parried, but **any damage cancels it**. One revolver
    shot kills.
  - *Stray* — keeps medium distance, backs off when you close in, charges
    a glowing orb before each throw. **Shoot the orb mid-charge to
    detonate the Stray.** The thrown orb is parryable.
  - *Malicious Face* — floating stone head boss. Alternates a 10-orb
    barrage (parryable) with a telegraphed beam (dodge it — dash). Below
    half health it enrages and fires double beams.
- **The level** follows the original 0-1 room sequence: drop shaft →
  "KEEP OUT" planks (punch through) → jammed doors (slide the gap) →
  collapsed walkway (dash across) → the dark **Revolver Room** (lights
  snap on when you take the gun; then the Filth come) → three **Glass
  Rooms** with a checkpoint → the **Grinder Walkway** (glass over
  grinders; drop 5 enemies in for the challenge) → the **Turbine
  Chamber** → the boss and the exit elevator. **5 secrets** (+10 max HP
  each). Checkpoints respawn you on death.

## RL Lab — an agent that learns to play

Open `rl.html` for a built-in reinforcement-learning sandbox: a DQN agent
(hand-written MLP + Adam + replay buffer + target network, zero
dependencies) learns combat in a dedicated arena against waves of Filth
and a Stray.

- **Observations (49 floats)**: own hp/stamina/velocity, the 4 nearest
  enemies in egocentric coordinates with attack-telegraph flags, the 2
  nearest hostile orbs with velocities.
- **Actions (10)**: 6 movement directions, jump, dash, idle, and fire
  (aiming is automatic at the nearest enemy — the net learns spacing,
  dodging and trigger discipline, not mouse math).
- **Reward**: damage dealt and kills pay, damage taken and time cost,
  dying is a big penalty, clearing all 3 waves a big bonus.
- **TRAIN** runs the simulation headless-fast (hundreds of env steps/s)
  with a live learning curve; **WATCH** plays the greedy policy in first
  person at real time. `rl.html?mode=play` auto-loads the bundled
  pretrained weights (`assets/rl-weights.json`).

The bundled net was trained for ~800 episodes: it clears all three waves
with a perfect 13/13 kills in 12/12 greedy evaluation episodes (a random
policy mostly dies with 2–10 kills).

## Tech

- [Three.js](https://threejs.org/) (vendored in `vendor/`, MIT license)
- Custom AABB physics: axis-separated move-and-slide, slab-method raycasts
- Procedural pixel-art textures via `CanvasTexture` + `NearestFilter`
- Synthesized SFX and an intensity-driven combat music loop (WebAudio)
- No build step, no dependencies to install — plain ES modules
