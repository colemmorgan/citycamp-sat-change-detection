import { useEffect, useRef } from 'react';
import ScaleLine from 'ol/control/ScaleLine';
import { useMapHandle } from '@/map/mapHandle';

/**
 * Map scale bar, mounted under the legend.
 *
 * OpenLayers' ScaleLine is rendered into a target element we own rather than
 * letting OL place it, so it sits inside the legend stack instead of floating
 * in a corner of its own.
 *
 * `bar` style with two steps reads as a cartographic scale bar rather than a
 * web-map line, which suits a GIS tool. It accounts for Web Mercator's latitude
 * distortion automatically, so the distance shown is true ground distance at
 * the centre of the view — not the 1.32x-inflated projected figure.
 */
export function ScaleBar() {
  const handle = useMapHandle();
  const targetRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!handle || !targetRef.current) return;

    const control = new ScaleLine({
      target: targetRef.current,
      units: 'metric',
      bar: true,
      steps: 2,
      // Ratio text off: OL nests it inside the bar and absolutely positions the
      // step labels around it, so enabling it collides the two in a 208px box.
      // The distance labels are the useful part on a map anyway.
      text: false,
      minWidth: 100,
      maxWidth: 190,
    });

    handle.map.addControl(control);
    return () => {
      handle.map.removeControl(control);
    };
  }, [handle]);

  return <div ref={targetRef} className="scalebar-host" />;
}
