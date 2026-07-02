import * as THREE from 'three';
import { moveAndCollide, hasLos, randRange, clamp, raycastLevel } from './utils.js';

// Enemy roster modelled on the first level's cast:
//  Filth          — armless melee rusher; its bite can't be parried, but any
//                   damage cancels the attack; dies to a single revolver shot
//  Stray          — keeps medium distance, charges an orb before throwing it;
//                   shooting the orb mid-charge blows the Stray up
//  MaliciousFace  — floating stone head boss: orb barrages plus a charged
//                   beam, goes berserk below half health

const bodyMat = (color, emissive = 0x000000) =>
  new THREE.MeshStandardMaterial({ color, emissive, emissiveIntensity: 1, roughness: 0.85, flatShading: true });

function humanoid({ scale = 1, skin = 0xb04a3a, cloth = 0x2a2222, eyes = 0xff2200, arms = true, mouth = false }) {
  const g = new THREE.Group();
  const mSkin = bodyMat(skin);
  const mCloth = bodyMat(cloth);
  const mEyes = new THREE.MeshBasicMaterial({ color: eyes });
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.7, 0.3), mCloth);
  torso.position.y = 1.0;
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.32, 0.32), mSkin);
  head.position.y = 1.55;
  g.add(torso, head);
  if (mouth) {
    const jaw = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.12, 0.06), new THREE.MeshBasicMaterial({ color: 0x1a0505 }));
    jaw.position.set(0, 1.48, 0.16);
    const toothL = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.06, 0.02), new THREE.MeshBasicMaterial({ color: 0xd8d2c0 }));
    toothL.position.set(-0.07, 1.51, 0.19);
    const toothR = toothL.clone(); toothR.position.x = 0.07;
    g.add(jaw, toothL, toothR);
  } else {
    const eyeL = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.05, 0.02), mEyes);
    eyeL.position.set(-0.08, 1.58, 0.17);
    const eyeR = eyeL.clone(); eyeR.position.x = 0.08;
    g.add(eyeL, eyeR);
  }
  let armL = null, armR = null;
  if (arms) {
    armL = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.6, 0.14), mSkin);
    armL.position.set(-0.38, 1.0, 0);
    armR = armL.clone(); armR.position.x = 0.38;
    g.add(armL, armR);
  }
  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.65, 0.17), mCloth);
  legL.position.set(-0.14, 0.33, 0);
  const legR = legL.clone(); legR.position.x = 0.14;
  g.add(legL, legR);
  g.scale.setScalar(scale);
  g.userData.parts = { armL, armR, legL, legR, head, torso };
  g.userData.flashables = [mSkin, mCloth];
  return g;
}

let nextId = 1;

