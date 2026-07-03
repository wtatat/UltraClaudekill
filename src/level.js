import * as THREE from 'three';
import { aabb } from './utils.js';
import { Filth, Stray, MaliciousFace } from './enemies.js';

// ---------- procedural textures (canvas, pixel-art style) ----------
function makeTexture(draw, size = 64) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d');
  draw(ctx, size);
  const tex = new THREE.CanvasTexture(cv);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function noiseRect(ctx, x, y, w, h, base, spread, n = 60) {
  ctx.fillStyle = base;
  ctx.fillRect(x, y, w, h);
  for (let i = 0; i < n; i++) {
    const v = (Math.random() - 0.5) * spread;
    ctx.fillStyle = `rgba(${v > 0 ? 255 : 0},${v > 0 ? 255 : 0},${v > 0 ? 255 : 0},${Math.abs(v)})`;
    ctx.fillRect(x + Math.random() * w, y + Math.random() * h, 1 + Math.random() * 3, 1 + Math.random() * 3);
  }
}

function brickTex() {
  return makeTexture((ctx, s) => {
    noiseRect(ctx, 0, 0, s, s, '#4a3430', 0.25, 200);
    ctx.fillStyle = '#241514';
    for (let row = 0; row < 4; row++) {
      const y = row * 16;
      ctx.fillRect(0, y, s, 2);
      const off = row % 2 ? 16 : 0;
      for (let c = 0; c < 3; c++) ctx.fillRect((off + c * 32) % s, y, 2, 16);
    }
    for (let i = 0; i < 90; i++) {
      ctx.fillStyle = `rgba(0,0,0,${Math.random() * 0.3})`;
      ctx.fillRect(Math.random() * s, Math.random() * s, 2, 2);
    }
  });
}

function floorTex() {
  return makeTexture((ctx, s) => {
    noiseRect(ctx, 0, 0, s, s, '#3a3234', 0.2, 220);
    ctx.strokeStyle = '#1c1416';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, s - 2, s - 2);
    ctx.strokeRect(32, 0, 0.5, s);
    ctx.beginPath(); ctx.moveTo(0, 32); ctx.lineTo(s, 32); ctx.stroke();
  });
}

function panelTex() {
  return makeTexture((ctx, s) => {
    noiseRect(ctx, 0, 0, s, s, '#33383f', 0.18, 180);
    ctx.strokeStyle = '#14171b';
    ctx.lineWidth = 2;
    ctx.strokeRect(2, 2, s - 4, s - 4);
    ctx.fillStyle = '#565e68';
    for (const [x, y] of [[6, 6], [s - 9, 6], [6, s - 9], [s - 9, s - 9]]) ctx.fillRect(x, y, 3, 3);
  });
}

function lavaTex() {
  return makeTexture((ctx, s) => {
    noiseRect(ctx, 0, 0, s, s, '#c33000', 0.3, 150);
    for (let i = 0; i < 26; i++) {
      ctx.fillStyle = ['#ff7b00', '#ffb300', '#8a1500'][i % 3];
      ctx.beginPath();
      ctx.arc(Math.random() * s, Math.random() * s, 2 + Math.random() * 6, 0, 7);
      ctx.fill();
    }
  });
}

function woodTex() {
  return makeTexture((ctx, s) => {
    noiseRect(ctx, 0, 0, s, s, '#6b4a26', 0.22, 160);
    ctx.strokeStyle = '#43301a';
    for (let i = 0; i < 6; i++) {
      ctx.lineWidth = 1 + Math.random() * 2;
      ctx.beginPath();
      ctx.moveTo(0, i * 11 + Math.random() * 4);
      ctx.lineTo(s, i * 11 + Math.random() * 6);
      ctx.stroke();
    }
  });
}

// ---------- level builder ----------
export class Level {
  constructor(G) {
    this.G = G;
    this.doors = [];
    this.triggers = [];
    this.pickups = [];
    this.rooms = {};
    this.breakables = [];
    this.breakableByCollider = new Map();
    this.hazards = [];        // { min, max, dps zones that hurt player AND enemies }
    this.spinners = [];       // rotating hazard props
    this.hazardKills = 0;
    this.challengeDone = false;
    this.secretsFound = 0;
    this.secretsTotal = 7;
    this._buildMaterials();
    this._build();
  }

  _buildMaterials() {
    const brick = brickTex(); brick.repeat.set(2, 2);
    const floor = floorTex(); floor.repeat.set(2, 2);
    const panel = panelTex(); panel.repeat.set(2, 2);
    const lava = lavaTex(); lava.repeat.set(3, 3);
    const wood = woodTex();
    this.mats = {
      brick: new THREE.MeshStandardMaterial({ map: brick, roughness: 1 }),
      floor: new THREE.MeshStandardMaterial({ map: floor, roughness: 1 }),
      panel: new THREE.MeshStandardMaterial({ map: panel, roughness: 0.8, metalness: 0.2 }),
      dark: new THREE.MeshStandardMaterial({ color: 0x17141a, roughness: 1 }),
      lava: new THREE.MeshStandardMaterial({ map: lava, emissive: 0xff4400, emissiveIntensity: 0.9, emissiveMap: lava }),
      wood: new THREE.MeshStandardMaterial({ map: wood, roughness: 0.95 }),
      door: new THREE.MeshStandardMaterial({ color: 0x5a1c1c, roughness: 0.6, metalness: 0.4 }),
      trim: new THREE.MeshStandardMaterial({ color: 0x777d88, roughness: 0.5, metalness: 0.6 }),
      glass: new THREE.MeshStandardMaterial({ color: 0xa8d8e8, transparent: true, opacity: 0.28, roughness: 0.1, metalness: 0.1 }),
      glowRed: new THREE.MeshStandardMaterial({ color: 0xff3020, emissive: 0xff3020, emissiveIntensity: 2.2 }),
      glowOrange: new THREE.MeshStandardMaterial({ color: 0xff8820, emissive: 0xff8820, emissiveIntensity: 2 }),
      glowBlue: new THREE.MeshStandardMaterial({ color: 0x39c2ff, emissive: 0x39c2ff, emissiveIntensity: 2 }),
    };
  }

