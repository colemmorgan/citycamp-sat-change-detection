import { create } from 'zustand';
import { VERIFIED_KEY } from '@/data/constants';
import { readJson, storageIsPersistent, writeJson } from '@/lib/storage';
import type { ChangeCategory, TaskProps } from '@/data/types';

/**
 * The ranked verification queue.
 *
 * OWNERSHIP: Stream A (queue, selection, verified state).
 * Stream B renders from it. Filters are here so the legend and the queue can
 * share one filter model.
 */

export interface Task extends TaskProps {
  /** [lon, lat] — already the pipeline's `centroid`, kept for clarity at call sites. */
  centroid: [number, number];
}

interface TasksState {
  tasks: Task[];
  setTasks: (t: Task[]) => void;

  selectedId: string | null;
  select: (id: string | null) => void;

  /** task_id -> true. Persisted, namespaced, try/catch wrapped. */
  verified: Record<string, boolean>;
  toggleVerified: (id: string) => void;
  isPersistent: boolean;

  /** Empty set = show all. */
  categoryFilter: Set<ChangeCategory>;
  toggleCategory: (c: ChangeCategory) => void;
  clearCategories: () => void;

  protectedOnly: boolean;
  setProtectedOnly: (v: boolean) => void;

  hideVerified: boolean;
  setHideVerified: (v: boolean) => void;
}

export const useTasksStore = create<TasksState>((set, get) => ({
  tasks: [],
  setTasks: (tasks) => set({ tasks }),

  selectedId: null,
  select: (selectedId) => set({ selectedId }),

  verified: readJson<Record<string, boolean>>(VERIFIED_KEY, {}),
  isPersistent: storageIsPersistent(),
  toggleVerified: (id) => {
    const next = { ...get().verified };
    if (next[id]) delete next[id];
    else next[id] = true;
    set({ verified: next });
    writeJson(VERIFIED_KEY, next);
  },

  categoryFilter: new Set<ChangeCategory>(),
  toggleCategory: (c) =>
    set((s) => {
      const next = new Set(s.categoryFilter);
      if (next.has(c)) next.delete(c);
      else next.add(c);
      return { categoryFilter: next };
    }),
  clearCategories: () => set({ categoryFilter: new Set<ChangeCategory>() }),

  protectedOnly: false,
  setProtectedOnly: (protectedOnly) => set({ protectedOnly }),

  hideVerified: false,
  setHideVerified: (hideVerified) => set({ hideVerified }),
}));

/** Tasks after filters, still in rank order. */
export function selectVisibleTasks(s: TasksState): Task[] {
  return s.tasks.filter((t) => {
    if (s.categoryFilter.size > 0 && !s.categoryFilter.has(t.change_category)) return false;
    if (s.protectedOnly && t.protected_status === 'outside') return false;
    if (s.hideVerified && s.verified[t.task_id]) return false;
    return true;
  });
}
