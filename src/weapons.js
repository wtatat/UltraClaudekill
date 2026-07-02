import * as THREE from 'three';
import { raycastLevelHit, rayAabb, clamp } from './utils.js';

const PUNCH_RANGE = 3.4;
const PUNCH_DAMAGE = 12;
const PARRY_DAMAGE = 20;
const REFLECT_DAMAGE = 40;

function buildFistModel() {
  const g = new THREE.Group();
  const arm = new THREE.MeshStandardMaterial({ color: 0x1c4d80, roughness: 0.4, metalness: 0.8 });
  const glove = new THREE.MeshStandardMaterial({ color: 0x2d7fd3, roughness: 0.35, metalness: 0.85 });
  const glow = new THREE.MeshStandardMaterial({ color: 0x59c1ff, emissive: 0x59c1ff, emissiveIntensity: 2 });
  const forearm = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, 0.3), arm);
  forearm.position.set(0, -0.02, 0.1);
  const fist = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.11, 0.14), glove);
  fist.position.set(0, 0, -0.1);
  const knuckles = new THREE.Mesh(new THREE.BoxGeometry(0.115, 0.03, 0.03), glow);
  knuckles.position.set(0, 0.035, -0.16);
  g.add(forearm, fist, knuckles);
  return g;
}

// Both weapons have infinite ammo; the revolver's alt-fire is a charged
// piercing shot on a cooldown, the shotgun kicks you backwards in the air.

function buildRevolverModel() {
  const g = new THREE.Group();
  const dark = new THREE.MeshStandardMaterial({ color: 0x2b2f36, roughness: 0.5, metalness: 0.7 });
  const steel = new THREE.MeshStandardMaterial({ color: 0x6f7884, roughness: 0.35, metalness: 0.9 });
  const grip = new THREE.MeshStandardMaterial({ color: 0x3a2415, roughness: 0.9 });
  const glow = new THREE.MeshStandardMaterial({ color: 0x39c2ff, emissive: 0x39c2ff, emissiveIntensity: 2 });

  const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.06, 0.34), steel);
  barrel.position.set(0, 0.02, -0.22);
  const frame = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.09, 0.16), dark);
  frame.position.set(0, 0, -0.02);
  const cyl = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.07, 8), steel);
  cyl.rotation.x = Math.PI / 2;
  cyl.position.set(0, 0.01, -0.08);
  const handle = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.13, 0.06), grip);
  handle.position.set(0, -0.09, 0.045);
  handle.rotation.x = 0.3;
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.056, 0.012, 0.3), glow);
  stripe.position.set(0, 0.055, -0.2);
  g.add(barrel, frame, cyl, handle, stripe);
  g.userData.chargeStripe = stripe;
  return g;
}

function buildShotgunModel() {
  const g = new THREE.Group();
  const dark = new THREE.MeshStandardMaterial({ color: 0x23262b, roughness: 0.6, metalness: 0.6 });
  const steel = new THREE.MeshStandardMaterial({ color: 0x596069, roughness: 0.4, metalness: 0.85 });
  const wood = new THREE.MeshStandardMaterial({ color: 0x4a2c14, roughness: 0.9 });
  const glow = new THREE.MeshStandardMaterial({ color: 0x71ff4d, emissive: 0x71ff4d, emissiveIntensity: 2 });

  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.52, 8), steel);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0.035, -0.3);
  const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.42, 8), dark);
  tube.rotation.x = Math.PI / 2;
  tube.position.set(0, -0.015, -0.26);
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.1, 0.2), dark);
  body.position.set(0, 0, 0);
  const pump = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.055, 0.14), wood);
  pump.position.set(0, -0.02, -0.3);
  const stock = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.09, 0.16), wood);
  stock.position.set(0, -0.03, 0.16);
  stock.rotation.x = 0.15;
  const dot = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.02, 0.02), glow);
  dot.position.set(0, 0.075, -0.5);
  g.add(barrel, tube, body, pump, stock, dot);
  g.userData.pump = pump;
  return g;
}

