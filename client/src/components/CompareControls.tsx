import { ArrowLeftRight, Columns2, Link2, Link2Off, SquareSplitHorizontal, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useCompareStore, type CompareMode } from '@/store/compareStore';
import { TargetPicker } from '@/compare/ui/TargetPicker';
import {
  CONTROL_H,
  controlActive,
  iconControl,
  segment,
  segmentActive,
  segmentGroup,
} from '@/compare/ui/toolbar';

/**
 * Compare mode's toolbar group.
 *
 * Sized for the 44px top bar: a 28px segmented mode switch, two target pickers
 * with a swap between them, and — in side-by-side only — the view lock. Groups
 * are separated by a 1px rule rather than by spacing, per plans/03 §5.
 *
 * It is self-contained: mount it anywhere in the bar. It owns no map state, only
 * compareStore.
 */

const MODES: Array<{ mode: CompareMode; label: string; hint: string; Icon: typeof X }> = [
  { mode: 'off', label: 'Off', hint: 'Single map', Icon: X },
  {
    mode: 'swipe',
    label: 'Swipe',
    hint: 'One view, split by a draggable divider',
    Icon: SquareSplitHorizontal,
  },
  {
    mode: 'sideBySide',
    label: 'Split',
    hint: 'Two views, side by side',
    Icon: Columns2,
  },
];

export function CompareControls() {
  const mode = useCompareStore((s) => s.mode);
  const setMode = useCompareStore((s) => s.setMode);
  const left = useCompareStore((s) => s.left);
  const right = useCompareStore((s) => s.right);
  const setLeft = useCompareStore((s) => s.setLeft);
  const setRight = useCompareStore((s) => s.setRight);
  const swap = useCompareStore((s) => s.swap);
  const position = useCompareStore((s) => s.position);
  const syncViews = useCompareStore((s) => s.syncViews);
  const setSyncViews = useCompareStore((s) => s.setSyncViews);

  const active = mode !== 'off';

  return (
    <TooltipProvider delayDuration={400}>
      <div className="flex items-center gap-2" data-slot="compare-controls">
        <span className="panel-label select-none">Compare</span>

        <div className={segmentGroup} role="radiogroup" aria-label="Comparison mode">
          {MODES.map(({ mode: value, label, hint, Icon }) => (
            <Tooltip key={value}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  role="radio"
                  aria-checked={mode === value}
                  onClick={() => setMode(value)}
                  className={cn(segment, mode === value && segmentActive)}
                >
                  <Icon size={13} aria-hidden />
                  {label}
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">{hint}</TooltipContent>
            </Tooltip>
          ))}
        </div>

        {active && (
          <>
            <Separator orientation="vertical" className="data-[orientation=vertical]:h-5 bg-border-0" />

            <div className="flex items-center gap-1">
              <TargetPicker side="Left" value={left} onChange={setLeft} />

              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label="Swap sides"
                    onClick={swap}
                    className={iconControl}
                  >
                    <ArrowLeftRight size={13} className="text-icon-base" aria-hidden />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom">Swap sides</TooltipContent>
              </Tooltip>

              <TargetPicker side="Right" value={right} onChange={setRight} />
            </div>

            {mode === 'swipe' && (
              <span
                className={cn(CONTROL_H, 'tnum flex items-center text-[11px] text-icon-base')}
                aria-live="off"
              >
                {Math.round(position * 100)}%
              </span>
            )}

            {mode === 'sideBySide' && (
              <>
                <Separator orientation="vertical" className="data-[orientation=vertical]:h-5 bg-border-0" />
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      aria-pressed={syncViews}
                      aria-label="Lock the two views together"
                      onClick={() => setSyncViews(!syncViews)}
                      className={cn(iconControl, syncViews && controlActive)}
                    >
                      {syncViews ? (
                        <Link2 size={14} className="text-icon-active" aria-hidden />
                      ) : (
                        <Link2Off size={14} className="text-icon-base" aria-hidden />
                      )}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    {syncViews ? 'Views locked — pan either' : 'Views independent'}
                  </TooltipContent>
                </Tooltip>
              </>
            )}
          </>
        )}
      </div>
    </TooltipProvider>
  );
}
