// Arcade flight model for Nusa Airlift — written from first principles.
// Lift grows with speed squared and stalls past a critical angle; banking turns
// the aircraft; throttle fights drag. No copied physics code.
import * as THREE from 'three';

export const STALL_SPEED = 26; // m/s — below this the wing stops flying
export const MAX_SPEED = 96; // m/s at full throttle, level flight
const GRAVITY = 9.81;

export function createFlight(start) {
  return {
    pos: new THREE.Vector3(start.x, start.y, start.z),
    heading: start.heading, // radians, 0 = facing -Z
    pitch: 0,
    roll: 0,
    speed: start.speed ?? 0,
    throttle: start.throttle ?? 0,
    flaps: false,
    fuel: 1,
    verticalSpeed: 0,
    // Short EMA of the sink rate (~0.25 s): the landing judgement reads
    // this, not the single-frame value — a one-frame spike from a pitch
    // correction must not crater an otherwise gentle touchdown.
    vsSmooth: 0,
    onGround: start.onGround ?? false,
    crashed: false,
    landed: false,
    stalled: false,
  };
}

// Forward direction from heading + pitch (y-up world).
export function forwardOf(flight) {
  const cp = Math.cos(flight.pitch);
  return new THREE.Vector3(
    Math.sin(flight.heading) * cp,
    Math.sin(flight.pitch),
    -Math.cos(flight.heading) * cp,
  );
}

// One physics step. `input` = { pitch: -1..1 (up positive), roll: -1..1,
// throttleUp, throttleDown, flaps }. `ground` = heightAt(x, z).
// Returns an event string: '' | 'stall' | 'landed' | 'crashed' | 'ditched'.
export function stepFlight(f, dt, input, ground) {
  if (f.crashed) return '';
  const wasAirborne = !f.onGround;

  // Throttle.
  if (input.throttleUp) f.throttle = Math.min(1, f.throttle + dt * 0.55);
  if (input.throttleDown) f.throttle = Math.max(0, f.throttle - dt * 0.7);

  // Flaps change the stall speed and add drag.
  const stallSpeed = f.flaps ? STALL_SPEED * 0.85 : STALL_SPEED;
  const flapDrag = f.flaps ? 0.35 : 0;

  // Attitude: pitch and roll ease toward the commanded values.
  const targetPitch = input.pitch * 0.32;
  const targetRoll = input.roll * 0.85;
  const ease = 1 - Math.exp(-dt * (f.onGround ? 6 : 3.2));
  f.pitch += (targetPitch - f.pitch) * ease;
  f.roll += (targetRoll - f.roll) * ease;

  // Turn: banked lift turns the nose. Turn rate = g * tan(bank) / speed.
  if (!f.onGround && f.speed > 8) {
    f.heading += (GRAVITY * Math.tan(f.roll) / Math.max(f.speed, 20)) * dt;
  }

  // Taxi: at a slow roll on the ground the rudder (A/D) turns the nose, so a
  // pilot can turn around on the strip after landing and take off the other
  // way. Only below 12 m/s — it never interferes with the takeoff roll.
  if (f.onGround && f.speed < 12) {
    f.heading += input.roll * 0.5 * dt;
  }

  // Speed: thrust minus drag. Fuel only burns while the engine runs.
  const thrust = f.fuel > 0 ? f.throttle * 26 : 0;
  const drag = 0.0021 * f.speed * f.speed + flapDrag * 2.2 + (f.onGround ? 3.2 : 0);
  const alongSlope = -GRAVITY * Math.sin(f.pitch);
  f.speed += (thrust - drag + alongSlope) * dt;
  if (f.fuel > 0) f.fuel = Math.max(0, f.fuel - f.throttle * dt * 0.0042);
  if (f.onGround) f.speed = Math.max(0, f.speed - dt * (f.throttle > 0.15 ? 0 : 9));
  f.speed = Math.min(f.speed, MAX_SPEED);

  // Stall: below stall speed the wing quits — nose drops, aircraft sinks.
  f.stalled = !f.onGround && f.speed < stallSpeed;
  if (f.stalled) {
    f.pitch += (-0.18 - f.pitch) * dt * 1.4;
  }

  // Integrate along the forward vector (its y-component is the climb);
  // a stalled wing adds an extra sink on top.
  const forward = forwardOf(f);
  const prevY = f.pos.y;
  f.pos.addScaledVector(forward, f.speed * dt);
  if (f.stalled) f.pos.y -= (stallSpeed - f.speed) * 1.6 * dt;
  f.verticalSpeed = (f.pos.y - prevY) / dt;
  f.vsSmooth += (f.verticalSpeed - f.vsSmooth) * Math.min(1, dt * 4);

  // Ground contact: three sample points (nose, left tip, right tip).
  const groundH = ground(f.pos.x, f.pos.z);
  const nose = new THREE.Vector3().copy(f.pos).addScaledVector(forward, 5);
  const right = new THREE.Vector3(Math.cos(f.heading), 0, Math.sin(f.heading));
  const tipL = new THREE.Vector3().copy(f.pos).addScaledVector(right, -5.7);
  const tipR = new THREE.Vector3().copy(f.pos).addScaledVector(right, 5.7);
  const noseH = ground(nose.x, nose.z);
  const tipLH = ground(tipL.x, tipL.z);
  const tipRH = ground(tipR.x, tipR.z);
  const clearance = Math.min(f.pos.y - groundH, nose.y - noseH, tipL.y - tipLH, tipR.y - tipRH);

  if (wasAirborne && clearance <= 0.4) {
    // Just touched down (or hit something): judge the landing on the
    // sustained sink rate, not a single-frame spike.
    const onWater = groundH <= 0.5;
    const gentle = Math.abs(f.vsSmooth) < 3.2 && Math.abs(f.roll) < 0.3 && f.speed < 42;
    if (onWater) {
      f.crashed = true;
      return 'ditched';
    }
    if (gentle) {
      f.onGround = true;
      f.landed = true;
      f.pos.y = groundH + 1.65;
      f.pitch = 0;
      f.roll = 0;
      return 'landed';
    }
    f.crashed = true;
    return 'crashed';
  }
  if (f.onGround) {
    // Rolling: rising terrain ahead of the nose or a wingtip ends the run.
    if (clearance < -1.2) {
      f.crashed = true;
      return 'crashed';
    }
    f.pos.y = groundH + 1.65;
    if (f.speed > stallSpeed * 1.05 && f.pitch > 0.06) {
      // Rotate off the runway.
      f.onGround = false;
      f.landed = false;
    }
  }
  return f.stalled ? 'stall' : '';
}
