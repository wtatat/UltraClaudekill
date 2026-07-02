import * as THREE from 'three';
import { aabb } from '../utils.js';
import { Filth, Stray, separateEnemies } from '../enemies.js';

// Gym-style combat environment: a closed arena, waves of Filth + a Stray.
// The agent controls movement/jump/dash/fire at a fixed 10Hz (3 physics
// steps of 1/30s per action). Aiming is automatic at the nearest enemy so
// the net learns spacing, dodging and trigger discipline, not mouse math.

export const N_ACTIONS = 10;
// 0 idle | 1 fwd | 2 back | 3 left | 4 right | 5 fwd-left | 6 fwd-right
// 7 jump | 8 dash (toward current move dir / forward) | 9 fire
const MOVES = [
  null, [0, -1], [0, 1], [-1, 0], [1, 0], [-0.7, -0.7], [0.7, -0.7],
  null, null, null,
];

const DT = 1 / 30;
const REPEAT = 3;
const MAX_ENEMIES_OBS = 4;
const MAX_PROJ_OBS = 2;
export const OBS_DIM = 9 + MAX_ENEMIES_OBS * 7 + MAX_PROJ_OBS * 6; // 49

// Input stub the Player/Weapons understand.
class BotInput {
  constructor() { this.reset(); this.sensitivity = 0; }
  reset() {
    this._down = new Set();
    this._pressed = new Set();
    this.mouse0 = false;
    this.mouse2 = false;
    this.clicked0 = false;
    this.locked = true;
  }
  down(code) { return this._down.has(code); }
  justPressed(code) { return this._pressed.has(code); }
  consumeMouse() { return [0, 0]; }
  endFrame() { this._pressed.clear(); this.clicked0 = false; }
}

// The arena: one enclosed room with a couple of pillars.
export class RLArena {
  constructor(G) {
    this.G = G;
    this.mats = {
      floor: new THREE.MeshStandardMaterial({ color: 0x3a3234, roughness: 1 }),
      brick: new THREE.MeshStandardMaterial({ color: 0x4a3430, roughness: 1 }),
      dark: new THREE.MeshStandardMaterial({ color: 0x17141a, roughness: 1 }),
    };
    this._build();
  }
  box(cx, cy, cz, w, h, d, mat) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), this.mats[mat]);
    mesh.position.set(cx, cy, cz);
    this.G.scene.add(mesh);
    this.G.colliders.push(aabb(cx, cy, cz, w, h, d));
  }
  _build() {
    const S = 26; // arena size
    this.box(0, -0.5, 0, S, 1, S, 'floor');
    this.box(0, 8.5, 0, S, 1, S, 'dark');
    this.box(-S / 2 - 0.5, 4, 0, 1, 8, S, 'brick');
    this.box(S / 2 + 0.5, 4, 0, 1, 8, S, 'brick');
    this.box(0, 4, -S / 2 - 0.5, S, 8, 1, 'brick');
    this.box(0, 4, S / 2 + 0.5, S, 8, 1, 'brick');
    this.box(-6, 1.5, -6, 2, 3, 2, 'brick');
    this.box(6, 1.5, 6, 2, 3, 2, 'brick');
    this.G.scene.add(new THREE.AmbientLight(0x887766, 1.6));
    this.G.scene.add(new THREE.HemisphereLight(0xaa6644, 0x221111, 0.8));
  }
  // Level-interface stubs used by shared systems
  breakHit() {}
  punchBreakables() { return false; }
  breakGlassUnder() { return false; }
  checkHazards() {}
  onEnemyKilled() {}
  update() {}
}

export class CombatEnv {
  constructor(G) {
    this.G = G;
    this.input = new BotInput();
    this.stepCount = 0;
    this.wave = 0;
    this.maxWaves = 3;
    this.maxSteps = 500; // control steps: ~2.5 min of sim
    this.episodeReturn = 0;
    this.episodeKills = 0;
  }

