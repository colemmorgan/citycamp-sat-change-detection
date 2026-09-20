import { useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  restrictToVerticalAxis,
  restrictToParentElement,
} from '@dnd-kit/modifiers';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Layers, Map as MapIcon, Satellite } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { useAppStore, selectGroup } from '@/store/appStore';
import { applyComposite } from '@/map/rasterLayers';
import { useMapHandle } from '@/map/mapHandle';
import { cn } from '@/lib/utils';
import { ThresholdSection } from './ThresholdSection';
import { RasterSection } from './RasterSection';
import type { BasemapId, LayerRowState, S2MetaPair, Stats } from '@/data/types';

/**
 * QGIS-style layer panel.
 *
 * Rows are ONE line by default. Opacity is revealed on demand by clicking the
 * percentage, because an always-visible full-width slider reads as a divider
 * rule and triples the height of every row.
 *
 * Three pinned groups rather than one free list: letting the basemap be dragged
 * above the data would bury the map with no obvious way back. Overlays reorder
 * within their own z-band; reference layers stay on top.
 *
 * Year-paired rows render as a segmented year control in one row, not two
 * checkboxes — the pair is mutually exclusive and two checkboxes would imply a
 * state the app cannot produce.
 */

function YearToggle({ row }: { row: LayerRowState }) {
  const setYear = useAppStore((s) => s.setYear);
  return (
    <div className="flex shrink-0 overflow-hidden rounded-xs border border-border-1">
      {([2017, 2024] as const).map((y) => (
        <button
          key={y}
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => setYear(row.id, y)}
          className={cn(
            'tnum px-1 py-px text-[10px] leading-4 transition-colors',
            row.year === y
              ? 'bg-surface-action text-on-action'
              : 'text-icon-base hover:bg-surface-3 hover:text-body',
          )}
        >
          {String(y).slice(2)}
        </button>
      ))}
    </div>
  );
}

function CompositeToggle() {
  const handle = useMapHandle();
  const falseColor = useAppStore((s) => s.falseColor);
  const setFalseColor = useAppStore((s) => s.setFalseColor);

  return (
    <button
      type="button"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={() => {
        const next = !falseColor;
        setFalseColor(next);
        if (handle) applyComposite(handle.rasters, next);
      }}
      title={
        falseColor
          ? 'False colour (NIR·Red·Green) — vegetation reads red'
          : 'True colour (Red·Green·Blue)'
      }
      className={cn(
        'shrink-0 rounded-xs border px-1 py-px text-[10px] leading-4 transition-colors',
        falseColor
          ? 'border-border-action bg-surface-action text-on-action'
          : 'border-border-1 text-icon-base hover:bg-surface-3 hover:text-body',
      )}
    >
      {falseColor ? 'CIR' : 'RGB'}
    </button>
  );
}

function LayerRow({ row, draggable }: { row: LayerRowState; draggable: boolean }) {
  const setVisible = useAppStore((s) => s.setVisible);
  const setOpacity = useAppStore((s) => s.setOpacity);
  const [showOpacity, setShowOpacity] = useState(false);

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: row.id,
    disabled: !draggable,
  });

  const off = Boolean(row.unavailable);
  const on = row.visible && !off;

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        'group relative border-b border-border-0/50 last:border-b-0',
        isDragging && 'z-20 bg-surface-3 opacity-90 shadow-sm',
        off ? 'opacity-35' : 'hover:bg-surface-2',
      )}
      {...attributes}
    >
      <div className="flex h-8 items-center gap-2 px-2.5">
        {/* Drag handle — only place that initiates a drag, so clicking the row
            or its controls never starts one. */}
        {draggable ? (
          <button
            type="button"
            {...listeners}
            aria-label={`Reorder ${row.label}`}
            className="shrink-0 cursor-grab text-icon-base/40 transition-colors hover:text-icon-active active:cursor-grabbing"
          >
            <GripVertical size={12} />
          </button>
        ) : (
          <span className="w-3 shrink-0" />
        )}

        <Checkbox
          checked={on}
          disabled={off}
          onCheckedChange={(v) => setVisible(row.id, v === true)}
          aria-label={row.label}
          className="shrink-0"
        />

        <span
          className={cn('min-w-0 flex-1 truncate', on ? 'text-body' : 'text-icon-base')}
          title={off ? `${row.label} — not generated by the pipeline` : row.label}
        >
          {row.label}
        </span>

        {row.id === 'imagery' && !off && <CompositeToggle />}
        {row.year !== undefined && !off && <YearToggle row={row} />}

        {/* Opacity is only meaningful for a layer that is actually drawn. */}
        {on ? (
          <button
            type="button"
            onClick={() => setShowOpacity((v) => !v)}
            title="Opacity"
            className={cn(
              'tnum w-8 shrink-0 text-right text-[10px] tabular-nums transition-colors',
              showOpacity ? 'text-body' : 'text-icon-base/60 hover:text-icon-active',
            )}
          >
            {Math.round(row.opacity * 100)}%
          </button>
        ) : (
          <span className="w-8 shrink-0" />
        )}
      </div>

      {showOpacity && on && (
        <div className="px-3 pb-2">
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={row.opacity}
            onChange={(e) => setOpacity(row.id, Number(e.target.value))}
            onPointerDown={(e) => e.stopPropagation()}
            aria-label={`${row.label} opacity`}
            className="h-0.5 w-full cursor-pointer appearance-none rounded-xs bg-surface-4 accent-(--surface-action) [&::-webkit-slider-thumb]:h-2.5 [&::-webkit-slider-thumb]:w-1.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-[1px] [&::-webkit-slider-thumb]:bg-surface-action"
          />
        </div>
      )}
    </li>
  );
}

