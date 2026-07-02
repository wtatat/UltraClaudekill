import * as THREE from 'three';
import { moveAndCollide, hasLos, randRange } from './utils.js';

// Three original enemy archetypes:
//  Husk   — fast melee rusher
//  Shade  — ranged, lobs destroyable plasma orbs
//  Warden — heavy mid-boss with AoE slam and rock throw

const bodyMat = (color, emissive = 0x000000) =>
  new THREE.MeshStandardMaterial({ color, emissive, emissiveIntensity: 1, roughness: 0.85, flatShading: true });

function humanoid({ scale = 1, skin = 0xb04a3a, cloth = 0x2a2222, eyes = 0xff2200 }) {
  const g = new THREE.Group();
  const mSkin = bodyMat(skin);
  const mCloth = bodyMat(cloth);
  const mEyes = new THREE.MeshBasicMaterial({ color: eyes });
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.7, 0.3), mCloth);
  torso.position.y = 1.0;
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.32, 0.32), mSkin);
  head.position.y = 1.55;
  const eyeL = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.05, 0.02), mEyes);
  eyeL.position.set(-0.08, 1.58, 0.17);
  const eyeR = eyeL.clone(); eyeR.position.x = 0.08;
  const armL = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.6, 0.14), mSkin);
  armL.position.set(-0.38, 1.0, 0);
  const armR = armL.clone(); armR.position.x = 0.38;
  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.65, 0.17), mCloth);
  legL.position.set(-0.14, 0.33, 0);
  const legR = legL.clone(); legR.position.x = 0.14;
  g.add(torso, head, eyeL, eyeR, armL, armR, legL, legR);
  g.scale.setScalar(scale);
  g.userData.parts = { armL, armR, legL, legR, head, torso };
  g.userData.flashables = [mSkin, mCloth];
  return g;
}

let nextId = 1;

// Add one hidden instance of every enemy/projectile material to the scene,
// so their shader programs compile during the loading screen instead of
// hitching on first spawn. Returns a cleanup function.
export function prewarmEnemyMeshes(scene) {
  const stash = [];
  const dummies = [
    humanoid({ skin: 0xc4574a, cloth: 0x33201c, eyes: 0xffcc00 }),
    humanoid({ scale: 1.9, skin: 0x8a2020, cloth: 0x151015, eyes: 0xff5500 }),
  ];
  const orb = new THREE.Mesh(new THREE.OctahedronGeometry(0.2, 0), new THREE.MeshBasicMaterial({ color: 0x44ddff }));
  const halo = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.4, 0),
    new THREE.MeshBasicMaterial({ color: 0x44ddff, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false })
  );
  orb.add(halo);
  dummies.push(orb);
  for (const d of dummies) {
    d.position.set(0, 1, -2);
    scene.add(d);
    stash.push(d);
  }
  return () => { for (const d of stash) scene.remove(d); };
}

class EnemyBase {
  constructor(G, pos) {
    this.G = G;
    this.id = nextId++;
    this.pos = pos.clone();
    this.vel = new THREE.Vector3();
    this.he = new THREE.Vector3(0.4, 0.9, 0.4);
    this.hp = 30;
    this.maxHp = 30;
    this.dead = false;
    this.attackCd = randRange(0.5, 1.5);
    this.flashT = 0;
    this.animT = Math.random() * 10;
    this.mesh = null;
    this.styleValue = 100;
    this.name = 'HUSK';
  }

  hitbox() {
    return {
      min: this.pos.clone().sub(this.he),
      max: this.pos.clone().add(this.he),
    };
  }

  damage(amount, fromPos, isSlam = false) {
    if (this.dead) return;
    this.hp -= amount;
    this.flashT = 0.08;
    if (this.hp <= 0) {
      this.die();
    } else {
      this.G.audio.enemyHurt();
      if (fromPos && !isSlam) {
        const push = this.pos.clone().sub(fromPos).setY(0).normalize().multiplyScalar(1.5);
        this.vel.add(push);
      }
      if (isSlam) this.vel.y = 6;
    }
  }

