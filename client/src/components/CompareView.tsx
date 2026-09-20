import { useCallback, useState } from 'react';
import { ChevronsLeftRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useLegend } from '@/data/queries';
import { useMapHandle } from '@/map/mapHandle';
import { useCompareStore, type CompareTarget } from '@/store/compareStore';
import { useCompareLayers } from '@/compare/useCompareLayers';
import { useCompareUrl } from '@/compare/useCompareUrl';
import { useSideBySide } from '@/compare/useSideBySide';
import { fractionFromClientX, useMapArea } from '@/compare/useMapArea';
import { targetLabel, targetSubLabel } from '@/compare/targets';

/**
 * The on-map half of compare mode: the swipe divider, the second pane, and the
 * pane labels. Also the mount point for the controllers that own raster
 * visibility and the URL — which is why it must stay mounted even when compare
 * is off, so that turning it off can hand the map back.
 *
 * MOUNTING: place it inside the element that boxes the map — the same box
 * MapCanvas fills — as a sibling after <MapCanvas/>:
 *
 *   <main className="relative min-w-0 flex-1">
 *     <MapCanvas … />
 *     <CompareView />
 *   </main>
 *
 * It measures the map viewport rather than trusting that box, so a different
 * mount point degrades gracefully instead of putting the divider in the wrong
 * place — but the above is the intended one.
 */

/** Arrow-key step, as a fraction of map width. Shift multiplies by 5. */
const KEY_STEP = 0.01;

function PaneBadge({
  target,
  side,
}: {
  target: CompareTarget;
  side: 'left' | 'right';
}) {
  const sub = targetSubLabel(target);
  return (
    <div
      className={cn(
        'pointer-events-none absolute top-2 flex items-baseline gap-1.5',
        'rounded-xs border border-border-0 bg-surface-1/95 px-1.5 py-1',
        'text-[11px] leading-none text-heading',
        side === 'left' ? 'left-2' : 'right-2',
      )}
    >
      <span>{targetLabel(target)}</span>
      {sub && <span className="text-[10px] text-icon-base">{sub}</span>}
    </div>
  );
}

export function CompareView() {
  const mode = useCompareStore((s) => s.mode);
  const position = useCompareStore((s) => s.position);
  const setPosition = useCompareStore((s) => s.setPosition);
  const left = useCompareStore((s) => s.left);
  const right = useCompareStore((s) => s.right);

  const handle = useMapHandle();
  const { data: legend } = useLegend();

  const [overlay, setOverlay] = useState<HTMLDivElement | null>(null);
  const [pane, setPane] = useState<HTMLDivElement | null>(null);
  const [dragging, setDragging] = useState(false);

  // Controllers. Unconditional — they handle `mode === 'off'` themselves.
  useCompareUrl();
  useCompareLayers();
  useSideBySide(pane, mode === 'sideBySide', legend);

  const area = useMapArea(overlay, mode !== 'off');
  const viewport = handle?.map.getViewport() ?? null;

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!viewport) return;
      // Both are needed: preventDefault stops the drag becoming a text
      // selection, stopPropagation stops OL reading it as a map pan.
      event.preventDefault();
      event.stopPropagation();
      event.currentTarget.setPointerCapture(event.pointerId);
      setDragging(true);
      setPosition(fractionFromClientX(viewport, event.clientX));
    },
    [viewport, setPosition],
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!dragging || !viewport) return;
      setPosition(fractionFromClientX(viewport, event.clientX));
    },
    [dragging, viewport, setPosition],
  );

  const onPointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setDragging(false);
  }, []);

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const step = event.shiftKey ? KEY_STEP * 5 : KEY_STEP;
      if (event.key === 'ArrowLeft') setPosition(position - step);
      else if (event.key === 'ArrowRight') setPosition(position + step);
      else if (event.key === 'Home') setPosition(0);
      else if (event.key === 'End') setPosition(1);
      else return;
      event.preventDefault();
    },
    [position, setPosition],
  );

  if (mode === 'off') return null;

  return (
    <div ref={setOverlay} className="pointer-events-none absolute inset-0 z-20">
      {area && (
        <div
          className="absolute"
          style={{ left: area.left, top: area.top, width: area.width, height: area.height }}
        >
          {mode === 'sideBySide' && (
            <div
              ref={setPane}
              // pointer-events-auto: this pane IS a map and needs its own
              // pan/zoom. The border is the seam between the two views.
              className="pointer-events-auto absolute inset-y-0 right-0 w-1/2 border-l border-border-1 bg-surface-0"
            />
          )}

          {mode === 'swipe' && (
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="Comparison divider"
              aria-valuenow={Math.round(position * 100)}
              aria-valuemin={0}
              aria-valuemax={100}
              tabIndex={0}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              onDoubleClick={() => setPosition(0.5)}
              onKeyDown={onKeyDown}
              // 14px of grab area around a 1px line — a 1px hit target is not
              // a hit target. touch-none keeps a drag from scrolling on touch.
              className={cn(
                'group pointer-events-auto absolute inset-y-0 w-3.5 -translate-x-1/2',
                'cursor-col-resize touch-none outline-none',
              )}
              style={{ left: position * area.width }}
            >
              <div
                className={cn(
                  'absolute inset-y-0 left-1/2 w-px -translate-x-1/2 transition-colors',
                  dragging ? 'bg-border-action' : 'bg-icon-base/70 group-hover:bg-border-action',
                )}
              />
              <div
                className={cn(
                  'absolute left-1/2 top-1/2 flex h-8 w-5 -translate-x-1/2 -translate-y-1/2',
                  'items-center justify-center rounded-sm border bg-surface-2 transition-colors',
                  dragging
                    ? 'border-border-action bg-surface-3'
                    : 'border-border-1 group-hover:border-border-action group-focus-visible:border-border-action',
                )}
              >
                <ChevronsLeftRight
                  size={13}
                  className={cn(
                    'transition-colors',
                    dragging ? 'text-icon-active' : 'text-icon-base group-hover:text-icon-active',
                  )}
                  aria-hidden
                />
              </div>
            </div>
          )}

          {/* In swipe the halves can be dragged to nothing; a label floating
              over a sliver of map it does not describe is worse than none. */}
          {(mode !== 'swipe' || position > 0.12) && <PaneBadge target={left} side="left" />}
          {(mode !== 'swipe' || position < 0.88) && <PaneBadge target={right} side="right" />}
        </div>
      )}
    </div>
  );
}
