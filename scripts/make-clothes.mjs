// Generates the built-in sample garments: public/clothes/*.svg and src/clothes.json (the catalogue +
// rigs). Run with `node scripts/make-clothes.mjs`. Real product photos work the same way: a
// transparent PNG plus a rig (see README), this just gives the app something to wear out of the box.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'public', 'clothes');
mkdirSync(outDir, { recursive: true });

// ---------- colour helpers ----------
const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const hex = (c) => '#' + c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
const mix = (a, b, t) => {
  const A = rgb(a);
  const B = rgb(b);
  return hex(A.map((v, i) => v + (B[i] - v) * t));
};
const dark = (c, t) => mix(c, '#000000', t);
const light = (c, t) => mix(c, '#ffffff', t);

// ---------- silhouette builder ----------
// `left` nodes are [dx, y] relative to the centre line (dx <= 0), optionally with a quadratic
// control point `c`. The right half is mirrored automatically.
function silhouette(cx, left, closeTop) {
  const X = (dx) => +(cx + dx).toFixed(1);
  const [x0, y0] = left[0].p;
  let d = `M${X(x0)} ${y0}`;
  for (let i = 1; i < left.length; i++) {
    const { p, c } = left[i];
    d += c ? `Q${X(c[0])} ${c[1]} ${X(p[0])} ${p[1]}` : `L${X(p[0])} ${p[1]}`;
  }
  const last = left[left.length - 1].p;
  d += `L${X(-last[0])} ${last[1]}`;
  for (let i = left.length - 1; i >= 1; i--) {
    const { c } = left[i];
    const p = left[i - 1].p;
    d += c ? `Q${X(-c[0])} ${c[1]} ${X(-p[0])} ${p[1]}` : `L${X(-p[0])} ${p[1]}`;
  }
  d += closeTop ? closeTop(cx) : '';
  return d + 'Z';
}
const N = (x, y, c) => ({ p: [x, y], c });

// reflect an absolute x across the centre line
const mirrorX = (cx, x) => +(2 * cx - x).toFixed(1);

// ---------- shared shading ----------
function defs(id, cx, W, H, base) {
  return `
  <linearGradient id="${id}-v" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#fff" stop-opacity=".16"/>
    <stop offset=".45" stop-color="#fff" stop-opacity="0"/>
    <stop offset="1" stop-color="#000" stop-opacity=".16"/>
  </linearGradient>
  <linearGradient id="${id}-h" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0" stop-color="#000" stop-opacity=".30"/>
    <stop offset=".16" stop-color="#000" stop-opacity=".04"/>
    <stop offset=".42" stop-color="#fff" stop-opacity=".09"/>
    <stop offset=".58" stop-color="#fff" stop-opacity=".05"/>
    <stop offset=".84" stop-color="#000" stop-opacity=".05"/>
    <stop offset="1" stop-color="#000" stop-opacity=".30"/>
  </linearGradient>
  <radialGradient id="${id}-pit" cx=".5" cy=".5" r=".5">
    <stop offset="0" stop-color="#000" stop-opacity=".34"/>
    <stop offset="1" stop-color="#000" stop-opacity="0"/>
  </radialGradient>
  <filter id="${id}-soft" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="3.2"/></filter>
  <filter id="${id}-grain" x="0" y="0" width="100%" height="100%">
    <feTurbulence type="fractalNoise" baseFrequency=".85" numOctaves="2" seed="4" result="n"/>
    <feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 .55 -.18"/>
  </filter>`;
}

