import type { Body } from './body';
import {
  clamp,
  dist,
  distToPolygon,
  distToSegment,
  inverseBilinear,
  lerp,
  norm,
  perp,
  sub,
  dot,
  v2,
  type V2,
} from './geom';

/**
 * A garment image is turned into a grid mesh. A small skeleton ("rig") drawn on the image says where
 * the garment's shoulders, hips and sleeve / leg axes are; every frame the mesh is bent so those
 * points land on the wearer's tracked joints (linear blend skinning with 2D bones).
 *
 * Sides are named by where they appear in the picture (`L` = left of the image), the same
 * convention as `Body`.
 */

export type Kind = 'top' | 'bottom' | 'dress';
export type Pt = [number, number];
/** Rig in image-normalised coordinates (0..1 across / down the garment image). */
export interface RigDef {
  /** shoulder joints [left, right] (tops and dresses) */
  s?: [Pt, Pt];
  /** hip joints [left, right] */
  h: [Pt, Pt];
  /**
   * Points after the shoulder along each sleeve. One point = a straight sleeve (short sleeves),
   * two points = it bends at the first one (elbow) and ends at the second (cuff).
   */
  arm?: [Pt[], Pt[]];
  /** Same for each leg: [knee] or [knee, ankle]. */
  leg?: [Pt[], Pt[]];
  /** sleeve / leg half-width as a fraction of the image height (default 0.06) */
  armR?: number;
  legR?: number;
  /** y (fraction of image height) where the pelvis hands over to the legs */
  crotch?: number;
  /** softness of the transition between bones, fraction of image height (default 0.045) */
  sigma?: number;
}

type BoneId = 'torso' | 'pelvis' | 'armL' | 'armL2' | 'armR' | 'armR2' | 'legL' | 'legL2' | 'legR' | 'legR2';

interface Bone {
  id: BoneId;
  /** rest segment (pelvis: the hip line) */
  a: V2;
  b: V2;
  radius: number;
  /** pelvis only: local y range of the region it owns (hip-line frame) */
  wMin: number;
  wMax: number;
  quad?: V2[];
}

export interface Mesh {
  kind: Kind;
  /** texture size the rig is expressed in */
  W: number;
  H: number;
  rig: RigDef;
  bones: Bone[];
  count: number;
  rest: Float32Array;
  uv: Float32Array;
  index: Uint16Array;
  /** up to 4 bone slots per vertex */
  vb: Uint8Array;
  vw: Float32Array;
  /** torso-quad coordinates per vertex */
  st: Float32Array;
  restShoulderW: number;
  restHipW: number;
  restTorsoLen: number;
  hipMid: V2;
  hipDir: V2;
}

const px = (p: Pt, W: number, H: number): V2 => v2(p[0] * W, p[1] * H);

