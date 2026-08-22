import type { LearningMastery, LearningNode } from "./learning-data"
import type { LearningBoard } from "./learning-routes"

export type TeachingStage = "locate" | "explain" | "apply" | "retain"
export type TeachingQuestionKind = "recall" | "application" | "transfer" | "review"
export type TeachingVerdict = "correct" | "partial" | "incorrect" | "off_topic" | "unjudgeable"

export interface TeachingConnection {
  nodeId?: string
  title: string
  relation: "prerequisite" | "child" | "sibling" | "related" | "example"
  explanation: string
}

export interface TeachingVisualBrief {
  kind: "image" | "none"
  title: string
  reason: string
  imagePrompt?: string
  cacheFingerprint?: string
}

export interface TeachingLesson {
  schemaVersion: 3
  nodeId: string
  sourceFingerprint: string
  essence: string
  explanation: string
  mechanism: string
  example: string
  counterexample: string
  relationshipExplanation: string
  checkQuestion: string
  conceptVisual: TeachingVisualBrief
  relationshipVisual: TeachingVisualBrief
  preparedAt: string
}

export interface TeachingEvaluation {
  verdict: TeachingVerdict
  feedback: string
  strengths: string[]
  missingPoints: string[]
  evidence: string[]
  nextAction: string
  passedRecall: boolean
  passedApplication: boolean
  unresolvedCoreMisconception: boolean
}

export interface TeachingAttempt {
  id: string
  nodeId: string
  question: string
  answer: string
  kind: TeachingQuestionKind
  evaluation: TeachingEvaluation
  createdAt: string
  assisted: boolean
}

export interface TeachingContext {
  node: LearningNode
  breadcrumb: LearningNode[]
  prerequisites: LearningNode[]
  children: LearningNode[]
  siblings: LearningNode[]
  related: LearningNode[]
  sourceExcerpt: string
  sourcePath?: string
  sourceImage?: string
  sourceFingerprint: string
  learningBoard?: LearningBoard
  learningBoardFingerprint?: string
  learningBoardNodes: LearningNode[]
  priorAttempts: TeachingAttempt[]
  currentMastery: LearningMastery
}

export interface TeachingNodeSession {
  activeStage: TeachingStage
  lesson?: TeachingLesson
  lastError?: string
  reviewDueAt?: string
}