  box(cx, cy, cz, w, h, d, mat, { collide = true, uvScale = 0.35 } = {}) {
    const geo = new THREE.BoxGeometry(w, h, d);
    const m = this.mats[mat] || this.mats.brick;
    let material = m;
    if (m.map) {
      material = m.clone();
      material.map = m.map.clone();
      material.map.repeat.set(Math.max(1, Math.round(Math.max(w, d) * uvScale)), Math.max(1, Math.round(Math.max(h, Math.min(w, d)) * uvScale)));
      if (material.emissiveMap) material.emissiveMap = material.map;
    }
    const mesh = new THREE.Mesh(geo, material);
    mesh.position.set(cx, cy, cz);
    this.G.scene.add(mesh);
    if (collide) this.G.colliders.push(aabb(cx, cy, cz, w, h, d));
    if (mat === 'lava') (this._lavaMats = this._lavaMats || []).push(material);
    return mesh;
  }

  floorCeil(cx, cz, w, d, floorY, height, { ceil = true } = {}) {
    this.box(cx, floorY - 0.5, cz, w, 1, d, 'floor');
    if (ceil) this.box(cx, floorY + height + 0.5, cz, w, 1, d, 'dark');
  }

  light(x, y, z, color = 0xffb37a, intensity = 25, dist = 18) {
    const l = new THREE.PointLight(color, intensity, dist, 1.8);
    l.position.set(x, y, z);
    this.G.scene.add(l);
    return l;
  }

  torch(x, y, z, color = 0xff8820) {
    this.box(x, y, z, 0.18, 0.5, 0.18, color === 0xff8820 ? 'glowOrange' : 'glowBlue', { collide: false });
  }

  // ---- breakables (planks, glass) ----
  breakable(cx, cy, cz, w, h, d, { glass = false } = {}) {
    const meshes = [];
    if (glass) {
      meshes.push(this.box(cx, cy, cz, w, h, d, 'glass', { collide: false }));
      // frame edge glow so panes read at a glance
      const edge = new THREE.Mesh(new THREE.BoxGeometry(w + 0.04, Math.min(h, 0.06), d + 0.04), this.mats.glowBlue);
      edge.position.set(cx, cy + h / 2, cz);
      this.G.scene.add(edge);
      meshes.push(edge);
    } else {
      // a stack of planks across the opening
      const horizontal = w > d;
      const count = Math.max(3, Math.round(h / 0.5));
      for (let i = 0; i < count; i++) {
        const py = cy - h / 2 + (i + 0.5) * (h / count);
        const p = this.box(
          cx + (Math.random() - 0.5) * 0.06, py, cz + (Math.random() - 0.5) * 0.06,
          horizontal ? w : d * 0.9, h / count * 0.75, horizontal ? d * 0.9 : w,
          'wood', { collide: false });
        p.rotation.z = (Math.random() - 0.5) * 0.08;
        meshes.push(p);
      }
    }
    const collider = aabb(cx, cy, cz, w, h, d);
    this.G.colliders.push(collider);
    const b = { meshes, colliders: [collider], glass, broken: false };
    this.breakables.push(b);
    this.breakableByCollider.set(collider, b);
    return b;
  }

  breakIt(b) {
    if (b.broken) return;
    b.broken = true;
    for (const c of b.colliders) {
      const i = this.G.colliders.indexOf(c);
      if (i >= 0) this.G.colliders.splice(i, 1);
      this.breakableByCollider.delete(c);
      const center = new THREE.Vector3().addVectors(c.min, c.max).multiplyScalar(0.5);
      this.G.effects.spawn(center, {
        count: 16, mat: b.glass ? 'glass' : 'gibWood', speed: 5,
        size: b.glass ? 0.09 : 0.16, life: 0.8, up: 3,
      });
    }
    for (const m of b.meshes) this.G.scene.remove(m);
    if (b.glass) this.G.audio.glassBreak();
    else this.G.audio.plankBreak();
    if (b.onBreak) b.onBreak();
  }

  breakHit(collider) {
    const b = this.breakableByCollider.get(collider);
    if (b) this.breakIt(b);
  }

  punchBreakables(origin, dir, range) {
    let hit = false;
    for (const b of this.breakables) {
      if (b.broken) continue;
      for (const c of b.colliders) {
        const closest = new THREE.Vector3(
          Math.min(Math.max(origin.x, c.min.x), c.max.x),
          Math.min(Math.max(origin.y, c.min.y), c.max.y),
          Math.min(Math.max(origin.z, c.min.z), c.max.z),
        );
        const to = closest.sub(origin);
        const d = to.length();
        if (d > range) continue;
        if (d > 0.01 && to.divideScalar(d).dot(dir) < 0.35) continue;
        this.breakIt(b);
        hit = true;
        break;
      }
    }
    return hit;
  }

  breakGlassUnder(player) {
    const feet = player.pos.y - player.he.y;
    for (const b of this.breakables) {
      if (b.broken || !b.glass) continue;
      for (const c of b.colliders) {
        if (Math.abs(c.max.y - feet) > 0.2) continue;
        if (player.pos.x + player.he.x < c.min.x || player.pos.x - player.he.x > c.max.x) continue;
        if (player.pos.z + player.he.z < c.min.z || player.pos.z - player.he.z > c.max.z) continue;
        this.breakIt(b);
        return true;
      }
    }
    return false;
  }

  // ---- doors ----
  door(cx, cy, cz, w, h, d, name, { gap = 0 } = {}) {
    // gap > 0 leaves a slide-through slot underneath (jammed door)
    const bodyH = h - gap;
    const bodyY = cy + gap / 2;
    const mesh = this.box(cx, bodyY, cz, w, bodyH, d, 'door', { collide: false });
    const seam = new THREE.Mesh(new THREE.BoxGeometry(w * 0.9, 0.1, d + 0.06), gap > 0 ? this.mats.trim : this.mats.glowRed);
    seam.position.set(cx, bodyY, cz);
    this.G.scene.add(seam);
    const collider = aabb(cx, bodyY, cz, w, bodyH, d);
    this.G.colliders.push(collider);
    const door = { mesh, seam, collider, open: false, h: bodyH, t: 0, name, baseY: bodyY, jammed: gap > 0 };
    this.doors.push(door);
    return door;
  }

  openDoor(door) {
    if (door.open || door.jammed) return;
    door.open = true;
    this.G.audio.door();
    const i = this.G.colliders.indexOf(door.collider);
    if (i >= 0) this.G.colliders.splice(i, 1);
    door.seam.material = this.mats.glowBlue;
  }

  trigger(cx, cy, cz, w, h, d, fn, name = '') {
    this.triggers.push({ box: aabb(cx, cy, cz, w, h, d), fired: false, fn, name });
  }