export function buildMesh(rig: RigDef, kind: Kind, W: number, H: number, bbox: [number, number, number, number] = [0, 0, 1, 1]): Mesh {
  const hL = px(rig.h[0], W, H);
  const hR = px(rig.h[1], W, H);
  const hasShoulders = !!rig.s && kind !== 'bottom';
  const sL = rig.s ? px(rig.s[0], W, H) : hL;
  const sR = rig.s ? px(rig.s[1], W, H) : hR;
  const armR = (rig.armR ?? 0.06) * H;
  const legR = (rig.legR ?? 0.06) * H;
  const sigma = (rig.sigma ?? 0.045) * H;

  const hipMid = lerp(hL, hR, 0.5);
  const hipDir = norm(sub(hR, hL));
  const hipPerp = perp(hipDir);

  const bones: Bone[] = [];
  const seg = (id: BoneId, a: V2, b: V2, radius: number) => bones.push({ id, a, b, radius, wMin: 0, wMax: 0 });

  if (hasShoulders) {
    bones.push({ id: 'torso', a: sL, b: sR, radius: 0, wMin: 0, wMax: 0, quad: [sL, sR, hR, hL] });
  }
  // The pelvis owns the strip between the hips. Tops: everything below the hip line. Bottoms: from the
  // waistband down to the crotch (or to the hem for skirts).
  const pelvisMin = hasShoulders ? 0 : -Infinity;
  let pelvisMax = Infinity;
  if (!hasShoulders && rig.leg && rig.crotch !== undefined) pelvisMax = (rig.crotch * H - hipMid.y) * hipPerp.y + 0; // along hip-perp
  bones.push({ id: 'pelvis', a: hL, b: hR, radius: 0, wMin: pelvisMin, wMax: pelvisMax });

  if (rig.arm && hasShoulders) {
    const sides: [V2, Pt[], BoneId, BoneId][] = [
      [sL, rig.arm[0], 'armL', 'armL2'],
      [sR, rig.arm[1], 'armR', 'armR2'],
    ];
    for (const [root, pts, id1, id2] of sides) {
      const p1 = px(pts[0], W, H);
      seg(id1, root, p1, armR);
      if (pts[1]) seg(id2, p1, px(pts[1], W, H), armR);
    }
  }
  if (rig.leg) {
    const sides: [V2, Pt[], BoneId, BoneId][] = [
      [hL, rig.leg[0], 'legL', 'legL2'],
      [hR, rig.leg[1], 'legR', 'legR2'],
    ];
    for (const [root, pts, id1, id2] of sides) {
      const p1 = px(pts[0], W, H);
      seg(id1, root, p1, legR);
      if (pts[1]) seg(id2, p1, px(pts[1], W, H), legR);
    }
  }

  // ---- vertex grid over the garment's bounding box
  const bx0 = bbox[0] * W;
  const by0 = bbox[1] * H;
  const bw = (bbox[2] - bbox[0]) * W;
  const bh = (bbox[3] - bbox[1]) * H;
  const cell = 14;
  const cols = clamp(Math.ceil(bw / cell), 8, 70);
  const rows = clamp(Math.ceil(bh / cell), 8, 70);
  const count = (cols + 1) * (rows + 1);
  const rest = new Float32Array(count * 2);
  const uv = new Float32Array(count * 2);
  const vb = new Uint8Array(count * 4);
  const vw = new Float32Array(count * 4);
  const st = new Float32Array(count * 2);

  const d = new Float64Array(bones.length);
  for (let r = 0; r <= rows; r++) {
    for (let c = 0; c <= cols; c++) {
      const i = r * (cols + 1) + c;
      const x = bx0 + (c / cols) * bw;
      const y = by0 + (r / rows) * bh;
      rest[i * 2] = x;
      rest[i * 2 + 1] = y;
      uv[i * 2] = x / W;
      uv[i * 2 + 1] = y / H;
      const p = v2(x, y);

      if (hasShoulders) {
        const q = inverseBilinear(p, sL, sR, v2(hR.x, hR.y), v2(hL.x, hL.y));
        st[i * 2] = q.s;
        st[i * 2 + 1] = q.t;
      }

      // influence distance to every bone
      for (let b = 0; b < bones.length; b++) {
        const bone = bones[b];
        if (bone.id === 'torso') d[b] = distToPolygon(p, bone.quad!);
        else if (bone.id === 'pelvis') {
          const rel = sub(p, hipMid);
          const u = dot(rel, hipDir);
          const w = dot(rel, hipPerp);
          const half = dist(hL, hR) / 2;
          const du = Math.max(0, Math.abs(u) - half);
          const dw = w < bone.wMin ? bone.wMin - w : w > bone.wMax ? w - bone.wMax : 0;
          d[b] = Math.hypot(du, dw);
        } else d[b] = Math.max(0, distToSegment(p, bone.a, bone.b) - bone.radius);
      }
      // keep the 4 closest bones
      const order = Array.from(d.keys()).sort((m, n) => d[m] - d[n]).slice(0, 4);
      const dmin = d[order[0]];
      let sum = 0;
      const ws = order.map((b) => {
        const k = (d[b] - dmin) / sigma;
        const w = Math.exp(-k * k);
        sum += w;
        return w;
      });
      order.forEach((b, j) => {
        vb[i * 4 + j] = b;
        vw[i * 4 + j] = ws[j] / sum;
      });
    }
  }

  const index = new Uint16Array(cols * rows * 6);
  let n = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const a = r * (cols + 1) + c;
      const b = a + 1;
      const cc = a + cols + 1;
      const dd = cc + 1;
      index[n++] = a;
      index[n++] = b;
      index[n++] = cc;
      index[n++] = b;
      index[n++] = dd;
      index[n++] = cc;
    }
  }

  return {
    kind,
    W,
    H,
    rig,
    bones,
    count,
    rest,
    uv,
    index,
    vb,
    vw,
    st,
    restShoulderW: dist(sL, sR),
    restHipW: dist(hL, hR),
    restTorsoLen: hasShoulders ? dist(lerp(sL, sR, 0.5), hipMid) : 0,
    hipMid,
    hipDir,
  };
}

// ---------------------------------------------------------------------------
// Posing
// ---------------------------------------------------------------------------

interface SegXf {
  a: V2;
  d: V2;
  n: V2;
  A: V2;
  D: V2;
  N: V2;
  /** scale along the bone / across it */
  sa: number;
  sc: number;
}

// Typical segment lengths per unit of torso length (shoulder joints -> hip joints)
const NOMINAL = { upperArm: 0.5, forearm: 0.45, thigh: 0.72, shin: 0.68 };

/**
 * Forward kinematics of the garment's own chain: every bone points the way the wearer's limb points,
 * but keeps the garment's length (scaled with the torso, shortened only when the limb is foreshortened).
 */
function chain(
  xf: Map<BoneId, SegXf>,
  m: Mesh,
  ids: BoneId[],
  joints: V2[],
  nominal: number[],
  torsoLen: number,
  lengthScale: number,
  crossScale: number,
) {
  let A = joints[0];
  for (let j = 0; j < ids.length; j++) {
    const bone = m.bones.find((b) => b.id === ids[j]);
    if (!bone) return;
    const restLen = dist(bone.a, bone.b) || 1;
    const d = norm(sub(bone.b, bone.a));
    const vec = sub(joints[j + 1], joints[j]);
    const L = Math.hypot(vec.x, vec.y);
    const D = L < 1e-3 ? d : v2(vec.x / L, vec.y / L);
    const f = clamp(L / (nominal[j] * torsoLen), 0.4, 1.15);
    const sa = lengthScale * f;
    xf.set(ids[j], { a: bone.a, d, n: perp(d), A, D, N: perp(D), sa, sc: crossScale });
    A = v2(A.x + D.x * restLen * sa, A.y + D.y * restLen * sa);
  }
}

