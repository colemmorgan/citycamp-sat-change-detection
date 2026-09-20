import { useEffect } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { useAppStore } from '@/store/appStore';
import { useTasksStore } from '@/store/tasksStore';
import { useBootstrap, useTasks } from '@/data/queries';
import type { LayerRowId } from '@/data/types';
import { MapCanvas } from './MapCanvas';
import { StatusStrip } from './StatusStrip';
import { TopBar } from './TopBar';
import { TaskPanel } from './TaskPanel';
import { LayerPanel } from './LayerPanel';
import { Legend } from './Legend';
import { GlobeGalleryDialog } from './GlobeGalleryDialog';
import { useMapUrlSync } from '@/hooks/useMapUrlSync';
import { useTaskPicking } from '@/hooks/useTaskPicking';

/**
 * Load gate and layout frame.
 *
 * Fetching is React Query's; this component only reacts to its states. The
 * three-panel chrome (top bar, layer panel, task panel) is Stream B's — the
 * slots below are where it lands.
 */
export function AppShell() {
  const { stats, legend, available, s2Meta, isLoading, error, isReady } = useBootstrap();

  const initThreshold = useAppStore((s) => s.initThreshold);
  const markUnavailable = useAppStore((s) => s.markUnavailable);
  const setTasks = useTasksStore((s) => s.setTasks);

  const tasks = useTasks(Boolean(available?.tasks));

  // Called unconditionally (rules of hooks). Both no-op until the map exists.
  useMapUrlSync();
  useTaskPicking();

  // Seed the slider from the L4 gate once stats land.
  useEffect(() => {
    if (stats) initThreshold(stats.change.slider_default);
  }, [stats, initThreshold]);

  // Mirror the task list into the store so map selection and the queue panel
  // share one ordering without re-deriving it.
  useEffect(() => {
    if (tasks.data) setTasks(tasks.data);
  }, [tasks.data, setTasks]);

  // Disable panel rows whose underlying file the probe did not find.
  useEffect(() => {
    if (!available) return;
    const missing: LayerRowId[] = [];
    if (!available.s2_2017 && !available.s2_2024) missing.push('imagery' as const);
    if (!available.lulc2017 && !available.lulc2024) missing.push('lulc' as const);
    if (!available.change) missing.push('change' as const);
    if (!available.transitions) missing.push('transitions' as const);
    if (!available.protectedAreas) missing.push('protected' as const);
    if (!available.globePoints) missing.push('globe' as const);
    if (!available.tasks) missing.push('tasks' as const);
    if (missing.length) markUnavailable(missing);
  }, [available, markUnavailable]);

  if (error) {
    return (
      <div className="flex h-full items-center justify-center bg-surface-0 p-6">
        <div className="max-w-md rounded-lg border border-border-1 bg-surface-1 p-5">
          <div className="mb-2 flex items-center gap-2 text-error">
            <AlertTriangle size={18} />
            <h2 className="text-base">Could not load pipeline data</h2>
          </div>
          <p className="mb-3 text-icon-base">{error.message}</p>
          <p className="text-icon-base">
            Run{' '}
            <code className="rounded-xs bg-surface-3 px-1 py-0.5 text-body">
              ./scripts/sync-data.sh
            </code>{' '}
            to copy the latest pipeline output into{' '}
            <code className="text-body">public/data</code>.
          </p>
        </div>
      </div>
    );
  }

  if (isLoading || !isReady || !stats || !legend || !available) {
    return (
      <div className="flex h-full items-center justify-center bg-surface-0">
        <div className="flex items-center gap-2 text-icon-base">
          <Loader2 size={16} className="animate-spin" />
          <span>Loading…</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-surface-0">
      <TopBar />

      <div className="relative flex min-h-0 flex-1">
        {/* LEFT PANEL — the only permanent column. */}
        <aside className="w-[316px] shrink-0 overflow-hidden border-r border-border-0 bg-surface-1">
          <LayerPanel stats={stats} s2Meta={s2Meta} />
        </aside>

        {/* MAP fills the rest; legend and queue float above it. */}
        <main className="relative min-w-0 flex-1">
          <MapCanvas stats={stats} legend={legend} available={available} s2Meta={s2Meta} />
          <Legend stats={stats} legend={legend} />
          <TaskPanel stats={stats} />
        </main>

        <GlobeGalleryDialog />
      </div>

      <StatusStrip stats={stats} />
    </div>
  );
}
