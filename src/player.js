import * as THREE from 'three';
import { clamp, moveAndCollide } from './utils.js';

const WALK_SPEED = 11;
const AIR_ACCEL = 40;
const GRAVITY = 32;
const JUMP_V = 11.5;
const DASH_SPEED = 27;
const DASH_TIME = 0.14;
const SLIDE_SPEED = 16;
const SLAM_V = -40;
const MAX_STAMINA = 3;
const HARD_DEATH_Y = -60;

export class Player {
  constructor(G) {
    this.G = G;
    this.pos = new THREE.Vector3(0, 1.0, 0);   // capsule center
    this.vel = new THREE.Vector3();
    this.he = new THREE.Vector3(0.35, 0.85, 0.35); // half extents
    this.heStand = 0.85;
    this.heSlide = 0.45;
    this.yaw = 0;
    this.pitch = 0;
    this.hp = 100;
    this.maxHp = 100;
    this.stamina = MAX_STAMINA;
    this.onGround = false;
    this.dashT = 0;
    this.dashDir = new THREE.Vector3();
    this.sliding = false;
    this.slideDir = new THREE.Vector3();
    this.slamming = false;
    this.coyote = 0;
    this.hurtCooldown = 0;
    this.dead = false;
    this.stepT = 0;
    this.landVel = 0;
  }

  get eyePos() {
    const crouchDrop = this.sliding ? 0.35 : 0;
    return this.pos.clone().add(new THREE.Vector3(0, 0.65 - crouchDrop, 0));
  }

  forwardFlat() {
    return new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
  }
  rightFlat() {
    return new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
  }
  aimDir() {
    const cp = Math.cos(this.pitch);
    return new THREE.Vector3(-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp);
  }

  damage(amount, fromPos = null) {
    if (this.dead || this.hurtCooldown > 0 || this.dashT > 0) return;
    this.hp -= amount;
    this.hurtCooldown = 0.35;
    this.G.audio.playerHurt();
    this.G.hud.damageFlash();
    this.G.effects.shake(0.25);
    this.G.hud.style.hurt();
    if (fromPos) {
      const push = this.pos.clone().sub(fromPos).setY(0).normalize().multiplyScalar(6);
      this.vel.add(push);
    }
    if (this.hp <= 0) {
      this.hp = 0;
      this.dead = true;
      this.G.onPlayerDeath();
    }
  }

  heal(amount) {
    if (this.dead) return;
    this.hp = Math.min(this.maxHp, this.hp + amount);
  }

