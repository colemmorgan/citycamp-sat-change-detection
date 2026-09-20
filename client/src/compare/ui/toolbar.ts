/**
 * Shared class strings for the compare toolbar.
 *
 * plans/03: compact toolbar, 2px radii on the smallest controls, hierarchy from
 * surface + 1px border rather than shadow, and an active state that is more
 * than a colour change (surface AND border AND text all move).
 *
 * These are strings rather than components because every consumer is a
 * different element — a Radix trigger, a plain button, a toggle — and wrapping
 * each one would add a component per control for no shared behaviour.
 */

/** Height of every control in the bar. 28px keeps the bar itself under 44px. */
export const CONTROL_H = 'h-7';

/** Default compact control: dark surface, subtle border, 2px radius. */
export const controlBase =
  'inline-flex items-center justify-center gap-1.5 rounded-sm border border-border-1 ' +
  'bg-surface-2 text-[12px] leading-none text-body transition-colors ' +
  'hover:bg-surface-3 hover:text-heading ' +
  'focus-visible:outline-1 focus-visible:outline-offset-1 focus-visible:outline-border-action ' +
  'disabled:pointer-events-none disabled:opacity-40';

/** Icon-only variant of the above. Square, no label. */
export const iconControl = `${controlBase} ${CONTROL_H} w-7 shrink-0 px-0`;

/** Segmented-group shell — one border around the set, not around each item. */
export const segmentGroup =
  'inline-flex items-center gap-0.5 rounded-sm border border-border-1 bg-surface-2 p-0.5';

/** One segment inside the group. */
export const segment =
  'inline-flex h-6 items-center gap-1.5 rounded-xs px-1.5 text-[12px] leading-none ' +
  'text-icon-base transition-colors hover:bg-surface-3 hover:text-icon-active ' +
  'focus-visible:outline-1 focus-visible:outline-offset-1 focus-visible:outline-border-action';

/** Selected segment: surface, border and text all change, never colour alone. */
export const segmentActive =
  'bg-surface-action text-on-action shadow-none hover:bg-surface-action hover:text-on-action';

/** A control that is on, but is not the primary action (e.g. the sync lock). */
export const controlActive =
  'border-border-action bg-surface-3 text-heading hover:bg-surface-3';

/** Dropdown surface. 4px — a panel, not a micro control. */
export const menuSurface =
  'z-50 min-w-50 rounded-md border border-border-1 bg-surface-2 p-1 ' +
  'text-body outline-none';

export const menuItem =
  'relative flex h-7 cursor-default select-none items-center gap-2 rounded-xs pl-6 pr-2 ' +
  'text-[12px] leading-none outline-none transition-colors ' +
  'data-[highlighted]:bg-surface-3 data-[highlighted]:text-heading ' +
  'data-[disabled]:pointer-events-none data-[disabled]:opacity-40';

export const menuLabel = 'panel-label px-2 pt-1.5 pb-1';
