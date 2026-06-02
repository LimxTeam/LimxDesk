import type { ReactNode } from "react";

/** 灵动岛语义类型 */
export type IslandType = "success" | "loading" | "error" | "warning" | "info";

/**
 * 灵动岛任务的可视描述。
 *
 * 快捷方式：传 `type` 自动匹配图标 + 颜色 + glow + spinning。
 * 传自定义 `icon` / `color` 会覆盖 type 的默认值。
 */
export interface IslandTask {
  /** 唯一 id（show 时若未提供则自动生成） */
  id: string;
  /** 语义类型：自动决定图标和颜色 */
  type?: IslandType;
  /** 左侧图标节点（覆盖 type 默认图标，建议 16px） */
  icon?: ReactNode;
  /** 主标题（必填） */
  title: string;
  /** 副标题（可选） */
  subtitle?: string;
  /** 主题色（覆盖 type 默认颜色） */
  color?: string;
  /** 进度 0..1；undefined 为 indeterminate */
  progress?: number;
  /** 左侧图标是否旋转。默认由 type 决定 */
  spinning?: boolean;
  /** 是否显示全屏模糊覆层。默认 `false` */
  overlay?: boolean;
  /** 是否启用边框呼吸辉光动画。默认由 type 决定 */
  glow?: boolean;
  /** 自动消失时长（ms）。0 或 undefined = 手动关闭（loading type 默认忽略此值） */
  duration?: number;
  /** 跟踪 Promise：resolve → 自动切 success，reject → 自动切 error */
  promise?: Promise<unknown>;
  /** promise resolve 时显示的标题（默认 "完成"） */
  successTitle?: string;
  /** promise reject 时显示的标题（默认 "失败"） */
  errorTitle?: string;
  /** 点击胶囊回调 */
  onClick?: () => void;
}

interface InternalState {
  tasks: IslandTask[];
}

const state: InternalState = {
  tasks: [],
};

const listeners = new Set<() => void>();

function notify(): void {
  for (const l of listeners) l();
}

let _idCounter = 0;
function nextId(): string {
  _idCounter += 1;
  return `island_${_idCounter}_${Date.now().toString(36)}`;
}

export interface HideOptions {
  successTitle?: string;
  successSubtitle?: string;
  successFor?: number;
}

const DEFAULT_SUCCESS_FOR_MS = 1500;

/**
 * 全局灵动岛 API — 命令式接口，可在 React 树外任意位置调用。
 */
export const dynamicIsland = {
  show(task: Omit<IslandTask, "id"> & { id?: string }): string {
    const id = task.id ?? nextId();
    const next: IslandTask = { id, ...task };

    // 同名替换
    const existing = state.tasks.findIndex((t) => t.id === id);
    if (existing >= 0) {
      state.tasks = state.tasks.map((t, i) => (i === existing ? next : t));
    } else {
      state.tasks = [...state.tasks, next];
    }
    notify();

    // ── duration：非 loading 且 duration > 0 时自动消失 ──
    const duration = task.duration ?? 0;
    if (duration > 0 && task.type !== "loading") {
      window.setTimeout(() => {
        const idx = state.tasks.findIndex((t) => t.id === id);
        if (idx >= 0) {
          state.tasks = state.tasks.filter((_, i) => i !== idx);
          notify();
        }
      }, duration);
    }

    // ── promise：跟踪异步任务，自动切 success / error ──
    if (task.promise) {
      task.promise
        .then((result: unknown) => {
          const msg = typeof result === "string" ? result : undefined;
          dynamicIsland.update(id, {
            type: "success",
            title: task.successTitle ?? "完成",
            subtitle: msg ?? task.subtitle,
            progress: 1,
            spinning: false,
            glow: false,
            promise: undefined,
          });
          const d = duration > 0 ? duration : 2000;
          window.setTimeout(() => dynamicIsland.hide(id), d);
        })
        .catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          dynamicIsland.update(id, {
            type: "error",
            title: task.errorTitle ?? "失败",
            subtitle: msg,
            progress: 0,
            spinning: false,
            glow: false,
            promise: undefined,
          });
          const d = duration > 0 ? duration : 4000;
          window.setTimeout(() => dynamicIsland.hide(id), d);
        });
    }

    return id;
  },

  update(id: string, patch: Partial<Omit<IslandTask, "id">>): void {
    const idx = state.tasks.findIndex((t) => t.id === id);
    if (idx < 0) return;
    state.tasks = state.tasks.map((t, i) =>
      i === idx ? { ...t, ...patch } : t,
    );
    notify();
  },

  hide(id: string, opts?: HideOptions): void {
    const idx = state.tasks.findIndex((t) => t.id === id);
    if (idx < 0) return;

    if (opts?.successTitle) {
      const stayMs = opts.successFor ?? DEFAULT_SUCCESS_FOR_MS;
      state.tasks = state.tasks.map((t, i) =>
        i === idx
          ? {
              ...t,
              title: opts.successTitle as string,
              subtitle: opts.successSubtitle ?? t.subtitle,
              progress: 1,
              spinning: false,
            }
          : t,
      );
      notify();
      window.setTimeout(() => {
        const i = state.tasks.findIndex((t) => t.id === id);
        if (i >= 0) {
          state.tasks = state.tasks.filter((_, k) => k !== i);
          notify();
        }
      }, stayMs);
      return;
    }

    state.tasks = state.tasks.filter((_, i) => i !== idx);
    notify();
  },

  /** 清空所有任务（兜底用，例如全局错误后重置 UI） */
  hideAll(): void {
    if (state.tasks.length === 0) return;
    state.tasks = [];
    notify();
  },

  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },

  getSnapshot(): IslandTask[] {
    return state.tasks;
  },
};
