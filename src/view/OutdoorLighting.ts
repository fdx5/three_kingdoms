import * as THREE from 'three';

/** A radiance probe of open sky and earth, with the same sun direction as the stage. */
export function outdoorLighting(renderer: THREE.WebGLRenderer, sun: THREE.DirectionalLight, sky: THREE.Color): THREE.WebGLRenderTarget {
  const scene = new THREE.Scene();
  const geometry = new THREE.SphereGeometry(10, 32, 16);
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    uniforms: {
      sunDirection: { value: sun.position.clone().sub(sun.target.position).normalize() },
      sunColor: { value: sun.color.clone() },
      skyColor: { value: sky.clone().lerp(new THREE.Color(0x8eafcb), .65) },
    },
    vertexShader: `varying vec3 direction;
      void main() { direction = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `varying vec3 direction; uniform vec3 sunDirection, sunColor, skyColor;
      void main() {
        vec3 d = normalize(direction);
        float altitude = max(d.y, 0.0);
        vec3 sky = mix(vec3(.82, .87, .91), skyColor, pow(altitude, .45));
        float alignment = max(dot(d, sunDirection), 0.0);
        sky += sunColor * (pow(alignment, 32.0) * .3 + pow(alignment, 1800.0) * 6.0);
        vec3 earth = vec3(.16, .135, .095) * (.7 + max(d.y + 1.0, 0.0) * .3);
        gl_FragColor = vec4(mix(earth, sky, smoothstep(-.09, .045, d.y)), 1.0);
      }`,
  });
  scene.add(new THREE.Mesh(geometry, material));
  const generator = new THREE.PMREMGenerator(renderer);
  try { return generator.fromScene(scene, .02, .1, 100); }
  finally { geometry.dispose(); material.dispose(); generator.dispose(); }
}