  die() {
    this.dead = true;
    this.G.audio.kill();
    this.G.audio.enemyDie();
    this.G.effects.gibs(this.pos.clone());
    this.G.scene.remove(this.mesh);
    this.G.hud.style.kill(this.styleValue, this.name);
    this.G.onEnemyKilled(this);
  }

  faceThePlayer() {
    const p = this.G.player.pos;
    this.mesh.rotation.y = Math.atan2(p.x - this.pos.x, p.z - this.pos.z);
  }

  // true while the enemy is winding up an attack and a punch will parry it
  parryWindow() { return false; }

  onParried() {}

  updateFlash(dt) {
    const mats = this.mesh.userData.flashables || [];
    if (this.flashT > 0) {
      this.flashT -= dt;
      const on = this.flashT > 0;
      for (const m of mats) {
        m.emissive.setHex(on ? 0xffffff : 0x000000);
        m.emissiveIntensity = on ? 0.8 : 1;
      }
      this._parryGlow = false;
    } else if (this.parryWindow()) {
      // the tell: bright yellow pulse during the windup
      const pulse = 0.6 + Math.sin(performance.now() / 40) * 0.3;
      for (const m of mats) {
        m.emissive.setHex(0xffcc22);
        m.emissiveIntensity = pulse;
      }
      this._parryGlow = true;
    } else if (this._parryGlow) {
      for (const m of mats) {
        m.emissive.setHex(0x000000);
        m.emissiveIntensity = 1;
      }
      this._parryGlow = false;
    }
  }
}

export class Husk extends EnemyBase {
  constructor(G, pos) {
    super(G, pos);
    this.hp = this.maxHp = 30;
    this.speed = randRange(6, 7.5);
    this.styleValue = 100;
    this.name = 'HUSK';
    this.mesh = humanoid({ skin: 0xc4574a, cloth: 0x33201c, eyes: 0xffcc00 });
    this.mesh.position.copy(pos);
    G.scene.add(this.mesh);
    this.lungeT = 0;
    this.windup = 0;
    this.staggerT = 0;
  }

  parryWindow() { return this.windup > 0; }

  onParried() {
    this.windup = 0;
    this.lungeT = 0;
    this.attackCd = 2.2;
    this.staggerT = 0.7;
    this.vel.x = 0; this.vel.z = 0;
  }

  update(dt) {
    const G = this.G, P = G.player;
    if (this.dead) return;
    this.animT += dt;
    this.attackCd -= dt;
    if (this.staggerT > 0) {
      this.staggerT -= dt;
      this.vel.x = 0; this.vel.z = 0;
      this.vel.y -= 30 * dt;
      moveAndCollide(this.pos, this.vel, this.he, dt, G.colliders);
      this.mesh.position.copy(this.pos).y = this.pos.y - this.he.y;
      this.updateFlash(dt);
      return;
    }
    const toP = P.pos.clone().sub(this.pos);
    const dist = toP.length();
    toP.y = 0; toP.normalize();

    if (this.windup > 0) {
      this.windup -= dt;
      this.vel.x = 0; this.vel.z = 0;
      if (this.windup <= 0) {
        // lunge
        this.vel.x = toP.x * 14; this.vel.z = toP.z * 14; this.vel.y = 4;
        this.lungeT = 0.35;
      }
    } else if (this.lungeT > 0) {
      this.lungeT -= dt;
      if (dist < 2.1 && this.attackCd <= 0) {
        P.damage(14, this.pos);
        this.attackCd = 1.4;
        this.lungeT = 0;
      }
    } else {
      if (dist < 2.4 && this.attackCd <= 0) {
        this.windup = 0.4;
        this.G.audio.parryPing();
      } else {
        this.vel.x = toP.x * this.speed;
        this.vel.z = toP.z * this.speed;
      }
    }

    this.vel.y -= 30 * dt;
    const res = moveAndCollide(this.pos, this.vel, this.he, dt, G.colliders);
    // hop over obstacles
    if (res.hitWall && res.onGround && this.lungeT <= 0 && this.windup <= 0) this.vel.y = 8;

    this.mesh.position.copy(this.pos).y = this.pos.y - this.he.y;
    this.faceThePlayer();
    // shamble animation
    const parts = this.mesh.userData.parts;
    const sw = Math.sin(this.animT * 9) * 0.5;
    parts.legL.rotation.x = sw; parts.legR.rotation.x = -sw;
    parts.armL.rotation.x = this.windup > 0 ? -2.4 : -0.6 - sw * 0.4;
    parts.armR.rotation.x = this.windup > 0 ? -2.4 : -0.6 + sw * 0.4;
    this.updateFlash(dt);
  }
}