// Soft body-vs-body colliders: enemies push each other (and get pushed out
// of the player) apart horizontally. Heavier bodies shove lighter ones.
export function separateEnemies(G, dt) {
  const list = [];
  for (const e of G.enemies) if (!e.dead) list.push(e);
  const maxPush = 5 * dt;

  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    for (let j = i + 1; j < list.length; j++) {
      const b = list[j];
      const dy = Math.abs(a.pos.y - b.pos.y);
      if (dy > a.he.y + b.he.y) continue;
      let dx = b.pos.x - a.pos.x;
      let dz = b.pos.z - a.pos.z;
      const px = (a.he.x + b.he.x) - Math.abs(dx);
      const pz = (a.he.z + b.he.z) - Math.abs(dz);
      if (px <= 0 || pz <= 0) continue;
      if (dx === 0 && dz === 0) { dx = a.avoidBias * 0.01; dz = 0.01; }
      const wa = b.mass / (a.mass + b.mass);
      const wb = 1 - wa;
      if (px < pz) {
        const s = Math.sign(dx || 1) * Math.min(px, maxPush);
        a.pos.x -= s * wa;
        b.pos.x += s * wb;
      } else {
        const s = Math.sign(dz || 1) * Math.min(pz, maxPush);
        a.pos.z -= s * wa;
        b.pos.z += s * wb;
      }
    }

    // don't stand inside the player (the player is never pushed)
    const P = G.player;
    if (Math.abs(a.pos.y - P.pos.y) < a.he.y + P.he.y) {
      const dx = a.pos.x - P.pos.x;
      const dz = a.pos.z - P.pos.z;
      const px = (a.he.x + P.he.x) - Math.abs(dx);
      const pz = (a.he.z + P.he.z) - Math.abs(dz);
      if (px > 0 && pz > 0) {
        if (px < pz) a.pos.x += Math.sign(dx || a.avoidBias) * Math.min(px, maxPush);
        else a.pos.z += Math.sign(dz || a.avoidBias) * Math.min(pz, maxPush);
      }
    }
    a.mesh.position.copy(a.pos).y = a.pos.y - a.he.y;
  }
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
    this.name = 'FILTH';
    this.avoidBias = Math.random() < 0.5 ? 1 : -1; // preferred side to go around
  }

  get mass() { return this.he.x * this.he.x * this.he.y; }

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
      this.onDamaged();
    }
  }

  onDamaged() {}

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

  // true while the enemy is winding up a parryable attack
  parryWindow() { return false; }

  onParried() {}

  // Local avoidance: bend the desired direction sideways around packmates
  // blocking the path. Disabled at close range so bodies never get in the
  // way of an attack.
  steer(desired, playerDist) {
    if (playerDist < 3.2) return desired;
    const side = new THREE.Vector3(-desired.z, 0, desired.x);
    let lateral = 0;
    for (const o of this.G.enemies) {
      if (o === this || o.dead) continue;
      const dx = o.pos.x - this.pos.x;
      const dz = o.pos.z - this.pos.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 1e-4 || dist > 4.5) continue;
      if (Math.abs(o.pos.y - this.pos.y) > this.he.y + o.he.y) continue;
      const ahead = (dx * desired.x + dz * desired.z) / dist;
      if (ahead < 0.35) continue;
      const latOff = dx * side.x + dz * side.z;
      const pathWidth = (this.he.x + o.he.x) * 2.2;
      if (Math.abs(latOff) > pathWidth) continue;
      const weight = (1 - dist / 4.5) * ahead * (o.mass >= this.mass ? 1.4 : 0.8);
      lateral -= (latOff !== 0 ? Math.sign(latOff) : this.avoidBias) * weight;
    }
    if (lateral === 0) return desired;
    return desired.clone().addScaledVector(side, clamp(lateral, -1.3, 1.3)).normalize();
  }

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
      // the tell: bright yellow pulse during a parryable windup
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

// ---------------------------------------------------------------- FILTH
// Runs at the player nonstop (faster than walking speed), bites with a
// lunging jump. The bite is NOT parryable, but any damage cancels it.
export class Filth extends EnemyBase {
  constructor(G, pos) {
    super(G, pos);
    this.hp = this.maxHp = 24; // one clean revolver shot
    this.speed = randRange(12, 13.5);
    this.styleValue = 100;
    this.name = 'FILTH';
    this.mesh = humanoid({ skin: 0x7d9a5a, cloth: 0x3a4230, arms: false, mouth: true });
    this.mesh.position.copy(pos);
    G.scene.add(this.mesh);
    this.lungeT = 0;
    this.windup = 0;
    this.staggerT = 0;
  }

  onDamaged() {
    // taking any damage cancels the bite
    if (this.windup > 0 || this.lungeT > 0) {
      this.windup = 0;
      this.lungeT = 0;
      this.attackCd = 0.8;
      this.staggerT = 0.2;
    }
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
        // jumping bite: leaps at the player
        this.vel.x = toP.x * 17; this.vel.z = toP.z * 17;
        this.vel.y = Math.min(6 + Math.max(0, P.pos.y - this.pos.y) * 2, 10);
        this.lungeT = 0.35;
      }
    } else if (this.lungeT > 0) {
      this.lungeT -= dt;
      if (dist < 2.1 && this.attackCd <= 0) {
        P.damage(25, this.pos);
        this.attackCd = 1.2;
        this.lungeT = 0;
      }
    } else {
      if (dist < 3.2 && this.attackCd <= 0) {
        this.windup = 0.35;
        this.G.audio._tone(0.25, { from: 400, to: 950, type: 'sawtooth', gain: 0.12 }); // hiss (no parry ping: not parryable)
      } else {
        const move = this.steer(toP, dist);
        this.vel.x = move.x * this.speed;
        this.vel.z = move.z * this.speed;
      }
    }

    this.vel.y -= 30 * dt;
    const res = moveAndCollide(this.pos, this.vel, this.he, dt, G.colliders);
    if (res.hitWall && res.onGround && this.lungeT <= 0 && this.windup <= 0) this.vel.y = 8;

    this.mesh.position.copy(this.pos).y = this.pos.y - this.he.y;
    this.faceThePlayer();
    const parts = this.mesh.userData.parts;
    const sw = Math.sin(this.animT * 11) * 0.6;
    parts.legL.rotation.x = sw; parts.legR.rotation.x = -sw;
    parts.head.rotation.x = this.windup > 0 ? -0.5 : 0; // rears back to bite
    this.mesh.rotation.x = this.lungeT > 0 ? 0.35 : 0;
    this.updateFlash(dt);
  }
}

