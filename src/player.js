import * as THREE from 'three';
import { clamp, moveAndCollide, wallNormal } from './utils.js';

const WALK_SPEED = 11;
const AIR_ACCEL = 40;
const GRAVITY = 32;
const JUMP_V = 11.5;
const DASH_SPEED = 27;
const DASH_TIME = 0.14;
const SLIDE_SPEED = 18;
const SLAM_V = -40;
const MAX_STAMINA = 3;
const STAMINA_REGEN = 0.7;    // per second, like Standard difficulty
const MAX_WALL_JUMPS = 3;     // per airtime
const WALL_JUMP_V = 10.5;
const WALL_JUMP_PUSH = 9;
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
    this.wallJumps = MAX_WALL_JUMPS;
    this.targetFov = 95;
    this.airTime = 0;
    this.clingT = 0;        // time spent wall-clinging (friction fades)
    this.slamT = 0;         // time spent falling in a slam (fuels slam jump)
    this.slamLandT = 0;     // window after slam landing for a boosted jump
    this.jumpBufferT = 0;   // jump pressed just before landing
    this.slideSpeed = SLIDE_SPEED;
    this._scrapeT = 0;
  }

  slideKeyDown(input) { return input.down('ControlLeft') || input.down('ControlRight') || input.down('KeyC'); }
  slideKeyPressed(input) { return input.justPressed('ControlLeft') || input.justPressed('ControlRight') || input.justPressed('KeyC'); }

  _startSlide(dir, boost = 0) {
    this.sliding = true;
    this.slideDir.copy(dir);
    this.slideSpeed = SLIDE_SPEED + boost;
    this.he.y = this.heSlide;
    this.pos.y -= (this.heStand - this.heSlide) - 0.01;
    this.G.audio.slide();
  }

  _stopSlide() {
    this.he.y = this.heStand;
    this.pos.y += (this.heStand - this.heSlide) + 0.01;
    this.sliding = false;
  }

  // Jump from the ground. Right after a slam landing it becomes a slam
  // jump: the height scales with how long the slam fell, chainable.
  _doJump() {
    const G = this.G;
    this.jumpBufferT = 0;
    this.coyote = 0;
    this.onGround = false;
    if (this.slamLandT > 0) {
      this.vel.y = JUMP_V + 2 + Math.min(this.slamT * 12, 12);
      this.slamLandT = 0;
      G.audio.jump();
      G.audio._tone(0.15, { from: 300, to: 700, type: 'square', gain: 0.15 });
      G.hud.style.add(20, 'SLAM JUMP');
    } else {
      this.vel.y = JUMP_V;
      G.audio.jump();
    }
    if (this.sliding) {
      // slide-jump keeps momentum
      const spd = this.slideSpeed * 1.15;
      this._stopSlide();
      this.vel.x = this.slideDir.x * spd;
      this.vel.z = this.slideDir.z * spd;
    }
    this.slamT = 0;
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
    // stamina regen pauses while sliding, like in the original
    if (!this.sliding) this.stamina = Math.min(MAX_STAMINA, this.stamina + dt * STAMINA_REGEN);

    // wish direction
    const wish = new THREE.Vector3();
    if (input.down('KeyW')) wish.add(this.forwardFlat());
    if (input.down('KeyS')) wish.sub(this.forwardFlat());
    if (input.down('KeyD')) wish.add(this.rightFlat());
    if (input.down('KeyA')) wish.sub(this.rightFlat());
    if (wish.lengthSq() > 0) wish.normalize();

    // --- dash ---
    if (input.justPressed('ShiftLeft') && this.dashT <= 0) {
      if (this.stamina >= 1) {
        this.stamina -= 1;
        this.dashT = DASH_TIME;
        this.dashDir.copy(wish.lengthSq() > 0 ? wish : this.forwardFlat());
        if (this.sliding) this._stopSlide();
        G.audio.dash();
        G.hud.style.add(2, null);
      } else {
        G.audio._tone(0.08, { from: 200, to: 120, type: 'square', gain: 0.12 }); // out of stamina
      }
    }

    // --- slide / slam ---
    if (this.slideKeyPressed(input)) {
      if (this.onGround && !this.sliding) {
        this._startSlide(wish.lengthSq() > 0 ? wish : this.forwardFlat());
      } else if (!this.onGround && !this.slamming) {
        // ground slam
        this.slamming = true;
        this.vel.set(0, SLAM_V, 0);
        this.dashT = 0;
      }
    }
    // stand up when the key is released, or after genuinely leaving the
    // ground (airTime guard: one-frame contact flickers must not end a slide)
    if (this.sliding && (!this.slideKeyDown(input) || this.airTime > 0.1)) {
      const airborne = this.airTime > 0.1;
      this._stopSlide();
      // slide key held while flying off a ledge → turn into a slam
      if (airborne && this.slideKeyDown(input) && !this.slamming) {
        this.slamming = true;
        this.vel.set(0, SLAM_V, 0);
        this.dashT = 0;
      }
    }

    // --- jump / wall jump / slam jump ---
    if (input.justPressed('Space')) {
      if (this.onGround || this.coyote > 0) {
        this._doJump();
      } else if (this.wallJumps > 0) {
        const n = wallNormal(this.pos, this.he, G.colliders);
        if (n) {
          this.wallJumps--;
          // slam storage: wall-jumping out of a slam converts the fall
          // into a bigger burst
          const stored = this.slamming ? 1.35 : 1;
          this.slamming = false;
          this.vel.y = WALL_JUMP_V * stored;
          const along = this.vel.clone().setY(0).addScaledVector(n, -n.dot(this.vel));
          this.vel.x = along.x * 0.7 + n.x * WALL_JUMP_PUSH * stored;
          this.vel.z = along.z * 0.7 + n.z * WALL_JUMP_PUSH * stored;
          G.audio.jump();
          G.audio._noise(0.1, { freq: 900, gain: 0.2, type: 'highpass' });
          G.effects.dust(this.pos.clone().addScaledVector(n, -0.4));
          G.effects.shake(0.04);
          if (stored > 1) G.hud.style.add(30, 'SLAM STORAGE');
        } else {
          this.jumpBufferT = 0.15; // buffer it: fires the moment we land
        }
      } else {
        this.jumpBufferT = 0.15;
      }
    }

    // --- horizontal movement ---
    if (this.dashT > 0) {
      this.dashT -= dt;
      this.vel.x = this.dashDir.x * DASH_SPEED;
      this.vel.z = this.dashDir.z * DASH_SPEED;
      this.vel.y = 0;
    } else if (this.sliding) {
      // a slide entered from a slam starts faster and settles back down
      this.slideSpeed = Math.max(SLIDE_SPEED, this.slideSpeed - 10 * dt);
      this.vel.x = this.slideDir.x * this.slideSpeed;
      this.vel.z = this.slideDir.z * this.slideSpeed;
      // steer slightly
      this.vel.addScaledVector(this.rightFlat(), (input.down('KeyD') ? 1 : 0) * 3 - (input.down('KeyA') ? 1 : 0) * 3);
    } else if (this.onGround) {
      this.vel.x = wish.x * WALK_SPEED;
      this.vel.z = wish.z * WALK_SPEED;
    } else {
      // air control: steer freely, but never GAIN speed past the cap —
      // existing momentum (dash, slide-jump) is preserved
      const hv0 = Math.hypot(this.vel.x, this.vel.z);
      this.vel.x += wish.x * AIR_ACCEL * dt;
      this.vel.z += wish.z * AIR_ACCEL * dt;
      const hv = Math.hypot(this.vel.x, this.vel.z);
      const cap = Math.max(WALK_SPEED * 1.4, hv0);
      if (hv > cap) { this.vel.x *= cap / hv; this.vel.z *= cap / hv; }
    }

    // gravity; a slam keeps accelerating downward the longer it falls
    if (this.dashT <= 0) this.vel.y -= GRAVITY * dt;
    if (this.slamming) {
      this.slamT += dt;
      this.vel.y -= 60 * dt;
      this.vel.y = Math.max(this.vel.y, -75);
    } else {
      this.vel.y = Math.max(this.vel.y, -55);
    }

    const wasGround = this.onGround;
    const preFallV = this.vel.y;
    const res = moveAndCollide(this.pos, this.vel, this.he, dt, G.colliders);
    this.onGround = res.onGround;
    this.airTime = this.onGround ? 0 : this.airTime + dt;

    // slamming onto glass punches straight through it
    if (this.onGround && !wasGround && this.slamming && G.level && G.level.breakGlassUnder(this)) {
      this.onGround = false;
      this.vel.y = SLAM_V;
    }

    if (this.onGround && !wasGround) {
      this.wallJumps = MAX_WALL_JUMPS;
      this.clingT = 0;
      this.coyote = 0;
      if (!this.slamming && preFallV < -12) G.audio.land();
    }
    // slam landing: separate from the air->ground transition so a slam
    // started at ground level still resolves instead of sticking
    if (this.onGround && this.slamming) {
      this.slamming = false;
      this.slamLandT = 0.25; // window for a boosted slam jump
      G.audio.slam();
      G.effects.shake(0.3);
      G.effects.spawn(this.pos.clone().setY(this.pos.y - this.he.y + 0.1), { count: 10, mat: 'smoke', speed: 5, size: 0.2, life: 0.5, up: 2, gravity: 2 });
      // the shockwave grows with time spent slamming
      const radius = 4.5 + Math.min(this.slamT * 2, 2.5);
      for (const e of G.enemies) {
        if (e.dead) continue;
        const d = e.pos.distanceTo(this.pos);
        if (d < radius) {
          e.damage(40, this.pos, true);
          G.hud.style.add(60, 'SLAM DUNK');
        }
      }
      // keep holding slide through a slam to come out of it sliding, faster
      if (this.slideKeyDown(input) && !this.sliding) {
        this._startSlide(wish.lengthSq() > 0 ? wish : this.forwardFlat(), Math.min(this.slamT * 8, 8));
      }
    }
    // buffered jump fires the moment we land (slam jump if just slammed)
    if (this.onGround && this.jumpBufferT > 0) this._doJump();
    if (wasGround && !this.onGround) this.coyote = 0.12;
    else this.coyote = Math.max(0, this.coyote - dt);
    this.jumpBufferT = Math.max(0, this.jumpBufferT - dt);
    this.slamLandT = Math.max(0, this.slamLandT - dt);
    if (this.onGround && this.slamLandT <= 0) this.slamT = 0;

    // --- wall cling: pressing into a wall while falling slows the drop,
    // but the friction wears off the longer you hang on ---
    if (!this.onGround && this.vel.y < 0 && !this.slamming && wish.lengthSq() > 0) {
      const n = wallNormal(this.pos, this.he, G.colliders);
      if (n && wish.dot(n) < -0.5) {
        this.clingT += dt;
        const maxFall = -(2.5 + this.clingT * 9);
        // ease toward the friction cap instead of snapping to it
        if (this.vel.y < maxFall) this.vel.y += (maxFall - this.vel.y) * Math.min(1, dt * 10);
        this._scrapeT += dt;
        if (this._scrapeT > 0.18) {
          this._scrapeT = 0;
          G.audio._noise(0.09, { freq: 1800, gain: 0.07, type: 'highpass' });
          G.effects.dust(this.pos.clone().addScaledVector(n, -0.4));
        }
      } else {
        this.clingT = Math.max(0, this.clingT - dt * 2);
      }
    }

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

    // dynamic FOV: wider while dashing or sliding
    this.targetFov = 95 + (this.dashT > 0 ? 9 : 0) + (this.sliding ? 5 : 0);
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