export class Weapons {
  constructor(G, camera) {
    this.G = G;
    this.camera = camera;
    this.rig = new THREE.Group();
    camera.add(this.rig);
    this.rig.position.set(0.28, -0.24, -0.5);

    this.revolver = buildRevolverModel();
    this.shotgun = buildShotgunModel();
    this.rig.add(this.revolver, this.shotgun);
    this.shotgun.visible = false;

    // you start empty-handed: the revolver waits on a pedestal in the dark
    this.current = 'none';
    this.revolver.visible = false;
    this.hasRevolver = false;
    this.hasShotgun = false;
    this.cooldown = 0;
    this.chargeCd = 0;
    this.charge = 0;      // 0..1 while holding RMB
    this.charging = false;
    this.recoil = 0;
    this.swapT = 0;
    this._chargeTick = 0;
    this.lastShotWasAir = false;

    // the left arm: quick punch, parries projectiles and telegraphed attacks
    this.fist = buildFistModel();
    this.fist.position.set(-0.3, -0.3, -0.35);
    this.fist.visible = false;
    camera.add(this.fist);
    this.punchCd = 0;
    this.punchAnimT = 0;
    this.punchChain = 0;   // consecutive punches raise the cooldown
    this.punchIdleT = 0;
  }

  giveRevolver() {
    this.hasRevolver = true;
    this.switchTo('revolver');
  }

  giveShotgun() {
    this.hasShotgun = true;
    this.switchTo('shotgun');
  }

  switchTo(name) {
    if (name === 'revolver' && !this.hasRevolver) return;
    if (name === 'shotgun' && !this.hasShotgun) return;
    if (name === this.current) return;
    this.current = name;
    this.swapT = 0.22;
    this.revolver.visible = name === 'revolver';
    this.shotgun.visible = name === 'shotgun';
    this.G.hud.setWeapon(name);
    this.G.hud.style.varietyBonus(name);
  }

  muzzleWorld() {
    const v = new THREE.Vector3(0, 0.03, -0.55);
    return this.rig.localToWorld(v.clone());
  }

  // Fire a hitscan ray; returns list of enemy hits (sorted), respecting walls.
  // Breakable glass and planks shatter when the ray lands on them.
  _hitscan(origin, dir, pierce = false) {
    const G = this.G;
    const { dist: wallDist, collider: wallHit } = raycastLevelHit(origin, dir, G.colliders, 300);
    if (wallHit) G.level.breakHit(wallHit);
    const hits = [];
    for (const e of G.enemies) {
      if (e.dead) continue;
      const t = rayAabb(origin, dir, e.hitbox());
      if (t < wallDist) hits.push({ enemy: e, t });
    }
    for (const p of G.projectiles) {
      if (p.dead || p.friendly) continue;
      const t = rayAabb(origin, dir, p.hitbox());
      if (t < wallDist) hits.push({ projectile: p, t });
    }
    hits.sort((a, b) => a.t - b.t);
    return { hits: pierce ? hits : hits.slice(0, 1), wallDist };
  }

  _applyHit(hit, origin, dir, dmg) {
    const G = this.G;
    const point = origin.clone().addScaledVector(dir, hit.t);
    if (hit.projectile) {
      hit.projectile.explode();
      G.hud.style.add(40, 'INTERCEPTED');
      G.audio.parryBreak();
      return;
    }
    const e = hit.enemy;
    const wasAlive = !e.dead;
    e.damage(dmg, G.player.pos);
    G.effects.blood(point);
    G.audio.hitmarker();
    G.hud.hitmarker();
    // blood-fuel: close range damage heals
    const dist = e.pos.distanceTo(G.player.pos);
    if (dist < 5) G.player.heal(dmg * 0.5);
    if (wasAlive && e.dead) {
      if (!G.player.onGround) G.hud.style.add(40, 'AERIAL FINISH');
      if (dist < 3) G.hud.style.add(30, 'POINT-BLANK');
    } else if (dist > 30) {
      G.hud.style.add(20, 'SNIPER');
    }
  }

