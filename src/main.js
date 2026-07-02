import * as THREE from 'three';
import { Input } from './input.js';
import { AudioSys } from './audio.js';
import { Effects } from './effects.js';
import { Player } from './player.js';
import { Weapons } from './weapons.js';
import { Level } from './level.js';
import { Hud, RANKS } from './hud.js';
import { Projectile } from './enemies.js';

const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1) * 0.7); // chunky retro pixels
renderer.setSize(window.innerWidth, window.innerHeight);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a0505);
scene.fog = new THREE.Fog(0x220604, 8, 70);

const camera = new THREE.PerspectiveCamera(95, window.innerWidth / window.innerHeight, 0.05, 400);
scene.add(camera);

window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
});

// ---- game context ----
const G = {
  scene, camera, renderer,
  colliders: [],
  enemies: [],
  projectiles: [],
  state: 'menu', // menu | playing | dead | win
  kills: 0,
  startTime: 0,
  spawnProjectile(pos, vel, opts) {
    G.projectiles.push(new Projectile(G, pos, vel, opts));
  },
  onEnemyKilled(e) {
    G.kills++;
    G.level.onEnemyKilled(e);
  },
  onPlayerDeath() {
    G.state = 'dead';
    G.audio.combat = 0;
    document.getElementById('death-screen').style.display = 'flex';
    document.exitPointerLock();
  },
  onLevelComplete() {
    if (G.state !== 'playing') return;
    G.state = 'win';
    G.audio.combat = 0;
    G.audio.checkpoint();
    const time = (performance.now() / 1000) - G.startTime;
    const mm = Math.floor(time / 60), ss = Math.floor(time % 60).toString().padStart(2, '0');
    const style = Math.round(G.hud.style.total);
    // final rank from total style, with time bonus
    let rankIdx = 0;
    const thresholds = [0, 400, 800, 1300, 1900, 2600, 3400, 4300];
    for (let i = 0; i < thresholds.length; i++) if (style >= thresholds[i]) rankIdx = i;
    if (time < 180 && rankIdx < RANKS.length - 1) rankIdx++;
    const r = RANKS[rankIdx];
    document.getElementById('win-time').textContent = `${mm}:${ss}`;
    document.getElementById('win-kills').textContent = G.kills;
    document.getElementById('win-style').textContent = style;
    document.getElementById('win-secrets').textContent = `${G.level.secretsFound} / ${G.level.secretsTotal}`;
    const wr = document.getElementById('win-rank');
    wr.textContent = r.letter;
    wr.style.color = r.color;
    wr.style.textShadow = `0 0 30px ${r.color}`;
    document.getElementById('win-rank-name').textContent = r.name;
    document.getElementById('win-rank-name').style.color = r.color;
    document.getElementById('win-screen').style.display = 'flex';
    document.exitPointerLock();
  },
};

G.input = new Input(canvas);
G.audio = new AudioSys();
G.effects = new Effects(scene);
G.player = new Player(G);
G.hud = new Hud(G);
G.weapons = new Weapons(G, camera);
G.level = new Level(G);
G.hud.setWeapon('revolver');
G.hud.setObjective('MOVE OUT');

// spawn point: inside the start elevator, facing the door (-z)
G.player.pos.set(0, 1.2, 1.5);
G.player.yaw = 0;

// ---- state / overlay wiring ----
const menu = document.getElementById('menu');
menu.addEventListener('click', () => {
  G.audio.init();
  G.audio.resume();
  G.input.requestLock();
});
document.getElementById('death-screen').addEventListener('click', () => location.reload());
window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyR' && (G.state === 'dead' || G.state === 'win')) location.reload();
});
document.getElementById('win-screen').addEventListener('click', () => location.reload());

document.addEventListener('pointerlockchange', () => {
  const locked = document.pointerLockElement === canvas;
  if (locked && G.state === 'menu') {
    G.state = 'playing';
    G.startTime = performance.now() / 1000;
    menu.style.display = 'none';
    G.hud.message('0-1  //  INTO THE FIRE', 3200);
  } else if (locked && G.state === 'playing') {
    document.getElementById('pause-hint').style.display = 'none';
  } else if (!locked && G.state === 'playing') {
    document.getElementById('pause-hint').style.display = 'flex';
  }
});
document.getElementById('pause-hint').addEventListener('click', () => {
  G.audio.resume();
  G.input.requestLock();
});

// ---- main loop ----
let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  let dt = Math.min((now - last) / 1000, 1 / 25);
  last = now;
  const t = now / 1000;

  if (G.state === 'playing' && G.input.locked) {
    G.player.update(dt, G.input);
    G.weapons.update(dt, G.input);
    for (const e of G.enemies) e.update(dt);
    for (let i = G.projectiles.length - 1; i >= 0; i--) {
      const p = G.projectiles[i];
      p.update(dt);
      if (p.dead) G.projectiles.splice(i, 1);
    }
    G.level.update(dt, t);
    G.level.checkHazards(dt);
    G.hud.update(dt);
  }
  G.effects.update(dt);
  G.player.applyToCamera(camera, G.effects, t);
  G.input.endFrame();
  renderer.render(scene, camera);
}
requestAnimationFrame(frame);

// expose for debugging in devtools
window.G = G;
