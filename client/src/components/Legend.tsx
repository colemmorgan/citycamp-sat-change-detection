import { ChevronDown } from 'lucide-react';
import { CLASS_COLORS } from '@/data/constants';
import { useAppStore } from '@/store/appStore';
import { cn } from '@/lib/utils';
import { ScaleBar } from './ScaleBar';
import type { ClassCode, Stats, TransitionLegend } from '@/data/types';

/**
 * Map legend, floating over the bottom-right of the canvas.
 *
 * Collapsible to its header so it never permanently occludes the map. Shifts
 * left when the detected-changes panel is open rather than sliding underneath it.
 *
 * Every label and count is read from stats.json; only transitions that actually
 * occurred in the run appear, so the list length varies.
 */

function Swatch({ color, round }: { color: string; round?: boolean }) {
  return (
    <span
      className={cn(
        'inline-block size-2.5 shrink-0 border',
        round ? 'rounded-full' : 'rounded-[1px]',
      )}
      style={{ backgroundColor: color, borderColor: 'var(--border-1)' }}
    />
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="panel-label mb-1">{title}</p>
      <ul className="space-y-0.5">{children}</ul>
    </div>
  );
}

export function Legend({
  stats,
  legend,
}: {
  stats: Stats;
  legend: TransitionLegend;
}) {
  const open = useAppStore((s) => s.legendOpen);
  const toggle = useAppStore((s) => s.toggleLegend);
  const queueOpen = useAppStore((s) => s.queueOpen);

  const entries = Object.entries(legend).sort((a, b) => a[1].priority - b[1].priority);

  return (
    <div
      className={cn(
        'absolute bottom-3 z-20 flex w-[226px] flex-col gap-1.5 transition-[right] duration-200',
        queueOpen ? 'right-[352px]' : 'right-3',
      )}
    >
      <div className="overflow-hidden rounded-md border border-border-1 bg-surface-1/95 backdrop-blur-[2px]">
      <button
        type="button"
        onClick={toggle}
        className="flex w-full items-center justify-between px-2.5 py-1.5 transition-colors hover:bg-surface-2"
      >
        <span className="panel-label">Legend</span>
        <ChevronDown
          size={12}
          className={cn(
            'text-icon-base transition-transform',
            !open && '-rotate-90',
          )}
        />
      </button>

      {open && (
        <div className="space-y-2.5 border-t border-border-0 px-2.5 py-2">
          <Block title="Confirmed transitions">
            {entries.map(([code, e]) => (
              <li key={code} className="flex items-center gap-1.5">
                <Swatch color={e.color} />
                <span className="truncate text-[11px] text-body" title={e.label}>
                  {e.label}
                </span>
              </li>
            ))}
          </Block>

          <Block title="Land cover">
            {(Object.entries(stats.classes) as Array<[string, string]>).map(
              ([code, label]) => (
                <li key={code} className="flex items-center gap-1.5">
                  <Swatch color={CLASS_COLORS[Number(code) as ClassCode]} />
                  <span className="text-[11px] text-body">{label}</span>
                </li>
              ),
            )}
          </Block>

          <Block title="GLOBE observations">
            {/* One symbol for every GLOBE observation. The usable/unusable split
                is a modelling concern, not map symbology. */}
            <li className="flex items-center gap-1.5">
              <Swatch color="#4A80B5" round />
              <span className="text-[11px] text-body">
                Observation{' '}
                <span className="tnum text-icon-base">
                  (
                  {stats.counts.globe_unusable_in_aoi +
                    stats.counts.globe_trained_statewide}
                  )
                </span>
              </span>
            </li>
            <li className="flex items-center gap-1.5">
              <span className="inline-block size-1.5 shrink-0 rounded-full bg-icon-base" />
              <span className="text-[11px] text-body">
                OSM supplement{' '}
                <span className="tnum text-icon-base">({stats.counts.osm_supplements})</span>
              </span>
            </li>
          </Block>
        </div>
      )}
      </div>

      {/* Scale bar sits below the legend card, and stays visible when the
          legend is collapsed — distance is useful even when the key is not. */}
      <div className="rounded-md border border-border-1 bg-surface-1/95 px-2 py-1.5 backdrop-blur-[2px]">
        <ScaleBar />
      </div>
    </div>
  );
}