  reset() {
    const G = this.G;
    // clear world
    for (const e of G.enemies) if (!e.dead) { G.scene.remove(e.mesh); }
    G.enemies.length = 0;
    for (const p of G.projectiles) if (!p.dead) G.scene.remove(p.mesh);
    G.projectiles.length = 0;
    G.kills = 0;
    const P = G.player;
    P.dead = false;
    P.hp = P.maxHp = 100;
    P.stamina = 3;
    P.vel.set(0, 0, 0);
    P.pos.set(0, 1.0, 8);
    P.yaw = 0; P.pitch = 0;
    if (P.sliding) { P.he.y = P.heStand; P.sliding = false; }
    P.slamming = false;
    P.dashT = 0;
    G.weapons.hasRevolver = true;
    G.weapons.switchTo('revolver');
    G.weapons.cooldown = 0;
    this.stepCount = 0;
    this.wave = 0;
    this.episodeReturn = 0;
    this.episodeKills = 0;
    this._prevKills = 0;
    this._spawnWave();
    return this.observe();
  }

  _spawnWave() {
    this.wave++;
    const G = this.G;
    const spots = [[-9, -8], [9, -8], [0, -10], [-10, 2], [10, 2]];
    const nFilth = Math.min(2 + this.wave, 4);
    for (let i = 0; i < nFilth; i++) {
      const [x, z] = spots[i % spots.length];
      G.enemies.push(new Filth(G, new THREE.Vector3(x + Math.random(), 1, z + Math.random())));
    }
    if (this.wave >= 2) {
      G.enemies.push(new Stray(G, new THREE.Vector3(0, 1, -11)));
    }
  }

  _applyAction(a) {
    const G = this.G, P = G.player, inp = this.input;
    inp._down.clear();
    inp._pressed.clear();
    inp.mouse0 = false;
    const mv = MOVES[a];
    if (mv) {
      // egocentric move mapped onto WASD relative to facing
      if (mv[1] < 0) inp._down.add('KeyW');
      if (mv[1] > 0) inp._down.add('KeyS');
      if (mv[0] < 0) inp._down.add('KeyA');
      if (mv[0] > 0) inp._down.add('KeyD');
    }
    if (a === 7) { inp._down.add('Space'); inp._pressed.add('Space'); }
    if (a === 8) { inp._down.add('ShiftLeft'); inp._pressed.add('ShiftLeft'); inp._down.add('KeyW'); }
    if (a === 9) {
      // auto-aim at the nearest live enemy with a touch of noise
      const e = this._nearestEnemy();
      if (e) {
        const d = e.pos.clone().add(new THREE.Vector3(0, 0.2, 0)).sub(P.eyePos);
        const len = d.length();
        P.yaw = Math.atan2(-d.x, -d.z) + (Math.random() - 0.5) * 0.02;
        P.pitch = Math.asin(Math.max(-1, Math.min(1, d.y / len)));
        inp.mouse0 = true;
      }
    } else if (a !== 0) {
      // face the nearest enemy while maneuvering (turns "fwd" into approach)
      const e = this._nearestEnemy();
      if (e) P.yaw = Math.atan2(-(e.pos.x - P.pos.x), -(e.pos.z - P.pos.z));
    }
  }

