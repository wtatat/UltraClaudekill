import * as THREE from 'three';
import { randRange } from './utils.js';

// Particle + tracer pool. Everything reuses one geometry per type.
export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.particles = [];
    this.tracers = [];
    this.shakeAmt = 0;
    this._cubeGeo = new THREE.BoxGeometry(1, 1, 1);
    this._mats = {
      blood: new THREE.MeshBasicMaterial({ color: 0x9e0d0d }),
      bloodDark: new THREE.MeshBasicMaterial({ color: 0x5c0505 }),
      spark: new THREE.MeshBasicMaterial({ color: 0xffd06a }),
      smoke: new THREE.MeshBasicMaterial({ color: 0x333333, transparent: true, opacity: 0.7 }),
      gib: new THREE.MeshBasicMaterial({ color: 0x7a1010 }),
    };
    this._tracerMat = new THREE.MeshBasicMaterial({
      color: 0xffe9a0, transparent: true, opacity: 0.9,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
  }

  spawn(pos, { count = 8, mat = 'blood', speed = 6, size = 0.12, life = 0.7, up = 3, gravity = 18 } = {}) {
    for (let i = 0; i < count; i++) {
      if (this.particles.length > 400) break;
      const m = new THREE.Mesh(this._cubeGeo, this._mats[mat]);
      const s = size * randRange(0.5, 1.5);
      m.scale.setScalar(s);
      m.position.copy(pos);
      m.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
      const v = new THREE.Vector3(
        randRange(-1, 1), randRange(0, 1) * (up / Math.max(speed, 0.01)) + randRange(-0.3, 0.6), randRange(-1, 1)
      ).normalize().multiplyScalar(speed * randRange(0.4, 1.2));
      v.y += up * randRange(0.3, 1);
      this.scene.add(m);
      this.particles.push({ mesh: m, vel: v, life: life * randRange(0.6, 1.3), gravity });
    }
  }

  blood(pos, big = false) {
    this.spawn(pos, { count: big ? 22 : 9, mat: 'blood', speed: big ? 9 : 6, size: big ? 0.17 : 0.11 });
    this.spawn(pos, { count: big ? 8 : 3, mat: 'bloodDark', speed: 4, size: 0.14 });
  }

  gibs(pos) {
    this.spawn(pos, { count: 14, mat: 'gib', speed: 8, size: 0.28, life: 1.2, up: 6 });
    this.blood(pos, true);
  }

  sparks(pos) {
    this.spawn(pos, { count: 6, mat: 'spark', speed: 7, size: 0.06, life: 0.35, up: 2 });
  }

  tracer(from, to) {
    const dir = to.clone().sub(from);
    const len = dir.length();
    if (len < 0.3) return;
    const geo = this._cubeGeo;
    const m = new THREE.Mesh(geo, this._tracerMat.clone());
    m.scale.set(0.025, 0.025, len);
    m.position.copy(from).addScaledVector(dir, 0.5);
    m.lookAt(to);
    this.scene.add(m);
    this.tracers.push({ mesh: m, life: 0.09, maxLife: 0.09 });
  }

  flash(pos, color = 0xffb545, intensity = 40, dur = 0.06) {
    const l = new THREE.PointLight(color, intensity, 12);
    l.position.copy(pos);
    this.scene.add(l);
    this.tracers.push({ mesh: l, life: dur, maxLife: dur, isLight: true });
  }

  shake(amt) { this.shakeAmt = Math.min(this.shakeAmt + amt, 0.5); }

  update(dt) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.scene.remove(p.mesh);
        this.particles.splice(i, 1);
        continue;
      }
      p.vel.y -= p.gravity * dt;
      p.mesh.position.addScaledVector(p.vel, dt);
      p.mesh.rotation.x += dt * 4;
      p.mesh.rotation.z += dt * 3;
      if (p.mesh.position.y < 0.03 && p.vel.y < 0) { p.vel.y *= -0.3; p.vel.x *= 0.6; p.vel.z *= 0.6; }
    }
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i];
      t.life -= dt;
      if (t.life <= 0) {
        this.scene.remove(t.mesh);
        this.tracers.splice(i, 1);
        continue;
      }
      const k = t.life / t.maxLife;
      if (t.isLight) t.mesh.intensity *= k;
      else t.mesh.material.opacity = k * 0.9;
    }
    this.shakeAmt = Math.max(0, this.shakeAmt - dt * 1.8);
  }
}
