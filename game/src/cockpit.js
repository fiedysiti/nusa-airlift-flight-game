// A real 3D cockpit panel for Nusa Airlift, built from three.js primitives
// and attached to the camera, so it reads as a flown cockpit in cockpit view
// and never appears in the chase view. Three live dials (speed, altitude,
// heading) with needles driven by the flight model every frame; the DOM HUD
// stays the source of the exact numbers.
import * as THREE from 'three';

export function buildCockpit(camera) {
  const group = new THREE.Group();
  const dark = new THREE.MeshLambertMaterial({ color: 0x1a2530 });
  const cream = new THREE.MeshLambertMaterial({ color: 0xf2e8d5 });
  const needleMat = new THREE.MeshBasicMaterial({ color: 0xff2a1e });
  const tickMat = new THREE.MeshBasicMaterial({ color: 0x2b3440 });

  // Glareshield: the dark brow over the panel, tilted toward the pilot.
  const shield = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.26, 0.14), dark);
  shield.position.set(0, -0.22, -1.02);
  shield.rotation.x = -0.2;
  group.add(shield);

  // Panel face.
  const panel = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.44, 0.06), dark);
  panel.position.set(0, -0.44, -1.05);
  group.add(panel);

  const dials = [];
  const defs = [
    { x: -0.46, key: 'speed' }, // airspeed
    { x: 0, key: 'alt' }, // altitude
    { x: 0.46, key: 'heading' }, // heading
  ];
  for (const d of defs) {
    // Rim + cream face, both facing the pilot (+Z in camera space).
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.02, 24), dark);
    rim.rotation.x = Math.PI / 2;
    rim.position.set(d.x, -0.44, -1.02);
    const face = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.025, 24), cream);
    face.rotation.x = Math.PI / 2;
    face.position.set(d.x, -0.44, -1.015);
    group.add(rim, face);
    // Four tick marks around the dial, at the needle's sweep ends and quarters.
    for (const a of [-2.1, -0.7, 0.7, 2.1]) {
      const tick = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.035, 0.005), tickMat);
      tick.position.set(d.x + Math.sin(a) * 0.105, -0.44 + Math.cos(a) * 0.105, -1.0);
      tick.rotation.z = -a;
      group.add(tick);
    }
    // Needle: a pivot at the dial centre with the blade offset up, so
    // rotating the pivot sweeps the needle across the face.
    const pivot = new THREE.Group();
    pivot.position.set(d.x, -0.44, -0.995);
    const needle = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.11, 0.008), needleMat);
    needle.position.y = 0.045;
    pivot.add(needle);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.01, 12), dark);
    hub.rotation.x = Math.PI / 2;
    hub.position.z = 0.005;
    pivot.add(hub);
    group.add(pivot);
    dials.push({ key: d.key, pivot });
  }

  group.visible = false;
  camera.add(group);

  return {
    group,
    update(flight) {
      const frac = (v, max) => Math.max(0, Math.min(1, v / max));
      for (const d of dials) {
        let f = 0;
        if (d.key === 'speed') f = frac(flight.speed, 96);
        else if (d.key === 'alt') f = frac(flight.pos.y, 1200);
        else f = (((flight.heading % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) / (2 * Math.PI);
        // Needle sweeps from up-left (0) to up-right (full scale).
        d.pivot.rotation.z = 2.1 - f * 4.2;
      }
    },
  };
}
