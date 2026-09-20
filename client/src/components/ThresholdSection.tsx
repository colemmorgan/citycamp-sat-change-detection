import { useCallback } from 'react';
import { RotateCcw } from 'lucide-react';
import { Slider } from '@/components/ui/slider';
import { useAppStore } from '@/store/appStore';
import { percentileOf } from '@/data/loader';
import { cn } from '@/lib/utils';
import type { Stats } from '@/data/types';

/**
 * Change threshold, as a group in the layer panel.
 *
 * It sits with the layers rather than in the toolbar because it is really a
 * styling control for one layer — it restyles the change raster live by
 * updating a WebGL uniform, so dragging stays smooth at any rate.
 *
 * The gate tick on the track is the threshold the pipeline used to build both
 * the transitions layer and the task queue. When the handle sits on it, all
 * three views agree; dragging away shows exactly what was left out.
 */
export function ThresholdSection({ stats }: { stats: Stats }) {
  const threshold = useAppStore((s) => s.threshold);
  const setThreshold = useAppStore((s) => s.setThreshold);

  const c = stats.change;
  const gate = c.l4_threshold;
  const pct = percentileOf(threshold, c);
  const atGate = Math.abs(threshold - gate) < 1e-6;
  const gatePos = ((gate - c.slider_min) / (c.slider_max - c.slider_min)) * 100;

  const onChange = useCallback(
    (v: number[]) => setThreshold(v[0] ?? gate),
    [setThreshold, gate],
  );

  return (
    <div className="px-2.5 py-2.5">
      <div className="mb-2 flex items-baseline gap-2">
        <span className="tnum text-xl leading-none text-heading">
          {threshold.toFixed(3)}
        </span>
        <span className="tnum text-[10px] text-icon-base">p{pct.toFixed(1)}</span>

        {/* Reset appears only once the handle has moved off the gate; at the
            gate there is nothing to reset to. */}
        {!atGate && (
          <button
            type="button"
            onClick={() => setThreshold(gate)}
            title={`Reset to ${gate.toFixed(3)} — the cutoff used to build the ${stats.counts.tasks} tasks`}
            className="ml-auto flex items-center gap-1 text-[10px] text-icon-base transition-colors hover:text-icon-active"
          >
            <RotateCcw size={10} />
            Reset
          </button>
        )}
      </div>

      <div className="relative py-0.5">
        {/* Gate marker: where the pipeline drew the line. */}
        <div
          className={cn(
            'pointer-events-none absolute top-1/2 z-10 h-3 w-px -translate-y-1/2 bg-border-action/80',
          )}
          style={{ left: `${gatePos}%` }}
          aria-hidden
        />
        <Slider
          value={[threshold]}
          min={c.slider_min}
          max={c.slider_max}
          step={0.001}
          onValueChange={onChange}
          aria-label="Change threshold"
        />
      </div>

      <div className="mt-1 flex justify-between text-[10px] text-icon-base">
        <span className="tnum">p{percentileOf(c.slider_min, c).toFixed(0)}</span>
        <span className="tnum">max {c.slider_max.toFixed(2)}</span>
      </div>
    </div>
  );
}
