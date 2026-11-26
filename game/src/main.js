// Nusa Airlift — bootstrap, game loop, cameras and state machine.
// Own code throughout; three.js is the only library, vendored as a min build.
import * as THREE from 'three';
import { buildTerrain, RUNWAYS, groundHeight } from './terrain.js';
import { buildAircraft } from './aircraft.js';
import { createFlight, stepFlight, forwardOf } from './flight.js';
import { createMissions, stepMissions, onLanded, resetMissionVisuals } from './missions.js';
import { createHud } from './hud.js';
import { createAudio } from './audio.js';
import { createInput } from './input.js';
import { buildSky } from './clouds.js';
import { stageShot } from './shots.js';

const params = new URLSearchParams(window.location.search);
const SEED = Number(params.get('seed') ?? 20261126) || 20261126;
const SHOT = params.get('shot') || '';

const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
renderer.setSize(window.innerWidth, window.innerHeight);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87bfe8);
scene.fog = new THREE.Fog(0xcfe8f5, 900, 6500);

const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.5, 12000);
camera.position.set(0, 80, 200);

scene.add(new THREE.HemisphereLight(0xbfe3ff, 0x3f6a3a, 0.95));
const sun = new THREE.DirectionalLight(0xfff2cf, 1.9);
sun.position.set(-2600, 2400, -5200);
scene.add(sun);

const terrain = buildTerrain(SEED);
scene.add(terrain.group);
buildSky(scene, SEED);

const aircraft = buildAircraft();
scene.add(aircraft.group);
const missions = createMissions(SEED, scene);
const hud = createHud();
const audio = createAudio();
const input = createInput();

const HOME = RUNWAYS[0];
const homeRad = (HOME.heading * Math.PI) / 180;

function runwayStart() {
  // Parked at the far end of the home strip, facing down its heading:
  // start = centre - forward * (half length - 40), forward = (sin h, -cos h).
  return {
    x: HOME.x - Math.sin(homeRad) * (HOME.length / 2 - 40),
    y: HOME.elevation + 1.65,
    z: HOME.z + Math.cos(homeRad) * (HOME.length / 2 - 40),
    heading: homeRad,
    speed: 0,
    throttle: 0,
    onGround: true,
  };
}

const flight = createFlight(runwayStart());

const game = {
  flight,
  aircraft,
  missions,
  camera,
  cameraMode: 'chase',
  paused: false,
  shotMode: SHOT,
  propSpin: 0,
  hudDirty: false,
  state: 'title', // title | flying | landed | crashed | done
  updateCamera,
  renderOnce,
};

let camPos = new THREE.Vector3(0, 80, 200);
let camLook = new THREE.Vector3(0, 20, 0);
let stallBeepAt = 0;
let fpsEma = 60;
let lastQualityCheck = 0;
let pixelStep = 0;
// Wall-clock of the render loop: advances in every state, including after a
// crash, so the playtest harness can observe a crash instead of hanging on a
// frozen flight clock.
let gameClock = 0;

function updateCamera(dt) {
  const f = flight;
  const forward = forwardOf(f);
  if (game.cameraMode === 'cockpit') {
    // Pilot's eye: ahead of the windshield glass (so no glass wash in the
    // frame) and high enough to see over the cowling. The prop is hidden in
    // cockpit mode (a real prop reads as a blur; a frozen blade would split
    // the frame), and the camera pitches slightly down so the cowling reads
    // as a strip at the bottom, not half the frame. Instruments are the DOM
    // HUD (ALT/SPD/HDG, attitude, throttle/fuel) — it stays legible here.
    aircraft.prop.visible = false;
    const eye = f.pos.clone().addScaledVector(forward, 3.15);
    eye.y += 1.3;
    camera.position.copy(eye);
    camera.fov = 68;
    camera.updateProjectionMatrix();
    const look = f.pos.clone().addScaledVector(forward, 120);
    look.y -= 20;
    camera.lookAt(look);
    camPos.copy(camera.position);
    camLook.copy(look);
    return;
  }
  aircraft.prop.visible = true;
  // Chase: smoothed position behind and above, look ahead of the nose.
  const target = f.pos.clone().addScaledVector(forward, -26);
  target.y = f.pos.y + 7.5;
  const k = 1 - Math.exp(-dt * 4.5);
  camPos.lerp(target, dt === 0 ? 1 : k);
  const lookTarget = f.pos.clone().addScaledVector(forward, 90);
  lookTarget.y = f.pos.y + 2;
  camLook.lerp(lookTarget, dt === 0 ? 1 : 1 - Math.exp(-dt * 6));
  camera.position.copy(camPos);
  const targetFov = 62 + Math.min(16, f.speed * 0.14);
  if (Math.abs(camera.fov - targetFov) > 0.2) {
    camera.fov += (targetFov - camera.fov) * 0.1;
    camera.updateProjectionMatrix();
  }
  camera.lookAt(camLook);
}

function renderOnce() {
  syncAircraftMesh();
  updateHud();
  renderer.render(scene, camera);
}

function syncAircraftMesh() {
  const f = flight;
  aircraft.group.position.copy(f.pos);
  aircraft.group.rotation.order = 'YXZ';
  aircraft.group.rotation.y = -f.heading;
  aircraft.group.rotation.x = f.pitch;
  aircraft.group.rotation.z = -f.roll;
  aircraft.prop.rotation.z = game.propSpin;
}