  update(dt, input) {
    const G = this.G;
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.chargeCd = Math.max(0, this.chargeCd - dt);
    this.swapT = Math.max(0, this.swapT - dt);
    this.recoil = Math.max(0, this.recoil - dt * 6);
    this.punchCd = Math.max(0, this.punchCd - dt);
    this.punchIdleT += dt;
    if (this.punchIdleT > 0.9) this.punchChain = 0;

    if (input.justPressed('Digit1')) this.switchTo('revolver');
    if (input.justPressed('Digit2')) this.switchTo('shotgun');
    if (input.justPressed('KeyQ')) this.switchTo(this.current === 'revolver' ? 'shotgun' : 'revolver');

    const origin = G.player.eyePos;
    const dir = G.player.aimDir();

    // --- punch (F; also LMB while you have no gun) ---
    const wantPunch = input.justPressed('KeyF') || (this.current === 'none' && input.clicked0);
    if (wantPunch && this.punchCd <= 0) this._punch(origin, dir);
    if (this.punchAnimT > 0) {
      this.punchAnimT -= dt;
      const k = Math.max(0, this.punchAnimT / 0.22);
      this.fist.visible = true;
      this.fist.position.z = -0.35 - Math.sin((1 - k) * Math.PI) * 0.38;
      this.fist.position.x = -0.3 + Math.sin((1 - k) * Math.PI) * 0.16;
      this.fist.rotation.x = Math.sin((1 - k) * Math.PI) * 0.2;
      if (this.punchAnimT <= 0) this.fist.visible = false;
    }

    // --- revolver charge (RMB) ---
    if (this.current === 'revolver') {
      const stripe = this.revolver.userData.chargeStripe;
      if (input.mouse2 && this.chargeCd <= 0) {
        this.charging = true;
        this.charge = Math.min(1, this.charge + dt / 0.9);
        this._chargeTick += dt;
        if (this._chargeTick > 0.09) { this._chargeTick = 0; G.audio.charging(this.charge); }
        stripe.material.emissiveIntensity = 2 + this.charge * 8;
      } else if (this.charging) {
        // release
        if (this.charge >= 0.99) {
          this._fireCharged(origin, dir);
        }
        this.charging = false;
        this.charge = 0;
        stripe.material.emissiveIntensity = 2;
      }
    }

    // --- primary fire ---
    if (input.mouse0 && this.cooldown <= 0 && this.swapT <= 0 && !this.charging && this.current !== 'none') {
      if (this.current === 'revolver') this._fireRevolver(origin, dir);
      else this._fireShotgun(origin, dir);
    }

    // viewmodel animation
    const targetZ = -0.5 + this.recoil * 0.09;
    this.rig.position.z = targetZ;
    this.rig.rotation.x = this.recoil * 0.35;
    if (this.swapT > 0) this.rig.position.y = -0.24 - this.swapT * 1.2;
    else this.rig.position.y = -0.24 + Math.sin(performance.now() / 1000 * 2.1) * 0.006;
  }

  // Feedbacker-style punch: hits up to two projectiles (reflecting them at
  // the crosshair) and nearby enemies; punching an enemy during its yellow
  // windup flash parries the attack.
  _punch(origin, dir) {
    const G = this.G;
    this.punchCd = 0.3 + 0.12 * Math.min(this.punchChain, 4);
    this.punchChain++;
    this.punchIdleT = 0;
    this.punchAnimT = 0.22;
    G.audio.punchWhoosh();

    let parried = false;
    let hitSomething = false;

    // breakables: planks and glass shatter under a fist
    if (G.level && G.level.punchBreakables(origin, dir, PUNCH_RANGE)) hitSomething = true;

    // projectiles first: in front within range, or anywhere point-blank
    // (covers the mercy window when the orb is already inside you)
    let reflected = 0;
    for (const p of G.projectiles) {
      if (p.dead || p.friendly || reflected >= 2) continue;
      const to = p.pos.clone().sub(origin);
      const d = to.length();
      const facing = d > 0.01 ? to.divideScalar(d).dot(dir) : 1;
      if (d < 1.4 || (d < PUNCH_RANGE && facing > 0.55)) {
        p.reflect(dir, 24, REFLECT_DAMAGE);
        reflected++;
        parried = true;
      }
    }

    // enemies in a short cone
    let punched = 0;
    for (const e of G.enemies) {
      if (e.dead || punched >= 2) continue;
      const hb = e.hitbox();
      const closest = new THREE.Vector3(
        clamp(origin.x, hb.min.x, hb.max.x),
        clamp(origin.y, hb.min.y, hb.max.y),
        clamp(origin.z, hb.min.z, hb.max.z),
      );
      const to = closest.sub(origin);
      const d = to.length();
      const facing = d > 0.01 ? to.divideScalar(d).dot(dir) : 1;
      if (d > PUNCH_RANGE || facing < 0.6) continue;
      punched++;
      hitSomething = true;
      if (e.parryWindow()) {
        e.onParried();
        e.damage(PARRY_DAMAGE, G.player.pos);
        parried = true;
      } else {
        e.damage(PUNCH_DAMAGE, G.player.pos);
        e.vel.addScaledVector(dir, 4);
        G.player.heal(10); // blood on the knuckles
      }
      G.effects.blood(G.player.eyePos.clone().addScaledVector(dir, Math.min(d, 2)));
    }

    if (parried) {
      // full reward: stamina, health, style, hitstop
      G.player.stamina = 3;
      G.player.heal(40);
      G.hud.style.add(150, 'PARRY');
      G.hud.parryFlash();
      G.audio.parry();
      G.effects.flash(origin.clone().addScaledVector(dir, 1), 0xffd23e, 50, 0.12);
      G.effects.shake(0.08);
      G.hitstop = 0.09;
    } else if (hitSomething) {
      G.audio.punchHit();
      G.hud.style.add(20, null);
      G.effects.shake(0.04);
    }
  }

