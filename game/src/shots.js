// Deterministic screenshot staging for Nusa Airlift (?shot=cover|cockpit|ring|landing).
// Each shot places the real aircraft, the real rings and the real HUD in a fixed
// pose from the world seed, then freezes the simulation so the frame is exactly
// reproducible. The staged frame is a genuine render of the game's own code.
import * as THREE from 'three';
import { RUNWAYS } from './terrain.js';

// Place the aircraft at a pose and point the chase camera at the next target.
function pose(game, x, y, z, heading, pitch, roll, speed, throttle) {
  const f = game.flight;
  f.pos.set(x, y, z);
  f.heading = heading;
  f.pitch = pitch;
  f.roll = roll;
  f.speed = speed;
  f.throttle = throttle;
  f.onGround = false;
  f.fuel = 0.86;
  game.aircraft.group.position.copy(f.pos);
  game.aircraft.group.rotation.set(0, 0, 0);
  game.aircraft.group.rotation.order = 'YXZ';
  // Three.js rotation.y = -heading: forward (sin h, 0, -cos h) needs -h about Y.
  game.aircraft.group.rotation.y = -heading;
  game.aircraft.group.rotation.x = pitch;
  game.aircraft.group.rotation.z = -roll;
  game.propSpin = 0;
}

// Chase camera directly behind the aircraft, looking slightly ahead.
// `side` shifts the camera off the flight axis (positive = to the pilot's
// right) so a ring dead ahead is not hidden behind the fuselage.
function chaseCam(game, distance, height, lookAhead, side = 0) {
  const f = game.flight;
  const back = new THREE.Vector3(Math.sin(f.heading), 0, -Math.cos(f.heading));
  const right = new THREE.Vector3(Math.cos(f.heading), 0, Math.sin(f.heading));
  const camPos = f.pos.clone().addScaledVector(back, -distance).addScaledVector(right, side);
  camPos.y = f.pos.y + height;
  game.camera.position.copy(camPos);
  const look = f.pos.clone().addScaledVector(back, lookAhead);
  look.y = f.pos.y + 4;
  game.camera.lookAt(look);
}

export function stageShot(name, game) {
  const missions = game.missions;
  game.paused = true;
  game.shotMode = name;

  if (name === 'cockpit') {
    // Cockpit view: instruments lit, ring ahead through the windscreen.
    // Aircraft sits 120 m before ring 0, flying east toward it (heading 90°).
    pose(game, 330, 200, 350, 1.5708, 0.03, 0.08, 58, 0.72);
    game.cameraMode = 'cockpit';
    game.updateCamera(0);
    missions.nextRing = 0;
    missions.rings.forEach((r, i) => r.mesh.material.color.setHex(i === 0 ? 0xffd23e : 0xff7a1a));
  } else if (name === 'ring') {
    // Mid ring pass: the next ring fills the frame, aircraft just entering it.
    // Heading 2.36 points from (640, 196, 40) at ring 2 (700, 200, 100).
    pose(game, 640, 196, 40, 2.36, 0.02, -0.12, 62, 0.75);
    missions.nextRing = 2;
    missions.rings.forEach((r, i) => {
      r.passed = i < 2;
      r.mesh.material.color.setHex(i < 2 ? 0x37d67a : i === 2 ? 0xffd23e : 0xff7a1a);
    });
    game.cameraMode = 'chase';
    chaseCam(game, 22, 7, 120);
  } else if (name === 'landing') {
    // Final approach: gear down, flaps, PAPI beside the runway, threshold ahead.
    // Approach point = centre - forward * 520, forward = (sin h, -cos h).
    // Posed 95 m above the strip so the shot clears the coastal rise (~56 m)
    // on the west approach.
    const rw = RUNWAYS[0];
    const rad = (rw.heading * Math.PI) / 180;
    const ax = rw.x - Math.sin(rad) * 520;
    const az = rw.z + Math.cos(rad) * 520;
    pose(game, ax, rw.elevation + 95, az, rad, -0.06, 0.02, 34, 0.35);
    game.flight.flaps = true;
    missions.phase = 'leg2';
    missions.targetRunway = RUNWAYS[0];
    game.cameraMode = 'chase';
    chaseCam(game, 26, 9, 480);
  } else {
    // cover (default): chase view, banking gently toward the next ring, the
    // ring and the home runway both readable, HUD full, bright daylight.
    // Aircraft sits 120 m before ring 0, flying east toward it (heading 90°),
    // over the green coast with the sea beyond the ring.
    pose(game, 330, 200, 350, 1.5708, 0.04, 0.22, 58, 0.72);
    missions.nextRing = 0;
    missions.rings.forEach((r, i) => r.mesh.material.color.setHex(i === 0 ? 0xffd23e : 0xff7a1a));
    game.cameraMode = 'chase';
    chaseCam(game, 20, 7, 130, 10);
  }

  game.hudDirty = true;
  game.renderOnce();
  window.__shotReady = true;
  return name;
}
