import Layer from 'ol/layer/Layer';
import type BaseLayer from 'ol/layer/Base';
import type RenderEvent from 'ol/render/Event';

/**
 * Horizontal clipping for WebGL layers.
 *
 * THE WHOLE REASON THIS FILE EXISTS: every raster in this app is an
 * `ol/layer/WebGLTile`. The swipe recipe everyone reaches for first —
 *
 *     layer.on('prerender', e => { e.context.save(); e.context.clip(...) })
 *
 * — assumes `e.context` is a Canvas 2D context. For a WebGL layer it is a
 * WebGLRenderingContext, which has no `save`, no `clip`, and no path API. The
 * call either throws or silently does nothing, and the layer renders full
 * width. The WebGL equivalent is the scissor box.
 *
 * Three things are easy to get wrong and are handled explicitly below:
 *
 *  1. DEVICE PIXELS. gl.scissor takes device pixels; frameState.size is CSS
 *     pixels. Multiply by frameState.pixelRatio — which is the ratio OL
 *     actually rendered with, and is not always window.devicePixelRatio.
 *  2. BOTTOM-LEFT ORIGIN. gl's y axis points up from the bottom of the drawing
 *     buffer; pointer and CSS coordinates point down from the top. The flip is
 *     written out below even though a full-height band makes it evaluate to
 *     zero, because a half-flipped box is invisible until someone adds a
 *     vertical split and then it is very hard to see why.
 *  3. IT IS GLOBAL STATE. SCISSOR_TEST stays on until something turns it off,
 *     so every layer that enables it must disable it in `postrender` or it will
 *     clip layers that never asked to be clipped.
 */

/** A vertical band, as fractions of the map width. 0 = left edge, 1 = right. */
export interface Band {
  from: number;
  to: number;
}

/**
 * The slice of WebGLRenderingContext we need. Duck-typed rather than
 * `instanceof`-checked so it accepts both WebGL1 and WebGL2 contexts, and
 * cleanly rejects the Canvas 2D context a vector layer would hand us.
 */
interface ScissorGl {
  enable(cap: number): void;
  disable(cap: number): void;
  scissor(x: number, y: number, width: number, height: number): void;
  readonly SCISSOR_TEST: number;
}

function asScissorGl(context: unknown): ScissorGl | null {
  if (!context || typeof context !== 'object') return null;
  const gl = context as Partial<ScissorGl>;
  if (typeof gl.scissor !== 'function') return null;
  if (typeof gl.enable !== 'function' || typeof gl.disable !== 'function') return null;
  if (typeof gl.SCISSOR_TEST !== 'number') return null;
  return gl as ScissorGl;
}

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);

/**
 * Restrict `layer` to a vertical band of the map viewport.
 *
 * `getBand` is called on every frame rather than captured, so dragging the
 * divider is a re-render, not a re-subscribe. Returning null disables clipping
 * for that frame without detaching anything.
 *
 * Returns a detach function. Callers must call it — the listeners outlive the
 * React effect otherwise and the layer stays clipped after compare mode is off.
 */
export function clipLayerToBand(layer: BaseLayer, getBand: () => Band | null): () => void {
  // Only ol/layer/Layer emits prerender/postrender. Groups do not.
  if (!(layer instanceof Layer)) return () => {};

  const onPrerender = (event: RenderEvent) => {
    const gl = asScissorGl(event.context);
    if (!gl) return;

    const band = getBand();
    const size = event.frameState?.size;
    const widthCss = size?.[0];
    const heightCss = size?.[1];
    if (!band || widthCss === undefined || heightCss === undefined) return;

    const ratio = event.frameState?.pixelRatio ?? 1;
    const bufferWidth = Math.round(widthCss * ratio);
    const bufferHeight = Math.round(heightCss * ratio);

    const x0 = Math.round(clamp01(band.from) * bufferWidth);
    const x1 = Math.round(clamp01(band.to) * bufferWidth);

    // Top-left band geometry, then flipped into gl's bottom-left origin. The
    // band is full height, so yTop is 0 and yGl works out to 0 as well — but
    // the flip is the part that silently puts the clip on the wrong half, so
    // it is spelled out rather than assumed away.
    const yTop = 0;
    const bandHeight = bufferHeight;
    const yGl = bufferHeight - (yTop + bandHeight);

    gl.enable(gl.SCISSOR_TEST);
    // A zero-width box is legal and draws nothing — which is exactly right when
    // the divider is dragged fully to one edge.
    gl.scissor(x0, yGl, Math.max(0, x1 - x0), bandHeight);
  };

  const onPostrender = (event: RenderEvent) => {
    const gl = asScissorGl(event.context);
    // Unconditional: if prerender enabled it, postrender must disable it, even
    // on a frame where getBand() has since returned null.
    gl?.disable(gl.SCISSOR_TEST);
  };

  layer.on('prerender', onPrerender);
  layer.on('postrender', onPostrender);

  return () => {
    layer.un('prerender', onPrerender);
    layer.un('postrender', onPostrender);
  };
}