export class Shade extends EnemyBase {
  constructor(G, pos) {
    super(G, pos);
    this.hp = this.maxHp = 60;
    this.styleValue = 120;
    this.name = 'SHADE';
    this.mesh = humanoid({ skin: 0x6a6f7a, cloth: 0x1a1d24, eyes: 0x3fd6ff });
    this.mesh.position.copy(pos);
    G.scene.add(this.mesh);
    this.strafeDir = Math.random() < 0.5 ? 1 : -1;
    this.strafeT = randRange(1, 2);
    this.attackCd = randRange(1, 2.2);
  }

  update(dt) {
    const G = this.G, P = G.player;
    if (this.dead) return;
    this.animT += dt;
    this.attackCd -= dt;
    this.strafeT -= dt;
    if (this.strafeT <= 0) { this.strafeDir *= -1; this.strafeT = randRange(1, 2.5); }

    const toP = P.pos.clone().sub(this.pos);
    const dist = toP.length();
    toP.y = 0; toP.normalize();
    const side = new THREE.Vector3(-toP.z, 0, toP.x).multiplyScalar(this.strafeDir);
    const los = hasLos(this.pos.clone().setY(this.pos.y + 0.6), P.eyePos, G.colliders);

    let move = new THREE.Vector3();
    if (!los || dist > 26) move.copy(toP);            // approach
    else if (dist < 8) move.copy(toP).negate();       // back off
    move.addScaledVector(side, 0.8).normalize();
    this.vel.x = move.x * 4.2;
    this.vel.z = move.z * 4.2;
    this.vel.y -= 30 * dt;
    const res = moveAndCollide(this.pos, this.vel, this.he, dt, G.colliders);
    if (res.hitWall && res.onGround) this.vel.y = 7;

    if (los && dist < 30 && this.attackCd <= 0) {
      this.attackCd = 2.3;
      const from = this.pos.clone().add(new THREE.Vector3(0, 0.6, 0));
      const aim = P.pos.clone().addScaledVector(P.vel, dist / 14 * 0.35).sub(from).normalize();
      G.spawnProjectile(from, aim.multiplyScalar(14), { damage: 12, color: 0x44ddff, radius: 0.22 });
      G.audio.projShoot();
    }

    this.mesh.position.copy(this.pos).y = this.pos.y - this.he.y;
    this.faceThePlayer();
    const parts = this.mesh.userData.parts;
    parts.armR.rotation.x = -1.4;
    const sw = Math.sin(this.animT * 6) * 0.3;
    parts.legL.rotation.x = sw; parts.legR.rotation.x = -sw;
    this.updateFlash(dt);
  }
}

export class Warden extends EnemyBase {
  constructor(G, pos) {
    super(G, pos);
    this.hp = this.maxHp = 350;
    this.styleValue = 500;
    this.name = 'WARDEN';
    this.he.set(0.8, 1.6, 0.8);
    this.mesh = humanoid({ scale: 1.9, skin: 0x8a2020, cloth: 0x151015, eyes: 0xff5500 });
    this.mesh.position.copy(pos);
    G.scene.add(this.mesh);
    this.slamWindup = 0;
    this.throwCd = 2;
    this.roared = false;
    this.staggerT = 0;
  }

  parryWindow() { return this.slamWindup > 0; }

  onParried() {
    this.slamWindup = 0;
    this.attackCd = 2.6;
    this.staggerT = 0.9;
    this.vel.x = 0; this.vel.z = 0;
  }

  damage(amount, fromPos, isSlam) {
    super.damage(amount, fromPos, false); // too heavy for knock-up
    if (!this.dead && this.G.hud) this.G.hud.bossBar(this.hp / this.maxHp, 'WARDEN');
  }