/** Wraps shapes into a full SVG with the silhouette clip and common shading. */
function wrap({ id, W, H, cx, d, base, body, over = '', extraDefs = '', hole = '' }) {
  const edge = dark(base, 0.45);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<defs>${defs(id, cx, W, H, base)}
  <clipPath id="${id}-clip"><path d="${d}"/></clipPath>
  ${hole ? `<mask id="${id}-mask"><rect width="${W}" height="${H}" fill="#fff"/>${hole}</mask>` : ''}
  ${extraDefs}
</defs>
<g ${hole ? `mask="url(#${id}-mask)"` : ''}>
  <path d="${d}" fill="${base}"/>
  <g clip-path="url(#${id}-clip)">
    ${body}
    <rect width="${W}" height="${H}" fill="url(#${id}-h)"/>
    <rect width="${W}" height="${H}" fill="url(#${id}-v)"/>
    <rect width="${W}" height="${H}" filter="url(#${id}-grain)" opacity=".5"/>
    ${over}
  </g>
  <path d="${d}" fill="none" stroke="${edge}" stroke-opacity=".55" stroke-width="2.2" stroke-linejoin="round"/>
</g>
</svg>`;
}

// Proportions (175 cm adult, 1 m = 700 px) measured against MediaPipe's own landmarks, which sit lower than
// the anatomical joints: shoulder -> hip landmark is ~60 cm, a normal tee hem ends ~3 cm below the hip
// landmark, the waistband of jeans ~20 cm above it.
const HEM_BELOW_HIP = 24;
const items = [];
const norm = (W, H, p) => [+(p[0] / W).toFixed(4), +(p[1] / H).toFixed(4)];

// ============================================================ TEES
function tee({ id, name, color, neck = 'crew', stripe }) {
  const W = 640;
  const H = 520;
  const cx = 320;
  const base = color;
  const seam = [-150, 36];
  const Pt = [-262.6, 101];
  const Pb = [-204.6, 201.5];
  const A = [-176, 185];
  const hemY = 505;
  const left = [
    N(neck === 'v' ? -46 : -52, 2),
    N(...seam),
    N(...Pt),
    N(...Pb, [-236, 160]),
    N(...A),
    N(-172, hemY),
    N(0, hemY + 9, [-90, hemY + 11]),
  ];
  const closeTop =
    neck === 'v'
      ? (c) => `L${c + 46} 2L${c} 118L${c - 46} 2`
      : (c) => `C${c + 54} 58 ${c + 32} 94 ${c} 94C${c - 32} 94 ${c - 54} 58 ${c - 52} 2`;
  const d = silhouette(cx, left, closeTop);
  const neckStroke =
    neck === 'v'
      ? `M${cx - 46} 2L${cx} 118L${cx + 46} 2`
      : `M${cx - 52} 2C${cx - 54} 58 ${cx - 32} 94 ${cx} 94C${cx + 32} 94 ${cx + 54} 58 ${cx + 52} 2`;
  const rib = dark(base, 0.14);
  const sx = (dx) => cx + dx;
  let body = `
    <path d="${neckStroke}" fill="none" stroke="${rib}" stroke-width="17" stroke-linecap="round"/>
    <path d="${neckStroke}" fill="none" stroke="#fff" stroke-opacity=".08" stroke-width="5" transform="translate(0 -3)"/>
    <ellipse cx="${sx(A[0] + 14)}" cy="${A[1] + 8}" rx="42" ry="58" fill="url(#${id}-pit)"/>
    <ellipse cx="${mirrorX(cx, sx(A[0] + 14))}" cy="${A[1] + 8}" rx="42" ry="58" fill="url(#${id}-pit)"/>
    <path d="M${sx(seam[0])} ${seam[1]}L${sx(A[0])} ${A[1]}" stroke="#000" stroke-opacity=".16" stroke-width="2"/>
    <path d="M${mirrorX(cx, sx(seam[0]))} ${seam[1]}L${mirrorX(cx, sx(A[0]))} ${A[1]}" stroke="#000" stroke-opacity=".16" stroke-width="2"/>
    <path d="M${cx - 150} 360C${cx - 80} 372 ${cx - 40} 366 ${cx + 10} 372" stroke="#000" stroke-opacity=".07" stroke-width="14" fill="none" filter="url(#${id}-soft)"/>
    <path d="M${cx + 60} 250C${cx + 80} 320 ${cx + 100} 380 ${cx + 96} 470" stroke="#000" stroke-opacity=".08" stroke-width="12" fill="none" filter="url(#${id}-soft)"/>
    <path d="M${cx - 96} 220C${cx - 110} 300 ${cx - 120} 380 ${cx - 108} 470" stroke="#fff" stroke-opacity=".10" stroke-width="12" fill="none" filter="url(#${id}-soft)"/>
    <path d="M${sx(Pt[0]) + 8} ${Pt[1] + 12}L${sx(Pb[0]) + 8} ${Pb[1] + 10}" stroke="#000" stroke-opacity=".22" stroke-width="2" stroke-dasharray="6 4"/>
    <path d="M${mirrorX(cx, sx(Pt[0])) - 8} ${Pt[1] + 12}L${mirrorX(cx, sx(Pb[0])) - 8} ${Pb[1] + 10}" stroke="#000" stroke-opacity=".22" stroke-width="2" stroke-dasharray="6 4"/>
    <path d="M${cx - 168} ${hemY - 14}L${cx + 168} ${hemY - 14}" stroke="#000" stroke-opacity=".2" stroke-width="2" stroke-dasharray="6 4"/>`;
  if (stripe) {
    for (let y = 120; y < hemY - 10; y += 46) {
      body += `<rect x="0" y="${y}" width="${W}" height="16" fill="${stripe}" opacity=".9"/>`;
    }
  }
  const svg = wrap({ id, W, H, cx, d, base, body });
  const tipL = [(Pt[0] + Pb[0]) / 2 + cx, (Pt[1] + Pb[1]) / 2];
  const tipR = [mirrorX(cx, (Pt[0] + Pb[0]) / 2 + cx), tipL[1]];
  const sh = [cx + seam[0] + 14, seam[1] + 16];
  const shR = [mirrorX(cx, sh[0]), sh[1]];
  const hipY = hemY - HEM_BELOW_HIP;
  items.push({
    id,
    name,
    kind: 'top',
    color: color,
    src: `clothes/${id}.svg`,
    size: [W, H],
    rig: {
      s: [norm(W, H, sh), norm(W, H, shR)],
      h: [norm(W, H, [cx - 62, hipY]), norm(W, H, [cx + 62, hipY])],
      arm: [[norm(W, H, tipL)], [norm(W, H, tipR)]],
      armR: +(58 / H).toFixed(4),
    },
  });
  writeFileSync(join(outDir, `${id}.svg`), svg);
}

// ============================================================ LONG SLEEVE / HOODIE
function longSleeve({ id, name, color, hoodie = false, stripe }) {
  const W = 780;
  const cx = 390;
  const top = hoodie ? 70 : 0;
  const H = hoodie ? 640 : 540;
  const base = color;
  // sleeves hang close to the body (~15 deg), like a ghost-mannequin photo: little rotation is needed
  // to match a person standing with their arms down
  const seam = [-152, 36 + top];
  const Pt = [-292, 452 + top];
  const Pb = [-206, 478 + top];
  const A = [-180, 190 + top];
  const hemY = 520 + top;
  const left = [
    hoodie ? N(-80, 62 + top) : N(-52, 2),
    N(...seam),
    N(...Pt),
    N(...Pb),
    N(...A),
    N(-176, hemY),
    N(0, hemY + 8, [-90, hemY + 10]),
  ];
  const neckLow = hoodie ? 96 + top : 94;
  const closeTop = hoodie
    ? (c) => `L${c} ${neckLow - 20}L${c - 80} ${62 + top}`
    : (c) => `C${c + 54} 58 ${c + 32} 94 ${c} 94C${c - 32} 94 ${c - 54} 58 ${c - 52} 2`;
  const d = silhouette(cx, left, closeTop);
  const rib = dark(base, 0.16);
  const sx = (dx) => cx + dx;
  let body = '';
  // cuffs and hem ribbing
  const cuffC = [(Pt[0] + Pb[0]) / 2 + cx, (Pt[1] + Pb[1]) / 2];
  const ang = Math.atan2(Pb[1] - Pt[1], Pb[0] - Pt[0]);
  const cuff = (x, y, a, flip) => `<rect x="-52" y="-20" width="104" height="${hoodie ? 40 : 30}" fill="${rib}" transform="translate(${x} ${y}) rotate(${(a * 180) / Math.PI - 90}) ${flip ? 'scale(-1 1)' : ''}"/>`;
  body += cuff(cuffC[0], cuffC[1], ang, false);
  body += cuff(mirrorX(cx, cuffC[0]), cuffC[1], Math.PI - ang, false);
  body += `<rect x="${cx - 200}" y="${hemY - (hoodie ? 34 : 26)}" width="400" height="${hoodie ? 60 : 50}" fill="${rib}"/>`;
  body += `<path d="M${cx - 190} ${hemY - (hoodie ? 34 : 26)}L${cx + 190} ${hemY - (hoodie ? 34 : 26)}" stroke="#000" stroke-opacity=".25" stroke-width="2"/>`;
  for (const s of [-1, 1]) {
    body += `<path d="M${cx + s * seam[0] * -1 + s * 0} ${seam[1]}L${cx + s * A[0] * -1} ${A[1]}" stroke="#000" stroke-opacity=".16" stroke-width="2"/>`;
    body += `<path d="M${cx + s * -A[0]} ${A[1]}L${cx + s * -Pb[0]} ${Pb[1]}" stroke="#000" stroke-opacity=".34" stroke-width="5" filter="url(#${id}-soft)"/>`;
    body += `<path d="M${cx + s * -A[0]} ${A[1]}L${cx + s * -Pb[0]} ${Pb[1]}" stroke="#000" stroke-opacity=".22" stroke-width="1.6"/>`;
    body += `<ellipse cx="${cx + s * 160}" cy="${A[1] + 12}" rx="40" ry="66" fill="url(#${id}-pit)"/>`;
    body += `<path d="M${cx + s * 212} ${seam[1] + 150}C${cx + s * 226} ${seam[1] + 230} ${cx + s * 240} ${seam[1] + 310} ${cx + s * 250} ${seam[1] + 390}" stroke="#000" stroke-opacity=".12" stroke-width="12" fill="none" filter="url(#${id}-soft)"/>`;
    body += `<path d="M${cx + s * 232} ${seam[1] + 140}C${cx + s * 248} ${seam[1] + 220} ${cx + s * 262} ${seam[1] + 300} ${cx + s * 270} ${seam[1] + 380}" stroke="#fff" stroke-opacity=".10" stroke-width="9" fill="none" filter="url(#${id}-soft)"/>`;
    // elbow creases
    body += `<path d="M${cx + s * 214} ${seam[1] + 214}q${s * 12} 12 ${s * 34} 8" stroke="#000" stroke-opacity=".13" stroke-width="3" fill="none"/>`;
  }
  body += `<path d="M${cx - 130} ${top + 330}C${cx - 60} ${top + 346} ${cx + 40} ${top + 336} ${cx + 128} ${top + 350}" stroke="#000" stroke-opacity=".07" stroke-width="16" fill="none" filter="url(#${id}-soft)"/>`;
  body += `<path d="M${cx + 70} ${top + 230}C${cx + 92} ${top + 310} ${cx + 110} ${top + 370} ${cx + 104} ${top + 440}" stroke="#000" stroke-opacity=".08" stroke-width="12" fill="none" filter="url(#${id}-soft)"/>`;
  let extraDefs = '';
  let hole = '';
  let over = '';
  let dFinal = d;
  if (hoodie) {
    // hood worn down: a thick ring behind the neckline
    const ring = `<ellipse cx="${cx}" cy="${62 + top - 40}" rx="104" ry="82"/>`;
    const opening = `<ellipse cx="${cx}" cy="${62 + top - 36}" rx="66" ry="54" fill="#000"/>`;
    // add the ring to the silhouette so the outline and clip include it
    dFinal = d + `M${cx - 104} ${62 + top - 40}a104 82 0 1 0 208 0a104 82 0 1 0 -208 0Z`;
    hole = `<path d="M${cx - 66} ${62 + top - 36}a66 54 0 1 0 132 0a66 54 0 1 0 -132 0Z M${cx - 66} ${neckLow - 20}L${cx + 66} ${neckLow - 20}L${cx + 66} ${62 + top - 36}L${cx - 66} ${62 + top - 36}Z" fill="#000"/>`;
    body += `<ellipse cx="${cx}" cy="${62 + top - 40}" rx="104" ry="82" fill="${dark(base, 0.1)}"/>`;
    body += `<ellipse cx="${cx}" cy="${62 + top - 36}" rx="86" ry="66" fill="none" stroke="${dark(base, 0.3)}" stroke-width="6" stroke-opacity=".6"/>`;
    // pocket
    body += `<path d="M${cx - 120} ${top + 380}L${cx + 120} ${top + 380}L${cx + 146} ${top + 478}L${cx - 146} ${top + 478}Z" fill="${dark(base, 0.07)}" stroke="#000" stroke-opacity=".28" stroke-width="2.4"/>`;
    body += `<path d="M${cx - 112} ${top + 388}L${cx + 112} ${top + 388}" stroke="#fff" stroke-opacity=".12" stroke-width="3"/>`;
    // drawstrings
    for (const s of [-1, 1]) {
      body += `<path d="M${cx + s * 34} ${neckLow - 16}C${cx + s * 36} ${neckLow + 60} ${cx + s * 30} ${neckLow + 130} ${cx + s * 34} ${neckLow + 190}" stroke="${light(base, 0.55)}" stroke-width="7" stroke-linecap="round" fill="none"/>`;
      body += `<circle cx="${cx + s * 34}" cy="${neckLow + 194}" r="8" fill="${light(base, 0.45)}"/>`;
    }
  } else {
    const neckStroke = `M${cx - 52} 2C${cx - 54} 58 ${cx - 32} 94 ${cx} 94C${cx + 32} 94 ${cx + 54} 58 ${cx + 52} 2`;
    body += `<path d="${neckStroke}" fill="none" stroke="${rib}" stroke-width="17" stroke-linecap="round"/>`;
  }
  if (stripe) {
    for (let y = top + 120; y < hemY - 40; y += 52) {
      body += `<rect x="0" y="${y}" width="${W}" height="18" fill="${stripe}" opacity=".85"/>`;
    }
  }
  const svg = wrap({ id, W, H, cx, d: dFinal, base, body, over, extraDefs, hole });
  const sh = [cx + seam[0] + 14, seam[1] + 16];
  const shR = [mirrorX(cx, sh[0]), sh[1]];
  const hipY = hemY - HEM_BELOW_HIP;
  const cuffL = [cuffC[0], cuffC[1] - 6];
  const cuffR = [mirrorX(cx, cuffC[0]), cuffC[1] - 6];
  const elbL = [sh[0] + (cuffL[0] - sh[0]) * 0.5, sh[1] + (cuffL[1] - sh[1]) * 0.5];
  const elbR = [shR[0] + (cuffR[0] - shR[0]) * 0.5, shR[1] + (cuffR[1] - shR[1]) * 0.5];
  items.push({
    id,
    name,
    kind: 'top',
    color,
    src: `clothes/${id}.svg`,
    size: [W, H],
    rig: {
      s: [norm(W, H, sh), norm(W, H, shR)],
      h: [norm(W, H, [cx - 62, hipY]), norm(W, H, [cx + 62, hipY])],
      arm: [
        [norm(W, H, elbL), norm(W, H, cuffL)],
        [norm(W, H, elbR), norm(W, H, cuffR)],
      ],
      armR: +((hoodie ? 70 : 56) / H).toFixed(4),
    },
  });
  writeFileSync(join(outDir, `${id}.svg`), svg);
}

// ============================================================ TANK
function tank({ id, name, color }) {
  const W = 520;
  const H = 500;
  const cx = 260;
  const base = color;
  const left = [
    N(-98, 0),
    N(-104, 96, [-100, 50]),
    N(-130, 160, [-110, 150]),
    N(-152, 200),
    N(-150, 478),
    N(0, 487, [-80, 489]),
  ];
  const closeTop = (c) => `L${c + 62} 0C${c + 60} 70 ${c + 36} 125 ${c} 125C${c - 36} 125 ${c - 60} 70 ${c - 62} 0`;
  const d = silhouette(cx, left, closeTop);
  const rib = dark(base, 0.14);
  let body = `
    <path d="M${cx - 62} 0C${cx - 60} 70 ${cx - 36} 125 ${cx} 125C${cx + 36} 125 ${cx + 60} 70 ${cx + 62} 0" fill="none" stroke="${rib}" stroke-width="12"/>
    <path d="M${cx - 100} 10C${cx - 104} 90 ${cx - 128} 156 ${cx - 150} 198" fill="none" stroke="${rib}" stroke-width="12"/>
    <path d="M${cx + 100} 10C${cx + 104} 90 ${cx + 128} 156 ${cx + 150} 198" fill="none" stroke="${rib}" stroke-width="12"/>
    <path d="M${cx - 150} 466L${cx + 150} 466" stroke="#000" stroke-opacity=".2" stroke-width="2" stroke-dasharray="6 4"/>
    <path d="M${cx + 50} 250C${cx + 70} 320 ${cx + 86} 380 ${cx + 82} 450" stroke="#000" stroke-opacity=".09" stroke-width="12" fill="none" filter="url(#${id}-soft)"/>
    <path d="M${cx - 80} 230C${cx - 96} 300 ${cx - 104} 380 ${cx - 94} 450" stroke="#fff" stroke-opacity=".11" stroke-width="12" fill="none" filter="url(#${id}-soft)"/>`;
  const svg = wrap({ id, W, H, cx, d, base, body });
  const sh = [cx - 118, 44];
  const shR = [cx + 118, 44];
  const hipY = 478 - HEM_BELOW_HIP;
  items.push({
    id,
    name,
    kind: 'top',
    color,
    src: `clothes/${id}.svg`,
    size: [W, H],
    rig: { s: [norm(W, H, sh), norm(W, H, shR)], h: [norm(W, H, [cx - 62, hipY]), norm(W, H, [cx + 62, hipY])] },
  });
  writeFileSync(join(outDir, `${id}.svg`), svg);
}

// ============================================================ DRESS
function dress({ id, name, color, flare = 1 }) {
  const W = 640;
  const H = 860;
  const cx = 320;
  const base = color;
  const hemHalf = 140 + 90 * flare;
  const left = [
    N(-72, 0),
    N(-78, 92, [-74, 46]),
    N(-116, 150, [-90, 140]),
    N(-122, 214, [-126, 180]),
    N(-92, 292, [-100, 252]),
    N(-hemHalf, 800, [-110 - 30 * flare, 560]),
    N(0, 822, [-hemHalf / 2, 836]),
  ];
  const closeTop = (c) => `L${c + 40} 0C${c + 38} 60 ${c + 24} 112 ${c} 112C${c - 24} 112 ${c - 38} 60 ${c - 40} 0L${c - 72} 0`;
  const d = silhouette(cx, left, closeTop);
  const dk = dark(base, 0.22);
  let body = `
    <path d="M${cx - 40} 0C${cx - 38} 60 ${cx - 24} 112 ${cx} 112C${cx + 24} 112 ${cx + 38} 60 ${cx + 40} 0" fill="none" stroke="${dk}" stroke-width="9"/>
    <path d="M${cx - 92} 292L${cx + 92} 292" stroke="${dk}" stroke-width="9"/>
    <path d="M${cx - 92} 304L${cx + 92} 304" stroke="#000" stroke-opacity=".18" stroke-width="2"/>
    <path d="M${cx - 30} 150C${cx - 36} 200 ${cx - 40} 250 ${cx - 36} 290" stroke="#000" stroke-opacity=".12" stroke-width="3" fill="none"/>
    <path d="M${cx + 30} 150C${cx + 36} 200 ${cx + 40} 250 ${cx + 36} 290" stroke="#000" stroke-opacity=".12" stroke-width="3" fill="none"/>`;
  for (let i = -5; i <= 5; i++) {
    const x0 = cx + i * 14;
    const x1 = cx + i * (hemHalf / 6.4);
    body += `<path d="M${x0} 310C${(x0 + x1) / 2 + i * 3} 520 ${x1} 700 ${x1} 812" stroke="${i % 2 ? '#000' : '#fff'}" stroke-opacity="${i % 2 ? 0.1 : 0.09}" stroke-width="${i % 2 ? 14 : 12}" fill="none" filter="url(#${id}-soft)"/>`;
  }
  body += `<path d="M${cx - hemHalf + 10} 786L${cx + hemHalf - 10} 786" stroke="#000" stroke-opacity=".2" stroke-width="2" stroke-dasharray="6 4"/>`;
  const svg = wrap({ id, W, H, cx, d, base, body });
  const sh = [cx - 116, 36];
  const shR = [cx + 116, 36];
  const hipY = 440; // natural waist seam is ~20 cm above the hip landmark
  items.push({
    id,
    name,
    kind: 'dress',
    color,
    src: `clothes/${id}.svg`,
    size: [W, H],
    rig: { s: [norm(W, H, sh), norm(W, H, shR)], h: [norm(W, H, [cx - 62, hipY]), norm(W, H, [cx + 62, hipY])] },
  });
  writeFileSync(join(outDir, `${id}.svg`), svg);
}

// ============================================================ JEANS / SHORTS / SKIRT
function pants({ id, name, color, short = false, denim = true, wide = false }) {
  const W = 560;
  const cx = 280;
  const hem = short ? 340 : 740;
  const H = hem + 10;
  const base = color;
  const legOut = wide ? 168 : 146;
  const hemOut = short ? legOut - 4 : wide ? 168 : 136;
  const hemIn = short ? 38 : wide ? 34 : 44;
  const left = [
    N(-130, 0),
    N(-154, 110, [-148, 40]),
    N(-legOut - 4, short ? 250 : 400, [-legOut - 6, 220]),
    N(-hemOut, hem),
    N(-hemIn, hem),
    ...(short ? [] : [N(-22, 420)]),
    N(-5, 196, short ? [-18, 290] : [-8, 300]),
  ];
  const d = silhouette(cx, left);
  const dk = dark(base, 0.25);
  let body = '';
  let extraDefs = '';
  if (denim) {
    extraDefs = `<pattern id="${id}-twill" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(52)"><rect width="6" height="6" fill="none"/><rect width="2" height="6" fill="#fff" fill-opacity=".07"/></pattern>`;
    body += `<rect width="${W}" height="${H}" fill="url(#${id}-twill)"/>`;
  }
  const stitch = denim ? '#e0a44a' : '#000';
  const so = denim ? 0.8 : 0.2;
  body += `
    <rect x="${cx - 150}" y="0" width="300" height="44" fill="${dark(base, 0.1)}"/>
    <path d="M${cx - 150} 44L${cx + 150} 44" stroke="${stitch}" stroke-opacity="${so}" stroke-width="2.2" stroke-dasharray="7 4"/>
    <path d="M${cx - 150} 5L${cx + 150} 5" stroke="${stitch}" stroke-opacity="${so}" stroke-width="2.2" stroke-dasharray="7 4"/>
    <circle cx="${cx}" cy="26" r="9" fill="${light(base, 0.5)}" stroke="#000" stroke-opacity=".3"/>
    <path d="M${cx} 44L${cx} 186C${cx + 2} 194 ${cx + 6} 200 ${cx + 16} 202" stroke="${stitch}" stroke-opacity="${so}" stroke-width="2.4" stroke-dasharray="7 4" fill="none"/>
    <path d="M${cx - 112} 46C${cx - 120} 90 ${cx - 100} 150 ${cx - 56} 168" stroke="${stitch}" stroke-opacity="${so}" stroke-width="2.4" fill="none" stroke-dasharray="7 4"/>
    <path d="M${cx + 112} 46C${cx + 120} 90 ${cx + 100} 150 ${cx + 56} 168" stroke="${stitch}" stroke-opacity="${so}" stroke-width="2.4" fill="none" stroke-dasharray="7 4"/>
    <path d="M${cx - 112} 46C${cx - 118} 80 ${cx - 104} 132 ${cx - 70} 156" stroke="#000" stroke-opacity=".22" stroke-width="2" fill="none"/>
    <path d="M${cx + 112} 46C${cx + 118} 80 ${cx + 104} 132 ${cx + 70} 156" stroke="#000" stroke-opacity=".22" stroke-width="2" fill="none"/>`;
  for (const dx of [-110, -70, -22, 22, 70, 110]) {
    body += `<rect x="${cx + dx - 6}" y="-2" width="12" height="52" rx="3" fill="${dark(base, 0.12)}" stroke="#000" stroke-opacity=".2"/>`;
  }
  // leg shading
  for (const s of [-1, 1]) {
    body += `<path d="M${cx + s * 96} 200C${cx + s * 100} 330 ${cx + s * 96} 480 ${cx + s * 90} ${hem - 30}" stroke="#fff" stroke-opacity=".10" stroke-width="22" fill="none" filter="url(#${id}-soft)"/>`;
    body += `<path d="M${cx + s * 40} 230C${cx + s * 44} 330 ${cx + s * 48} 480 ${cx + s * 50} ${hem - 30}" stroke="#000" stroke-opacity=".14" stroke-width="14" fill="none" filter="url(#${id}-soft)"/>`;
    body += `<path d="M${cx + s * (hemOut - 6)} ${hem - 22}L${cx + s * (hemIn + 6)} ${hem - 22}" stroke="${stitch}" stroke-opacity="${so}" stroke-width="2.2" stroke-dasharray="6 4"/>`;
  }
  if (!short) {
    for (const s of [-1, 1]) {
      body += `<path d="M${cx + s * 100} 480q${s * -14} 10 ${s * -34} 4" stroke="#000" stroke-opacity=".18" stroke-width="3" fill="none"/>`;
      body += `<path d="M${cx + s * 98} 300q${s * -8} 20 ${s * -30} 24" stroke="#000" stroke-opacity=".10" stroke-width="3" fill="none"/>`;
    }
  }
  body += `<ellipse cx="${cx}" cy="212" rx="34" ry="30" fill="url(#${id}-pit)"/>`;
  const svg = wrap({ id, W, H, cx, d, base, body, extraDefs });

  const hipY = 140; // waistband top is ~20 cm above the hip landmark
  const hipX = 66;
  const ankleY = short ? 0 : hem - 25;
  const legX = (y) => 70 + ((y - hipY) / (hem - hipY)) * 18;
  const rig = { h: [norm(W, H, [cx - hipX, hipY]), norm(W, H, [cx + hipX, hipY])], legR: +(76 / H).toFixed(4), crotch: +(196 / H).toFixed(4) };
  if (short) {
    const tipY = hem - 14;
    rig.leg = [[norm(W, H, [cx - legX(tipY) - 4, tipY])], [norm(W, H, [cx + legX(tipY) + 4, tipY])]];
    rig.legR = +(70 / H).toFixed(4);
  } else {
    const kneeY = (hipY + ankleY) / 2;
    rig.leg = [
      [norm(W, H, [cx - legX(kneeY), kneeY]), norm(W, H, [cx - legX(ankleY), ankleY])],
      [norm(W, H, [cx + legX(kneeY), kneeY]), norm(W, H, [cx + legX(ankleY), ankleY])],
    ];
  }
  items.push({ id, name, kind: 'bottom', color, src: `clothes/${id}.svg`, size: [W, H], rig });
  writeFileSync(join(outDir, `${id}.svg`), svg);
}

