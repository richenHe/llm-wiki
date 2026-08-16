import { fileExists, readFile, writeFileAtomic } from "@/commands/fs"
import type { LearningMastery } from "./learning-data"
import type { LearningProgressSnapshot } from "./learning-store"
import type { TeachingAttempt } from "./teaching-types"

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

function migrateMastery(value: unknown): LearningMastery | null {
  if (value === "unseen") return "unseen"
  if (value === "started" || value === "understood" || value === "learning") return "learning"
  if (value === "practiced") return "learning"
  if (value === "applicable") return "applicable"
  if (value === "mastered") return "learning"
  if (value === "consolidated") return "consolidated"
  return null
}

export function parseLearningSnapshot(raw: string): LearningProgressSnapshot | null {
  const value = JSON.parse(raw) as Record<string, unknown>
  if (![1, 2, 3].includes(Number(value.schemaVersion)) || typeof value.selectedNodeId !== "string") return null
  const masteryByNode: Record<string, LearningMastery> = {}
  if (value.masteryByNode && typeof value.masteryByNode === "object") {
    for (const [nodeId, saved] of Object.entries(value.masteryByNode as Record<string, unknown>)) {
      const mastery = migrateMastery(saved)
      if (mastery) masteryByNode[nodeId] = mastery
    }
  }
  return {
    schemaVersion: 3,
    selectedNodeId: value.selectedNodeId,
    masteryByNode,
    attempts: Number(value.schemaVersion) === 3 && Array.isArray(value.attempts) ? value.attempts as TeachingAttempt[] : [],
    sessionsByNode: Number(value.schemaVersion) === 3 && value.sessionsByNode && typeof value.sessionsByNode === "object" ? value.sessionsByNode as LearningProgressSnapshot["sessionsByNode"] : {},
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : new Date(0).toISOString(),
  }
}

function parseSnapshot(raw: string): LearningProgressSnapshot | null {
  return parseLearningSnapshot(raw)
}