// ---------------------------------------------------------------- STRAY
// Keeps 12-26m away, backs off when crowded. Charges an orb for half a
// second before throwing; shoot the glowing orb to detonate the Stray.
export class Stray extends EnemyBase {
  constructor(G, pos) {
    super(G, pos);
    this.hp = this.maxHp = 50;
    this.styleValue = 120;
    this.name = 'STRAY';
    this.mesh = humanoid({ skin: 0xb8a794, cloth: 0x6e2f2a, eyes: 0x3fd6ff });
    this.mesh.position.copy(pos);
    G.scene.add(this.mesh);
    this.strafeDir = Math.random() < 0.5 ? 1 : -1;
    this.strafeT = randRange(1, 2);
    this.attackCd = randRange(1, 2);   // first throw 1-2s after spotting
    this.chargeT = 0;
    this.sawPlayer = false;
    // the charge orb, visible while winding up a throw
    this.orb = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.16, 0),
      new THREE.MeshBasicMaterial({ color: 0x44ddff })
    );
    this.orb.position.set(0.38, 1.5, 0.2);
    this.orb.visible = false;
    this.mesh.add(this.orb);
  }

  parryWindow() { return false; }

  onDamaged() {
    // hitting a Stray mid-charge detonates the orb in its hands
    if (this.chargeT > 0) {
      this.chargeT = 0;
      const at = this.pos.clone().add(new THREE.Vector3(0, 0.6, 0));
      this.G.effects.flash(at, 0x44ddff, 60, 0.15);
      this.G.effects.sparks(at);
      this.G.audio.charged();
      for (const o of this.G.enemies) {
        if (o !== this && !o.dead && o.pos.distanceTo(at) < 3) o.damage(30, at);
      }
      if (this.G.player.pos.distanceTo(at) < 3) this.G.player.damage(15, at);
      this.G.hud.style.add(60, 'ORB RUPTURE');
      this.damage(9999, null); // the blast kills it
    }
  }

  die() {
    this.orb.visible = false;
    super.die();
  }

  update(dt) {
    const G = this.G, P = G.player;
    if (this.dead) return;
    this.animT += dt;
    this.strafeT -= dt;
    if (this.strafeT <= 0) { this.strafeDir *= -1; this.strafeT = randRange(1, 2.5); }

    const toP = P.pos.clone().sub(this.pos);
    const dist = toP.length();
    toP.y = 0; toP.normalize();
    const side = new THREE.Vector3(-toP.z, 0, toP.x).multiplyScalar(this.strafeDir);
    const los = hasLos(this.pos.clone().setY(this.pos.y + 0.6), P.eyePos, G.colliders);

    if (!los) this.sawPlayer = false;
    else if (!this.sawPlayer) { this.sawPlayer = true; this.attackCd = randRange(1, 2); }

    const airborne = Math.abs(this.vel.y) > 4;
    if (this.chargeT > 0) {
      // committed to the throw: stand still, glow, release
      this.chargeT -= dt;
      this.vel.x = 0; this.vel.z = 0;
      this.orb.visible = true;
      this.orb.scale.setScalar(1 + (0.5 - this.chargeT) * 1.6);
      if (airborne) { this.chargeT = 0; this.orb.visible = false; this.attackCd = randRange(1, 2.5); }
      else if (this.chargeT <= 0) {
        this.orb.visible = false;
        const from = this.pos.clone().add(new THREE.Vector3(0, 0.6, 0));
        const aim = P.pos.clone().addScaledVector(P.vel, dist / 20 * 0.4).sub(from).normalize();
        G.spawnProjectile(from, aim.multiplyScalar(20), { damage: 20, color: 0x44ddff, radius: 0.22 });
        G.audio.projShoot();
        this.attackCd = randRange(1, 2.5);
      }
    } else {
      let move = new THREE.Vector3();
      if (!los || dist > 26) move.copy(toP);            // approach
      else if (dist < 12) move.copy(toP).negate();      // back off
      move.addScaledVector(side, 0.8).normalize();
      move = this.steer(move, dist);
      this.vel.x = move.x * 6;
      this.vel.z = move.z * 6;
      this.attackCd -= dt;
      if (los && dist < 30 && this.attackCd <= 0) {
        this.chargeT = 0.5;
        G.audio.parryPing();
      }
    }

    this.vel.y -= 30 * dt;
    const res = moveAndCollide(this.pos, this.vel, this.he, dt, G.colliders);
    if (res.hitWall && res.onGround) this.vel.y = 7;

    this.mesh.position.copy(this.pos).y = this.pos.y - this.he.y;
    this.faceThePlayer();
    const parts = this.mesh.userData.parts;
    parts.armR.rotation.x = this.chargeT > 0 ? -2.2 : -1.4;
    const sw = Math.sin(this.animT * 6) * 0.3;
    parts.legL.rotation.x = sw; parts.legR.rotation.x = -sw;
    this.updateFlash(dt);
  }
}