  checkpoint(x, y, z) {
    const pylon = this.box(x, y + 0.5, z, 0.25, 1, 0.25, 'glowBlue', { collide: false });
    this.trigger(x, y + 1, z, 3.5, 3, 3.5, () => {
      this.G.checkpoint = { x, y: y + 1.2, z };
      this.G.audio.checkpoint();
      this.G.hud.message('CHECKPOINT');
      pylon.material = this.mats.glowOrange;
    });
  }

  pickup(x, y, z, kind) {
    let mesh, fn;
    if (kind === 'revolver') {
      mesh = new THREE.Group();
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.12, 0.6), this.mats.trim);
      const grip = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.22, 0.1), this.mats.door);
      grip.position.set(0, -0.12, 0.22);
      mesh.add(b, grip);
      fn = () => this._onRevolverPickup();
    } else if (kind === 'shotgun') {
      mesh = new THREE.Group();
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 1.0), this.mats.trim);
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.14, 0.3), this.mats.door);
      p.position.z = 0.1;
      mesh.add(b, p);
      fn = () => {
        this.G.weapons.giveShotgun();
        this.G.hud.message('PUMP SHOTGUN ACQUIRED');
        this.G.audio.pickup();
      };
    } else if (kind === 'health') {
      mesh = new THREE.Mesh(new THREE.OctahedronGeometry(0.3, 0), this.mats.glowRed);
      fn = () => { this.G.player.heal(50); this.G.audio.pickup(); this.G.hud.styleEvent('+ RESTORED'); };
    } else { // secret orb
      mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(0.35, 0), this.mats.glowBlue);
      fn = () => {
        this.secretsFound++;
        this.G.player.maxHp += 10;
        this.G.player.heal(100);
        this.G.audio.secret();
        this.G.hud.message(`SECRET ${this.secretsFound} / ${this.secretsTotal} — MAX HP +10`);
        this.G.hud.style.add(150, 'SECRET');
      };
    }
    mesh.position.set(x, y, z);
    this.G.scene.add(mesh);
    const r = (kind === 'revolver' || kind === 'shotgun') ? 1.9 : 1.2;
    this.pickups.push({ mesh, r, fn, taken: false, baseY: y });
  }

  spawnRoom(name, list) {
    const room = this.rooms[name] || (this.rooms[name] = { alive: new Set(), door: null, onClear: null });
    for (const [Cls, x, y, z] of list) {
      const e = new Cls(this.G, new THREE.Vector3(x, y, z));
      e.room = name;
      room.alive.add(e);
      this.G.enemies.push(e);
    }
  }

  onEnemyKilled(e) {
    const room = this.rooms[e.room];
    if (!room) return;
    room.alive.delete(e);
    if (room.alive.size === 0) {
      if (room.next) { room.next(); room.next = null; }
      else if (room.door) {
        this.openDoor(room.door);
        this.G.hud.message('DOOR UNLOCKED');
        this.G.hud.setObjective('PROCEED');
      }
    }
  }

  update(dt, t) {
    // shared flame flicker on the emissive materials
    this.mats.glowOrange.emissiveIntensity = 2 + Math.sin(t * 9) * 0.25 + Math.sin(t * 23) * 0.2;
    const lavaGlow = 0.9 + Math.sin(t * 5) * 0.12;
    for (const m of this._lavaMats || []) m.emissiveIntensity = lavaGlow;
    // rotating hazard props
    for (const s of this.spinners) s.mesh.rotation[s.axis] += s.speed * dt;
    // doors animate up
    for (const d of this.doors) {
      if (d.open && d.t < 1) {
        d.t = Math.min(1, d.t + dt / 1.2);
        const y = d.baseY + d.t * (d.h + 0.2);
        d.mesh.position.y = y;
        d.seam.position.y = y;
      }
    }
    // pickups
    const P = this.G.player;
    for (const p of this.pickups) {
      if (p.taken) continue;
      p.mesh.rotation.y += dt * 2;
      p.mesh.position.y = p.baseY + Math.sin(t * 2.5) * 0.12;
      if (P.pos.distanceTo(p.mesh.position) < p.r) {
        p.taken = true;
        this.G.scene.remove(p.mesh);
        p.fn();
      }
    }
    // triggers
    for (const tr of this.triggers) {
      if (tr.fired) continue;
      const b = tr.box;
      if (P.pos.x > b.min.x && P.pos.x < b.max.x &&
          P.pos.y > b.min.y && P.pos.y < b.max.y &&
          P.pos.z > b.min.z && P.pos.z < b.max.z) {
        tr.fired = true;
        tr.fn();
      }
    }
    // combat intensity for music
    let near = 0;
    for (const e of this.G.enemies) if (!e.dead && e.pos.distanceTo(P.pos) < 40) near++;
    this.G.audio.combat += ((near > 0 ? Math.min(1, 0.5 + near * 0.12) : 0) - this.G.audio.combat) * dt * 2;
  }

  // hazard zones hurt the player and shred enemies (grinders, turbine, fire)
  checkHazards(dt) {
    const P = this.G.player;
    this._hazT = (this._hazT || 0) + dt;
    if (this._hazT < 0.25) return;
    this._hazT = 0;
    for (const z of this.hazards) {
      if (!P.dead &&
          P.pos.x > z.min.x && P.pos.x < z.max.x &&
          P.pos.y - P.he.y < z.max.y && P.pos.y > z.min.y &&
          P.pos.z > z.min.z && P.pos.z < z.max.z) {
        P.hurtCooldown = 0;
        P.damage(z.dmg || 10);
      }
      for (const e of this.G.enemies) {
        if (e.dead) continue;
        if (e.pos.x > z.min.x && e.pos.x < z.max.x &&
            e.pos.y - e.he.y < z.max.y && e.pos.y - e.he.y > z.min.y - 1 &&
            e.pos.z > z.min.z && e.pos.z < z.max.z) {
          e.damage(45, null, true);
          if (e.dead) {
            this.hazardKills++;
            this.G.hud.style.add(50, 'SHREDDED');
            if (this.hazardKills >= 5 && !this.challengeDone) {
              this.challengeDone = true;
              this.G.hud.message('CHALLENGE COMPLETE — 5 SHREDDED');
              this.G.hud.style.add(300, 'CHALLENGE');
            }
          }
        }
      }
    }
  }

  _onRevolverPickup() {
    const G = this.G;
    G.weapons.giveRevolver();
    G.audio.pickup();
    G.hud.message('PIERCER REVOLVER ACQUIRED');
    // the lights snap on...
    for (const l of this.revolverLights) l.intensity = 26;
    this.revolverGlow.forEach(m => { m.visible = true; });
    G.audio.door();
    // ...and the dead come out
    setTimeout(() => {
      if (G.state !== 'playing') return;
      G.hud.message('THEY HEARD THAT');
      G.hud.setObjective('EXTERMINATE');
      G.audio.wardenRoar();
      this.spawnRoom('rev', [
        [Filth, -6, 1, -62], [Filth, 6, 1, -62], [Filth, 0, 1, -72],
      ]);
      this.rooms.rev.next = () => {
        G.hud.message('MORE OF THEM');
        this.spawnRoom('rev', [
          [Filth, -7, 1, -70], [Filth, 7, 1, -70], [Filth, -3, 1, -58], [Filth, 3, 1, -74],
        ]);
      };
    }, 900);
  }

  // ================= LAYOUT =================
  // Faithful homage to the classic 0-1 room sequence:
  // drop shaft -> KEEP OUT planks -> jammed doors (slide) -> collapsed
  // walkway (dash) -> dark Revolver Room -> three Glass Rooms with a
  // checkpoint -> Grinder Walkway -> Turbine Chamber -> boss + elevator.
  _build() {
    const G = this.G;

    // ---- S. drop shaft + landing room (z 4 .. -8) ----
    this.floorCeil(0, -2, 8, 12, 0, 5, { ceil: false });
    // ceiling with a hole (x -2..2, z -1..4) the player drops through
    this.box(0, 5.5, -4.5, 8, 1, 7, 'dark');
    this.box(-3, 5.5, 1.5, 2, 1, 5, 'dark');
    this.box(3, 5.5, 1.5, 2, 1, 5, 'dark');
    // the shaft tube above the hole
    this.box(-2.5, 8.5, 1.5, 1, 7, 5, 'brick');
    this.box(2.5, 8.5, 1.5, 1, 7, 5, 'brick');
    this.box(0, 8.5, 4, 5, 7, 1, 'brick');
    this.box(0, 8.5, -1, 5, 7, 1, 'brick');
    this.box(-4.5, 2.5, -2, 1, 5, 12, 'brick');
    this.box(4.5, 2.5, -2, 1, 5, 12, 'brick');
    this.box(0, 2.5, 4.5, 8, 5, 1, 'brick');
    this.light(0, 3.5, -2, 0xffb37a, 14, 12);
    this.trigger(0, 2, -2, 8, 4, 6, () => {
      G.hud.message('0-1  //  INTO THE FIRE', 3000);
      G.hud.setObjective('FIND A WAY DOWN');
    });

    // ---- T1. KEEP OUT room (z -8 .. -20) ----
    this.floorCeil(0, -14, 8, 12, 0, 5);
    this.box(-4.5, 2.5, -14, 1, 5, 12, 'brick');
    this.box(4.5, 2.5, -14, 1, 5, 12, 'brick');
    this.box(0, 4.4, -8, 8, 1.2, 1, 'brick'); // lintel into T1
    this.torch(-3.8, 1.6, -10); this.torch(3.8, 1.6, -12);
    // doorway at z=-20 blocked by planks
    this.box(-3, 2.5, -20, 4, 5, 1, 'brick');
    this.box(3, 2.5, -20, 4, 5, 1, 'brick');
    this.box(0, 4.25, -20, 2.4, 1.5, 1, 'brick');
    this.breakable(0, 1.75, -20, 2.4, 3.5, 0.4);
    this.trigger(0, 2, -14, 8, 4, 5, () => {
      G.hud.message('KEEP OUT');
      G.hud.setObjective('PUNCH (F / LMB) THROUGH THE PLANKS');
    });
    // secret 1: shelf by the left wall, wall-jump up to it
    this.box(-3, 3.6, -9.4, 2, 0.4, 2.4, 'panel');
    this.pickup(-3, 4.4, -9.4, 'secret');

    // ---- T2. jammed doors corridor (z -20 .. -38) ----
    this.floorCeil(0, -29, 6, 18, 0, 4.5);
    this.box(-3.5, 2.25, -29, 1, 4.5, 18, 'brick');
    this.box(3.5, 2.25, -29, 1, 4.5, 18, 'brick');
    this.torch(-2.8, 1.4, -24); this.torch(2.8, 1.4, -33);
    this.door(0, 2.25, -25, 6, 4.5, 0.6, 'jam1', { gap: 1.1 });
    this.door(0, 2.25, -32, 6, 4.5, 0.6, 'jam2', { gap: 1.1 });
    this.trigger(0, 2, -22, 6, 4, 3, () => {
      G.hud.message('JAMMED DOORS');
      G.hud.setObjective('SLIDE (CTRL / C) THROUGH THE GAP');
    });

    // ---- T3. collapsed walkway (z -38 .. -58), 9m gap over a fire pit ----
    this.floorCeil(0, -40.5, 8, 5, 0, 6);          // ledge z -38..-43
    this.box(0, -0.5, -47.5, 8, 1, 9, 'dark', { collide: false }); // shadowy void hint
    this.floorCeil(0, -55, 8, 6, 0, 6);            // far ledge z -52..-58
    this.box(-4.5, 3, -48, 1, 6, 20, 'brick');
    this.box(4.5, 3, -48, 1, 6, 20, 'brick');
    this.box(0, 6.5, -47.5, 8, 1, 21, 'dark');     // ceiling over the whole span
    // the pit: floor at -7, burning
    this.box(0, -7.5, -47.5, 8, 1, 9, 'floor');
    this.box(0, -6.9, -47.5, 8, 0.2, 9, 'lava', { collide: false });
    this.hazards.push({ min: new THREE.Vector3(-4, -8, -52), max: new THREE.Vector3(4, -6.2, -43), dmg: 10 });
    this.box(0, -3.5, -42.6, 8, 8, 0.8, 'brick');  // pit near wall (below ledge)
    this.box(0, -3.5, -52.4, 8, 8, 0.8, 'brick');  // pit far wall
    this.light(0, -4, -47.5, 0xff5510, 16, 14);
    // mercy stairs out of the pit: climb along the right wall to the far ledge
    for (let i = 1; i <= 13; i++) {
      this.box(3.2, -7 + i * 0.55 - 0.5, -43.8 - i * 0.62, 1.6, 1, 1.2, 'floor');
    }
    this.trigger(0, 2, -39.5, 8, 4, 3, () => {
      G.hud.message('THE WALKWAY IS OUT');
      G.hud.setObjective('DASH (SHIFT) ACROSS THE GAP');
    });
    // secret 2: alcove in the pit's far wall
    this.floorCeil(0, -53.8, 3, 2, -7, 2.2, { ceil: true });
    this.pickup(0, -6.3, -53.5, 'secret');

    // ---- R. Revolver Room (z -58 .. -78, 22 wide), dark until pickup ----
    this.floorCeil(0, -68, 22, 20, 0, 7);
    this.box(-11.5, 3.5, -68, 1, 7, 20, 'brick');
    this.box(11.5, 3.5, -68, 1, 7, 20, 'brick');
    this.box(-7.5, 3.5, -58, 8, 7, 1, 'brick');
    this.box(7.5, 3.5, -58, 8, 7, 1, 'brick');
    this.box(0, 5.25, -58, 7, 3.5, 1, 'brick');
    this.box(-7.5, 3.5, -78, 8, 7, 1, 'brick');
    this.box(7.5, 3.5, -78, 8, 7, 1, 'brick');
    this.box(0, 5.5, -78, 7, 3, 1, 'brick');
    // pillars
    for (const [px, pz] of [[-6, -63], [6, -63], [-6, -73], [6, -73]]) {
      this.box(px, 3.5, pz, 1.4, 7, 1.4, 'brick');
    }
    // pedestal with the revolver
    this.box(0, 0.5, -66, 1.6, 1, 1.6, 'panel');
    this.box(0, 1.15, -66, 1.2, 0.3, 1.2, 'trim');
    this.pickup(0, 1.8, -66, 'revolver');
    // room lights start dark; emissive strips hidden too
    this.revolverLights = [
      this.light(0, 6, -63, 0xff7744, 0, 26),
      this.light(0, 6, -73, 0xff7744, 0, 26),
    ];
    this.revolverGlow = [];
    for (const gz of [-60, -68, -76]) {
      const strip = this.box(0, 6.6, gz, 18, 0.15, 0.4, 'glowOrange', { collide: false });
      strip.visible = false;
      this.revolverGlow.push(strip);
    }
    const doorRev = this.door(0, 2, -78, 7, 4, 0.8, 'rev');
    this.rooms.rev = { alive: new Set(), door: doorRev };
    this.trigger(0, 2, -61, 12, 5, 3, () => {
      G.hud.message('SO DARK IN HERE');
      G.hud.setObjective('TAKE THE REVOLVER');
    });
    // secret 3: tucked behind the far-left pillar
    this.pickup(-8.5, 0.8, -74.5, 'secret');

    // ---- G1. glass panes room (z -78 .. -90) ----
    this.floorCeil(0, -84, 10, 12, 0, 5);
    this.box(-5.5, 2.5, -84, 1, 5, 12, 'brick');
    this.box(5.5, 2.5, -84, 1, 5, 12, 'brick');
    this.torch(-4.8, 1.6, -81, 0x39c2ff); this.torch(4.8, 1.6, -87, 0x39c2ff);
    // two floor-to-lintel panes that must be broken
    this.breakable(0, 2.25, -81.5, 10, 4.5, 0.25, { glass: true });
    this.breakable(0, 2.25, -85.5, 10, 4.5, 0.25, { glass: true });
    this.light(0, 4, -84, 0x9fdcff, 10, 12);
    this.trigger(0, 2, -79.5, 10, 4, 2, () => {
      G.hud.setObjective('GLASS BREAKS. EVERYTHING BREAKS');
    });
    this.checkpoint(0, 0, -88);

    // ---- G2. glass floor room (z -90 .. -104, 14 wide) ----
    this.box(0, 6.5, -97, 14, 1, 14, 'dark');      // ceiling only; the floor is rims + glass
    this.box(-7.5, 3, -97, 1, 6, 14, 'brick');
    this.box(7.5, 3, -97, 1, 6, 14, 'brick');
    this.box(-5, 3, -90, 5, 6, 1, 'brick');
    this.box(5, 3, -90, 5, 6, 1, 'brick');
    this.box(0, 4.75, -90, 6, 2.5, 1, 'brick');
    this.box(-5, 3, -104, 5, 6, 1, 'brick');
    this.box(5, 3, -104, 5, 6, 1, 'brick');
    this.box(0, 4.75, -104, 6, 2.5, 1, 'brick');
    // central pit covered by four glass panes
    // pit: x -4..4, z -101..-93, depth 3
    this.box(-5.5, -1.5, -97, 3, 3, 14, 'floor');   // solid rim left
    this.box(5.5, -1.5, -97, 3, 3, 14, 'floor');    // solid rim right
    this.box(0, -1.5, -91.5, 8, 3, 3, 'floor');     // rim near
    this.box(0, -1.5, -102.5, 8, 3, 3, 'floor');    // rim far
    this.box(0, -3.5, -97, 14, 1, 14, 'floor');     // pit bottom
    for (const [gx, gz] of [[-2, -95], [2, -95], [-2, -99], [2, -99]]) {
      this.breakable(gx, -0.15, gz, 4, 0.3, 4, { glass: true });
    }
    this.light(0, 5, -97, 0xff7744, 18, 20);
    this.trigger(0, 2, -92, 10, 5, 3, () => {
      G.hud.message('THIN ICE');
      G.hud.setObjective('EXTERMINATE');
      this.spawnRoom('g2', [
        [Filth, -4, 1, -99], [Filth, 4, 1, -99], [Filth, 0, 1, -101], [Filth, 5, 1, -94],
      ]);
    });
    this.rooms.g2 = { alive: new Set(), door: null };
    // secret 4: in the pit, visible through the glass
    this.pickup(3, -2.5, -100, 'secret');

    // ---- G3. glass + strays room (z -104 .. -118, 14 wide) ----
    this.floorCeil(0, -111, 14, 14, 0, 7);
    this.box(-7.5, 3.5, -111, 1, 7, 14, 'brick');
    this.box(7.5, 3.5, -111, 1, 7, 14, 'brick');
    this.box(-5, 3.5, -118, 5, 7, 1, 'brick');
    this.box(5, 3.5, -118, 5, 7, 1, 'brick');
    this.box(0, 5.25, -118, 6, 3.5, 1, 'brick');
    // stray perches
    this.box(-6, 1.25, -114, 2.5, 2.5, 2.5, 'panel');
    this.box(6, 1.25, -108, 2.5, 2.5, 2.5, 'panel');
    this.light(0, 5.5, -111, 0xff6633, 20, 22);
    const doorG3 = this.door(0, 2, -118, 6, 4, 0.8, 'g3');
    this.rooms.g3 = { alive: new Set(), door: doorG3 };
    this.trigger(0, 2, -106, 12, 5, 3, () => {
      G.hud.message('SOMETHING IS THROWING THINGS');
      G.hud.setObjective('PUNCH (F) THEIR ORBS BACK');
      this.spawnRoom('g3', [
        [Stray, -6, 3.5, -114], [Stray, 6, 3.5, -108],
        [Filth, -3, 1, -113], [Filth, 3, 1, -113], [Filth, 0, 1, -115],
      ]);
    });
    this.pickup(0, 0.8, -105.5, 'health');

    // ---- GW. grinder walkway (z -118 .. -142, 10 wide) ----
    this.floorCeil(0, -120, 10, 4, 0, 6);          // near ledge z -118..-122
    this.floorCeil(0, -140, 10, 4, 0, 6);          // far ledge z -138..-142
    this.box(-5.5, 3, -130, 1, 6, 24, 'brick');
    this.box(5.5, 3, -130, 1, 6, 24, 'brick');
    this.box(0, 6.5, -130, 10, 1, 24, 'dark');
    // the pit with grinders
    this.box(0, -6.5, -130, 10, 1, 16, 'floor');   // pit bottom z -122..-138
    this.box(0, -3, -121.6, 10, 6, 0.8, 'brick');  // pit walls under ledges
    this.box(0, -3, -138.4, 10, 6, 0.8, 'brick');
    // three grinder drums across the pit
    for (const gz of [-126, -130, -134]) {
      const drum = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, 9, 10), this.mats.dark);
      drum.rotation.z = Math.PI / 2;
      drum.position.set(0, -4.2, gz);
      this.G.scene.add(drum);
      const teeth = new THREE.Mesh(new THREE.BoxGeometry(9.2, 0.35, 0.35), this.mats.glowOrange);
      drum.add(teeth);
      const teeth2 = teeth.clone(); teeth2.rotation.x = Math.PI / 2; drum.add(teeth2);
      this.spinners.push({ mesh: drum, axis: 'x', speed: 4 });
    }
    this.hazards.push({ min: new THREE.Vector3(-5, -7, -138), max: new THREE.Vector3(5, -2.4, -122), dmg: 25 });
    this.light(0, -1, -130, 0xff5510, 14, 20);
    // glass walkway down the middle: 3 wide, 8 segments of 2m
    for (let i = 0; i < 8; i++) {
      this.breakable(0, -0.15, -123 - i * 2, 3, 0.3, 2, { glass: true });
    }
    const doorGW = this.door(0, 2, -142, 6, 4, 0.8, 'gw');
    this.rooms.gw = { alive: new Set(), door: doorGW };
    this.trigger(0, 2, -119.5, 10, 5, 2.5, () => {
      G.hud.message('MIND THE GRINDERS');
      G.hud.setObjective('CROSS. OR DROP THEM IN');
      this.spawnRoom('gw', [
        [Filth, -2, 1, -139], [Filth, 2, 1, -139], [Filth, 0, 1, -140.5],
        [Filth, -3.5, 1, -140.5], [Filth, 3.5, 1, -139.5],
      ]);
    });

    // ---- TC. turbine chamber (z -142 .. -160, 18 wide, tall) ----
    // no full floor: solid rims around an open shaft, glass walkway across it
    this.box(0, 12.5, -151, 18, 1, 18, 'dark');    // ceiling
    this.box(-9.5, 3, -151, 1, 20, 18, 'brick');
    this.box(9.5, 3, -151, 1, 20, 18, 'brick');
    this.box(-6, 5, -142, 7, 12, 1, 'brick');
    this.box(6, 5, -142, 7, 12, 1, 'brick');
    this.box(0, 7.5, -142, 5, 9, 1, 'brick');
    this.box(-6, 5, -160, 7, 12, 1, 'brick');
    this.box(6, 5, -160, 7, 12, 1, 'brick');
    this.box(0, 7.5, -160, 5, 9, 1, 'brick');
    // rims double as the shaft's upper walls (top flush with y 0)
    this.box(-7.5, -4, -151, 3, 8, 18, 'floor');   // left rim, x -9..-6
    this.box(7.5, -4, -151, 3, 8, 18, 'floor');    // right rim, x 6..9
    this.box(0, -4, -143.5, 18, 8, 3, 'floor');    // near strip, z -142..-145
    this.box(0, -4, -158.5, 18, 8, 3, 'floor');    // far strip, z -157..-160
    // glass walkway down the middle over the shaft
    for (let i = 0; i < 6; i++) {
      this.breakable(0, -0.15, -146 - i * 2, 3, 0.3, 2, { glass: true });
    }
    // fan at the bottom of the 8-deep shaft
    this.box(0, -8.5, -151, 12, 1, 12, 'floor');
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 1, 8), this.mats.trim);
    hub.position.set(0, -7.4, -151);
    this.G.scene.add(hub);
    const fan = new THREE.Group();
    for (let i = 0; i < 4; i++) {
      const blade = new THREE.Mesh(new THREE.BoxGeometry(10, 0.25, 1.4), this.mats.dark);
      blade.rotation.y = (Math.PI / 2) * i + Math.PI / 4;
      const tip = new THREE.Mesh(new THREE.BoxGeometry(10, 0.28, 0.2), this.mats.glowOrange);
      tip.rotation.copy(blade.rotation);
      fan.add(blade, tip);
    }
    fan.position.set(0, -7.2, -151);
    this.G.scene.add(fan);
    this.spinners.push({ mesh: fan, axis: 'y', speed: 3.2 });
    this.hazards.push({ min: new THREE.Vector3(-6, -8, -157), max: new THREE.Vector3(6, -6.2, -145), dmg: 30 });
    this.light(0, -5, -151, 0xff8830, 16, 16);
    this.light(0, 8, -151, 0xff6633, 22, 26);
    this.trigger(0, 2, -143.5, 10, 5, 2.5, () => {
      G.hud.message('THE TURBINE STILL TURNS');
      G.hud.setObjective('EXTERMINATE');
      this.spawnRoom('tc', [
        [Stray, -7.5, 6.5, -156], [Stray, 7.5, 6.5, -147],
        [Filth, -7.5, 1, -155], [Filth, 7.5, 1, -155], [Filth, 0, 1, -158],
      ]);
    });
    // stray perches high on the wall rims
    this.box(-7.5, 2.75, -156, 3, 5.5, 3, 'panel');
    this.box(7.5, 2.75, -147, 3, 5.5, 3, 'panel');
    // secret 5: high ledge, wall-jump between the perch and the wall
    this.box(8.2, 6.5, -155, 2, 0.4, 2, 'panel');
    this.pickup(8.2, 7.3, -155, 'secret');
    const doorTC = this.door(0, 2, -160, 5, 4, 0.8, 'tc');
    this.rooms.tc = { alive: new Set(), door: doorTC };
    this.checkpoint(-6, 0, -144);

    // ---- W1. armory (z -160 .. -176, 18 wide): the shotgun, and a price ----
    this.floorCeil(0, -168, 18, 16, 0, 7);
    this.box(-9.5, 3.5, -168, 1, 7, 16, 'brick');
    this.box(9.5, 3.5, -168, 1, 7, 16, 'brick');
    this.box(-5.75, 3.5, -176, 7.5, 7, 1, 'brick');
    this.box(5.75, 3.5, -176, 7.5, 7, 1, 'brick');
    this.box(0, 5, -176, 4, 4, 1, 'brick');
    this.light(0, 5.5, -168, 0xff7744, 20, 20);
    this.torch(-8.8, 1.6, -164); this.torch(8.8, 1.6, -172);
    this.checkpoint(0, 0, -162);
    // weapon racks (decor)
    this.box(-8.9, 1.2, -168, 0.4, 2.4, 5, 'panel');
    this.box(8.9, 1.2, -168, 0.4, 2.4, 5, 'panel');
    // shotgun pedestal
    this.box(0, 0.5, -168, 1.6, 1, 1.6, 'panel');
    this.box(0, 1.15, -168, 1.2, 0.3, 1.2, 'trim');
    this.pickup(0, 1.8, -168, 'shotgun');
    const doorW1 = this.door(0, 1.6, -176, 4.2, 3.2, 0.8, 'w1');
    this.rooms.w1 = { alive: new Set(), door: doorW1 };
    // taking the shotgun springs the ambush
    {
      const sp = this.pickups[this.pickups.length - 1];
      const orig = sp.fn;
      sp.fn = () => {
        orig();
        G.hud.message('AN AMBUSH. OBVIOUSLY');
        G.hud.setObjective('TRY THE NEW TOY');
        G.audio.wardenRoar();
        this.spawnRoom('w1', [
          [Filth, -7, 1, -163], [Filth, 7, 1, -163],
          [Filth, -7, 1, -173], [Filth, 7, 1, -173],
          [Stray, 0, 1, -174],
        ]);
      };
    }
    this.trigger(0, 2, -162, 12, 5, 3, () => {
      G.hud.message('AN ARMORY');
      G.hud.setObjective('TAKE THE SHOTGUN');
    });

    // ---- W2. climb shaft (z -176 .. -190, 14 wide, tall): wall-jump up ----
    this.floorCeil(0, -183, 14, 14, 0, 13);
    this.box(0, 10, -176, 14, 6, 1, 'brick'); // seal above the armory doorway
    this.box(-7.5, 6.5, -183, 1, 13, 14, 'brick');
    this.box(7.5, 6.5, -183, 1, 13, 14, 'brick');
    // back wall with a HIGH opening (x -2.5..2.5, y 7..10.5)
    this.box(0, 3.5, -190, 14, 7, 1, 'brick');
    this.box(-5, 8.75, -190, 5, 3.5, 1, 'brick');
    this.box(5, 8.75, -190, 5, 3.5, 1, 'brick');
    this.box(0, 11.75, -190, 14, 2.5, 1, 'brick');
    // climbing ledges, alternating walls
    this.box(-5, 1.5, -180, 4, 0.6, 3, 'panel');
    this.box(5, 3.3, -182, 4, 0.6, 3, 'panel');
    this.box(-5, 5.1, -185, 4, 0.6, 3, 'panel');
    this.box(5, 6.9, -187, 4, 0.6, 3, 'panel');
    this.box(0, 6.6, -188.8, 5, 0.8, 2.2, 'panel'); // exit ledge at the gap
    this.light(0, 10, -183, 0xff6633, 18, 20);
    this.torch(-6.8, 2, -179); this.torch(6.8, 5, -186);
    // defenders
    this.box(6, 4.5, -179.5, 2.5, 9, 2.5, 'brick'); // stray tower
    const doorW2 = this.door(0, 8.75, -190, 5.2, 3.5, 0.8, 'w2');
    this.rooms.w2 = { alive: new Set(), door: doorW2 };
    this.trigger(0, 2, -178, 12, 5, 3, () => {
      G.hud.message('THE ONLY WAY IS UP');
      G.hud.setObjective('WALL JUMP. CLING. CLIMB');
      this.spawnRoom('w2', [
        [Stray, 6, 9.9, -179.5],
        [Filth, -4, 1, -186], [Filth, 4, 1, -185],
      ]);
    });
    // secret 6: shelf right under the ceiling
    this.box(-6, 11, -188, 2, 0.4, 2, 'panel');
    this.pickup(-6, 11.8, -188, 'secret');

    // ---- W3. lava lake with a narrow bridge (z -190 .. -216, 20 wide) ----
    this.box(-10.5, 5.5, -203, 1, 15, 26, 'brick');
    this.box(10.5, 5.5, -203, 1, 15, 26, 'brick');
    this.box(0, 12.5, -203, 20, 1, 26, 'dark'); // ceiling
    // front wall strips beside the W2 shaft (W2's back wall covers the middle)
    this.box(-8.75, 6, -190, 3.5, 14, 1, 'brick');
    this.box(8.75, 6, -190, 3.5, 14, 1, 'brick');
    // entry balcony at y7, stairs down along the left wall
    this.box(0, 6.5, -191.8, 20, 1, 3.6, 'floor');
    for (let i = 0; i < 13; i++) {
      this.box(-8.5, 6.45 - 0.5 - i * 0.5, -194 - i * 0.7, 3, 1, 1.4, 'floor');
    }
    // the lake: solid bed below, glowing surface, hazard zone above it
    this.box(0, -1.2, -204.8, 20, 1, 22.4, 'floor');
    this.box(0, 0.02, -204.8, 20, 0.12, 22.4, 'lava', { collide: false });
    this.hazards.push({ min: new THREE.Vector3(-10, -1, -216), max: new THREE.Vector3(10, 0.5, -193.6), dmg: 15 });
    // shore by the stairs, spur, and the narrow bridge across
    this.box(-7.5, 0.1, -201.5, 6, 1, 6, 'floor');
    this.box(-3.5, 0.1, -202.5, 4, 1, 2.4, 'floor');
    this.box(0, 0.1, -205, 2.4, 1, 22, 'floor');
    // stray pillars rising from the lava
    this.box(-6, 1.5, -208, 2.5, 3, 2.5, 'brick');
    this.box(6, 1.5, -200, 2.5, 3, 2.5, 'brick');
    // far landing and back wall
    this.box(0, 0.1, -214.5, 20, 1, 3, 'floor');
    this.box(-6.25, 6, -216, 8.5, 12, 1, 'brick');
    this.box(6.25, 6, -216, 8.5, 12, 1, 'brick');
    this.box(0, 8, -216, 4, 8, 1, 'brick');
    this.light(0, 3, -203, 0xff4400, 26, 26);
    this.light(0, 9, -196, 0xff6633, 14, 16);
    const doorW3 = this.door(0, 2.3, -216, 4.2, 3.4, 0.8, 'w3');
    this.rooms.w3 = { alive: new Set(), door: doorW3 };
    this.trigger(0, 7.5, -191.5, 16, 4, 3, () => {
      G.hud.message('CROSS THE LAKE');
      G.hud.setObjective('DO NOT SWIM');
      this.spawnRoom('w3', [
        [Stray, -6, 4, -208], [Stray, 6, 4, -200],
        [Filth, -6, 1.8, -214.5], [Filth, -2, 1.8, -214.5],
        [Filth, 2, 1.8, -214.5], [Filth, 6, 1.8, -214.5],
      ]);
    });
    // secret 7: lone island off the bridge — dash for it
    this.box(8, 0.1, -212, 2, 1, 2, 'floor');
    this.pickup(8, 1.3, -212, 'secret');

    // ---- W4. penultimate arena (z -216 .. -236, 20x20): three waves ----
    this.floorCeil(0, -226, 20, 20, 0, 10);
    this.box(-10.5, 5, -226, 1, 10, 20, 'brick');
    this.box(10.5, 5, -226, 1, 10, 20, 'brick');
    this.box(-6.5, 5, -236, 8, 10, 1, 'brick');
    this.box(6.5, 5, -236, 8, 10, 1, 'brick');
    this.box(0, 7, -236, 6, 6, 1, 'brick');
    for (const [px, pz] of [[-6, -221], [6, -221], [-6, -231], [6, -231]]) {
      this.box(px, 2.5, pz, 1.5, 5, 1.5, 'brick');
    }
    this.box(-8, 1.25, -226, 2.5, 2.5, 2.5, 'panel'); // stray ledges
    this.box(8, 1.25, -226, 2.5, 2.5, 2.5, 'panel');
    this.light(0, 8, -226, 0xff5533, 26, 28);
    this.torch(-9.8, 2, -220); this.torch(9.8, 2, -232);
    this.checkpoint(0, 0, -218);
    this.pickup(-8.5, 0.8, -233, 'health');
    this.pickup(8.5, 0.8, -219, 'health');
    const doorW4 = this.door(0, 2, -236, 5.2, 4, 0.8, 'w4');
    this.rooms.w4 = { alive: new Set(), door: doorW4 };
    this.trigger(0, 2, -220, 14, 5, 3, () => {
      G.hud.message('THE LAST GAUNTLET');
      G.hud.setObjective('SURVIVE THE WAVES');
      G.audio.wardenRoar();
      this.spawnRoom('w4', [
        [Filth, -7, 1, -229], [Filth, 7, 1, -229], [Filth, 0, 1, -232],
        [Filth, -4, 1, -224], [Filth, 4, 1, -224],
      ]);
      this.rooms.w4.next = () => {
        G.hud.message('WAVE 2');
        this.spawnRoom('w4', [
          [Stray, -8, 3.4, -226], [Stray, 8, 3.4, -226],
          [Filth, -5, 1, -231], [Filth, 5, 1, -231], [Filth, 0, 1, -222],
        ]);
        this.rooms.w4.next = () => {
          G.hud.message('LAST OF THEM');
          this.spawnRoom('w4', [
            [Filth, -7, 1, -222], [Filth, 7, 1, -222], [Filth, -7, 1, -230],
            [Filth, 7, 1, -230], [Filth, -2, 1, -233], [Filth, 2, 1, -233],
          ]);
        };
      };
    });

    // ---- B. boss room + exit elevator (z -236 .. -256) ----
    this.floorCeil(0, -246, 20, 20, 0, 11);
    this.box(0, 10.75, -236, 20, 1.5, 1, 'brick'); // filler above the shared wall
    this.box(-10.5, 5.5, -246, 1, 11, 20, 'brick');
    this.box(10.5, 5.5, -246, 1, 11, 20, 'brick');
    this.box(-6.5, 5.5, -256, 8, 11, 1, 'brick');
    this.box(6.5, 5.5, -256, 8, 11, 1, 'brick');
    this.box(0, 7.25, -256, 6, 7.5, 1, 'brick');
    this.light(0, 8, -246, 0xff5533, 30, 30);
    this.torch(-9.8, 2, -240); this.torch(9.8, 2, -240);
    this.torch(-9.8, 2, -252); this.torch(9.8, 2, -252);
    this.pickup(-8, 0.8, -246, 'health');
    this.pickup(8, 0.8, -246, 'health');
    const doorBoss = this.door(0, 2.25, -256, 5.5, 4.5, 0.8, 'boss');
    this.rooms.boss = { alive: new Set(), door: doorBoss };
    this.trigger(0, 2, -239, 14, 6, 3, () => {
      G.hud.message('SOMETHING WICKED', 3000);
      G.hud.setObjective('DODGE THE BEAM. PARRY THE ORBS');
      this.spawnRoom('boss', [[MaliciousFace, 0, 4.5, -249]]);
    });

    // exit elevator (z -256 .. -262)
    this.floorCeil(0, -259, 6, 6, 0, 4);
    this.box(-3.5, 2, -259, 1, 4, 6, 'panel');
    this.box(3.5, 2, -259, 1, 4, 6, 'panel');
    this.box(0, 2, -262.5, 6, 4, 1, 'panel');
    this.light(0, 3.2, -259, 0x9fdcff, 16, 10);
    this.trigger(0, 2, -260, 5, 4, 3, () => G.onLevelComplete(), 'exit');

    // global fill lights
    const amb = new THREE.AmbientLight(0x664422, 1.5);
    G.scene.add(amb);
    const hemi = new THREE.HemisphereLight(0xaa4a33, 0x1a0808, 0.9);
    G.scene.add(hemi);
  }
}
