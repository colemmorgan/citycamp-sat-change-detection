/**
 * Compare mode's public surface.
 *
 * Everything else under src/compare/ is internal. The app only needs the two
 * components: CompareControls in the top bar, CompareView over the map.
 */
export { CompareControls } from '@/components/CompareControls';
export { CompareView } from '@/components/CompareView';

export { resolveTargetLayer, targetLabel, targetOptions, sameTarget } from './targets';
export type { TargetOption } from './targets';
export { clipLayerToBand, type Band } from './scissor';