function buildFaceMesh() {
  const g = new THREE.Group();
  const stone = bodyMat(0x8f8578);
  const stoneDark = bodyMat(0x6b6156);
  const head = new THREE.Mesh(new THREE.BoxGeometry(2.6, 2.6, 2.2), stone);
  const brow = new THREE.Mesh(new THREE.BoxGeometry(2.7, 0.5, 0.5), stoneDark);
  brow.position.set(0, 0.75, 1.0);
  const nose = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.9, 0.4), stoneDark);
  nose.position.set(0, -0.1, 1.15);
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0xff6a00 });
  const eyeL = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.3, 0.1), eyeMat);
  eyeL.position.set(-0.7, 0.35, 1.12);
  const eyeR = eyeL.clone(); eyeR.position.x = 0.7;
  const mouth = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.35, 0.1), new THREE.MeshBasicMaterial({ color: 0x220a05 }));
  mouth.position.set(0, -0.85, 1.12);
  g.add(head, brow, nose, eyeL, eyeR, mouth);
  // ghostly hanging legs
  const legMat = new THREE.MeshBasicMaterial({ color: 0xbbccdd, transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false });
  for (const [lx, lz] of [[-1, -0.7], [1, -0.7], [-1.2, 0.4], [1.2, 0.4]]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.16, 3.4, 0.16), legMat);
    leg.position.set(lx, -2.5, lz);
    leg.rotation.z = -lx * 0.15;
    g.add(leg);
  }
  g.userData.flashables = [stone, stoneDark];
  g.userData.eyeMat = eyeMat;
  return g;
}

