import * as THREE from 'three';
import { aabb } from './utils.js';
import { Husk, Shade, Warden } from './enemies.js';

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

// ---------- level builder ----------
export class Level {
  constructor(G) {
    this.G = G;
    this.doors = [];       // { mesh, collider, open, h }
    this.triggers = [];    // { box, once, fired, fn, name }
    this.pickups = [];     // { mesh, r, fn, taken, spin }
    this.rooms = {};       // name -> { enemies:Set, door }
    this.secretsFound = 0;
    this.secretsTotal = 1;
    this._buildMaterials();
    this._build();
  }

  _buildMaterials() {
    const brick = brickTex(); brick.repeat.set(2, 2);
    const floor = floorTex(); floor.repeat.set(2, 2);
    const panel = panelTex(); panel.repeat.set(2, 2);
    const lava = lavaTex(); lava.repeat.set(3, 3);
    this.mats = {
      brick: new THREE.MeshStandardMaterial({ map: brick, roughness: 1 }),
      floor: new THREE.MeshStandardMaterial({ map: floor, roughness: 1 }),
      panel: new THREE.MeshStandardMaterial({ map: panel, roughness: 0.8, metalness: 0.2 }),
      dark: new THREE.MeshStandardMaterial({ color: 0x17141a, roughness: 1 }),
      lava: new THREE.MeshStandardMaterial({ map: lava, emissive: 0xff4400, emissiveIntensity: 0.9, emissiveMap: lava }),
      door: new THREE.MeshStandardMaterial({ color: 0x5a1c1c, roughness: 0.6, metalness: 0.4 }),
      trim: new THREE.MeshStandardMaterial({ color: 0x777d88, roughness: 0.5, metalness: 0.6 }),
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

  // room: floor + ceiling + 4 walls with optional openings (done by caller placing walls)
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

  // Torches are emissive-only: real lights are a scarce resource (every
  // point light is evaluated in every shader), so rooms get one or two
  // area lights instead and torches just glow.
  torch(x, y, z, color = 0xff8820) {
    this.box(x, y, z, 0.18, 0.5, 0.18, color === 0xff8820 ? 'glowOrange' : 'glowBlue', { collide: false });
  }

  door(cx, cy, cz, w, h, d, name) {
    const mesh = this.box(cx, cy, cz, w, h, d, 'door', { collide: false });
    // glowing seam
    const seam = new THREE.Mesh(new THREE.BoxGeometry(w * 0.9, 0.1, d + 0.06), this.mats.glowRed);
    seam.position.set(cx, cy, cz);
    this.G.scene.add(seam);
    const collider = aabb(cx, cy, cz, w, h, d);
    this.G.colliders.push(collider);
    const door = { mesh, seam, collider, open: false, h, t: 0, name, baseY: cy };
    this.doors.push(door);
    return door;
  }

  openDoor(door) {
    if (door.open) return;
    door.open = true;
    this.G.audio.door();
    // remove collider
    const i = this.G.colliders.indexOf(door.collider);
    if (i >= 0) this.G.colliders.splice(i, 1);
    door.seam.material = this.mats.glowBlue;
  }

  trigger(cx, cy, cz, w, h, d, fn, name = '') {
    this.triggers.push({ box: aabb(cx, cy, cz, w, h, d), fired: false, fn, name });
  }

  pickup(x, y, z, kind) {
    let mesh, fn;
    if (kind === 'shotgun') {
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
        this.G.player.maxHp += 25;
        this.G.player.heal(100);
        this.G.audio.secret();
        this.G.hud.message('SECRET FOUND — MAX HP +25');
        this.G.hud.style.add(150, 'SECRET');
      };
    }
    mesh.position.set(x, y, z);
    this.G.scene.add(mesh);
    this.pickups.push({ mesh, r: 1.2, fn, taken: false, baseY: y });
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

  // ================= LAYOUT =================
  // An original homage to the classic "first level in Hell" opener:
  // elevator -> burning corridor -> three combat chambers -> exit elevator.
  _build() {
    const G = this.G;

    // ---- 0. start elevator (player spawns inside, z ~ 0) ----
    this.floorCeil(0, 0, 6, 8, 0, 4);
    this.box(-3.5, 2, 0, 1, 4, 8, 'panel');   // left wall
    this.box(3.5, 2, 0, 1, 4, 8, 'panel');    // right wall
    this.box(0, 2, 4.5, 6, 4, 1, 'panel');    // back wall
    this.box(0, 3.9, -3.5, 6, 0.6, 1, 'panel'); // lintel
    this.light(0, 3.2, 0, 0xffffff, 14, 10);
    const startDoor = this.door(0, 1.8, -3.5, 5, 3.6, 0.6, 'start');
    setTimeout(() => { this.openDoor(startDoor); }, 1200);

    // ---- 1. corridor A: z -4 .. -28, width 6, flame vents ----
    this.floorCeil(0, -16, 6, 24, 0, 5);
    this.box(-3.5, 2.5, -16, 1, 5, 24, 'brick');
    this.box(3.5, 2.5, -16, 1, 5, 24, 'brick');
    for (let z = -8; z >= -24; z -= 5) {
      this.torch(-2.8, 1.4, z);
      this.torch(2.8, 1.4, z + 2.5);
    }
    // lava gutter along the corridor center-line edges (decorative)
    this.box(0, 0.06, -16, 0.8, 0.1, 22, 'lava', { collide: false });
    this.light(0, 1, -16, 0xff5510, 10, 20);

    this.trigger(0, 2, -8, 6, 4, 3, () => {
      G.hud.message('0-1  //  INTO THE FIRE');
      G.hud.setObjective('FIND THE EXIT');
    });

    // ---- 2. chamber ONE (z -28 .. -46, 18x18): 3 husks ----
    const c1z = -37;
    this.floorCeil(0, c1z, 18, 18, 0, 6);
    this.box(-9.5, 3, c1z, 1, 6, 18, 'brick');
    this.box(9.5, 3, c1z, 1, 6, 18, 'brick');
    // front wall with entrance gap
    this.box(-6, 3, -28, 7, 6, 1, 'brick');
    this.box(6, 3, -28, 7, 6, 1, 'brick');
    this.box(0, 5, -28, 6, 2.5, 1, 'brick');
    // back wall with exit gap
    this.box(-6, 3, -46, 7, 6, 1, 'brick');
    this.box(6, 3, -46, 7, 6, 1, 'brick');
    this.box(0, 5, -46, 6, 2.5, 1, 'brick');
    // crates
    this.box(-5, 0.75, c1z - 3, 1.5, 1.5, 1.5, 'panel');
    this.box(-5, 2.25, c1z - 3, 1.5, 1.5, 1.5, 'panel');
    this.box(5.5, 0.75, c1z + 4, 1.5, 1.5, 1.5, 'panel');
    this.torch(-8.8, 1.6, c1z - 6); this.torch(8.8, 1.6, c1z - 6);
    this.torch(-8.8, 1.6, c1z + 6); this.torch(8.8, 1.6, c1z + 6);
    this.light(0, 5, c1z, 0xff7744, 20, 24);

    const door1 = this.door(0, 1.9, -46, 5.5, 3.8, 0.8, 'c1');
    this.rooms.c1 = { alive: new Set(), door: door1 };
    this.trigger(0, 2, -31, 12, 5, 3, () => {
      this.spawnRoom('c1', [
        [Husk, -4, 1, c1z - 2],
        [Husk, 4, 1, c1z - 4],
        [Husk, 0, 1, c1z - 6],
      ]);
      G.hud.message('THEY COME CRAWLING');
      G.hud.setObjective('EXTERMINATE');
      G.audio.wardenRoar();
    });

    // ---- 3. corridor B with a drop (z -46 .. -66), floor steps down to -5 ----
    this.floorCeil(0, -50, 8, 8, 0, 5);           // upper ledge z -46..-54
    this.box(-4.5, 2.5, -50, 1, 5, 8, 'brick');
    this.box(4.5, 2.5, -50, 1, 5, 8, 'brick');
    // the pit: z -54..-66, floor at y=-5
    this.floorCeil(0, -60, 8, 12, -5, 10, { ceil: false });
    this.box(0, 5.5, -60, 8, 1, 12, 'dark');       // high ceiling
    // right pit wall, solid
    this.box(4.5, 0, -60, 1, 12, 12, 'brick');
    // left pit wall with a low opening (secret alcove) at z -62.4..-65.6, y -5..-2.5
    this.box(-4.5, 0, -58.2, 1, 12, 8.4, 'brick');           // z -54..-62.4
    this.box(-4.5, 0, -65.8, 1, 12, 0.4, 'brick');           // z -65.6..-66
    this.box(-4.5, 1.75, -64, 1, 8.5, 3.2, 'brick');         // above the opening
    this.box(0, -2.5, -54.5, 8, 5, 1, 'brick');    // pit front wall, flush with the ledge
    this.torch(-3.8, -3.5, -58); this.torch(3.8, -3.5, -62);
    this.light(0, -1, -60, 0xff6622, 16, 16);
    // secret alcove behind the opening (x -9..-5)
    this.floorCeil(-7, -64, 4, 3.2, -5, 2.5, { ceil: true });
    this.box(-9.2, -3.7, -64, 0.5, 2.6, 3.2, 'brick');       // alcove back wall
    this.box(-7, -3.7, -62.2, 4, 2.6, 0.4, 'brick');         // alcove sides
    this.box(-7, -3.7, -65.8, 4, 2.6, 0.4, 'brick');
    this.pickup(-7.5, -4.2, -64, 'secret');
    // health pickup at pit bottom
    this.pickup(2, -4.4, -57, 'health');

    // staircase out of the pit: 10 steps x 0.5 rise (auto step-up climbs them)
    for (let i = 1; i <= 10; i++) {
      this.box(0, -5 + i * 0.5 - 0.5, -61.05 - i * 0.45, 8, 1, 0.9, 'floor');
    }
    // corridor after the climb (z -66 .. -71)
    this.floorCeil(0, -68.5, 8, 5, 0, 5);
    this.box(-4.5, 2.5, -68.5, 1, 5, 5, 'brick');
    this.box(4.5, 2.5, -68.5, 1, 5, 5, 'brick');

    // ---- 4. chamber TWO (z -71 .. -93, 22x22): husks + shades on ledges ----
    const c2z = -82;
    this.floorCeil(0, c2z, 22, 22, 0, 8);
    this.box(-11.5, 4, c2z, 1, 8, 22, 'brick');
    this.box(11.5, 4, c2z, 1, 8, 22, 'brick');
    this.box(-7, 4, -71, 9, 8, 1, 'brick');
    this.box(7, 4, -71, 9, 8, 1, 'brick');
    this.box(0, 6, -71, 5, 4.5, 1, 'brick');
    this.box(-7, 4, -93, 9, 8, 1, 'brick');
    this.box(7, 4, -93, 9, 8, 1, 'brick');
    this.box(0, 6.2, -93, 5, 4, 1, 'brick');
    // pillars
    this.box(-5, 2.5, c2z - 3, 1.6, 5, 1.6, 'brick');
    this.box(5, 2.5, c2z - 3, 1.6, 5, 1.6, 'brick');
    this.box(-5, 2.5, c2z + 5, 1.6, 5, 1.6, 'brick');
    this.box(5, 2.5, c2z + 5, 1.6, 5, 1.6, 'brick');
    // side ledges for shades
    this.box(-9.5, 2.2, c2z, 3, 0.6, 6, 'panel');
    this.box(9.5, 2.2, c2z, 3, 0.6, 6, 'panel');
    this.torch(-10.8, 3.2, c2z - 4, 0xff8820); this.torch(10.8, 3.2, c2z + 4, 0xff8820);
    this.light(0, 6.5, c2z, 0xff6633, 26, 30);
    // lava trench across the middle (harmful)
    this.box(0, 0.05, c2z + 1, 22, 0.12, 2.4, 'lava', { collide: false });
    this.lavaZones = this.lavaZones || [];
    this.lavaZones.push({ min: new THREE.Vector3(-11, -1, c2z - 0.2), max: new THREE.Vector3(11, 0.6, c2z + 2.2) });
    this.light(0, 1, c2z + 1, 0xff4400, 14, 18);

    // shotgun pickup sits center stage
    this.pickup(0, 1.1, c2z - 5, 'shotgun');

    const door2 = this.door(0, 2.1, -93, 5.2, 4.2, 0.8, 'c2');
    this.rooms.c2 = { alive: new Set(), door: door2 };
    this.trigger(0, 2, -74, 10, 6, 3, () => {
      this.spawnRoom('c2', [
        [Husk, -6, 1, c2z - 5], [Husk, 6, 1, c2z - 6], [Husk, 0, 1, c2z - 8],
        [Shade, -9.5, 3.6, c2z], [Shade, 9.5, 3.6, c2z],
      ]);
      G.hud.message('GRAB THE SHOTGUN');
      G.hud.setObjective('EXTERMINATE');
    });

    // ---- 5. corridor C (z -93 .. -105) ----
    this.floorCeil(0, -99, 6, 12, 0, 5);
    this.box(-3.5, 2.5, -99, 1, 5, 12, 'brick');
    this.box(3.5, 2.5, -99, 1, 5, 12, 'brick');
    this.torch(-2.8, 1.4, -97); this.torch(2.8, 1.4, -101);
    this.pickup(0, 0.8, -99, 'health');

    // ---- 6. ARENA (z -105 .. -135, 30x30, high ceiling, lava moat) ----
    const az = -120;
    this.floorCeil(0, az, 30, 30, 0, 12);
    this.box(-15.5, 6, az, 1, 12, 30, 'brick');
    this.box(15.5, 6, az, 1, 12, 30, 'brick');
    this.box(-9, 6, -105, 13, 12, 1, 'brick');
    this.box(9, 6, -105, 13, 12, 1, 'brick');
    this.box(0, 8.5, -105, 5, 7, 1, 'brick');
    this.box(-9, 6, -135, 13, 12, 1, 'brick');
    this.box(9, 6, -135, 13, 12, 1, 'brick');
    this.box(0, 8.5, -135, 5, 7, 1, 'brick');
    // corner lava pools (emissive; two shared lights below cover the glow)
    for (const [lx, lz] of [[-11, az - 11], [11, az - 11], [-11, az + 11], [11, az + 11]]) {
      this.box(lx, 0.05, lz, 6, 0.12, 6, 'lava', { collide: false });
      this.lavaZones.push({ min: new THREE.Vector3(lx - 3, -1, lz - 3), max: new THREE.Vector3(lx + 3, 0.6, lz + 3) });
    }
    this.light(0, 2, az - 11, 0xff4400, 26, 26);
    this.light(0, 2, az + 11, 0xff4400, 26, 26);
    // central raised platform
    this.box(0, 0.6, az, 8, 1.2, 8, 'panel');
    // jump pillars
    this.box(-8, 1.4, az + 6, 2.5, 2.8, 2.5, 'brick');
    this.box(8, 1.4, az - 6, 2.5, 2.8, 2.5, 'brick');
    this.light(0, 10, az, 0xff5533, 40, 40);
    this.torch(-14.8, 2, az - 8); this.torch(14.8, 2, az - 8);
    this.torch(-14.8, 2, az + 8); this.torch(14.8, 2, az + 8);
    this.pickup(-13, 0.8, az, 'health');
    this.pickup(13, 0.8, az, 'health');

    const doorFinal = this.door(0, 2.1, -135, 5.2, 4.2, 0.8, 'arena');
    this.rooms.wave1 = { alive: new Set() };
    this.rooms.wave2 = { alive: new Set() };
    this.rooms.wave3 = { alive: new Set(), door: doorFinal };

    this.trigger(0, 2, -108, 10, 6, 3, () => {
      G.hud.message('THE PIT AWAKENS');
      G.hud.setObjective('SURVIVE THE WAVES');
      G.audio.wardenRoar();
      this.spawnRoom('wave1', [
        [Husk, -8, 1, az - 4], [Husk, 8, 1, az - 4],
        [Husk, -4, 1, az - 10], [Husk, 4, 1, az - 10],
      ]);
      this.rooms.wave1.next = () => {
        G.hud.message('WAVE 2');
        this.spawnRoom('wave2', [
          [Shade, -11, 1, az - 8], [Shade, 11, 1, az - 8],
          [Husk, 0, 1, az - 12], [Husk, -6, 1, az + 8], [Husk, 6, 1, az + 8],
        ]);
        this.rooms.wave2.next = () => {
          G.hud.message('IT HEARS YOU');
          G.audio.wardenRoar();
          this.spawnRoom('wave3', [
            [Warden, 0, 1.8, az - 8],
            [Husk, -10, 1, az + 4], [Husk, 10, 1, az + 4],
          ]);
        };
      };
    });

    // ---- 7. exit hall + elevator (z -135 .. -148) ----
    this.floorCeil(0, -141, 6, 12, 0, 5);
    this.box(-3.5, 2.5, -141, 1, 5, 12, 'brick');
    this.box(3.5, 2.5, -141, 1, 5, 12, 'brick');
    this.torch(-2.8, 1.4, -139, 0x39c2ff); this.torch(2.8, 1.4, -143, 0x39c2ff);
    // elevator cab
    this.floorCeil(0, -150.5, 6, 7, 0, 4);
    this.box(-3.5, 2, -150.5, 1, 4, 7, 'panel');
    this.box(3.5, 2, -150.5, 1, 4, 7, 'panel');
    this.box(0, 2, -154.5, 6, 4, 1, 'panel');
    this.light(0, 3.2, -150.5, 0x9fdcff, 16, 10);
    this.trigger(0, 2, -151, 5, 4, 4, () => G.onLevelComplete(), 'exit');

    // sky glow strips high up in the arena (hell ambience)
    this.box(0, 11.4, az, 26, 0.2, 0.6, 'glowRed', { collide: false });
    this.box(0, 11.4, az - 8, 26, 0.2, 0.6, 'glowOrange', { collide: false });
    this.box(0, 11.4, az + 8, 26, 0.2, 0.6, 'glowOrange', { collide: false });

    // global fill lights (do most of the work now that torches are unlit)
    const amb = new THREE.AmbientLight(0x664422, 1.5);
    G.scene.add(amb);
    const hemi = new THREE.HemisphereLight(0xaa4a33, 0x1a0808, 0.9);
    G.scene.add(hemi);
  }

  // lava damage check, called from main loop
  checkHazards(dt) {
    const P = this.G.player;
    if (!this.lavaZones || P.dead) return;
    for (const z of this.lavaZones) {
      if (P.pos.x > z.min.x && P.pos.x < z.max.x &&
          P.pos.y - P.he.y < z.max.y && P.pos.y > z.min.y &&
          P.pos.z > z.min.z && P.pos.z < z.max.z) {
        this._lavaT = (this._lavaT || 0) + dt;
        if (this._lavaT > 0.25) {
          this._lavaT = 0;
          P.hurtCooldown = 0; // lava ignores mercy window
          P.damage(10);
        }
        return;
      }
    }
  }
}
