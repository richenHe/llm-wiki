import { create } from "zustand"
import { DEFAULT_LEARNING_NODE_ID, type LearningMastery } from "./learning-data"
import type { TeachingAttempt, TeachingLesson, TeachingNodeSession, TeachingStage } from "./teaching-types"

export interface LearningProgressSnapshot {
  schemaVersion: 3
  selectedNodeId: string
  masteryByNode: Record<string, LearningMastery>
  attempts: TeachingAttempt[]
  sessionsByNode: Record<string, TeachingNodeSession>
  updatedAt: string
}

interface LearningState {
  selectedNodeId: string
  zoom: number
  query: string
  detailOpen: boolean
  draftAnswer: string
  masteryByNode: Record<string, LearningMastery>
  attempts: TeachingAttempt[]
  sessionsByNode: Record<string, TeachingNodeSession>
  hydratedProjectPath: string | null
  selectNode: (nodeId: string) => void
  setZoom: (zoom: number) => void
  setQuery: (query: string) => void
  setDetailOpen: (open: boolean) => void
  setDraftAnswer: (answer: string) => void
  setActiveStage: (nodeId: string, stage: TeachingStage) => void
  setLesson: (nodeId: string, lesson: TeachingLesson) => void
  setTeachingError: (nodeId: string, error?: string) => void
  markLearningStarted: (nodeId: string) => void
  recordAttempt: (attempt: TeachingAttempt) => void
  hydrate: (projectPath: string, snapshot: LearningProgressSnapshot | null) => void
  resetProject: () => void
  toSnapshot: () => LearningProgressSnapshot
}

const initialState = {
  selectedNodeId: DEFAULT_LEARNING_NODE_ID,
  zoom: 1,
  query: "",
  detailOpen: false,
  draftAnswer: "",
  masteryByNode: {} as Record<string, LearningMastery>,
  attempts: [] as TeachingAttempt[],
  sessionsByNode: {} as Record<string, TeachingNodeSession>,
  hydratedProjectPath: null as string | null,
}

function reviewDueAt(createdAt: string): string {
  const due = new Date(createdAt)
  due.setDate(due.getDate() + 3)
  return due.toISOString()
}

export function deriveMastery(attempts: readonly TeachingAttempt[], current: LearningMastery = "unseen"): LearningMastery {
  if (attempts.length === 0) return current === "unseen" ? "learning" : current
  const latest = attempts[attempts.length - 1]
  const successful = attempts.filter((attempt) => attempt.evaluation.verdict === "correct" && !attempt.evaluation.unresolvedCoreMisconception)
  const hasRecall = successful.some((attempt) => attempt.kind === "recall" && attempt.evaluation.passedRecall)
  const hasApplication = successful.some((attempt) => (attempt.kind === "application" || attempt.kind === "transfer") && attempt.evaluation.passedApplication)
  if (latest.kind === "review" && latest.evaluation.verdict === "correct" && !latest.evaluation.unresolvedCoreMisconception && (current === "mastered" || current === "consolidated" || (hasRecall && hasApplication))) return "consolidated"
  if (latest.evaluation.unresolvedCoreMisconception && latest.evaluation.verdict !== "correct") return hasApplication ? "applicable" : "learning"
  if (hasRecall && hasApplication) return "mastered"
  if (hasApplication) return "applicable"
  return "learning"
}

export const useLearningStore = create<LearningState>((set, get) => ({
  ...initialState,
  selectNode: (selectedNodeId) => set({ selectedNodeId, draftAnswer: "" }),
  setZoom: (zoom) => set({ zoom: Math.min(1.3, Math.max(0.75, zoom)) }),
  setQuery: (query) => set({ query }),
  setDetailOpen: (detailOpen) => set({ detailOpen }),
  setDraftAnswer: (draftAnswer) => set({ draftAnswer }),
  setActiveStage: (nodeId, activeStage) => set((state) => ({
    draftAnswer: "",
    sessionsByNode: { ...state.sessionsByNode, [nodeId]: { ...state.sessionsByNode[nodeId], activeStage } },
  })),
  setLesson: (nodeId, lesson) => set((state) => ({
    sessionsByNode: { ...state.sessionsByNode, [nodeId]: { ...state.sessionsByNode[nodeId], activeStage: state.sessionsByNode[nodeId]?.activeStage ?? "locate", lesson, lastError: undefined } },
  })),
  setTeachingError: (nodeId, lastError) => set((state) => ({
    sessionsByNode: { ...state.sessionsByNode, [nodeId]: { ...state.sessionsByNode[nodeId], activeStage: state.sessionsByNode[nodeId]?.activeStage ?? "locate", lastError } },
  })),
  markLearningStarted: (nodeId) => set((state) => ({
    masteryByNode: state.masteryByNode[nodeId] && state.masteryByNode[nodeId] !== "unseen" ? state.masteryByNode : { ...state.masteryByNode, [nodeId]: "learning" },
  })),
  recordAttempt: (attempt) => set((state) => {
    const attempts = [...state.attempts, attempt]
    const currentMastery = state.masteryByNode[attempt.nodeId]
    const derived = deriveMastery(attempts.filter((item) => item.nodeId === attempt.nodeId), currentMastery)
    const reviewDue = state.sessionsByNode[attempt.nodeId]?.reviewDueAt
    const reviewIsEarly = attempt.kind === "review" && reviewDue && new Date(attempt.createdAt).getTime() < new Date(reviewDue).getTime()
    const mastery = reviewIsEarly && derived === "consolidated" ? (currentMastery ?? "learning") : derived
    return {
      attempts,
      draftAnswer: "",
      masteryByNode: { ...state.masteryByNode, [attempt.nodeId]: mastery },
      sessionsByNode: {
        ...state.sessionsByNode,
        [attempt.nodeId]: {
          ...state.sessionsByNode[attempt.nodeId],
          activeStage: mastery === "mastered" || mastery === "consolidated" ? "retain" : "apply",
          reviewDueAt: mastery === "mastered" ? reviewDueAt(attempt.createdAt) : state.sessionsByNode[attempt.nodeId]?.reviewDueAt,
          lastError: undefined,
        },
      },
    }
  }),
  hydrate: (projectPath, snapshot) => set({
    ...initialState,
    selectedNodeId: snapshot?.selectedNodeId ?? DEFAULT_LEARNING_NODE_ID,
    masteryByNode: snapshot?.masteryByNode ?? {},
    attempts: snapshot?.attempts ?? [],
    sessionsByNode: snapshot?.sessionsByNode ?? {},
    hydratedProjectPath: projectPath,
  }),
  resetProject: () => set({ ...initialState }),
  toSnapshot: () => ({
    schemaVersion: 3,
    selectedNodeId: get().selectedNodeId,
    masteryByNode: get().masteryByNode,
    attempts: get().attempts,
    sessionsByNode: get().sessionsByNode,
    updatedAt: new Date().toISOString(),
  }),
}))