// -------------------------------------------------------- MALICIOUS FACE
// Floating stone head boss. Slowly drifts toward the player, alternating
// orb barrages with a telegraphed hitscan beam. Enrages below half health.
export class MaliciousFace extends EnemyBase {
  constructor(G, pos) {
    super(G, pos);
    this.hp = this.maxHp = 500;
    this.styleValue = 600;
    this.name = 'MALICIOUS FACE';
    this.he.set(1.4, 1.4, 1.4);
    this.mesh = buildFaceMesh();
    this.mesh.position.copy(pos);
    G.scene.add(this.mesh);
    this.baseY = pos.y;
    this.state = 'drift';
    this.stateT = randRange(1.5, 2.5);
    this.barrageLeft = 0;
    this.barrageTick = 0;
    this.beamT = 0;
    this.beamDir = new THREE.Vector3(0, 0, -1);
    this.beamsQueued = 0;
    this.enraged = false;
    this.roared = false;
    // beam telegraph line
    this.beamLine = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial({ color: 0xff2200, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    this.beamLine.visible = false;
    G.scene.add(this.beamLine);
  }

  damage(amount, fromPos, isSlam) {
    super.damage(amount, fromPos, false);
    if (!this.dead) {
      this.G.hud.bossBar(this.hp / this.maxHp, 'MALICIOUS FACE');
      if (!this.enraged && this.hp < this.maxHp / 2) {
        this.enraged = true;
        this.mesh.userData.eyeMat.color.setHex(0xff1100);
        this.G.audio.wardenRoar();
        this.G.hud.message('IT IS FURIOUS');
      }
    }
  }

  die() {
    this.G.hud.bossBar(0, null);
    this.beamLine.visible = false;
    this.G.scene.remove(this.beamLine);
    this.G.effects.gibs(this.pos.clone());
    this.G.effects.gibs(this.pos.clone().add(new THREE.Vector3(0, 1, 0)));
    this.G.effects.flash(this.pos, 0xff6a00, 80, 0.4);
    this.G.effects.shake(0.45);
    super.die();
  }

  update(dt) {
    const G = this.G, P = G.player;
    if (this.dead) return;
    if (!this.roared) {
      this.roared = true;
      G.audio.wardenRoar();
      G.hud.bossBar(1, 'MALICIOUS FACE');
    }
    this.animT += dt;
    const toP = P.pos.clone().sub(this.pos);
    const dist = toP.length();
    const toPFlat = toP.clone().setY(0).normalize();

    // hover: drift toward/away to hold 9-16m, bob gently
    let moveScale = 0;
    if (dist > 16) moveScale = 1;
    else if (dist < 9) moveScale = -0.7;
    const hoverY = this.baseY + Math.sin(this.animT * 1.2) * 0.5;
    this.vel.x = toPFlat.x * 3.2 * moveScale;
    this.vel.z = toPFlat.z * 3.2 * moveScale;
    this.vel.y = clamp((hoverY + clamp(P.pos.y - 1, 0, 3) - this.pos.y) * 1.5, -3, 3);
    moveAndCollide(this.pos, this.vel, this.he, dt, G.colliders);
    this.mesh.position.copy(this.pos);
    this.faceThePlayer();

    this.stateT -= dt;
    if (this.state === 'drift') {
      if (this.stateT <= 0) {
        // enraged: strongly prefers the beam, fires two in a row
        if (this.enraged ? Math.random() < 0.75 : Math.random() < 0.35) {
          this.state = 'beam';
          this.beamT = 1.0;
          this.beamsQueued = this.enraged ? 2 : 1;
          G.audio.parryPing();
        } else {
          this.state = 'barrage';
          this.barrageLeft = 10;
          this.barrageTick = 0;
        }
      }
    } else if (this.state === 'barrage') {
      this.barrageTick -= dt;
      if (this.barrageTick <= 0 && this.barrageLeft > 0) {
        this.barrageTick = 0.12;
        this.barrageLeft--;
        const from = this.pos.clone().add(new THREE.Vector3(0, -0.4, 0));
        const aim = P.pos.clone().addScaledVector(P.vel, dist / 16 * 0.3).sub(from).normalize();
        aim.x += randRange(-0.08, 0.08);
        aim.y += randRange(-0.04, 0.06);
        aim.z += randRange(-0.08, 0.08);
        G.spawnProjectile(from, aim.normalize().multiplyScalar(16), { damage: 15, color: 0xff8830, radius: 0.28 });
        G.audio.projShoot();
      }
      if (this.barrageLeft <= 0) {
        this.state = 'drift';
        this.stateT = this.enraged ? randRange(1, 2) : randRange(2, 3.5);
      }
    } else if (this.state === 'beam') {
      this.beamT -= dt;
      const from = this.pos.clone().add(new THREE.Vector3(0, 0, 0));
      if (this.beamT > 0.3) {
        // tracking phase: the telegraph line follows the player
        this.beamDir.copy(P.eyePos).sub(from).normalize();
        this._showBeamLine(from, 0.06, 0.35);
      } else if (this.beamT > 0) {
        // locked: last chance to dodge
        this._showBeamLine(from, 0.14, 0.9);
      } else {
        this._fireBeam(from);
        this.beamsQueued--;
        if (this.beamsQueued > 0 && !this.dead) {
          this.beamT = 0.8;
        } else {
          this.beamLine.visible = false;
          this.state = 'drift';
          this.stateT = this.enraged ? randRange(0.8, 1.6) : randRange(2, 3.5);
        }
      }
    }

    this.updateFlash(dt);
  }

  _showBeamLine(from, thick, opacity) {
    const reach = raycastLevel(from, this.beamDir, this.G.colliders, 80);
    this.beamLine.visible = true;
    this.beamLine.material.opacity = opacity;
    this.beamLine.scale.set(thick, thick, reach);
    this.beamLine.position.copy(from).addScaledVector(this.beamDir, reach / 2);
    this.beamLine.lookAt(from.clone().addScaledVector(this.beamDir, reach));
  }

  _fireBeam(from) {
    const G = this.G;
    const reach = raycastLevel(from, this.beamDir, G.colliders, 80);
    const end = from.clone().addScaledVector(this.beamDir, reach);
    G.audio.charged();
    G.effects.tracer(from, end);
    G.effects.flash(end, 0xff4400, 60, 0.2);
    G.effects.sparks(end);
    G.effects.shake(0.15);
    // hit if the player is close to the beam segment
    const P = G.player;
    const toP = P.pos.clone().sub(from);
    const t = clamp(toP.dot(this.beamDir), 0, reach);
    const closest = from.clone().addScaledVector(this.beamDir, t);
    if (closest.distanceTo(P.pos) < 1.1) {
      P.damage(35, this.pos);
    } else if (end.distanceTo(P.pos) < 3) {
      P.damage(20, end); // explosion splash at the impact point
    }
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
    // shader recompile — use an additive halo instead
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

  explode() {
    if (this.dead) return;
    this.dead = true;
    this.G.effects.sparks(this.pos);
    this.G.effects.flash(this.pos, this.color, 20, 0.1);
    this.G.scene.remove(this.mesh);
  }

  update(dt) {
    if (this.dead) return;
    this.life -= dt;
    if (this.life <= 0) return this.explode();

    // mercy frames: the orb has touched the player but the hit lands with a
    // small delay, leaving a last-chance parry window
    if (this.mercyT > 0) {
      this.mercyT -= dt;
      if (this.mercyT <= 0) {
        this.G.player.damage(this.damage, this.pos);
        return this.explode();
      }
      return;
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
    // hit level (breakable glass shatters)
    for (const c of this.G.colliders) {
      if (this.pos.x > c.min.x - this.radius && this.pos.x < c.max.x + this.radius &&
          this.pos.y > c.min.y - this.radius && this.pos.y < c.max.y + this.radius &&
          this.pos.z > c.min.z - this.radius && this.pos.z < c.max.z + this.radius) {
        this.G.level.breakHit(c);
        return this.explode();
      }
    }
  }
}

// Add one hidden instance of every enemy/projectile material to the scene,
// so their shader programs compile during the loading screen instead of
// hitching on first spawn. Returns a cleanup function.
export function prewarmEnemyMeshes(scene) {
  const stash = [];
  const dummies = [
    humanoid({ skin: 0x7d9a5a, cloth: 0x3a4230, arms: false, mouth: true }),
    humanoid({ skin: 0xb8a794, cloth: 0x6e2f2a, eyes: 0x3fd6ff }),
  ];
  const orb = new THREE.Mesh(new THREE.OctahedronGeometry(0.2, 0), new THREE.MeshBasicMaterial({ color: 0x44ddff }));
  const halo = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.4, 0),
    new THREE.MeshBasicMaterial({ color: 0x44ddff, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false })
  );
  orb.add(halo);
  dummies.push(orb);
  dummies.push(buildFaceMesh());
  for (const d of dummies) {
    d.position.set(0, 1, -2);
    scene.add(d);
    stash.push(d);
  }
  return () => { for (const d of stash) scene.remove(d); };
}
