import { ListChecks } from 'lucide-react';
import { useAppStore } from '@/store/appStore';
import { useTasksStore } from '@/store/tasksStore';
import { cn } from '@/lib/utils';

/**
 * Compact top toolbar.
 *
 * The change threshold lives in the layer panel instead — it is a styling
 * control for one layer, so it belongs with the layers.
 */
export function TopBar() {
  const queueOpen = useAppStore((s) => s.queueOpen);
  const toggleQueue = useAppStore((s) => s.toggleQueue);
  const tasks = useTasksStore((s) => s.tasks);
  const verified = useTasksStore((s) => s.verified);
  const doneCount = tasks.filter((t) => verified[t.task_id]).length;

  return (
    // Three equal columns so the centre title stays optically centred in the
    // viewport regardless of how wide the left brand or right actions get.
    <header className="grid h-11 shrink-0 grid-cols-3 items-center border-b border-border-0 bg-surface-1 px-3">
      <span className="justify-self-start font-display text-[15px] font-medium tracking-tight text-heading">
        Spatial Awareness
      </span>

      <h1 className="justify-self-center whitespace-nowrap text-[13px] font-medium tracking-tight text-heading">
        Gainesville Change Detection and Observation
      </h1>

      <div className="justify-self-end">
        <button
          type="button"
          onClick={toggleQueue}
          aria-pressed={queueOpen}
          title="Sites where land cover changed between 2017 and 2024"
          className={cn(
            'flex shrink-0 items-center gap-1.5 rounded-xs border px-2 py-1 transition-colors',
            queueOpen
              ? 'border-border-action bg-surface-action text-on-action'
              : 'border-border-1 text-icon-base hover:bg-surface-3 hover:text-body',
          )}
        >
          <ListChecks size={13} />
          Detected changes
          <span
            className={cn(
              'tnum rounded-[2px] px-1 text-[10px]',
              queueOpen ? 'bg-black/20 text-on-action' : 'bg-surface-3 text-icon-base',
            )}
          >
            {doneCount}/{tasks.length}
          </span>
        </button>
      </div>
    </header>
  );
}
