import { Checkbox } from '@/components/ui/checkbox';
import { useAppStore } from '@/store/appStore';
import { useMapHandle } from '@/map/mapHandle';
import { applyStretch } from '@/map/rasterLayers';
import type { S2MetaPair } from '@/data/types';

/**
 * Raster display options, as a group in the layer panel under the threshold.
 *
 * On: the per-scene 2–98% stretch baked into each COG at export time.
 * Off (default): the shader inverts that using the bounds in the sidecar JSON
 * and re-maps both years onto one shared reflectance scale, so the two years
 * are radiometrically comparable.
 */
export function RasterSection({ s2Meta }: { s2Meta?: S2MetaPair }) {
  const on = useAppStore((s) => s.percentileStretch);
  const set = useAppStore((s) => s.setPercentileStretch);
  const handle = useMapHandle();

  // Without the sidecars there is nothing to invert, so the toggle is inert.
  const available = Boolean(s2Meta);

  // Same idiom as the composite toggle: set the store and push the uniform in
  // one action, rather than round-tripping through an effect.
  const toggle = (next: boolean) => {
    set(next);
    if (handle) applyStretch(handle.rasters, next);
  };

  return (
    <label className="flex h-8 cursor-pointer items-center gap-2 px-2.5">
      <Checkbox
        checked={on}
        onCheckedChange={(v) => toggle(v === true)}
        disabled={!available}
        aria-label="Apply percentile stretch"
      />
      <span className="truncate text-body">Apply Percentile Stretch (2–98%)</span>
    </label>
  );
}
