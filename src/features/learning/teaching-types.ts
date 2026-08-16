import type { LearningMastery, LearningNode } from "./learning-data"

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
  kind: "source" | "mermaid" | "image" | "none"
  title: string
  reason: string
  mermaid?: string
  imagePrompt?: string
  sourceImage?: string
}

export interface TeachingLesson {
  nodeId: string
  sourceFingerprint: string
  essence: string
  explanation: string
  analogy: string
  commonMistake: string
  connections: TeachingConnection[]
  recallQuestion: string
  applicationQuestion: string
  transferQuestion: string
  visual: TeachingVisualBrief
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
  priorAttempts: TeachingAttempt[]
  currentMastery: LearningMastery
}

export interface TeachingNodeSession {
  activeStage: TeachingStage
  lesson?: TeachingLesson
  lastError?: string
  reviewDueAt?: string
}