function updateHud() {
  const f = flight;
  const headingDeg = ((f.heading * 180) / Math.PI % 360 + 360) % 360;
  let warning = '';
  if (f.crashed) warning = '';
  else if (f.stalled) warning = 'STALL!';
  else if (f.fuel < 0.15) warning = 'LOW FUEL';
  else if (!f.onGround && f.verticalSpeed < -12 && f.pos.y < 130) warning = 'PULL UP';
  const banner = missions.message && missions.time < missions.messageUntil ? missions.message : '';
  hud.update({
    altFt: Math.max(0, f.pos.y * 3.28084),
    speedKt: f.speed * 1.94384,
    headingDeg,
    ring: missions.nextRing,
    ringTotal: 8,
    score: missions.score,
    fuel: f.fuel,
    throttle: f.throttle,
    flaps: f.flaps,
    pitch: f.pitch,
    roll: f.roll,
    warning,
    banner,
  });
}

function resetRun() {
  const start = runwayStart();
  flight.pos.set(start.x, start.y, start.z);
  flight.heading = start.heading;
  flight.pitch = 0;
  flight.roll = 0;
  flight.speed = 0;
  flight.throttle = 0;
  flight.flaps = false;
  flight.fuel = 1;
  flight.onGround = true;
  flight.crashed = false;
  flight.landed = false;
  flight.stalled = false;
  resetMissionVisuals(missions);
  missions.message = 'Terbang lewat 8 ring, lalu antar kargo ke Pulau Karang.';
  missions.messageUntil = missions.time + 6;
  game.state = 'flying';
  gameClock = 0;
  hud.showOverlay('', '', false);
}

function startFlying() {
  audio.unlock();
  audio.click();
  resetRun();
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - frame.last) / 1000 || 0.016);
  frame.last = now;
  gameClock += dt;
  fpsEma += ((1 / Math.max(dt, 0.001)) - fpsEma) * 0.02;

  // Auto-quality: drop pixel ratio if the frame rate sags.
  if (now - lastQualityCheck > 4000) {
    lastQualityCheck = now;
    if (fpsEma < 40 && pixelStep < 2) {
      pixelStep += 1;
      renderer.setPixelRatio(pixelStep === 1 ? 1.25 : 1);
    }
  }

  if (input.wasPressed('KeyM')) audio.setMuted(!audio.muted);
  if (input.wasPressed('KeyC')) game.cameraMode = game.cameraMode === 'chase' ? 'cockpit' : 'chase';
  if (input.wasPressed('KeyF') && game.state === 'flying') flight.flaps = !flight.flaps;

  if (game.state === 'title') {
    if (input.wasPressed('Enter')) startFlying();
    // Slow orbit around the parked aircraft for the title screen.
    const t = now * 0.00008;
    camPos.set(flight.pos.x + Math.sin(t) * 26, flight.pos.y + 9, flight.pos.z + Math.cos(t) * 26);
    camera.position.copy(camPos);
    camera.lookAt(flight.pos);
    syncAircraftMesh();
    renderer.render(scene, camera);
    input.endFrame();
    return;
  }

  if (!game.paused && game.state === 'flying') {
    const cmd = input.read();
    const event = stepFlight(flight, dt, cmd, (x, z) => groundHeight(x, z, SEED));
    if (event === 'stall' && now - stallBeepAt > 900) { stallBeepAt = now; audio.stall(); }
    if (event === 'landed') {
      audio.touchdown();
      const result = onLanded(missions, flight);
      if (result.event === 'mission-done') {
        game.state = 'done';
        hud.showOverlay('MISSION COMPLETE', `Score ${missions.score} — press R to fly again`, true);
      }
    }
    if (event === 'crashed' || event === 'ditched') {
      audio.crash();
      game.state = 'crashed';
      hud.showOverlay(
        event === 'ditched' ? 'DITCHED IN THE SEA' : 'CRASHED',
        'Press R to try again — mind your speed and the terrain.',
        true,
      );
    }
    const missionEvent = stepMissions(missions, flight, dt);
    if (missionEvent === 'ring') audio.ring();
    game.propSpin += (2 + flight.throttle * 28) * dt;
    audio.update(flight.throttle, flight.speed, flight.stalled);
  }

  if (input.wasPressed('KeyR') && game.state !== 'title') startFlying();

  syncAircraftMesh();
  updateCamera(game.paused ? 0 : dt);
  updateHud();
  renderer.render(scene, camera);
  input.endFrame();
}
frame.last = performance.now();

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
window.addEventListener('pointerdown', () => {
  if (game.state === 'title') startFlying();
});

// Expose a snapshot for the deterministic screenshot/playtest harness.
window.__game = {
  get state() { return game.state; },
  get score() { return missions.score; },
  get ring() { return missions.nextRing; },
  get speed() { return flight.speed; },
  get altitude() { return flight.pos.y; },
  get fuel() { return flight.fuel; },
  get crashed() { return flight.crashed; },
  get simTime() { return gameClock; },
};

if (SHOT) {
  game.state = 'flying';
  hud.showOverlay('', '', false);
  stageShot(SHOT, game);
} else {
  hud.showOverlay(
    'NUSA AIRLIFT',
    'Island courier — fly cargo between Nusa Besar and Pulau Karang. Pass all 8 rings, then land on the far runway. Watch your fuel.',
    true,
  );
  requestAnimationFrame(frame);
}