  update(dt, input) {
    const G = this.G;
    if (this.dead) return;

    // look
    const [mdx, mdy] = input.consumeMouse();
    this.yaw -= mdx * input.sensitivity;
    this.pitch = clamp(this.pitch - mdy * input.sensitivity, -1.53, 1.53);

    this.hurtCooldown = Math.max(0, this.hurtCooldown - dt);
    this.stamina = Math.min(MAX_STAMINA, this.stamina + dt * 0.9);

    // wish direction
    const wish = new THREE.Vector3();
    if (input.down('KeyW')) wish.add(this.forwardFlat());
    if (input.down('KeyS')) wish.sub(this.forwardFlat());
    if (input.down('KeyD')) wish.add(this.rightFlat());
    if (input.down('KeyA')) wish.sub(this.rightFlat());
    if (wish.lengthSq() > 0) wish.normalize();

    // --- dash ---
    if (input.justPressed('ShiftLeft') && this.stamina >= 1 && this.dashT <= 0) {
      this.stamina -= 1;
      this.dashT = DASH_TIME;
      this.dashDir.copy(wish.lengthSq() > 0 ? wish : this.forwardFlat());
      this.sliding = false;
      G.audio.dash();
      G.hud.style.add(2, null);
    }

    // --- slide ---
    if (input.justPressed('ControlLeft')) {
      if (this.onGround && !this.sliding) {
        this.sliding = true;
        this.slideDir.copy(wish.lengthSq() > 0 ? wish : this.forwardFlat());
        this.he.y = this.heSlide;
        this.pos.y -= (this.heStand - this.heSlide) - 0.01;
        G.audio.slide();
      } else if (!this.onGround && !this.slamming) {
        // ground slam
        this.slamming = true;
        this.vel.set(0, SLAM_V, 0);
        this.dashT = 0;
      }
    }
    if (this.sliding && (!input.down('ControlLeft') || !this.onGround)) {
      // try to stand up (check headroom)
      this.he.y = this.heStand;
      this.pos.y += (this.heStand - this.heSlide) + 0.01;
      this.sliding = false;
    }

    // --- jump ---
    if (input.justPressed('Space') && (this.onGround || this.coyote > 0)) {
      this.vel.y = JUMP_V;
      this.onGround = false;
      this.coyote = 0;
      if (this.sliding) {
        // slide-jump keeps momentum
        this.he.y = this.heStand;
        this.pos.y += (this.heStand - this.heSlide) + 0.01;
        this.sliding = false;
        this.vel.x = this.slideDir.x * SLIDE_SPEED * 1.15;
        this.vel.z = this.slideDir.z * SLIDE_SPEED * 1.15;
      }
      G.audio.jump();
    }

    // --- horizontal movement ---
    if (this.dashT > 0) {
      this.dashT -= dt;
      this.vel.x = this.dashDir.x * DASH_SPEED;
      this.vel.z = this.dashDir.z * DASH_SPEED;
      this.vel.y = 0;
    } else if (this.sliding) {
      this.vel.x = this.slideDir.x * SLIDE_SPEED;
      this.vel.z = this.slideDir.z * SLIDE_SPEED;
      // steer slightly
      this.vel.addScaledVector(this.rightFlat(), (input.down('KeyD') ? 1 : 0) * 3 - (input.down('KeyA') ? 1 : 0) * 3);
    } else if (this.onGround) {
      this.vel.x = wish.x * WALK_SPEED;
      this.vel.z = wish.z * WALK_SPEED;
    } else {
      // air control
      this.vel.x += wish.x * AIR_ACCEL * dt;
      this.vel.z += wish.z * AIR_ACCEL * dt;
      const hv = Math.hypot(this.vel.x, this.vel.z);
      const cap = Math.max(WALK_SPEED * 1.4, hv);
      if (hv > cap) { this.vel.x *= cap / hv; this.vel.z *= cap / hv; }
    }

    // gravity
    if (this.dashT <= 0) this.vel.y -= GRAVITY * dt;
    this.vel.y = Math.max(this.vel.y, -55);

    const wasGround = this.onGround;
    const preFallV = this.vel.y;
    const res = moveAndCollide(this.pos, this.vel, this.he, dt, G.colliders);
    this.onGround = res.onGround;

    if (this.onGround && !wasGround) {
      if (this.slamming) {
        this.slamming = false;
        G.audio.slam();
        G.effects.shake(0.3);
        G.effects.spawn(this.pos.clone().setY(this.pos.y - this.he.y + 0.1), { count: 10, mat: 'smoke', speed: 5, size: 0.2, life: 0.5, up: 2, gravity: 2 });
        // slam damages nearby enemies
        for (const e of G.enemies) {
          if (e.dead) continue;
          const d = e.pos.distanceTo(this.pos);
          if (d < 4.5) {
            e.damage(40, this.pos, true);
            G.hud.style.add(60, 'SLAM DUNK');
          }
        }
      } else if (preFallV < -12) {
        G.audio.land();
      }
      this.coyote = 0;
    }
    if (wasGround && !this.onGround) this.coyote = 0.12;
    else this.coyote = Math.max(0, this.coyote - dt);

    // footsteps
    const hSpeed = Math.hypot(this.vel.x, this.vel.z);
    if (this.onGround && hSpeed > 3 && !this.sliding) {
      this.stepT += dt * hSpeed;
      if (this.stepT > 4.2) {
        this.stepT = 0;
        G.audio._noise(0.06, { freq: 500, gain: 0.08 });
      }
    }

    // out of bounds
    if (this.pos.y < HARD_DEATH_Y) this.damage(1000);
  }

  applyToCamera(camera, effects, t) {
    const eye = this.eyePos;
    camera.position.copy(eye);
    // view bob
    const hSpeed = Math.hypot(this.vel.x, this.vel.z);
    if (this.onGround && hSpeed > 3 && !this.sliding) {
      camera.position.y += Math.sin(t * 12) * 0.035;
    }
    if (effects.shakeAmt > 0.001) {
      camera.position.x += (Math.random() - 0.5) * effects.shakeAmt;
      camera.position.y += (Math.random() - 0.5) * effects.shakeAmt;
    }
    camera.rotation.set(0, 0, 0);
    camera.rotateY(this.yaw);
    camera.rotateX(this.pitch);
    // slide tilt
    const targetRoll = this.sliding ? 0.06 : 0;
    camera.rotateZ(targetRoll);
  }
}