  _nearestEnemy() {
    let best = null, bd = 1e9;
    for (const e of this.G.enemies) {
      if (e.dead) continue;
      const d = e.pos.distanceTo(this.G.player.pos);
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }

  _totalEnemyHp() {
    let s = 0;
    for (const e of this.G.enemies) if (!e.dead) s += Math.max(0, e.hp);
    return s;
  }

  step(action) {
    const G = this.G, P = G.player;
    const hpBefore = P.hp;
    const ehpBefore = this._totalEnemyHp();
    const killsBefore = G.kills;

    this._applyAction(action);
    for (let k = 0; k < REPEAT; k++) {
      P.update(DT, this.input);
      G.weapons.update(DT, this.input);
      for (const e of G.enemies) e.update(DT);
      separateEnemies(G, DT);
      for (let i = G.projectiles.length - 1; i >= 0; i--) {
        G.projectiles[i].update(DT);
        if (G.projectiles[i].dead) G.projectiles.splice(i, 1);
      }
      G.effects.update(DT);
      this.input.endFrame();
      if (P.dead) break;
    }

    // wave / episode bookkeeping
    let done = false, win = false;
    if (!P.dead && G.enemies.every(e => e.dead)) {
      if (this.wave >= this.maxWaves) { done = true; win = true; }
      else this._spawnWave();
    }
    this.stepCount++;
    if (this.stepCount >= this.maxSteps) done = true;
    if (P.dead) done = true;

    // reward: aggression pays, damage hurts, time costs a little
    const dealt = Math.max(0, ehpBefore - this._totalEnemyHp());
    const taken = Math.max(0, hpBefore - P.hp);
    const kills = G.kills - killsBefore;
    this.episodeKills += kills;
    let r = 0.015 * dealt + 1.2 * kills - 0.03 * taken - 0.004;
    if (P.dead) r -= 4;
    if (win) r += 5;
    this.episodeReturn += r;

    return { obs: this.observe(), reward: r, done, win };
  }

  observe() {
    const G = this.G, P = G.player;
    const o = new Float32Array(OBS_DIM);
    let i = 0;
    // self
    o[i++] = P.hp / 100;
    o[i++] = P.stamina / 3;
    o[i++] = P.onGround ? 1 : 0;
    o[i++] = P.vel.x / 20;
    o[i++] = P.vel.y / 20;
    o[i++] = P.vel.z / 20;
    o[i++] = Math.min(1, P.pos.y / 8);
    o[i++] = G.weapons.cooldown > 0 ? 1 : 0;
    o[i++] = Math.min(1, G.enemies.filter(e => !e.dead).length / 5);
    // nearest enemies, egocentric (rotated into the player's yaw frame)
    const cos = Math.cos(P.yaw), sin = Math.sin(P.yaw);
    const alive = G.enemies.filter(e => !e.dead)
      .sort((a, b) => a.pos.distanceTo(P.pos) - b.pos.distanceTo(P.pos))
      .slice(0, MAX_ENEMIES_OBS);
    for (let k = 0; k < MAX_ENEMIES_OBS; k++) {
      const e = alive[k];
      if (!e) { i += 7; continue; }
      const dx = e.pos.x - P.pos.x, dy = e.pos.y - P.pos.y, dz = e.pos.z - P.pos.z;
      const rx = dx * cos - dz * sin;   // right
      const rz = dx * sin + dz * cos;   // forward(-)
      const dist = Math.hypot(dx, dy, dz);
      o[i++] = rx / 20;
      o[i++] = dy / 8;
      o[i++] = rz / 20;
      o[i++] = Math.min(1, dist / 30);
      o[i++] = e.name === 'FILTH' ? 1 : 0;
      o[i++] = e.name === 'STRAY' ? 1 : 0;
      o[i++] = (e.windup > 0 || e.chargeT > 0) ? 1 : 0; // attack telegraph
    }
    // nearest hostile projectiles
    const projs = G.projectiles.filter(p => !p.dead && !p.friendly)
      .sort((a, b) => a.pos.distanceTo(P.pos) - b.pos.distanceTo(P.pos))
      .slice(0, MAX_PROJ_OBS);
    for (let k = 0; k < MAX_PROJ_OBS; k++) {
      const p = projs[k];
      if (!p) { i += 6; continue; }
      const dx = p.pos.x - P.pos.x, dy = p.pos.y - P.pos.y, dz = p.pos.z - P.pos.z;
      o[i++] = (dx * cos - dz * sin) / 15;
      o[i++] = dy / 8;
      o[i++] = (dx * sin + dz * cos) / 15;
      o[i++] = p.vel.x / 25;
      o[i++] = p.vel.y / 25;
      o[i++] = p.vel.z / 25;
    }
    return o;
  }
}
