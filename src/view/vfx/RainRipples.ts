import { BALANCE } from '../../data/balance';
const C = BALANCE.fx.weather;

/** Shared world-space phase keeps reflection distortion attached to the visible impact ring. */
export const rainRipplesGLSL = `
  float rainRing(vec2 world, float time) {
    vec2 cell = world / ${C.rippleTile}.0;
    float seed = fract(sin(dot(floor(cell), vec2(127.1,311.7))) * 43758.5453);
    float age = fract(time * ${C.rippleSpeed} + seed);
    float radius = length(fract(cell) - .5);
    return (1.0 - smoothstep(0.0, ${C.rippleWidth}, abs(radius - age * .5))) * (1.0-age);
  }
`;
