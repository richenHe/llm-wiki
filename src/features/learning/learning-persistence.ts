import { fileExists, readFile, writeFileAtomic } from "@/commands/fs"
import type { LearningProgressSnapshot } from "./learning-store"

const STATE_RELATIVE_PATH = ".llm-wiki/learning/learners/default/progress.json"

function statePath(projectPath: string): string {
  return `${projectPath.replace(/[\\/]+$/, "")}/${STATE_RELATIVE_PATH}`
}

function previewStorageKey(projectPath: string): string {
  return `llm-wiki:learning-preview:${projectPath}`
}

function hasTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window
}

export async function loadLearningProgress(projectPath: string): Promise<LearningProgressSnapshot | null> {
  try {
    if (!hasTauriRuntime()) {
      const raw = localStorage.getItem(previewStorageKey(projectPath))
      return raw ? parseLearningProgressSnapshot(raw) : null
    }
    const path = statePath(projectPath)
    if (!(await fileExists(path))) return null
    return parseLearningProgressSnapshot(await readFile(path))
  } catch (error) {
    console.warn("[learning] failed to load progress", error)
    return null
  }
}

export async function saveLearningProgress(projectPath: string, snapshot: LearningProgressSnapshot): Promise<void> {
  const contents = `${JSON.stringify(snapshot, null, 2)}\n`
  if (!hasTauriRuntime()) {
    localStorage.setItem(previewStorageKey(projectPath), contents)
    return
  }
  await writeFileAtomic(statePath(projectPath), contents)
}

export function parseLearningProgressSnapshot(raw: string): LearningProgressSnapshot | null {
  const value = JSON.parse(raw) as {
    schemaVersion?: number
    selectedNodeId?: unknown
    masteryByNode?: LearningProgressSnapshot["masteryByNode"]
    attempts?: LearningProgressSnapshot["attempts"]
    goalsByNode?: LearningProgressSnapshot["goalsByNode"]
    lessonCache?: LearningProgressSnapshot["lessonCache"]
    updatedAt?: unknown
  }
  if (![1, 2, 3].includes(value.schemaVersion ?? 0) || typeof value.selectedNodeId !== "string") return null
  return {
    schemaVersion: 3,
    selectedNodeId: value.selectedNodeId,
    masteryByNode: value.masteryByNode ?? {},
    attempts: Array.isArray(value.attempts) ? value.attempts : [],
    goalsByNode: value.goalsByNode ?? {},
    lessonCache: value.lessonCache ?? {},
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : new Date(0).toISOString(),
  }
}
