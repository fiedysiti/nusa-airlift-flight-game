// The courier aircraft for Nusa Airlift, built from primitives: a high-wing bush
// plane in courier orange and cream, with a spinning prop, nav lights and fixed gear.
// No external model, no copied mesh — every part is placed here.
import * as THREE from 'three';

export function buildAircraft() {
  const plane = new THREE.Group();
  const paint = new THREE.MeshLambertMaterial({ color: 0xe86a1c });
  const cream = new THREE.MeshLambertMaterial({ color: 0xf2e8d5 });
  const dark = new THREE.MeshLambertMaterial({ color: 0x2b3440 });
  const glass = new THREE.MeshLambertMaterial({ color: 0x18242e, transparent: true, opacity: 0.35, depthWrite: false });

  // Fuselage: nose cone + body + tapered tail.
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.7, 1.5, 12), paint);
  nose.rotation.x = -Math.PI / 2;
  nose.position.set(0, 0, -4.35);
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.62, 6.4, 12), cream);
  body.rotation.x = Math.PI / 2;
  body.position.set(0, 0, -0.6);
  const tail = new THREE.Mesh(new THREE.ConeGeometry(0.62, 2.4, 12), paint);
  tail.rotation.x = Math.PI / 2;
  tail.position.set(0, 0.1, 3.8);
  plane.add(nose, body, tail);

  // Belly stripe.
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.18, 5.6), paint);
  stripe.position.set(0, -0.62, -0.6);
  plane.add(stripe);

  // Main wing (high wing) + struts.
  const wing = new THREE.Mesh(new THREE.BoxGeometry(11.4, 0.22, 1.9), paint);
  wing.position.set(0, 0.95, -0.9);
  plane.add(wing);
  for (const side of [-1, 1]) {
    const strut = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.5, 0.12), dark);
    strut.position.set(side * 2.6, 0.25, -0.9);
    strut.rotation.z = side * 0.35;
    plane.add(strut);
  }

  // Tail: horizontal stabiliser + vertical fin.
  const stab = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.16, 1.1), paint);
  stab.position.set(0, 0.25, 4.4);
  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.7, 1.4), paint);
  fin.position.set(0, 0.9, 4.5);
  plane.add(stab, fin);

  // Cockpit windows.
  const windshield = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.7, 0.9), glass);
  windshield.position.set(0, 0.55, -2.6);
  windshield.rotation.x = -0.35;
  const sideWindow = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.55, 1.2), glass);
  sideWindow.position.set(0, 0.45, -1.6);
  plane.add(windshield, sideWindow);

  // Propeller: hub + two blades; spins in the loop.
  const prop = new THREE.Group();
  const hub = new THREE.Mesh(new THREE.ConeGeometry(0.32, 0.7, 10), dark);
  hub.rotation.x = -Math.PI / 2;
  prop.add(hub);
  for (const angle of [0, Math.PI]) {
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.34, 3.4, 0.08), dark);
    blade.rotation.z = angle;
    blade.position.z = -0.15;
    prop.add(blade);
  }
  prop.position.set(0, 0, -5.3);
  plane.add(prop);

  // Fixed landing gear: two mains + tail wheel.
  for (const side of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 1.1, 6), dark);
    leg.position.set(side * 0.85, -1.05, -1.4);
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.3, 12), dark);
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(side * 0.85, -1.6, -1.4);
    plane.add(leg, wheel);
  }
  const tailWheel = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.18, 10), dark);
  tailWheel.rotation.z = Math.PI / 2;
  tailWheel.position.set(0, -0.75, 4.2);
  plane.add(tailWheel);

  // Nav lights: red left, green right, white tail.
  const lightMat = (color) => new THREE.MeshBasicMaterial({ color });
  const leftLight = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 8), lightMat(0xff2211));
  leftLight.position.set(-5.7, 0.95, -0.9);
  const rightLight = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 8), lightMat(0x22ff66));
  rightLight.position.set(5.7, 0.95, -0.9);
  const tailLight = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 8), lightMat(0xffffff));
  tailLight.position.set(0, 0.3, 5.1);
  plane.add(leftLight, rightLight, tailLight);

  return { group: plane, prop };
}
