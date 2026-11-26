// Seeded island terrain for Nusa Airlift: two islands in a bright sea, with two
// flattened airstrips, procedural runway paint and working PAPI lights.
// Own code; heightfield is sampled from the noise in rng.js, nothing is copied in.
import * as THREE from 'three';
import { fbm, mulberry32 } from './rng.js';

export const WORLD_SIZE = 4200; // metres, square world centred on (0, 0)
export const SEA_LEVEL = 0;

const ISLANDS = [
  { x: -650, z: -450, radius: 1450, peak: 260 }, // Nusa Besar — home island
  { x: 1350, z: 950, radius: 950, peak: 190 }, // Pulau Karang — cargo destination
];

export const RUNWAYS = [
  {
    name: 'NUSA',
    label: 'Nusa Besar',
    x: -650, z: 700, heading: 90, // east-west; takeoff east over the sea,
    // approach from the west over the coast (never into the island peak)
    length: 620, width: 34, elevation: 12,
  },
  {
    name: 'KARANG',
    label: 'Pulau Karang',
    x: 2050, z: 950, heading: 90, // east-west; takeoff east over the sea,
    // approach from the west (high over the island, down the east slope)
    length: 520, width: 30, elevation: 12,
  },
];

function islandHeight(x, z, seed) {
  let h = -40; // open sea floor
  for (const island of ISLANDS) {
    const dx = x - island.x;
    const dz = z - island.z;
    const d = Math.sqrt(dx * dx + dz * dz) / island.radius;
    if (d >= 1) continue;
    const falloff = Math.pow(Math.cos((d * Math.PI) / 2), 0.7);
    const hills = fbm(x * 0.0016 + 7.3, z * 0.0016 + 2.9, seed, 4);
    const ridge = fbm(x * 0.004 + 1.7, z * 0.004 + 8.4, seed + 55, 3);
    const height = falloff * (island.peak * (0.25 + 0.75 * hills) + ridge * 26);
    h = Math.max(h, height);
  }
  return h;
}

// Blend the terrain flat where a runway sits, so the strip is landable:
// fully flat across the strip plus a 30 m apron, then a smooth falloff
// over the next 140 m so the strip reads as a coastal plain, not a cliff.
function runwayBlend(x, z) {
  let best = null;
  for (const rw of RUNWAYS) {
    const rad = (rw.heading * Math.PI) / 180;
    const along = (x - rw.x) * Math.sin(rad) + (z - rw.z) * Math.cos(rad);
    const across = (x - rw.x) * Math.cos(rad) - (z - rw.z) * Math.sin(rad);
    const halfLIn = rw.length / 2 + 30;
    const halfWIn = rw.width / 2 + 30;
    const halfLOut = rw.length / 2 + 170;
    const halfWOut = rw.width / 2 + 170;
    if (Math.abs(along) > halfLOut || Math.abs(across) > halfWOut) continue;
    const edgeL = (Math.abs(along) - halfLIn) / (halfLOut - halfLIn);
    const edgeW = (Math.abs(across) - halfWIn) / (halfWOut - halfWIn);
    const edge = Math.max(0, Math.max(edgeL, edgeW));
    const w = 1 - Math.min(1, edge);
    if (best === null || w > best.w) best = { w, elevation: rw.elevation };
  }
  return best;
}

export function groundHeight(x, z, seed) {
  const raw = islandHeight(x, z, seed);
  const blend = runwayBlend(x, z);
  if (!blend) return raw;
  return raw * (1 - blend.w) + blend.elevation * blend.w;
}

function colourFor(height, slope, rand) {
  // Sand, grass, rock, snow — one consistent low-poly palette.
  if (height < 3) return [0.86, 0.78, 0.55]; // beach sand
  if (height < 120) {
    const g = 0.42 + rand() * 0.1;
    return [0.32, g, 0.22]; // grass
  }
  if (height < 210) return [0.48, 0.44, 0.38]; // rock
  return [0.92, 0.93, 0.95]; // high peaks
}

