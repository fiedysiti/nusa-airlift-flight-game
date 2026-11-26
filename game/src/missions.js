// Missions for Nusa Airlift: an 8-ring course between the islands, then cargo
// legs that end in a graded landing. Fuel turns every sortie into a decision.
import * as THREE from 'three';
import { RUNWAYS } from './terrain.js';

export const RING_COUNT = 8;

function ringPositions(seed) {
  // A gentle S-course from the home strip, out over the sea, around Pulau
  // Karang and back — fixed geometry, so every run flies the same course.
  // Ring 0 sits on the departure path east of the home strip, over the coast,
  // so the cover shot reads green coast + blue sea with the ring ahead.
  return [
    [450, 200, 350],
    [250, 180, -250],
    [700, 200, 100],
    [1050, 190, 550],
    [1350, 170, 850],
    [950, 200, 1150],
    [300, 210, 900],
    [-350, 180, 350],
  ].map(([x, y, z]) => new THREE.Vector3(x, y, z));
}

export function createMissions(seed, scene) {
  const rings = [];
  const ringGroup = new THREE.Group();
  const positions = ringPositions(seed);
  positions.forEach((pos, i) => {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(26, 2.2, 10, 28),
      new THREE.MeshBasicMaterial({ color: i === 0 ? 0xffd23e : 0xff7a1a }),
    );
    ring.position.copy(pos);
    // Face the incoming course: the torus plane stands perpendicular to the
    // direction the pilot flies in from (previous ring, or the home strip
    // for ring 0), so the ring reads as a circle, never edge-on.
    const from = i === 0
      ? new THREE.Vector3(RUNWAYS[0].x, pos.y, RUNWAYS[0].z)
      : positions[i - 1];
    ring.rotation.y = Math.atan2(pos.x - from.x, pos.z - from.z);
    ring.userData.index = i;
    ringGroup.add(ring);
    rings.push({ mesh: ring, pos, passed: false });
  });
  scene.add(ringGroup);
  return {
    rings,
    nextRing: 0,
    score: 0,
    legsDone: 0,
    targetRunway: RUNWAYS[1], // first cargo leg ends at Pulau Karang
    phase: 'rings', // rings -> leg1 -> leg2 -> done
    message: 'Terbang lewat 8 ring, lalu antar kargo ke Pulau Karang.',
    messageUntil: 0,
    time: 0,
  };
}

export function resetMissionVisuals(missions) {
  missions.rings.forEach((r, i) => {
    r.passed = false;
    r.mesh.material.color.setHex(i === 0 ? 0xffd23e : 0xff7a1a);
  });
  missions.nextRing = 0;
  missions.score = 0;
  missions.legsDone = 0;
  missions.targetRunway = RUNWAYS[1];
  missions.phase = 'rings';
}

// Returns an event string when something notable happens.
export function stepMissions(missions, flight, dt) {
  missions.time += dt;
  if (missions.phase === 'rings' && missions.nextRing < RING_COUNT) {
    const ring = missions.rings[missions.nextRing];
    const d = flight.pos.distanceTo(ring.pos);
    if (d < 26) {
      ring.passed = true;
      ring.mesh.material.color.setHex(0x37d67a);
      missions.nextRing += 1;
      missions.score += 100;
      if (missions.nextRing < RING_COUNT) {
        missions.rings[missions.nextRing].mesh.material.color.setHex(0xffd23e);
      } else {
        missions.phase = 'leg1';
        missions.message = 'Semua ring dilewati! Antar kargo ke Pulau Karang — dekati runway dari TIMUR, dari arah laut, lalu mendarat.';
        missions.messageUntil = missions.time + 6;
      }
      return 'ring';
    }
  }
  return '';
}

// Grade a landing: 0..500 by vertical speed, centreline offset and speed.
// Uses the sustained sink rate, same as the touchdown judgement. A
// touchdown on the flat overrun apron past a strip end still counts (the
// ground there is flat and landable) but scores half — it is a long
// landing, not a failure.
export function gradeLanding(flight, runway) {
  const rad = (runway.heading * Math.PI) / 180;
  const along = (flight.pos.x - runway.x) * Math.sin(rad) + (flight.pos.z - runway.z) * Math.cos(rad);
  const across = Math.abs((flight.pos.x - runway.x) * Math.cos(rad) - (flight.pos.z - runway.z) * Math.sin(rad));
  const vs = Math.abs(flight.vsSmooth ?? flight.verticalSpeed);
  const smooth = Math.max(0, 1 - vs / 6);
  const centre = Math.max(0, 1 - across / (runway.width / 2 + 12));
  const onStrip = Math.abs(along) < runway.length / 2 + 100;
  const onPavement = Math.abs(along) < runway.length / 2;
  const grade = onStrip ? Math.round(500 * (0.45 * smooth + 0.35 * centre + 0.2) * (onPavement ? 1 : 0.5)) : 0;
  const label = grade >= 420 ? 'SEMPURNA' : grade >= 300 ? 'BAGUS' : grade >= 150 ? 'KERAS' : 'KASAR';
  return { grade, label, onStrip };
}

// Call when the aircraft lands: advances legs, refuels, scores.
export function onLanded(missions, flight) {
  if (missions.phase === 'leg1' && missions.targetRunway === RUNWAYS[1]) {
    const g = gradeLanding(flight, RUNWAYS[1]);
    if (!g.onStrip) return { event: 'landed-wrong', grade: g };
    missions.score += g.grade;
    missions.legsDone += 1;
    missions.phase = 'leg2';
    missions.targetRunway = RUNWAYS[0];
    flight.fuel = 1;
    missions.message = `Mendarat ${g.label}! +${g.grade}. Kargo berikut: kembali ke Nusa Besar — putar di landasan (tahan A/D pelan), lalu lepas landas ke timur.`;
    missions.messageUntil = missions.time + 6;
    return { event: 'leg-done', grade: g };
  }
  if (missions.phase === 'leg2' && missions.targetRunway === RUNWAYS[0]) {
    const g = gradeLanding(flight, RUNWAYS[0]);
    if (!g.onStrip) return { event: 'landed-wrong', grade: g };
    missions.score += g.grade;
    missions.legsDone += 1;
    missions.phase = 'done';
    flight.fuel = 1;
    missions.message = `Misi selesai! Landing ${g.label}, +${g.grade}. Skor akhir ${missions.score}.`;
    missions.messageUntil = missions.time + 8;
    return { event: 'mission-done', grade: g };
  }
  // Landing during the ring phase just refuels.
  flight.fuel = 1;
  return { event: 'refuel', grade: null };
}
