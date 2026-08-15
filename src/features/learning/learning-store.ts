import { create } from "zustand"
import { DEFAULT_LEARNING_NODE_ID, type LearningMastery } from "./learning-data"
import type { LearningLesson } from "./learning-tutor"

export type LearningAttemptKind = "diagnostic" | "guided-practice" | "verification" | "self-explanation"

export interface LearningAttempt {
  nodeId: string
  answer: string
  createdAt: string
  kind: LearningAttemptKind
  goal?: string
  passed?: boolean | null
  score?: number | null
  feedback?: string
}

export interface LearningProgressSnapshot {
  schemaVersion: 3
  selectedNodeId: string
  masteryByNode: Record<string, LearningMastery>
  attempts: LearningAttempt[]
  goalsByNode: Record<string, string>
  lessonCache: Record<string, LearningLesson>
  updatedAt: string
}

interface RecordAttemptInput {
  nodeId?: string
  baselineMastery?: LearningMastery
  answer: string
  kind: LearningAttemptKind
  goal?: string
  passed?: boolean | null
  score?: number | null
  feedback?: string
}

interface LearningState {
  selectedNodeId: string
  zoom: number
  query: string
  detailOpen: boolean
  lessonOpen: boolean
  masteryByNode: Record<string, LearningMastery>
  attempts: LearningAttempt[]
  goalsByNode: Record<string, string>
  lessonCache: Record<string, LearningLesson>
  hydratedProjectPath: string | null
  selectNode: (nodeId: string) => void
  setZoom: (zoom: number) => void
  setQuery: (query: string) => void
  setDetailOpen: (open: boolean) => void
  setLessonOpen: (open: boolean) => void
  setLearningGoal: (nodeId: string, goal: string) => void
  cacheLesson: (lesson: LearningLesson) => void
  removeCachedLesson: (nodeId: string) => void
  recordAttempt: (input: RecordAttemptInput) => boolean
  hydrate: (projectPath: string, snapshot: LearningProgressSnapshot | null) => void
  resetProject: () => void
  toSnapshot: () => LearningProgressSnapshot
}

const initialState = {
  selectedNodeId: DEFAULT_LEARNING_NODE_ID,
  zoom: 1,
  query: "",
  detailOpen: false,
  lessonOpen: false,
  masteryByNode: {} as Record<string, LearningMastery>,
  attempts: [] as LearningAttempt[],
  goalsByNode: {} as Record<string, string>,
  lessonCache: {} as Record<string, LearningLesson>,
  hydratedProjectPath: null as string | null,
}

function nextMastery(current: LearningMastery | undefined, input: RecordAttemptInput): LearningMastery {
  const masteryOrder: LearningMastery[] = ["unseen", "started", "understood", "practiced", "mastered"]
  const candidate = input.kind === "verification" && input.passed === true
    ? "mastered"
    : input.kind === "guided-practice" || input.kind === "self-explanation" || input.kind === "verification"
      ? "practiced"
      : "started"
  const currentRank = masteryOrder.indexOf(current ?? "unseen")
  const baselineRank = masteryOrder.indexOf(input.baselineMastery ?? "unseen")
  const existing = masteryOrder[Math.max(currentRank, baselineRank)]
  return masteryOrder.indexOf(existing) >= masteryOrder.indexOf(candidate) ? existing : candidate
}

export const useLearningStore = create<LearningState>((set, get) => ({
  ...initialState,
  selectNode: (selectedNodeId) => set({ selectedNodeId, lessonOpen: false }),
  setZoom: (zoom) => set({ zoom: Math.min(1.3, Math.max(0.75, zoom)) }),
  setQuery: (query) => set({ query }),
  setDetailOpen: (detailOpen) => set({ detailOpen }),
  setLessonOpen: (lessonOpen) => set({ lessonOpen }),
  setLearningGoal: (nodeId, goal) => set((state) => ({ goalsByNode: { ...state.goalsByNode, [nodeId]: goal } })),
  cacheLesson: (lesson) => set((state) => ({ lessonCache: { ...state.lessonCache, [lesson.nodeId]: lesson } })),
  removeCachedLesson: (nodeId) => set((state) => {
    const lessonCache = { ...state.lessonCache }
    delete lessonCache[nodeId]
    return { lessonCache }
  }),
  recordAttempt: (input) => {
    const answer = input.answer.trim()
    if (!answer) return false
    const nodeId = input.nodeId ?? get().selectedNodeId
    const current = get().masteryByNode[nodeId]
    const attempt: LearningAttempt = {
      nodeId,
      answer,
      createdAt: new Date().toISOString(),
      kind: input.kind,
      ...(input.goal ? { goal: input.goal } : {}),
      ...(input.passed !== undefined ? { passed: input.passed } : {}),
      ...(input.score !== undefined ? { score: input.score } : {}),
      ...(input.feedback ? { feedback: input.feedback } : {}),
    }
    set((state) => ({
      attempts: [...state.attempts, attempt],
      masteryByNode: { ...state.masteryByNode, [nodeId]: nextMastery(current, input) },
    }))
    return true
  },
  hydrate: (projectPath, snapshot) => set({
    ...initialState,
    selectedNodeId: snapshot?.selectedNodeId ?? DEFAULT_LEARNING_NODE_ID,
    masteryByNode: snapshot?.masteryByNode ?? {},
    attempts: snapshot?.attempts ?? [],
    goalsByNode: snapshot?.goalsByNode ?? {},
    lessonCache: snapshot?.lessonCache ?? {},
    hydratedProjectPath: projectPath,
  }),
  resetProject: () => set({ ...initialState }),
  toSnapshot: () => ({
    schemaVersion: 3,
    selectedNodeId: get().selectedNodeId,
    masteryByNode: get().masteryByNode,
    attempts: get().attempts,
    goalsByNode: get().goalsByNode,
    lessonCache: get().lessonCache,
    updatedAt: new Date().toISOString(),
  }),
}))
