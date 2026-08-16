import { beforeEach, describe, expect, it } from "vitest"
import { deriveMastery, useLearningStore } from "./learning-store"
import type { TeachingAttempt, TeachingEvaluation, TeachingQuestionKind } from "./teaching-types"

const correct: TeachingEvaluation = {
  verdict: "correct",
  feedback: "回答覆盖了关键点。",
  strengths: ["关键关系正确"],
  missingPoints: [],
  evidence: ["来源内容支持该结论"],
  nextAction: "继续应用",
  passedRecall: true,
  passedApplication: false,
  unresolvedCoreMisconception: false,
}

function attempt(kind: TeachingQuestionKind, evaluation: TeachingEvaluation = correct): TeachingAttempt {
  return { id: crypto.randomUUID(), nodeId: "acceleration", question: "测试题", answer: "测试答案", kind, evaluation, assisted: false, createdAt: "2026-08-16T00:00:00.000Z" }
}

describe("learning store", () => {
  beforeEach(() => useLearningStore.getState().resetProject())

  it("keeps project progress isolated during hydration", () => {
    useLearningStore.getState().hydrate("C:/project-a", {
      schemaVersion: 3,
      selectedNodeId: "velocity",
      masteryByNode: { velocity: "mastered" },
      attempts: [],
      sessionsByNode: {},
      updatedAt: "2026-08-04T00:00:00.000Z",
    })
    expect(useLearningStore.getState().selectedNodeId).toBe("velocity")
    useLearningStore.getState().hydrate("C:/project-b", null)
    expect(useLearningStore.getState().masteryByNode).toEqual({})
  })

  it("does not mark mastery from length or a single recall answer", () => {
    useLearningStore.getState().recordAttempt(attempt("recall"))
    expect(useLearningStore.getState().masteryByNode.acceleration).toBe("learning")
  })

  it("requires both unassisted recall and application for current mastery", () => {
    const application = attempt("application", { ...correct, passedRecall: false, passedApplication: true })
    expect(deriveMastery([attempt("recall"), application])).toBe("mastered")
  })

  it("only consolidates after a correct review", () => {
    const review = attempt("review", { ...correct, passedApplication: true })
    expect(deriveMastery([review], "mastered")).toBe("consolidated")
    expect(deriveMastery([review], "learning")).toBe("learning")
  })

  it("keeps a core misconception from passing the gate", () => {
    const mistaken = attempt("application", { ...correct, verdict: "partial", passedApplication: false, unresolvedCoreMisconception: true })
    expect(deriveMastery([attempt("recall"), mistaken])).toBe("learning")
  })

  it("does not consolidate an early review before its due date", () => {
    const store = useLearningStore.getState()
    store.recordAttempt(attempt("recall"))
    store.recordAttempt(attempt("application", { ...correct, passedRecall: false, passedApplication: true }))
    expect(useLearningStore.getState().masteryByNode.acceleration).toBe("mastered")
    const earlyReview = { ...attempt("review", { ...correct, passedApplication: true }), createdAt: "2026-08-17T00:00:00.000Z" }
    useLearningStore.getState().recordAttempt(earlyReview)
    expect(useLearningStore.getState().masteryByNode.acceleration).toBe("mastered")
  })
})
