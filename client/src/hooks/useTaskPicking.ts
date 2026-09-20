import { useEffect } from 'react';
import type { MapBrowserEvent } from 'ol';
import type VectorLayer from 'ol/layer/Vector';
import type VectorSource from 'ol/source/Vector';
import { useMapHandle } from '@/map/mapHandle';
import * as registry from '@/map/layerRegistry';
import { useAppStore } from '@/store/appStore';
import { useTasksStore } from '@/store/tasksStore';
import { useGlobeStore } from '@/store/globeStore';
import type { GlobePointProps } from '@/data/types';

/**
 * Click a task polygon to summon the queue, or a GLOBE point to open its photo
 * gallery.
 *
 * This is the main way the queue becomes visible without hunting for a button:
 * the red patches are the interesting thing on screen, so clicking one should
 * explain it.
 *
 * Hit-testing is restricted to the tasks layer so clicks on protected
 * boundaries or GLOBE points fall through to normal map panning.
 */
export function useTaskPicking() {
  const handle = useMapHandle();
  const setQueueOpen = useAppStore((s) => s.setQueueOpen);
  const select = useTasksStore((s) => s.select);
  const openGallery = useGlobeStore((s) => s.open);

  useEffect(() => {
    if (!handle) return;
    const { map } = handle;

    const onClick = (e: MapBrowserEvent) => {
      // GLOBE points are small and sit on top of task polygons, so they are
      // tested first — otherwise a point inside a task patch is unclickable.
      const globeLayer = registry.get('globe');
      if (globeLayer) {
        let hit: GlobePointProps | null = null;
        map.forEachFeatureAtPixel(
          e.pixel,
          (feature) => {
            const props = feature.getProperties() as GlobePointProps;
            // OSM-derived points are not GLOBE observations and have no photos.
            if (props.source === 'osm_derived') return false;
            hit = props;
            return true;
          },
          { layerFilter: (l) => l === globeLayer, hitTolerance: 6 },
        );
        if (hit) {
          const props = hit as GlobePointProps;
          // Open the SITE: every observation here shares one coordinate, so a
          // single feature can never stand for the one the user meant.
          openGallery(props.site_name ?? props.globe_id, props);
          return;
        }
      }

      const tasksLayer = registry.get('tasks');
      if (!tasksLayer) return;

      let hitId: string | null = null;
      map.forEachFeatureAtPixel(
        e.pixel,
        (feature) => {
          const id = feature.get('task_id');
          if (typeof id === 'string') {
            hitId = id;
            return true; // stop at the first hit
          }
          return false;
        },
        { layerFilter: (l) => l === tasksLayer, hitTolerance: 3 },
      );

      if (!hitId) return;
      select(hitId);
      setQueueOpen(true);

      const hl = registry.get('task-highlight') as VectorLayer<VectorSource> | undefined;
      const src = (tasksLayer as VectorLayer<VectorSource>).getSource();
      const match = src?.getFeatures().find((f) => f.get('task_id') === hitId);
      const target = hl?.getSource();
      target?.clear();
      if (match) target?.addFeature(match.clone());
    };

    // Cursor feedback so tasks and GLOBE points read as clickable.
    const onMove = (e: MapBrowserEvent) => {
      if (e.dragging) return;
      const tasksLayer = registry.get('tasks');
      const globeLayer = registry.get('globe');

      const overGlobe =
        globeLayer !== undefined &&
        map.hasFeatureAtPixel(e.pixel, {
          layerFilter: (l) => l === globeLayer,
          hitTolerance: 6,
        });
      const overTask =
        tasksLayer !== undefined &&
        map.hasFeatureAtPixel(e.pixel, {
          layerFilter: (l) => l === tasksLayer,
          hitTolerance: 3,
        });

      map.getTargetElement().style.cursor = overGlobe || overTask ? 'pointer' : '';
    };

    map.on('singleclick', onClick);
    map.on('pointermove', onMove);
    return () => {
      map.un('singleclick', onClick);
      map.un('pointermove', onMove);
    };
  }, [handle, select, setQueueOpen, openGallery]);
}