function runwayTexture(runway) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#33373d';
  ctx.fillRect(0, 0, 256, 64);
  ctx.fillStyle = '#e8e8e8';
  // Threshold bars at both ends.
  for (let i = 0; i < 4; i += 1) {
    ctx.fillRect(8 + i * 10, 6, 6, 52);
    ctx.fillRect(214 + i * 10, 6, 6, 52);
  }
  // Centreline dashes.
  for (let x = 52; x < 204; x += 24) ctx.fillRect(x, 29, 14, 6);
  // Runway designation numbers (painted as simple blocks).
  ctx.fillRect(28, 22, 10, 20);
  ctx.fillRect(218, 22, 10, 20);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function buildRunway(runway, seed) {
  const group = new THREE.Group();
  const rad = (runway.heading * Math.PI) / 180;
  const strip = new THREE.Mesh(
    new THREE.PlaneGeometry(runway.length, runway.width),
    new THREE.MeshLambertMaterial({ map: runwayTexture(runway) }),
  );
  strip.rotation.x = -Math.PI / 2;
  // Length axis must match the flight model's along-axis (sin h, cos h):
  // rotation.z = heading - 90° puts the strip's long side on that axis.
  strip.rotation.z = rad - Math.PI / 2;
  strip.position.set(runway.x, runway.elevation + 0.4, runway.z);
  group.add(strip);

  // PAPI: four light boxes beside the threshold; two red, two white on a
  // correct 3-degree glide path (static colours — they read as PAPI at a glance).
  const papi = new THREE.Group();
  for (let i = 0; i < 4; i += 1) {
    const lamp = new THREE.Mesh(
      new THREE.BoxGeometry(2.2, 1.1, 1.4),
      new THREE.MeshBasicMaterial({ color: i < 2 ? 0xff2a1e : 0xffffff }),
    );
    const side = runway.width / 2 + 8 + i * 3.4;
    const along = -runway.length / 2 + 110;
    const lx = runway.x + Math.sin(rad) * along + Math.cos(rad) * side;
    const lz = runway.z + Math.cos(rad) * along - Math.sin(rad) * side;
    lamp.position.set(lx, runway.elevation + 1.2, lz);
    papi.add(lamp);
  }
  group.add(papi);

  // Windsock near the threshold.
  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.25, 0.25, 9, 6),
    new THREE.MeshLambertMaterial({ color: 0xdddddd }),
  );
  const sx = runway.x + Math.cos(rad) * (runway.width / 2 + 14);
  const sz = runway.z - Math.sin(rad) * (runway.width / 2 + 14);
  pole.position.set(sx, runway.elevation + 4.5, sz);
  const sock = new THREE.Mesh(
    new THREE.ConeGeometry(1.1, 4.5, 8),
    new THREE.MeshLambertMaterial({ color: 0xff7a1a }),
  );
  sock.rotation.z = Math.PI / 2;
  sock.position.set(sx + 2.2, runway.elevation + 8.6, sz);
  group.add(pole, sock);
  return group;
}

export function buildTerrain(seed) {
  const group = new THREE.Group();
  const segments = 128;
  const geometry = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, segments, segments);
  geometry.rotateX(-Math.PI / 2);
  const positions = geometry.attributes.position;
  const colours = new Float32Array(positions.count * 3);
  const rand = mulberry32(seed ^ 0x9e3779b9);
  const half = WORLD_SIZE / 2;
  for (let i = 0; i < positions.count; i += 1) {
    const x = positions.getX(i);
    const z = positions.getZ(i);
    const h = groundHeight(x, z, seed);
    positions.setY(i, h);
    // Slope estimate from neighbours for the rock blend.
    const s = Math.abs(groundHeight(x + 24, z, seed) - h) + Math.abs(groundHeight(x, z + 24, seed) - h);
    const c = h > 120 || s > 16 ? [0.48, 0.44, 0.38] : colourFor(h, s, rand);
    colours[i * 3] = c[0];
    colours[i * 3 + 1] = c[1];
    colours[i * 3 + 2] = c[2];
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colours, 3));
  geometry.computeVertexNormals();
  const land = new THREE.Mesh(
    geometry,
    new THREE.MeshLambertMaterial({ vertexColors: true }),
  );
  group.add(land);

  // Sea: a flat bright plane just under the beaches.
  const sea = new THREE.Mesh(
    new THREE.PlaneGeometry(WORLD_SIZE * 1.6, WORLD_SIZE * 1.6),
    new THREE.MeshLambertMaterial({ color: 0x1d7fb8 }),
  );
  sea.rotation.x = -Math.PI / 2;
  sea.position.y = SEA_LEVEL;
  group.add(sea);

  for (const runway of RUNWAYS) group.add(buildRunway(runway, seed));
  return { group, heightAt: (x, z) => groundHeight(x, z, seed) };
}