  die() {
    super.die();
    this.G.hud.bossBar(0, null);
    this.G.effects.gibs(this.pos.clone().add(new THREE.Vector3(0, 0.8, 0)));
    this.G.effects.shake(0.4);
  }

  update(dt) {
    const G = this.G, P = G.player;
    if (this.dead) return;
    if (!this.roared) {
      this.roared = true;
      G.audio.wardenRoar();
      G.hud.bossBar(1, 'WARDEN');
    }
    this.animT += dt;
    this.attackCd -= dt;
    this.throwCd -= dt;
    if (this.staggerT > 0) {
      this.staggerT -= dt;
      this.vel.x = 0; this.vel.z = 0;
      this.vel.y -= 30 * dt;
      moveAndCollide(this.pos, this.vel, this.he, dt, G.colliders);
      this.mesh.position.copy(this.pos).y = this.pos.y - this.he.y;
      this.updateFlash(dt);
      return;
    }
    const toP = P.pos.clone().sub(this.pos);
    const dist = toP.length();
    toP.y = 0; toP.normalize();

    if (this.slamWindup > 0) {
      this.slamWindup -= dt;
      this.vel.x = 0; this.vel.z = 0;
      if (this.slamWindup <= 0) {
        G.audio.slam();
        G.effects.shake(0.35);
        const ground = this.pos.clone().setY(this.pos.y - this.he.y + 0.2);
        G.effects.spawn(ground, { count: 24, mat: 'spark', speed: 10, size: 0.12, life: 0.5, up: 5 });
        G.effects.spawn(ground, { count: 14, mat: 'smoke', speed: 6, size: 0.35, life: 0.8, up: 2, gravity: 1 });
        const flat = P.pos.clone().sub(this.pos); flat.y = 0;
        if (flat.length() < 6 && P.pos.y - this.pos.y < 2.5) P.damage(30, this.pos);
      }
    } else {
      if (dist < 4.5 && this.attackCd <= 0) {
        this.slamWindup = 0.65;
        this.attackCd = 2.2;
        G.audio._tone(0.5, { from: 200, to: 60, type: 'sawtooth', gain: 0.25 });
        G.audio.parryPing();
      } else if (dist > 10 && this.throwCd <= 0 && hasLos(this.pos.clone().setY(this.pos.y + 1.5), P.eyePos, G.colliders)) {
        this.throwCd = 3.2;
        const from = this.pos.clone().add(new THREE.Vector3(0, 1.5, 0));
        const aim = P.pos.clone().addScaledVector(P.vel, dist / 18 * 0.5).sub(from).normalize();
        G.spawnProjectile(from, aim.multiplyScalar(18), { damage: 22, color: 0xff6a00, radius: 0.4, hp: 3 });
        G.audio.projShoot();
      } else {
        this.vel.x = toP.x * 4;
        this.vel.z = toP.z * 4;
      }
    }

    this.vel.y -= 30 * dt;
    moveAndCollide(this.pos, this.vel, this.he, dt, G.colliders);
    this.mesh.position.copy(this.pos).y = this.pos.y - this.he.y;
    this.faceThePlayer();
    const parts = this.mesh.userData.parts;
    const sw = Math.sin(this.animT * 5) * 0.35;
    parts.legL.rotation.x = sw; parts.legR.rotation.x = -sw;
    const raise = this.slamWindup > 0 ? -2.8 : -0.4;
    parts.armL.rotation.x = raise + sw * 0.2;
    parts.armR.rotation.x = raise - sw * 0.2;
    this.updateFlash(dt);
  }
}

