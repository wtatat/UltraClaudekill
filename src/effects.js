import * as THREE from 'three';
import { randRange } from './utils.js';

// Particle + tracer + light pools. Nothing is added to or removed from the
// scene at runtime: a constant light count avoids shader recompiles, and
// reused meshes avoid GC churn.
const MAX_PARTICLES = 320;
const MAX_TRACERS = 24;
const POOL_LIGHTS = 6;

export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.shakeAmt = 0;
    this._cubeGeo = new THREE.BoxGeometry(1, 1, 1);
    this._mats = {
      blood: new THREE.MeshBasicMaterial({ color: 0x9e0d0d }),
      bloodDark: new THREE.MeshBasicMaterial({ color: 0x5c0505 }),
      spark: new THREE.MeshBasicMaterial({ color: 0xffd06a }),
      smoke: new THREE.MeshBasicMaterial({ color: 0x333333, transparent: true, opacity: 0.7 }),
      gib: new THREE.MeshBasicMaterial({ color: 0x7a1010 }),
      glass: new THREE.MeshBasicMaterial({ color: 0xbfe8f5, transparent: true, opacity: 0.7 }),
      gibWood: new THREE.MeshBasicMaterial({ color: 0x6b4a26 }),
    };

    // particle pool
    this.particles = [];
    for (let i = 0; i < MAX_PARTICLES; i++) {
      const mesh = new THREE.Mesh(this._cubeGeo, this._mats.blood);
      mesh.visible = false;
      scene.add(mesh);
      this.particles.push({ mesh, vel: new THREE.Vector3(), life: 0, gravity: 18 });
    }
    this._nextParticle = 0;

    // tracer pool (each owns its material so opacity fades independently)
    this.tracers = [];
    for (let i = 0; i < MAX_TRACERS; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xffe9a0, transparent: true, opacity: 0.9,
        blending: THREE.AdditiveBlending, depthWrite: false,
      });
      const mesh = new THREE.Mesh(this._cubeGeo, mat);
      mesh.visible = false;
      scene.add(mesh);
      this.tracers.push({ mesh, life: 0, maxLife: 0.09 });
    }
    this._nextTracer = 0;

    // dynamic light pool — lights stay in the scene forever
    this.lights = [];
    for (let i = 0; i < POOL_LIGHTS; i++) {
      const l = new THREE.PointLight(0xffb545, 0, 14, 1.8);
      scene.add(l);
      this.lights.push({ light: l, life: 0, maxLife: 0.06, base: 0 });
    }
    this._nextLight = 0;
  }

  spawn(pos, { count = 8, mat = 'blood', speed = 6, size = 0.12, life = 0.7, up = 3, gravity = 18 } = {}) {
    for (let i = 0; i < count; i++) {
      const p = this.particles[this._nextParticle];
      this._nextParticle = (this._nextParticle + 1) % MAX_PARTICLES;
      const m = p.mesh;
      m.material = this._mats[mat];
      m.visible = true;
      const s = size * randRange(0.5, 1.5);
      m.scale.setScalar(s);
      m.position.copy(pos);
      m.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
      p.vel.set(randRange(-1, 1), randRange(-0.3, 0.8), randRange(-1, 1))
        .normalize().multiplyScalar(speed * randRange(0.4, 1.2));
      p.vel.y += up * randRange(0.3, 1);
      p.life = life * randRange(0.6, 1.3);
      p.gravity = gravity;
    }
  }

  blood(pos, big = false) {
    this.spawn(pos, { count: big ? 20 : 9, mat: 'blood', speed: big ? 9 : 6, size: big ? 0.17 : 0.11 });
    this.spawn(pos, { count: big ? 7 : 3, mat: 'bloodDark', speed: 4, size: 0.14 });
  }

  gibs(pos) {
    this.spawn(pos, { count: 14, mat: 'gib', speed: 8, size: 0.28, life: 1.2, up: 6 });
    this.blood(pos, true);
  }

  sparks(pos) {
    this.spawn(pos, { count: 6, mat: 'spark', speed: 7, size: 0.06, life: 0.35, up: 2 });
  }

  dust(pos) {
    this.spawn(pos, { count: 6, mat: 'smoke', speed: 3, size: 0.14, life: 0.4, up: 1.5, gravity: 2 });
  }

  tracer(from, to) {
    const dir = to.clone().sub(from);
    const len = dir.length();
    if (len < 0.3) return;
    const t = this.tracers[this._nextTracer];
    this._nextTracer = (this._nextTracer + 1) % MAX_TRACERS;
    const m = t.mesh;
    m.visible = true;
    m.material.opacity = 0.9;
    m.scale.set(0.025, 0.025, len);
    m.position.copy(from).addScaledVector(dir, 0.5);
    m.lookAt(to);
    t.maxLife = 0.09;
    t.life = 0.09;
  }

  flash(pos, color = 0xffb545, intensity = 40, dur = 0.06) {
    const f = this.lights[this._nextLight];
    this._nextLight = (this._nextLight + 1) % POOL_LIGHTS;
    f.light.color.setHex(color);
    f.light.position.copy(pos);
    f.light.intensity = intensity;
    f.base = intensity;
    f.maxLife = dur;
    f.life = dur;
  }

  shake(amt) { this.shakeAmt = Math.min(this.shakeAmt + amt, 0.5); }

  update(dt) {
    for (const p of this.particles) {
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) { p.mesh.visible = false; continue; }
      p.vel.y -= p.gravity * dt;
      p.mesh.position.addScaledVector(p.vel, dt);
      p.mesh.rotation.x += dt * 4;
      p.mesh.rotation.z += dt * 3;
      if (p.mesh.position.y < 0.03 && p.vel.y < 0) { p.vel.y *= -0.3; p.vel.x *= 0.6; p.vel.z *= 0.6; }
    }
    for (const t of this.tracers) {
      if (t.life <= 0) continue;
      t.life -= dt;
      if (t.life <= 0) { t.mesh.visible = false; continue; }
      t.mesh.material.opacity = (t.life / t.maxLife) * 0.9;
    }
    for (const f of this.lights) {
      if (f.life <= 0) continue;
      f.life -= dt;
      f.light.intensity = f.life <= 0 ? 0 : f.base * (f.life / f.maxLife);
    }
    this.shakeAmt = Math.max(0, this.shakeAmt - dt * 1.8);
  }

  // Force-compile every effect material during load so the first shot,
  // blood splatter or flash doesn't hitch.
  prewarm(renderer, camera) {
    const stash = [];
    let i = 0;
    for (const key of Object.keys(this._mats)) {
      const p = this.particles[i++];
      p.mesh.material = this._mats[key];
      p.mesh.visible = true;
      p.mesh.position.set(0, 1, -2);
      stash.push(p.mesh);
    }
    const t = this.tracers[0];
    t.mesh.visible = true;
    t.mesh.scale.set(0.02, 0.02, 1);
    t.mesh.position.set(0, 1, -2);
    stash.push(t.mesh);
    renderer.compile(this.scene, camera);
    for (const m of stash) m.visible = false;
  }
}
