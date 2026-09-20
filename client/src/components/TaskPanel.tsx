import { useCallback, useEffect, useMemo, useRef } from 'react';
import { Check, MapPin, Shield, ShieldCheck, Sprout, X } from 'lucide-react';
import { fromLonLat } from 'ol/proj';
import GeoJSON from 'ol/format/GeoJSON';
import type VectorLayer from 'ol/layer/Vector';
import type VectorSource from 'ol/source/Vector';
import { useShallow } from 'zustand/react/shallow';
import { useTasksStore, selectVisibleTasks, type Task } from '@/store/tasksStore';
import { useMapHandle } from '@/map/mapHandle';
import { useAppStore } from '@/store/appStore';
import * as registry from '@/map/layerRegistry';
import { cn } from '@/lib/utils';
import type { ChangeCategory, Stats } from '@/data/types';

/**
 * Ranked list of detected land-cover changes — the product.
 *
 * Change detection converts an empty map into a finite, ordered to-do list.
 * Everything here exists to make that list actionable: click a row, the map
 * flies to it, the polygon highlights, and the volunteer can mark it verified.
 */

const CATEGORY_ICON: Record<string, typeof Sprout> = {
  vegetation_loss: Sprout,
  development: MapPin,
  revegetation: Sprout,
  hydrologic: MapPin,
};

function ProtectedBadge({ task }: { task: Task }) {
  if (task.protected_status === 'inside') {
    return (
      <span className="inline-flex items-center gap-1 text-success" title={task.protected_name ?? ''}>
        <ShieldCheck size={11} />
        inside
      </span>
    );
  }
  if (task.protected_status === 'adjacent') {
    return (
      <span className="inline-flex items-center gap-1 text-warning" title={task.protected_name ?? ''}>
        <Shield size={11} />
        {task.distance_to_protected_m !== null ? `${task.distance_to_protected_m} m` : 'adjacent'}
      </span>
    );
  }
  return null;
}

function TaskRow({
  task,
  selected,
  verified,
  color,
  onSelect,
  onToggleVerified,
}: {
  task: Task;
  selected: boolean;
  verified: boolean;
  color: string;
  onSelect: () => void;
  onToggleVerified: () => void;
}) {
  const Icon = CATEGORY_ICON[task.change_category] ?? MapPin;

  return (
    <li data-task-id={task.task_id}>
      <div
        role="button"
        tabIndex={0}
        onClick={onSelect}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onSelect();
          }
        }}
        className={cn(
          'group flex cursor-pointer items-start gap-2 border-l-2 px-3 py-2 transition-colors',
          selected
            ? 'border-l-border-action bg-surface-3'
            : 'border-l-transparent hover:bg-surface-2',
          verified && 'opacity-45',
        )}
      >
        <span
          className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-xs text-[10px] font-semibold tnum"
          style={{ backgroundColor: `${color}26`, color }}
        >
          {task.rank}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <Icon size={11} style={{ color }} className="shrink-0" />
            <span className="truncate font-medium text-body">
              {task.from_label} → {task.to_label}
            </span>
          </div>

          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-icon-base">
            <span className="tnum">{task.area_ha.toFixed(1)} ha</span>
            <span className="tnum">Δ {task.change_mean.toFixed(2)}</span>
            <ProtectedBadge task={task} />
            {/* Only render on agreement. null means "not testable", never "failed". */}
            {task.ndvi_agrees === true && (
              <span
                className="inline-flex items-center gap-0.5 text-success"
                title={`NDVI ${task.ndvi_before?.toFixed(2)} → ${task.ndvi_after?.toFixed(2)} (independent of the model)`}
              >
                <Check size={10} />
                NDVI
              </span>
            )}
          </div>

          {task.protected_name && (
            <div className="mt-0.5 truncate text-[11px] text-icon-base">
              {task.protected_name}
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggleVerified();
          }}
          title={verified ? 'Mark unverified' : 'Mark verified'}
          className={cn(
            'mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-xs border transition-colors',
            verified
              ? 'border-success bg-success/20 text-success'
              : 'border-surface-4 text-icon-base opacity-0 group-hover:opacity-100 hover:border-icon-base hover:text-icon-active',
          )}
        >
          <Check size={12} strokeWidth={3} />
        </button>
      </div>
    </li>
  );
}

