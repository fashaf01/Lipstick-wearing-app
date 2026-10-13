import { CATEGORIES, productOf, type CategoryId, type Look } from './catalog';
import type { FacePts } from './face';
import type { FinishId } from './shades';
import { renderBrows } from './brows';
import { renderBlush } from './cheeks';
import { renderEyeshadow, renderLiner } from './eyes';
import { renderLips } from './lips';
import { Painter } from './paint';
import { Smoother } from './pixels';

const painter = new Painter();
const smoother = new Smoother();

/** Forget measured skin/lip reference colours (call when the face changes or is lost). */
export const resetMakeup = () => smoother.reset();

/**
 * Applies every active product to the frame, bottom layer first:
 * blush -> brows -> eyeshadow -> liner -> lips. Each step edits the pixels in place.
 */
export function renderLook(ctx: CanvasRenderingContext2D, w: number, h: number, pts: FacePts, look: Look, now: number) {
  const active = (id: CategoryId) => {
    const l = look[id];
    const product = productOf(id, l);
    return product && l.intensity > 0 ? { hex: product.hex, finish: l.finish, intensity: l.intensity / 100 } : null;
  };

  const blush = active('blush');
  if (blush) renderBlush(ctx, w, h, pts, blush, smoother);

  const brows = active('brows');
  if (brows) renderBrows(painter, ctx, w, h, pts, brows, smoother);

  const eyes = active('eyes');
  if (eyes) renderEyeshadow(ctx, w, h, pts, eyes, now, smoother);

  const liner = active('liner');
  if (liner) renderLiner(painter, ctx, w, h, pts, liner);

  const lips = active('lips');
  if (lips) renderLips(painter, ctx, w, h, pts, { ...lips, finish: lips.finish as FinishId }, smoother);
}

export const hasMakeup = (look: Look) =>
  (Object.keys(CATEGORIES) as CategoryId[]).some((id) => productOf(id, look[id]) && look[id].intensity > 0);
