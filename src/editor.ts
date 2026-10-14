import { autoRig, type AutoOptions, type Length } from './autorig';
import { KIND_ORDER, KIND_SINGULAR } from './catalog';
import type { Kind, Pt, RigDef } from './rig';

/**
 * Full-screen editor shown when adding or editing a garment: pick the type, then drag the dots onto
 * the garment's shoulders, hips and sleeve / leg lines. The first guess comes from `autoRig`.
 */
export interface EditorInput {
  canvas: HTMLCanvasElement;
  alpha: Uint8ClampedArray;
  kind: Kind;
  name: string;
  /** existing rig when editing; otherwise guessed from the silhouette */
  rig?: RigDef;
  warning?: string;
  canDelete?: boolean;
}

export type EditorResult = { action: 'save'; name: string; kind: Kind; rig: RigDef } | { action: 'delete' } | { action: 'cancel' };

interface Handle {
  id: string;
  label: string;
  color: string;
  /** partner mirrored across the centre line when "keep both sides matching" is on */
  partner?: string;
  get(): Pt;
  set(p: Pt): void;
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const COLORS = { s: '#4ade80', h: '#38bdf8', a: '#f472b6', l: '#fb923c' };

const HINTS: Record<Kind, string> = {
  top: 'Drag the green dots onto the shoulder joints (where the sleeve meets the shoulder) and the blue dots to where the hip bones would be. Pink dots run down the middle of each sleeve.',
  dress: 'Drag the green dots onto the shoulders (inside the straps or sleeves) and the blue dots to where the hip bones would be, just below the waist.',
  bottom: 'Drag the blue dots to the hip joints, about a hand below the waistband. Orange dots run down the middle of each leg.',
};

export function openEditor(input: EditorInput): Promise<EditorResult> {
  const root = $('editor');
  const stage = $('ed-stage');
  const view = $<HTMLCanvasElement>('ed-canvas');
  const lines = document.getElementById('ed-lines') as unknown as SVGSVGElement;
  const nameEl = $<HTMLInputElement>('ed-name');
  const kindEl = $('ed-kind');
  const lenEl = $('ed-len');
  const symEl = $<HTMLInputElement>('ed-sym');
  const warnEl = $('ed-warn');
  const hintEl = $('ed-hint');
  const delEl = $('ed-delete');

  let kind = input.kind;
  let sleeves: Length | 'auto' = 'auto';
  let legs: Length | 'auto' = 'auto';
  let rig: RigDef = input.rig ? structuredClone(input.rig) : guess({});
  let handles: Handle[] = [];

  function guess(extra: AutoOptions): RigDef {
    return autoRig(input.alpha, input.canvas.width, input.canvas.height, kind, { sleeves, legs, ...extra }).rig;
  }

  // ---- stage sizing: fit the garment into the free space
  view.width = input.canvas.width;
  view.height = input.canvas.height;
  view.getContext('2d')!.drawImage(input.canvas, 0, 0);
  function layoutStage() {
    const maxW = Math.min(window.innerWidth - 32, 560);
    const maxH = Math.max(160, window.innerHeight - 330);
    const k = Math.min(maxW / input.canvas.width, maxH / input.canvas.height);
    stage.style.width = `${Math.round(input.canvas.width * k)}px`;
    stage.style.height = `${Math.round(input.canvas.height * k)}px`;
  }

  // ---- controls
  nameEl.value = input.name;
  warnEl.hidden = !input.warning;
  warnEl.textContent = input.warning ?? '';
  delEl.hidden = !input.canDelete;

  function segment(host: HTMLElement, items: { id: string; label: string }[], current: string, onPick: (id: string) => void) {
    host.textContent = '';
    host.style.setProperty('--n', String(items.length));
    for (const it of items) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = it.label;
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(it.id === current));
      b.addEventListener('click', () => onPick(it.id));
      host.appendChild(b);
    }
  }

  function renderControls() {
    segment(
      kindEl,
      KIND_ORDER.map((k) => ({ id: k, label: KIND_SINGULAR[k] })),
      kind,
      (id) => {
        if (id === kind) return;
        kind = id as Kind;
        sleeves = 'auto';
        legs = 'auto';
        rig = guess({});
        rebuild();
      },
    );
    lenEl.hidden = kind === 'dress';
    if (kind === 'top') {
      segment(
        lenEl,
        [
          { id: 'auto', label: 'Auto' },
          { id: 'none', label: 'No sleeves' },
          { id: 'short', label: 'Short' },
          { id: 'long', label: 'Long' },
        ],
        sleeves,
        (id) => {
          sleeves = id as Length | 'auto';
          rig = guess({});
          rebuild();
        },
      );
    } else if (kind === 'bottom') {
      segment(
        lenEl,
        [
          { id: 'auto', label: 'Auto' },
          { id: 'none', label: 'Skirt (no legs)' },
        ],
        legs,
        (id) => {
          legs = id as Length | 'auto';
          rig = guess({});
          rebuild();
        },
      );
    }
    hintEl.textContent = HINTS[kind];
  }

  // ---- handles
  function buildHandles(): Handle[] {
    const out: Handle[] = [];
    if (kind !== 'bottom' && rig.s) {
      for (const i of [0, 1] as const) {
        out.push({
          id: `s${i}`,
          label: 'S',
          color: COLORS.s,
          partner: `s${1 - i}`,
          get: () => rig.s![i],
          set: (p) => (rig.s![i] = p),
        });
      }
    }
    for (const i of [0, 1] as const) {
      out.push({ id: `h${i}`, label: 'H', color: COLORS.h, partner: `h${1 - i}`, get: () => rig.h[i], set: (p) => (rig.h[i] = p) });
    }
    if (kind !== 'bottom' && rig.arm) {
      for (const i of [0, 1] as const) {
        rig.arm[i].forEach((_, j) =>
          out.push({ id: `a${i}.${j}`, label: String(j + 1), color: COLORS.a, partner: `a${1 - i}.${j}`, get: () => rig.arm![i][j], set: (p) => (rig.arm![i][j] = p) }),
        );
      }
    }
    if (kind === 'bottom' && rig.leg) {
      for (const i of [0, 1] as const) {
        rig.leg[i].forEach((_, j) =>
          out.push({ id: `l${i}.${j}`, label: String(j + 1), color: COLORS.l, partner: `l${1 - i}.${j}`, get: () => rig.leg![i][j], set: (p) => (rig.leg![i][j] = p) }),
        );
      }
    }
    return out;
  }

  const els = new Map<string, HTMLElement>();
  function rebuild() {
    for (const el of els.values()) el.remove();
    els.clear();
    handles = buildHandles();
    for (const h of handles) {
      const el = document.createElement('div');
      el.className = 'handle';
      el.textContent = h.label;
      el.style.background = h.color;
      el.dataset.id = h.id;
      stage.appendChild(el);
      els.set(h.id, el);
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        el.setPointerCapture(e.pointerId);
        el.classList.add('drag');
      });
      el.addEventListener('pointermove', (e) => {
        if (!el.hasPointerCapture(e.pointerId)) return;
        const r = stage.getBoundingClientRect();
        const p: Pt = [clamp((e.clientX - r.left) / r.width), clamp((e.clientY - r.top) / r.height)];
        h.set(p);
        if (symEl.checked && h.partner) handles.find((o) => o.id === h.partner)?.set([clamp(1 - p[0]), p[1]]);
        place();
      });
      const end = () => el.classList.remove('drag');
      el.addEventListener('pointerup', end);
      el.addEventListener('pointercancel', end);
    }
    renderControls();
    layoutStage();
    place();
  }

  const clamp = (v: number) => Math.min(1.05, Math.max(-0.05, v));

  function place() {
    for (const h of handles) {
      const el = els.get(h.id)!;
      const p = h.get();
      el.style.left = `${p[0] * 100}%`;
      el.style.top = `${p[1] * 100}%`;
    }
    // guide lines
    const W = 1000;
    const H = 1000 * (input.canvas.height / input.canvas.width);
    lines.setAttribute('viewBox', `0 0 ${W} ${H}`);
    const seg = (a: Pt, b: Pt, c: string) => `<line x1="${a[0] * W}" y1="${a[1] * H}" x2="${b[0] * W}" y2="${b[1] * H}" stroke="${c}" stroke-width="3" stroke-linecap="round" stroke-dasharray="1 7"/>`;
    let svg = seg(rig.h[0], rig.h[1], COLORS.h);
    if (kind !== 'bottom' && rig.s) {
      svg += seg(rig.s[0], rig.s[1], COLORS.s) + seg(rig.s[0], rig.h[0], '#ffffff') + seg(rig.s[1], rig.h[1], '#ffffff');
      if (rig.arm) {
        for (const i of [0, 1] as const) {
          let prev = rig.s[i];
          for (const p of rig.arm[i]) {
            svg += seg(prev, p, COLORS.a);
            prev = p;
          }
        }
      }
    }
    if (kind === 'bottom' && rig.leg) {
      for (const i of [0, 1] as const) {
        let prev = rig.h[i];
        for (const p of rig.leg[i]) {
          svg += seg(prev, p, COLORS.l);
          prev = p;
        }
      }
    }
    lines.innerHTML = svg;
  }

  // ---- open / close
  root.hidden = false;
  rebuild();
  const onResize = () => layoutStage();
  window.addEventListener('resize', onResize);

  return new Promise<EditorResult>((resolve) => {
    const finish = (r: EditorResult) => {
      window.removeEventListener('resize', onResize);
      root.hidden = true;
      cleanup();
      resolve(r);
    };
    const onSave = () => finish({ action: 'save', name: nameEl.value.trim() || 'My garment', kind, rig: structuredClone(rig) });
    const onCancel = () => finish({ action: 'cancel' });
    const onDelete = () => {
      if (confirm('Delete this garment from your device?')) finish({ action: 'delete' });
    };
    const saveBtn = $('ed-save');
    const cancelBtn = $('ed-cancel');
    saveBtn.addEventListener('click', onSave);
    cancelBtn.addEventListener('click', onCancel);
    delEl.addEventListener('click', onDelete);
    function cleanup() {
      saveBtn.removeEventListener('click', onSave);
      cancelBtn.removeEventListener('click', onCancel);
      delEl.removeEventListener('click', onDelete);
      for (const el of els.values()) el.remove();
      els.clear();
    }
  });
}