export function TaskPanel({ stats }: { stats: Stats }) {
  const handle = useMapHandle();
  const open = useAppStore((s) => s.queueOpen);
  const setQueueOpen = useAppStore((s) => s.setQueueOpen);
  const listRef = useRef<HTMLOListElement>(null);

  // Esc closes the overlay, which is what every other dismissible surface in
  // the app does.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setQueueOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setQueueOpen]);

  const tasks = useTasksStore((s) => s.tasks);
  const selectedId = useTasksStore((s) => s.selectedId);
  const select = useTasksStore((s) => s.select);
  const verified = useTasksStore((s) => s.verified);
  const toggleVerified = useTasksStore((s) => s.toggleVerified);
  const isPersistent = useTasksStore((s) => s.isPersistent);
  const categoryFilter = useTasksStore((s) => s.categoryFilter);
  const toggleCategory = useTasksStore((s) => s.toggleCategory);
  const protectedOnly = useTasksStore((s) => s.protectedOnly);
  const setProtectedOnly = useTasksStore((s) => s.setProtectedOnly);

  /**
   * useShallow is REQUIRED here. selectVisibleTasks builds a new array on every
   * call, so zustand's default reference equality would report a change on each
   * render and loop forever ("Maximum update depth exceeded"). The task objects
   * themselves are stable, so a shallow element-wise compare is correct.
   */
  const visible = useTasksStore(useShallow(selectVisibleTasks));

  /**
   * Bring the selected row into view. Selection often comes from a map click
   * or a shared URL, in which case the row can be far down a 40-item list.
   */
  useEffect(() => {
    if (!open || !selectedId) return;
    const el = listRef.current?.querySelector(`[data-task-id="${selectedId}"]`);
    el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [open, selectedId, visible.length]);
  const doneCount = useMemo(
    () => tasks.filter((t) => verified[t.task_id]).length,
    [tasks, verified],
  );

  /** Fly to a task and highlight its polygon. */
  const onSelect = useCallback(
    (task: Task) => {
      select(task.task_id);
      if (!handle) return;

      handle.map.getView().animate({
        center: fromLonLat(task.centroid),
        zoom: 14.5,
        duration: 650,
      });

      // Highlight lives on its own layer so selecting never restyles the queue.
      const hl = registry.get('task-highlight') as VectorLayer<VectorSource> | undefined;
      const src = registry.get('tasks') as VectorLayer<VectorSource> | undefined;
      if (!hl || !src) return;
      const match = src
        .getSource()
        ?.getFeatures()
        .find((f) => f.get('task_id') === task.task_id);
      const target = hl.getSource();
      target?.clear();
      if (match) target?.addFeature(match.clone());
    },
    [handle, select],
  );

  const categories = Object.entries(stats.categories) as Array<
    [ChangeCategory, { label: string; color: string }]
  >;
  const present = categories.filter(([c]) => tasks.some((t) => t.change_category === c));

  if (!open) return null;

  return (
    // An overlay above the map, not a layout column — the map keeps the full
    // viewport and the queue is summoned when wanted.
    <aside className="absolute inset-y-0 right-0 z-30 flex w-[340px] flex-col border-l border-border-1 bg-surface-1/97 backdrop-blur-[2px]">
      <header className="shrink-0 border-b border-border-0 px-3 py-2.5">
        <div className="flex items-baseline justify-between">
          <h3 className="panel-label">Detected changes</h3>
          <div className="flex items-center gap-2">
            <span className="tnum text-[11px] text-icon-base">
              {doneCount}/{tasks.length} checked
            </span>
            <button
              type="button"
              onClick={() => setQueueOpen(false)}
              title="Close (Esc)"
              className="text-icon-base transition-colors hover:text-icon-active"
            >
              <X size={13} />
            </button>
          </div>
        </div>

        {/* Names what the features are and the period they cover. Ordering and
            click-to-zoom are self-evident from the list itself. */}
        <p className="mt-1.5 text-[11px] leading-snug text-icon-base">
          Land cover that changed between 2017 and 2024.
        </p>

        {/* Category filter — doubles as the transitions legend. */}
        <div className="mt-2 flex flex-wrap gap-1">
          {present.map(([key, meta]) => {
            const on = categoryFilter.size === 0 || categoryFilter.has(key);
            const n = tasks.filter((t) => t.change_category === key).length;
            return (
              <button
                key={key}
                type="button"
                onClick={() => toggleCategory(key)}
                className={cn(
                  'flex items-center gap-1.5 rounded-xs border px-1.5 py-0.5 text-[11px] transition-colors',
                  on
                    ? 'border-border-1 bg-surface-3 text-body'
                    : 'border-transparent text-icon-base hover:bg-surface-2',
                )}
              >
                <span
                  className="size-2 rounded-[1px] border"
                  style={{ backgroundColor: meta.color, borderColor: 'var(--border-1)' }}
                />
                {meta.label}
                <span className="tnum opacity-60">{n}</span>
              </button>
            );
          })}
        </div>

        <label className="mt-2 flex cursor-pointer items-center gap-1.5 text-[11px] text-icon-base hover:text-body">
          <input
            type="checkbox"
            checked={protectedOnly}
            onChange={(e) => setProtectedOnly(e.target.checked)}
            className="accent-(--surface-action)"
          />
          On or near protected land only
        </label>
      </header>

      <ol ref={listRef} className="min-h-0 flex-1 overflow-y-auto">
        {visible.map((task) => (
          <TaskRow
            key={task.task_id}
            task={task}
            selected={task.task_id === selectedId}
            verified={Boolean(verified[task.task_id])}
            color={stats.categories[task.change_category]?.color ?? '#D7301F'}
            onSelect={() => onSelect(task)}
            onToggleVerified={() => toggleVerified(task.task_id)}
          />
        ))}
        {visible.length === 0 && (
          <li className="px-3 py-6 text-center text-icon-base">No tasks match this filter.</li>
        )}
      </ol>

      {!isPersistent && (
        <p className="shrink-0 border-t border-border-0 px-3 py-1.5 text-[10px] text-warning">
          Storage unavailable — verified marks will not survive a reload.
        </p>
      )}
    </aside>
  );
}

/** Reads the tasks layer's own features; kept here so the format is shared. */
export const taskGeoJson = new GeoJSON({
  dataProjection: 'EPSG:4326',
  featureProjection: 'EPSG:3857',
});
