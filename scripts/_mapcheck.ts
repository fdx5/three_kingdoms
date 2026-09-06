import { Path } from '../src/sim/Path';

const P: [number, number][] = JSON.parse(process.argv[2]);
const slots: [string, number, number][] = JSON.parse(process.argv[3]);
const path = new Path(P);
console.log('총 길이:', path.totalLength.toFixed(0));
let turns = 0;
for (let i = 1; i < P.length - 1; i++) {
  const ax = P[i][0]-P[i-1][0], az = P[i][1]-P[i-1][1];
  const bx = P[i+1][0]-P[i][0], bz = P[i+1][1]-P[i][1];
  const cos = (ax*bx+az*bz)/(Math.hypot(ax,az)*Math.hypot(bx,bz));
  if (cos < Math.cos(60*Math.PI/180)) turns++;
}
console.log('큰 꺾임:', turns);
for (const [id, x, z] of slots) {
  const c100 = path.lengthWithinRadius(x, z, 100);
  const c150 = path.lengthWithinRadius(x, z, 150);
  const onPath = path.lengthWithinRadius(x, z, 23);
  console.log(`  ${id} (${x},${z})  사거리100=${c100.toFixed(0)}u  사거리150=${c150.toFixed(0)}u  ${onPath>0?'*** 경로 위!':''}`);
}
const inMap = P.every(([x,z]) => x>=0 && x<=1200 && z>=0 && z<=700);
console.log('맵 안:', inMap);
