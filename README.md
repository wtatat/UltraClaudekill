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
| Space | Jump |
| Shift | Dash (3 stamina bars, regenerating) |
| Ctrl (ground) | Slide — keeps speed, slide-jump for a boost |
| Ctrl (air) | Ground slam — damages everything around the impact |
| LMB | Fire |
| RMB (revolver) | Hold to charge a piercing shot (3s cooldown) |
| 1 / 2 / Q | Switch weapons |
| R | Restart after death / victory |

## Mechanics

- **Blood is fuel** — damaging an enemy within ~5 m heals you for half the
  damage dealt. Stay aggressive to stay alive.
- **Style meter** — kills, aerial finishes, point-blank shots, slams,
  multi-kills and weapon swapping raise your rank from **D — DRAB** up to
  **U — ULTRACLAUDEKILL**. It decays when you play passively and drops when
  you take hits.
- **Dashing grants brief invulnerability.** Lava does not care about your
  mercy window.
- The level: start elevator → burning corridor → three combat chambers →
  a pit with **one secret** (+25 max HP) → wave arena guarded by the
  **WARDEN** → exit elevator with your final rank tally.

## Tech

- [Three.js](https://threejs.org/) (vendored in `vendor/`, MIT license)
- Custom AABB physics: axis-separated move-and-slide, slab-method raycasts
- Procedural pixel-art textures via `CanvasTexture` + `NearestFilter`
- Synthesized SFX and an intensity-driven combat music loop (WebAudio)
- No build step, no dependencies to install — plain ES modules
