import * as THREE from 'three';
import { Effects } from '../effects.js';
import { Player } from '../player.js';
import { Weapons } from '../weapons.js';
import { Projectile } from '../enemies.js';
import { RLArena, CombatEnv, OBS_DIM, N_ACTIONS } from './env.js';
import { DQN } from './dqn.js';

// ---- silent stand-ins for the game's audio/hud so shared code just works ----
function makeNullAudio() {
  const base = { combat: 0 };
  return new Proxy(base, {
    get(t, k) {
      if (k in t) return t[k];
      return () => {};
    },
    set(t, k, v) { t[k] = v; return true; },
  });
}

function makeNullHud() {
  const style = { add() {}, kill() {}, hurt() {}, varietyBonus() {}, update() {}, total: 0 };
  return {
    style,
    styleEvent() {}, message() {}, setObjective() {}, setWeapon() {},
    hitmarker() {}, damageFlash() {}, parryFlash() {}, bossBar() {}, update() {},
  };
}

// ---- world ----
const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
renderer.setPixelRatio(0.7);
renderer.setSize(window.innerWidth, window.innerHeight);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a0808);
scene.fog = new THREE.Fog(0x220806, 10, 60);
const camera = new THREE.PerspectiveCamera(95, window.innerWidth / window.innerHeight, 0.05, 200);
scene.add(camera);
window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
});

const G = {
  scene, camera, renderer,
  colliders: [], enemies: [], projectiles: [],
  state: 'playing', kills: 0, hitstop: 0, checkpoint: null,
  audio: makeNullAudio(),
  hud: makeNullHud(),
  spawnProjectile(pos, vel, opts) { G.projectiles.push(new Projectile(G, pos, vel, opts)); },
  onEnemyKilled() { G.kills++; },
  onPlayerDeath() {},
  onLevelComplete() {},
  respawn() {},
};
G.effects = new Effects(scene);
G.player = new Player(G);
G.weapons = new Weapons(G, camera);
G.level = new RLArena(G);
G.player.pos.set(0, 1.0, 8);

const env = new CombatEnv(G);
const agent = new DQN({ obsDim: OBS_DIM, nActions: N_ACTIONS });

// ---- training driver ----
const ui = {
  ep: document.getElementById('rl-ep'),
  ret: document.getElementById('rl-ret'),
  avg: document.getElementById('rl-avg'),
  eps: document.getElementById('rl-eps'),
  loss: document.getElementById('rl-loss'),
  kills: document.getElementById('rl-kills'),
  sps: document.getElementById('rl-sps'),
  mode: document.getElementById('rl-mode'),
  chart: document.getElementById('rl-chart'),
};
const chartCtx = ui.chart.getContext('2d');

const S = {
  mode: 'train',      // train | watch | pause
  episode: 0,
  returns: [],
  obs: null,
  stepsThisSec: 0,
  lastSecT: performance.now(),
  sps: 0,
  greedy: false,
};

function drawChart() {
  const w = ui.chart.width, h = ui.chart.height;
  chartCtx.clearRect(0, 0, w, h);
  chartCtx.fillStyle = '#111';
  chartCtx.fillRect(0, 0, w, h);
  const data = S.returns.slice(-200);
  if (data.length < 2) return;
  let mn = Math.min(...data), mx = Math.max(...data);
  if (mx - mn < 1e-6) mx = mn + 1;
  // raw returns
  chartCtx.strokeStyle = '#553333';
  chartCtx.beginPath();
  data.forEach((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - ((v - mn) / (mx - mn)) * (h - 6) - 3;
    i ? chartCtx.lineTo(x, y) : chartCtx.moveTo(x, y);
  });
  chartCtx.stroke();
  // moving average
  const ma = data.map((_, i) => {
    const s = data.slice(Math.max(0, i - 19), i + 1);
    return s.reduce((a, b) => a + b, 0) / s.length;
  });
  chartCtx.strokeStyle = '#ffd23e';
  chartCtx.lineWidth = 2;
  chartCtx.beginPath();
  ma.forEach((v, i) => {
    const x = (i / (ma.length - 1)) * w;
    const y = h - ((v - mn) / (mx - mn)) * (h - 6) - 3;
    i ? chartCtx.lineTo(x, y) : chartCtx.moveTo(x, y);
  });
  chartCtx.stroke();
  chartCtx.lineWidth = 1;
}

