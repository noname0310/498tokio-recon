import type { Matrix, Transform, Vec3 } from "./types.js";
/* Shared left-handed scene math; column-major matrices, ZXY Euler rotation. */
export const Math3D = (() => {
  const identity = () => [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];
  function multiply(a:Matrix, b:Matrix):Matrix {
    const out = Array(16).fill(0);
    for (let col = 0; col < 4; col++) for (let row = 0; row < 4; row++)
      for (let k = 0; k < 4; k++) out[col * 4 + row] += a[k * 4 + row] * b[col * 4 + k];
    return out;
  }
  function inverse(m:Matrix):Matrix {
    const a = Array.from({ length: 4 }, (_, r) => [...Array.from({ length: 4 }, (_, c) => m[c * 4 + r]), ...Array.from({ length: 4 }, (_, c) => +(c === r))]);
    for (let c = 0; c < 4; c++) {
      let pivot = c;
      for (let r = c + 1; r < 4; r++) if (Math.abs(a[r][c]) > Math.abs(a[pivot][c])) pivot = r;
      if (Math.abs(a[pivot][c]) < 1e-12) throw new Error("A Transform scale cannot be zero.");
      [a[c], a[pivot]] = [a[pivot], a[c]];
      const divisor = a[c][c]; a[c] = a[c].map(x => x / divisor);
      for (let r = 0; r < 4; r++) if (r !== c) { const factor = a[r][c]; a[r] = a[r].map((x, k) => x - factor * a[c][k]); }
    }
    return Array.from({ length: 16 }, (_, i) => a[i % 4][4 + Math.floor(i / 4)]);
  }
  function point(m:Matrix, p:Vec3, w = 1):Vec3 {
    return { x: m[0]*p.x+m[4]*p.y+m[8]*p.z+m[12]*w, y: m[1]*p.x+m[5]*p.y+m[9]*p.z+m[13]*w, z: m[2]*p.x+m[6]*p.y+m[10]*p.z+m[14]*w };
  }
  function trs(t:Transform):Matrix {
    const p = t.localPosition, s = t.localScale, r = t.localRotation;
    const x = r.x * Math.PI / 180, y = r.y * Math.PI / 180, z = r.z * Math.PI / 180;
    const X = [1,0,0,0, 0,Math.cos(x),Math.sin(x),0, 0,-Math.sin(x),Math.cos(x),0, 0,0,0,1];
    const Y = [Math.cos(y),0,-Math.sin(y),0, 0,1,0,0, Math.sin(y),0,Math.cos(y),0, 0,0,0,1];
    const Z = [Math.cos(z),Math.sin(z),0,0, -Math.sin(z),Math.cos(z),0,0, 0,0,1,0, 0,0,0,1];
    const m = multiply(multiply(Y, X), Z);
    for (let i = 0; i < 3; i++) { m[i] *= s.x; m[4+i] *= s.y; m[8+i] *= s.z; }
    m[12] = p.x; m[13] = p.y; m[14] = p.z;
    return m;
  }
  return {identity,multiply,inverse,point,trs};
})();
