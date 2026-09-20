import type BaseLayer from 'ol/layer/Base';
import type { LayerGroup, LayerId } from '@/data/types';
import { Z_BAND } from '@/data/constants';

/**
 * The single boundary between React state and live OpenLayers objects.
 *
 * React never holds an OL layer in state (it would be re-created on every
 * render and leak WebGL contexts). Layers are registered here once and mutated
 * imperatively. Anything that needs a live layer asks the registry.
 *
 * A layer whose file was absent is simply never registered, so `get` returns
 * undefined and callers no-op. That is how one missing raster degrades into a
 * disabled panel row instead of a broken map.
 */
const layers = new Map<LayerId, BaseLayer>();

export function register(id: LayerId, layer: BaseLayer): BaseLayer {
  layers.set(id, layer);
  layer.set('layerId', id);
  return layer;
}

export function get(id: LayerId): BaseLayer | undefined {
  return layers.get(id);
}

export function has(id: LayerId): boolean {
  return layers.has(id);
}

export function all(): BaseLayer[] {
  return [...layers.values()];
}

export function setVisible(id: LayerId, visible: boolean): void {
  layers.get(id)?.setVisible(visible);
}

export function setOpacity(id: LayerId, opacity: number): void {
  layers.get(id)?.setOpacity(opacity);
}

/**
 * z-index = group band + position within the group. Disjoint bands mean
 * intra-group reordering can never move a layer across a group boundary.
 */
export function setOrder(id: LayerId, group: LayerGroup, order: number): void {
  layers.get(id)?.setZIndex(Z_BAND[group] + order);
}

export function clear(): void {
  layers.clear();
}
