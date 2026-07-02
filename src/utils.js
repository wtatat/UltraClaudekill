import * as THREE from 'three';

export const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

export function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
export function lerp(a, b, t) { return a + (b - a) * t; }
export function randRange(a, b) { return a + Math.random() * (b - a); }

// Axis-aligned box collider { min: Vector3, max: Vector3 }
export function aabb(cx, cy, cz, w, h, d) {
  return {
    min: new THREE.Vector3(cx - w / 2, cy - h / 2, cz - d / 2),
    max: new THREE.Vector3(cx + w / 2, cy + h / 2, cz + d / 2),
  };
}

export function aabbOverlap(minA, maxA, b) {
  return minA.x < b.max.x && maxA.x > b.min.x &&
         minA.y < b.max.y && maxA.y > b.min.y &&
         minA.z < b.max.z && maxA.z > b.min.z;
}

const STEP_HEIGHT = 0.55;

export function boxFree(pos, he, colliders, skip) {
  const min = new THREE.Vector3(pos.x - he.x, pos.y - he.y, pos.z - he.z);
  const max = new THREE.Vector3(pos.x + he.x, pos.y + he.y, pos.z + he.z);
  for (const c of colliders) {
    if (c === skip) continue;
    if (aabbOverlap(min, max, c)) return false;
  }
  return true;
}

// Move a box (center pos, half extents he) axis by axis, sliding along colliders.
// Low ledges are stepped up automatically (stairs). The move is substepped so
// fast falls (ground slam) can't tunnel through thin floors.
// Returns { onGround, hitCeiling, hitWall }.
export function moveAndCollide(pos, vel, he, dt, colliders) {
  const maxDisp = Math.max(Math.abs(vel.x), Math.abs(vel.y), Math.abs(vel.z)) * dt;
  const steps = Math.min(8, Math.max(1, Math.ceil(maxDisp / 0.4)));
  const res = { onGround: false, hitCeiling: false, hitWall: false };
  const sub = dt / steps;
  for (let i = 0; i < steps; i++) {
    const r = moveStep(pos, vel, he, sub, colliders);
    res.onGround = res.onGround || r.onGround;
    res.hitCeiling = res.hitCeiling || r.hitCeiling;
    res.hitWall = res.hitWall || r.hitWall;
  }
  return res;
}

function moveStep(pos, vel, he, dt, colliders) {
  const res = { onGround: false, hitCeiling: false, hitWall: false };
  const axes = ['x', 'z', 'y']; // horizontal first, then vertical
  const min = new THREE.Vector3(), max = new THREE.Vector3();
  for (const ax of axes) {
    pos[ax] += vel[ax] * dt;
    min.set(pos.x - he.x, pos.y - he.y, pos.z - he.z);
    max.set(pos.x + he.x, pos.y + he.y, pos.z + he.z);
    for (const c of colliders) {
      if (!aabbOverlap(min, max, c)) continue;
      if (ax !== 'y' && vel.y <= 0.1) {
        // try stepping up onto a low ledge
        const lift = c.max.y - (pos.y - he.y);
        if (lift > 0 && lift <= STEP_HEIGHT) {
          const lifted = pos.clone();
          lifted.y = c.max.y + he.y + 0.002;
          if (boxFree(lifted, he, colliders, null)) {
            pos.y = lifted.y;
            res.onGround = true;
            min.y = pos.y - he.y; max.y = pos.y + he.y;
            continue;
          }
        }
      }
      if (ax === 'y') {
        if (vel.y <= 0 && pos.y > (c.min.y + c.max.y) / 2) {
          pos.y = c.max.y + he.y + 0.001;
          vel.y = 0;
          res.onGround = true;
        } else if (vel.y > 0) {
          pos.y = c.min.y - he.y - 0.001;
          vel.y = 0;
          res.hitCeiling = true;
        }
      } else {
        const center = (c.min[ax] + c.max[ax]) / 2;
        if (pos[ax] > center) pos[ax] = c.max[ax] + he[ax] + 0.001;
        else pos[ax] = c.min[ax] - he[ax] - 0.001;
        vel[ax] = 0;
        res.hitWall = true;
      }
      min.set(pos.x - he.x, pos.y - he.y, pos.z - he.z);
      max.set(pos.x + he.x, pos.y + he.y, pos.z + he.z);
    }
  }
  return res;
}

// Slab-method ray vs AABB. Returns distance t or Infinity.
export function rayAabb(origin, dir, box) {
  let tmin = 0, tmax = Infinity;
  for (const ax of ['x', 'y', 'z']) {
    const d = dir[ax];
    if (Math.abs(d) < 1e-9) {
      if (origin[ax] < box.min[ax] || origin[ax] > box.max[ax]) return Infinity;
    } else {
      let t1 = (box.min[ax] - origin[ax]) / d;
      let t2 = (box.max[ax] - origin[ax]) / d;
      if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return Infinity;
    }
  }
  return tmin;
}

// Nearest level-geometry hit along a ray. Returns distance or maxDist.
export function raycastLevel(origin, dir, colliders, maxDist = 1000) {
  return raycastLevelHit(origin, dir, colliders, maxDist).dist;
}

// Same, but also reports which collider was struck (for breakable glass).
export function raycastLevelHit(origin, dir, colliders, maxDist = 1000) {
  let best = maxDist, hit = null;
  for (const c of colliders) {
    const t = rayAabb(origin, dir, c);
    if (t < best) { best = t; hit = c; }
  }
  return { dist: best, collider: hit };
}

// Probe the four horizontal directions for a wall right next to the box.
// Returns the outward wall normal as a Vector3, or null.
export function wallNormal(pos, he, colliders, reach = 0.14) {
  const probe = pos.clone();
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    probe.set(pos.x + dx * reach, pos.y, pos.z + dz * reach);
    if (!boxFree(probe, he, colliders, null)) return new THREE.Vector3(-dx, 0, -dz);
  }
  return null;
}

// Line of sight between two points against level colliders.
export function hasLos(from, to, colliders) {
  const dir = to.clone().sub(from);
  const dist = dir.length();
  if (dist < 1e-4) return true;
  dir.divideScalar(dist);
  return raycastLevel(from, dir, colliders, dist) >= dist - 0.05;
}