  _fireRevolver(origin, dir) {
    const G = this.G;
    this.cooldown = 0.32;
    this.recoil = 1;
    G.audio.revolver();
    G.effects.flash(this.muzzleWorld());
    G.effects.shake(0.05);
    const { hits, wallDist } = this._hitscan(origin, dir);
    const endT = hits.length ? hits[0].t : wallDist;
    const end = origin.clone().addScaledVector(dir, endT);
    G.effects.tracer(this.muzzleWorld(), end);
    if (hits.length) this._applyHit(hits[0], origin, dir, 25);
    else if (wallDist < 300) G.effects.sparks(end);
  }

  _fireCharged(origin, dir) {
    const G = this.G;
    this.chargeCd = 3;
    this.recoil = 2;
    G.audio.charged();
    G.effects.flash(this.muzzleWorld(), 0x66ccff, 60);
    G.effects.shake(0.18);
    const { hits, wallDist } = this._hitscan(origin, dir, true);
    const end = origin.clone().addScaledVector(dir, wallDist);
    G.effects.tracer(this.muzzleWorld(), end);
    G.effects.tracer(this.muzzleWorld().add(new THREE.Vector3(0, 0.02, 0)), end);
    let n = 0;
    for (const h of hits) { this._applyHit(h, origin, dir, 100); n++; }
    if (n >= 2) G.hud.style.add(60, 'SKEWERED x' + n);
    if (wallDist < 300) G.effects.sparks(end);
  }

  _fireShotgun(origin, dir) {
    const G = this.G;
    this.cooldown = 0.75;
    this.recoil = 1.6;
    G.audio.shotgun();
    setTimeout(() => G.audio.pump(), 350);
    G.effects.flash(this.muzzleWorld(), 0xffa030, 55);
    G.effects.shake(0.12);
    this.lastShotWasAir = !G.player.onGround;

    const right = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0)).normalize();
    const up = new THREE.Vector3().crossVectors(right, dir).normalize();
    const perEnemy = new Map();
    for (let i = 0; i < 10; i++) {
      const spread = 0.075;
      const d = dir.clone()
        .addScaledVector(right, (Math.random() - 0.5) * 2 * spread)
        .addScaledVector(up, (Math.random() - 0.5) * 2 * spread)
        .normalize();
      const { hits, wallDist } = this._hitscan(origin, d);
      if (hits.length) {
        const h = hits[0];
        if (h.enemy) perEnemy.set(h.enemy, (perEnemy.get(h.enemy) || 0) + 1);
        else this._applyHit(h, origin, d, 8);
      } else if (wallDist < 60) {
        G.effects.sparks(origin.clone().addScaledVector(d, wallDist));
      }
      if (i % 3 === 0) {
        const endT = hits.length ? hits[0].t : Math.min(wallDist, 40);
        G.effects.tracer(this.muzzleWorld(), origin.clone().addScaledVector(d, endT));
      }
    }
    for (const [e, pellets] of perEnemy) {
      const fake = { enemy: e, t: e.pos.distanceTo(origin) };
      this._applyHit(fake, origin, dir, pellets * 8);
      if (pellets >= 8 && !e.dead) G.hud.style.add(20, 'FULL BLAST');
    }
    // airborne knockback = shotgun boosting
    if (!G.player.onGround) {
      G.player.vel.addScaledVector(dir, -7);
      G.hud.style.add(10, null);
    }
  }
}