function refreshUi() {
  const last20 = S.returns.slice(-20);
  const avg = last20.length ? last20.reduce((a, b) => a + b, 0) / last20.length : 0;
  ui.ep.textContent = S.episode;
  ui.ret.textContent = env.episodeReturn.toFixed(1);
  ui.avg.textContent = avg.toFixed(2);
  ui.eps.textContent = agent.epsilon.toFixed(2);
  ui.loss.textContent = agent.lastLoss.toFixed(3);
  ui.kills.textContent = env.episodeKills;
  ui.sps.textContent = S.sps;
  ui.mode.textContent = S.mode.toUpperCase() + (S.greedy ? ' (greedy)' : '');
  drawChart();
}

function envStep() {
  if (!S.obs) S.obs = env.reset();
  const a = agent.act(S.obs, S.greedy);
  const { obs, reward, done } = env.step(a);
  if (S.mode === 'train') {
    agent.remember(S.obs, a, reward, obs, done);
    agent.trainStep();
  }
  S.obs = obs;
  S.stepsThisSec++;
  if (done) {
    S.returns.push(env.episodeReturn);
    S.episode++;
    S.obs = env.reset();
  }
}

// train: as many env steps per frame as fit in the budget; watch: real-time
function frame() {
  requestAnimationFrame(frame);
  const now = performance.now();
  if (now - S.lastSecT > 1000) {
    S.sps = S.stepsThisSec;
    S.stepsThisSec = 0;
    S.lastSecT = now;
    refreshUi();
  }
  if (S.mode === 'train') {
    const budget = now + 24; // ms per frame for stepping
    while (performance.now() < budget) envStep();
    // light visual: render every frame from a fixed observer corner
    camera.position.set(16, 14, 16);
    camera.lookAt(G.player.pos);
  } else if (S.mode === 'watch') {
    envStep();
    G.player.applyToCamera(camera, G.effects, now / 1000);
  }
  if (S.mode !== 'pause') renderer.render(scene, camera);
}
requestAnimationFrame(frame);

// ---- controls ----
document.getElementById('btn-train').onclick = () => { S.mode = 'train'; S.greedy = false; refreshUi(); };
document.getElementById('btn-watch').onclick = () => { S.mode = 'watch'; S.greedy = true; refreshUi(); };
document.getElementById('btn-pause').onclick = () => { S.mode = 'pause'; refreshUi(); };
document.getElementById('btn-save').onclick = () => {
  localStorage.setItem('ultraclaudekill-rl', agent.save());
  ui.mode.textContent = 'SAVED';
};
document.getElementById('btn-export').onclick = () => {
  const blob = new Blob([agent.save()], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'rl-weights.json';
  a.click();
};
document.getElementById('btn-load').onclick = async () => {
  const saved = localStorage.getItem('ultraclaudekill-rl');
  if (saved) { agent.load(saved); ui.mode.textContent = 'LOADED (local)'; return; }
  try {
    const res = await fetch('../assets/rl-weights.json');
    if (res.ok) { agent.load(await res.json()); ui.mode.textContent = 'LOADED (pretrained)'; }
    else ui.mode.textContent = 'NO WEIGHTS FOUND';
  } catch { ui.mode.textContent = 'NO WEIGHTS FOUND'; }
};

// autoload pretrained weights in watch mode via ?mode=play
if (new URLSearchParams(location.search).get('mode') === 'play') {
  (async () => {
    try {
      const res = await fetch('../assets/rl-weights.json');
      if (res.ok) agent.load(await res.json());
    } catch { /* train from scratch */ }
    S.mode = 'watch';
    S.greedy = true;
  })();
}

window.RL = { G, env, agent, S };
