import { create } from "zustand"
import { DEFAULT_LEARNING_NODE_ID, type LearningMastery } from "./learning-data"

export interface LearningProgressSnapshot {
  schemaVersion: 2
  selectedNodeId: string
  masteryByNode: Record<string, LearningMastery>
  attempts: LearningAttempt[]
  updatedAt: string
}

export interface LearningAttempt {
  nodeId: string
  answer: string
  createdAt: string
  kind: "self-explanation"
}

interface LearningState {
  selectedNodeId: string
  zoom: number
  query: string
  detailOpen: boolean
  lessonOpen: boolean
  lessonAnswer: string
  lessonSubmitted: boolean
  masteryByNode: Record<string, LearningMastery>
  attempts: LearningAttempt[]
  hydratedProjectPath: string | null
  selectNode: (nodeId: string) => void
  setZoom: (zoom: number) => void
  setQuery: (query: string) => void
  setDetailOpen: (open: boolean) => void
  setLessonOpen: (open: boolean) => void
  setLessonAnswer: (answer: string) => void
  submitLesson: () => boolean
  hydrate: (projectPath: string, snapshot: LearningProgressSnapshot | null) => void
  resetProject: () => void
  toSnapshot: () => LearningProgressSnapshot
}

const initialState = {
  selectedNodeId: DEFAULT_LEARNING_NODE_ID,
  zoom: 1,
  query: "",
  detailOpen: true,
  lessonOpen: false,
  lessonAnswer: "",
  lessonSubmitted: false,
  masteryByNode: {} as Record<string, LearningMastery>,
  attempts: [] as LearningAttempt[],
  hydratedProjectPath: null as string | null,
}

export const useLearningStore = create<LearningState>((set, get) => ({
  ...initialState,
  selectNode: (selectedNodeId) => set({ selectedNodeId, detailOpen: true, lessonOpen: false, lessonAnswer: "", lessonSubmitted: false }),
  setZoom: (zoom) => set({ zoom: Math.min(1.3, Math.max(0.75, zoom)) }),
  setQuery: (query) => set({ query }),
  setDetailOpen: (detailOpen) => set({ detailOpen }),
  setLessonOpen: (lessonOpen) => set({ lessonOpen, lessonAnswer: "", lessonSubmitted: false }),
  setLessonAnswer: (lessonAnswer) => set({ lessonAnswer, lessonSubmitted: false }),
  submitLesson: () => {
    const { selectedNodeId, lessonAnswer, masteryByNode, attempts } = get()
    const answer = lessonAnswer.trim()
    if (answer.length < 12) return false
    const current = masteryByNode[selectedNodeId]
    const nextMastery = current === "mastered" ? "mastered" : "practiced"
    set({
      lessonSubmitted: true,
      masteryByNode: { ...masteryByNode, [selectedNodeId]: nextMastery },
      attempts: [...attempts, { nodeId: selectedNodeId, answer, createdAt: new Date().toISOString(), kind: "self-explanation" }],
    })
    return true
  },
  hydrate: (projectPath, snapshot) => set({
    ...initialState,
    selectedNodeId: snapshot?.selectedNodeId ?? DEFAULT_LEARNING_NODE_ID,
    masteryByNode: snapshot?.masteryByNode ?? {},
    attempts: snapshot?.attempts ?? [],
    hydratedProjectPath: projectPath,
  }),
  resetProject: () => set({ ...initialState }),
  toSnapshot: () => ({
    schemaVersion: 2,
    selectedNodeId: get().selectedNodeId,
    masteryByNode: get().masteryByNode,
    attempts: get().attempts,
    updatedAt: new Date().toISOString(),
  }),
}))
