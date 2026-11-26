// Sky, sun and clouds for Nusa Airlift: a gradient dome, a bright sun disc and
// soft low-poly cloud puffs scattered from the world seed.
import * as THREE from 'three';
import { mulberry32 } from './rng.js';

export function buildSky(scene, seed) {
  // Gradient dome (own shader, no texture file).
  const skyGeo = new THREE.SphereGeometry(9000, 24, 16);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      top: { value: new THREE.Color(0x2f7fd0) },
      mid: { value: new THREE.Color(0x9fd4ef) },
      bottom: { value: new THREE.Color(0xeaf6fb) },
    },
    vertexShader: `
      varying vec3 vPos;
      void main() { vPos = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
    `,
    fragmentShader: `
      uniform vec3 top; uniform vec3 mid; uniform vec3 bottom;
      varying vec3 vPos;
      void main() {
        float h = normalize(vPos).y;
        vec3 c = h > 0.12 ? mix(mid, top, smoothstep(0.12, 0.65, h)) : mix(bottom, mid, smoothstep(-0.08, 0.12, h));
        gl_FragColor = vec4(c, 1.0);
      }
    `,
  });
  const dome = new THREE.Mesh(skyGeo, skyMat);
  scene.add(dome);

  // Sun disc + glow.
  const sun = new THREE.Mesh(
    new THREE.CircleGeometry(180, 32),
    new THREE.MeshBasicMaterial({ color: 0xfff6c9, fog: false }),
  );
  sun.position.set(-2600, 2400, -5200);
  sun.lookAt(0, 0, 0);
  scene.add(sun);
  const glow = new THREE.Mesh(
    new THREE.CircleGeometry(420, 32),
    new THREE.MeshBasicMaterial({ color: 0xfff9d6, transparent: true, opacity: 0.35, fog: false }),
  );
  glow.position.copy(sun.position).multiplyScalar(1.001);
  glow.lookAt(0, 0, 0);
  scene.add(glow);

  // Clouds: puffs of 3–5 flattened spheres, seeded positions.
  const rand = mulberry32(seed ^ 0x51ab);
  const cloudMat = new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.88 });
  const clouds = new THREE.Group();
  for (let i = 0; i < 42; i += 1) {
    const puff = new THREE.Group();
    const puffs = 3 + Math.floor(rand() * 3);
    for (let j = 0; j < puffs; j += 1) {
      const r = 26 + rand() * 42;
      const ball = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), cloudMat);
      ball.position.set((rand() - 0.5) * 130, (rand() - 0.5) * 16, (rand() - 0.5) * 60);
      ball.scale.y = 0.45;
      puff.add(ball);
    }
    puff.position.set((rand() - 0.5) * 7600, 320 + rand() * 320, (rand() - 0.5) * 7600);
    clouds.add(puff);
  }
  scene.add(clouds);
  return clouds;
}