/** Writes the posed vertex positions (video pixels) into `out` (2 floats per vertex). */
export function poseMesh(m: Mesh, body: Body, out: Float32Array): void {
  const xf = new Map<BoneId, SegXf>();
  const rig = m.rig;
  const isBottom = m.kind === 'bottom';

  // Scales. Length follows the torso (it does not change when you turn); width follows the shoulders
  // (sleeves) or hips (pelvis), which do shrink when you turn.
  const Sl = isBottom ? (0.31 * body.torsoLen) / (m.restHipW || 1) : body.torsoLen / (m.restTorsoLen || 1);
  const Sw = isBottom ? Sl : body.shoulderW / (m.restShoulderW || 1);
  const hipRatio = dist(body.hL, body.hR) / (m.restHipW || 1);
  const Sp = clamp(hipRatio, 0.7 * Sl, 1.35 * Sl);

  if (rig.arm && !isBottom) {
    const has = (id: BoneId) => m.bones.some((b) => b.id === id);
    chain(xf, m, has('armL2') ? ['armL', 'armL2'] : ['armL'], [body.sL, body.eL, body.wL], [NOMINAL.upperArm, NOMINAL.forearm], body.torsoLen, Sl, Sw);
    chain(xf, m, has('armR2') ? ['armR', 'armR2'] : ['armR'], [body.sR, body.eR, body.wR], [NOMINAL.upperArm, NOMINAL.forearm], body.torsoLen, Sl, Sw);
  }
  if (rig.leg) {
    const has = (id: BoneId) => m.bones.some((b) => b.id === id);
    chain(xf, m, has('legL2') ? ['legL', 'legL2'] : ['legL'], [body.hL, body.kL, body.aL], [NOMINAL.thigh, NOMINAL.shin], body.torsoLen, Sl, Sp);
    chain(xf, m, has('legR2') ? ['legR', 'legR2'] : ['legR'], [body.hR, body.kR, body.aR], [NOMINAL.thigh, NOMINAL.shin], body.torsoLen, Sl, Sp);
  }

  // pelvis: from the rest hip line to the live one (width follows the hips, length the torso)
  const hmLive = lerp(body.hL, body.hR, 0.5);
  const E = dist(body.hL, body.hR) < 1e-3 ? v2(1, 0) : norm(sub(body.hR, body.hL));
  const F = perp(E);
  const hipPerp = perp(m.hipDir);

  const q00 = body.sL;
  const q10 = body.sR;
  const q11 = body.hR;
  const q01 = body.hL;

  const bones = m.bones;
  const vb = m.vb;
  const vw = m.vw;
  const rest = m.rest;
  const st = m.st;

  for (let i = 0; i < m.count; i++) {
    const rx = rest[i * 2];
    const ry = rest[i * 2 + 1];
    let x = 0;
    let y = 0;
    for (let j = 0; j < 4; j++) {
      const w = vw[i * 4 + j];
      if (w < 1e-4) continue;
      const bone = bones[vb[i * 4 + j]];
      let px_ = rx;
      let py_ = ry;
      if (bone.id === 'torso') {
        const s = st[i * 2];
        const t = clamp(st[i * 2 + 1], -0.8, 2.4);
        const ax = q00.x + (q10.x - q00.x) * s;
        const ay = q00.y + (q10.y - q00.y) * s;
        const bx = q01.x + (q11.x - q01.x) * s;
        const by = q01.y + (q11.y - q01.y) * s;
        px_ = ax + (bx - ax) * t;
        py_ = ay + (by - ay) * t;
      } else if (bone.id === 'pelvis') {
        const relx = rx - m.hipMid.x;
        const rely = ry - m.hipMid.y;
        const u = (relx * m.hipDir.x + rely * m.hipDir.y) * Sp;
        const w2 = (relx * hipPerp.x + rely * hipPerp.y) * Sl;
        px_ = hmLive.x + E.x * u + F.x * w2;
        py_ = hmLive.y + E.y * u + F.y * w2;
      } else {
        const t = xf.get(bone.id);
        if (t) {
          const relx = rx - t.a.x;
          const rely = ry - t.a.y;
          const u = (relx * t.d.x + rely * t.d.y) * t.sa;
          const w2 = (relx * t.n.x + rely * t.n.y) * t.sc;
          px_ = t.A.x + t.D.x * u + t.N.x * w2;
          py_ = t.A.y + t.D.y * u + t.N.y * w2;
        }
      }
      x += px_ * w;
      y += py_ * w;
    }
    out[i * 2] = x;
    out[i * 2 + 1] = y;
  }
}
