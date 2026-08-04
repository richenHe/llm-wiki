import { create } from "zustand"
import { isAbsolutePath, normalizePath } from "@/lib/path-utils"

export interface ActivityItem {
  id: string
  type: "ingest" | "lint" | "query"
  /** Stable identity for one ingest source across automatic retries. */
  activityKey?: string
  title: string
  status: "running" | "done" | "error"
  detail: string
  filesWritten: string[]
  createdAt: number
}

export function ingestActivityKey(projectPath: string, sourcePath: string): string {
  const normalizedProjectPath = normalizePath(projectPath)
  const normalizedSourcePath = normalizePath(sourcePath)
  const absoluteSourcePath = isAbsolutePath(normalizedSourcePath)
    ? normalizedSourcePath
    : `${normalizedProjectPath}/${normalizedSourcePath}`
  return `ingest:${normalizedProjectPath.toLowerCase()}:${absoluteSourcePath.toLowerCase()}`
}

export function hasRunningIngestActivity(
  items: readonly ActivityItem[],
  projectPath: string,
  sourcePath: string,
): boolean {
  const activityKey = ingestActivityKey(projectPath, sourcePath)
  return items.some((item) =>
    item.type === "ingest" &&
    item.status === "running" &&
    item.activityKey === activityKey
  )
}

interface ActivityState {
  items: ActivityItem[]
  addItem: (item: Omit<ActivityItem, "id" | "createdAt">) => string
  updateItem: (id: string, updates: Partial<Pick<ActivityItem, "status" | "detail" | "filesWritten">>) => void
  appendDetail: (id: string, text: string) => void
  clearDone: () => void
}

let counter = 0

export const useActivityStore = create<ActivityState>((set) => ({
  items: [],

  addItem: (item) => {
    const id = `activity-${++counter}`
    set((state) => ({
      items: [
        { ...item, id, createdAt: Date.now() },
        ...state.items,
      ],
    }))
    return id
  },

  updateItem: (id, updates) =>
    set((state) => ({
      items: state.items.map((item) =>
        item.id === id ? { ...item, ...updates } : item
      ),
    })),

  appendDetail: (id, text) =>
    set((state) => ({
      items: state.items.map((item) =>
        item.id === id ? { ...item, detail: item.detail + text } : item
      ),
    })),

  clearDone: () =>
    set((state) => ({
      items: state.items.filter((i) => i.status === "running"),
    })),
}))