function skirt({ id, name, color, long = false }) {
  const W = 600;
  const cx = 300;
  const hem = long ? 560 : 380;
  const H = hem + 24;
  const base = color;
  const hemHalf = long ? 215 : 190;
  const left = [N(-130, 0), N(-148, 100, [-140, 40]), N(-hemHalf, hem - 12, [-170, 260]), N(0, hem + 12, [-100, hem + 18])];
  const d = silhouette(cx, left);
  const dk = dark(base, 0.22);
  let body = `<rect x="${cx - 150}" y="0" width="300" height="40" fill="${dk}"/>
    <path d="M${cx - 150} 40L${cx + 150} 40" stroke="#000" stroke-opacity=".25" stroke-width="2"/>
    <circle cx="${cx}" cy="20" r="8" fill="${light(base, 0.4)}"/>`;
  for (let i = -6; i <= 6; i++) {
    const x0 = cx + i * 22;
    const x1 = cx + i * (hemHalf / 6.6);
    body += `<path d="M${x0} 50C${(x0 + x1) / 2} ${hem * 0.5} ${x1} ${hem * 0.8} ${x1} ${hem}" stroke="${i % 2 ? '#000' : '#fff'}" stroke-opacity="${i % 2 ? 0.11 : 0.1}" stroke-width="${i % 2 ? 16 : 13}" fill="none" filter="url(#${id}-soft)"/>`;
  }
  body += `<path d="M${cx - hemHalf + 14} ${hem - 24}L${cx + hemHalf - 14} ${hem - 24}" stroke="#000" stroke-opacity=".2" stroke-width="2" stroke-dasharray="6 4"/>`;
  const svg = wrap({ id, W, H, cx, d, base, body });
  const hipY = 140;
  items.push({
    id,
    name,
    kind: 'bottom',
    color,
    src: `clothes/${id}.svg`,
    size: [W, H],
    rig: { h: [norm(W, H, [cx - 62, hipY]), norm(W, H, [cx + 62, hipY])] },
  });
  writeFileSync(join(outDir, `${id}.svg`), svg);
}

