import { CATEGORIES, productOf, type CategoryId, type Look } from './catalog';
import type { FacePts } from './face';
import type { FinishId } from './shades';
import { renderBrows } from './brows';
import { renderBlush } from './cheeks';
import { renderEyeshadow, renderLiner } from './eyes';
import { renderLips } from './lips';
import { Painter } from './paint';

const painter = new Painter();

/**
 * Paints every active product onto the frame, bottom layer first:
 * blush -> brows -> eyeshadow -> liner -> lips.
 */
export function renderLook(ctx: CanvasRenderingContext2D, w: number, h: number, pts: FacePts, look: Look, now: number) {
  const active = (id: CategoryId) => {
    const l = look[id];
    const product = productOf(id, l);
    return product && l.intensity > 0 ? { hex: product.hex, finish: l.finish, intensity: l.intensity / 100 } : null;
  };

  const blush = active('blush');
  if (blush) renderBlush(painter, ctx, w, h, pts, blush);

  const brows = active('brows');
  if (brows) renderBrows(painter, ctx, w, h, pts, brows);

  const eyes = active('eyes');
  if (eyes) renderEyeshadow(painter, ctx, w, h, pts, eyes, now);

  const liner = active('liner');
  if (liner) renderLiner(painter, ctx, w, h, pts, liner);

  const lips = active('lips');
  if (lips) renderLips(painter, ctx, w, h, pts, { ...lips, finish: lips.finish as FinishId });
}

export const hasMakeup = (look: Look) =>
  (Object.keys(CATEGORIES) as CategoryId[]).some((id) => productOf(id, look[id]) && look[id].intensity > 0);
