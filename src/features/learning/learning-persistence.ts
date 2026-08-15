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
      return raw ? parseSnapshot(raw) : null
    }
    const path = statePath(projectPath)
    if (!(await fileExists(path))) return null
    return parseSnapshot(await readFile(path))
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

function parseSnapshot(raw: string): LearningProgressSnapshot | null {
  const value = JSON.parse(raw) as {
    schemaVersion?: number
    selectedNodeId?: unknown
    masteryByNode?: LearningProgressSnapshot["masteryByNode"]
    attempts?: LearningProgressSnapshot["attempts"]
    updatedAt?: unknown
  }
  if ((value.schemaVersion !== 1 && value.schemaVersion !== 2) || typeof value.selectedNodeId !== "string") return null
  return {
    schemaVersion: 2,
    selectedNodeId: value.selectedNodeId,
    masteryByNode: value.masteryByNode ?? {},
    attempts: Array.isArray(value.attempts) ? value.attempts : [],
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : new Date(0).toISOString(),
  }
}