function GroupHeader({ label, hint }: { label: string; hint?: string }) {
  return (
    <div className="flex items-center justify-between border-y border-border-0 bg-surface-2/40 px-2.5 py-1.5 first:border-t-0">
      <h3 className="panel-label">{label}</h3>
      {hint && <span className="text-[9px] text-icon-base/50">{hint}</span>}
    </div>
  );
}

export function LayerPanel({ stats, s2Meta }: { stats: Stats; s2Meta?: S2MetaPair }) {
  // useShallow is required: these selectors build a new array on every call.
  const overlays = useAppStore(useShallow(selectGroup('overlay')));
  const reference = useAppStore(useShallow(selectGroup('reference')));
  const reorderGroup = useAppStore((s) => s.reorderGroup);
  const basemap = useAppStore((s) => s.basemap);
  const setBasemap = useAppStore((s) => s.setBasemap);

  // Displayed top-first so the list reads like a z-stack.
  const overlaysTopFirst = [...overlays].reverse();
  const referenceTopFirst = [...reference].reverse();

  const sensors = useSensors(
    // A small distance threshold means a click on the handle still registers as
    // a click rather than starting a drag immediately.
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = overlaysTopFirst.findIndex((r) => r.id === active.id);
    const to = overlaysTopFirst.findIndex((r) => r.id === over.id);
    if (from === -1 || to === -1) return;
    reorderGroup('overlay', from, to);
  };

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-8 shrink-0 items-center gap-1.5 border-b border-border-0 px-2.5">
        <Layers size={13} className="text-icon-base" />
        <h2 className="text-[12px] font-medium text-heading">Layers</h2>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <GroupHeader label="Overlays" />
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={onDragEnd}
          modifiers={[restrictToVerticalAxis, restrictToParentElement]}
        >
          <SortableContext
            items={overlaysTopFirst.map((r) => r.id)}
            strategy={verticalListSortingStrategy}
          >
            <ul className="relative">
              {overlaysTopFirst.map((row) => (
                <LayerRow key={row.id} row={row} draggable />
              ))}
            </ul>
          </SortableContext>
        </DndContext>

        <GroupHeader label="Reference" />
        <ul>
          {referenceTopFirst.map((row) => (
            <LayerRow key={row.id} row={row} draggable={false} />
          ))}
        </ul>

        <GroupHeader label="Basemap" />
        <ul className="mb-0">
          {(
            [
              ['dark', 'Dark canvas', MapIcon],
              ['sat', 'Satellite', Satellite],
            ] as Array<[BasemapId, string, typeof MapIcon]>
          ).map(([id, label, Icon]) => (
            <li key={id}>
              <button
                type="button"
                onClick={() => setBasemap(id)}
                className={cn(
                  'flex h-8 w-full items-center gap-2 border-b border-border-0/50 px-2.5 text-left transition-colors last:border-b-0',
                  basemap === id ? 'bg-surface-3 text-body' : 'text-icon-base hover:bg-surface-2',
                )}
              >
                <span
                  className={cn(
                    'ml-1 size-2.5 shrink-0 rounded-full border',
                    basemap === id ? 'border-border-action bg-surface-action' : 'border-surface-4',
                  )}
                />
                <Icon size={12} />
                {label}
              </button>
            </li>
          ))}
        </ul>

        <GroupHeader label="Change threshold" />
        <ThresholdSection stats={stats} />

        <GroupHeader label="Raster" />
        <RasterSection s2Meta={s2Meta} />
      </div>
    </div>
  );
}