// ---- enemy projectile ----
export class Projectile {
  constructor(G, pos, vel, { damage = 12, color = 0x44ddff, radius = 0.22, hp = 1 } = {}) {
    this.G = G;
    this.pos = pos.clone();
    this.vel = vel.clone();
    this.damage = damage;
    this.radius = radius;
    this.hp = hp;
    this.dead = false;
    this.friendly = false;
    this.life = 8;
    this.color = color;
    this.mercyT = 0; // grace window after touching the player, still parryable
    // no per-projectile PointLight: adding/removing lights forces a full
    // shader recompile, which caused big hitches — use an additive halo instead
    const mat = new THREE.MeshBasicMaterial({ color });
    this.mesh = new THREE.Mesh(new THREE.OctahedronGeometry(radius, 0), mat);
    const halo = new THREE.Mesh(
      new THREE.OctahedronGeometry(radius * 1.9, 0),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    this.mesh.add(halo);
    this.mesh.position.copy(pos);
    G.scene.add(this.mesh);
  }

  hitbox() {
    const r = this.radius * 1.6;
    return {
      min: this.pos.clone().subScalar(r),
      max: this.pos.clone().addScalar(r),
    };
  }

  explode() {
    if (this.dead) return;
    this.dead = true;
    this.G.effects.sparks(this.pos);
    this.G.effects.flash(this.pos, this.color, 20, 0.1);
    this.G.scene.remove(this.mesh);
  }

  // Punched by the Feedbacker: reflect towards the aim point, boost it,
  // and make it hurt enemies instead of the player.
  reflect(dir, speed, damage) {
    this.friendly = true;
    this.damage = damage;
    this.mercyT = 0;
    this.life = 5;
    this.vel.copy(dir).multiplyScalar(Math.max(speed, this.vel.length() * 1.8));
    this.color = 0xffd23e;
    this.mesh.material.color.setHex(0xffd23e);
    this.mesh.children[0].material.color.setHex(0xffd23e);
  }

  update(dt) {
    if (this.dead) return;
    this.life -= dt;
    if (this.life <= 0) return this.explode();

    // mercy frames: the orb has touched the player but the hit lands with a
    // small delay, leaving a last-chance parry window (like the original)
    if (this.mercyT > 0) {
      this.mercyT -= dt;
      if (this.mercyT <= 0) {
        this.G.player.damage(this.damage, this.pos);
        return this.explode();
      }
      return; // frozen in the player during the window
    }

    // substep so fast (reflected) orbs can't fly through a target in one frame
    const steps = Math.min(8, Math.max(1, Math.ceil(this.vel.length() * dt / 0.3)));
    for (let i = 0; i < steps; i++) {
      this._step(dt / steps);
      if (this.dead || this.mercyT > 0) break;
    }
    if (!this.dead) {
      this.mesh.position.copy(this.pos);
      this.mesh.rotation.x += dt * 6;
      this.mesh.rotation.y += dt * 8;
    }
  }

  _step(dt) {
    this.pos.addScaledVector(this.vel, dt);

    if (this.friendly) {
      // hit enemies: full damage to the direct target, splash to neighbours
      for (const e of this.G.enemies) {
        if (e.dead) continue;
        const hb = e.hitbox();
        if (this.pos.x > hb.min.x - this.radius && this.pos.x < hb.max.x + this.radius &&
            this.pos.y > hb.min.y - this.radius && this.pos.y < hb.max.y + this.radius &&
            this.pos.z > hb.min.z - this.radius && this.pos.z < hb.max.z + this.radius) {
          e.damage(this.damage, this.pos);
          this.G.effects.blood(this.pos);
          this.G.audio.hitmarker();
          for (const o of this.G.enemies) {
            if (o !== e && !o.dead && o.pos.distanceTo(this.pos) < 2.5) o.damage(this.damage * 0.5, this.pos);
          }
          return this.explode();
        }
      }
    } else {
      // touch the player -> start mercy window instead of instant damage
      const P = this.G.player;
      const pd = this.pos.clone().sub(P.pos);
      pd.x = Math.max(0, Math.abs(pd.x) - P.he.x);
      pd.y = Math.max(0, Math.abs(pd.y) - P.he.y);
      pd.z = Math.max(0, Math.abs(pd.z) - P.he.z);
      if (pd.length() < this.radius + 0.1) {
        this.mercyT = 0.15;
        return;
      }
    }
    // hit level
    for (const c of this.G.colliders) {
      if (this.pos.x > c.min.x - this.radius && this.pos.x < c.max.x + this.radius &&
          this.pos.y > c.min.y - this.radius && this.pos.y < c.max.y + this.radius &&
          this.pos.z > c.min.z - this.radius && this.pos.z < c.max.z + this.radius) {
        return this.explode();
      }
    }
  }
}