// ============================================================ CATALOGUE
tee({ id: 'tee-white', name: 'White tee', color: '#f1efe9' });
tee({ id: 'tee-black', name: 'Black tee', color: '#25262c' });
tee({ id: 'tee-red', name: 'Red tee', color: '#c23b32' });
tee({ id: 'tee-navy-v', name: 'Navy V-neck', color: '#243d6e', neck: 'v' });
tee({ id: 'tee-sage', name: 'Sage tee', color: '#8aa586' });
tee({ id: 'tee-stripe', name: 'Breton stripe', color: '#f0eee8', stripe: '#27407a' });
tank({ id: 'tank-white', name: 'Rib tank', color: '#ece8df' });
tank({ id: 'tank-coral', name: 'Coral tank', color: '#e0705f' });
longSleeve({ id: 'long-grey', name: 'Grey long sleeve', color: '#9ca0a6' });
longSleeve({ id: 'long-burgundy', name: 'Burgundy knit', color: '#7a2e40' });
longSleeve({ id: 'hoodie-charcoal', name: 'Charcoal hoodie', color: '#3d4148', hoodie: true });
longSleeve({ id: 'hoodie-cream', name: 'Cream hoodie', color: '#e6dac3', hoodie: true });
longSleeve({ id: 'hoodie-green', name: 'Forest hoodie', color: '#2f5f48', hoodie: true });
pants({ id: 'jeans-blue', name: 'Blue jeans', color: '#44689a' });
pants({ id: 'jeans-black', name: 'Black jeans', color: '#2a2c31' });
pants({ id: 'jeans-wide', name: 'Wide-leg jeans', color: '#7d9ec6', wide: true });
pants({ id: 'chino-khaki', name: 'Khaki chinos', color: '#b79f78', denim: false });
pants({ id: 'shorts-denim', name: 'Denim shorts', color: '#6b90bf', short: true });
skirt({ id: 'skirt-plum', name: 'Plum skirt', color: '#6c3b60' });
skirt({ id: 'skirt-midi-tan', name: 'Tan midi skirt', color: '#c2a27a', long: true });
dress({ id: 'dress-emerald', name: 'Emerald dress', color: '#1f7b5c' });
dress({ id: 'dress-blush', name: 'Blush dress', color: '#e5aeb2', flare: 1.3 });
dress({ id: 'dress-black', name: 'Little black dress', color: '#202126', flare: 0.55 });

writeFileSync(join(root, 'src', 'clothes.json'), JSON.stringify(items, null, 1) + '\n');
// the service worker pre-caches these so the built-in garments work offline
writeFileSync(join(outDir, 'index.json'), JSON.stringify(items.map((i) => i.src)) + '\n');
console.log(`Wrote ${items.length} garments`);
