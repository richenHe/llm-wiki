import { beforeEach, describe, expect, it } from "vitest"
import { useLearningStore } from "./learning-store"

describe("learning store", () => {
  beforeEach(() => useLearningStore.getState().resetProject())

  it("keeps project progress isolated during hydration", () => {
    useLearningStore.getState().hydrate("C:/project-a", {
      schemaVersion: 3,
      selectedNodeId: "velocity",
      masteryByNode: { velocity: "mastered" },
      attempts: [],
      goalsByNode: { velocity: "能解释速度并分析新图像" },
      lessonCache: {},
      updatedAt: "2026-08-04T00:00:00.000Z",
    })
    expect(useLearningStore.getState().selectedNodeId).toBe("velocity")
    useLearningStore.getState().hydrate("C:/project-b", null)
    const state = useLearningStore.getState()
    expect(state.hydratedProjectPath).toBe("C:/project-b")
    expect(state.selectedNodeId).toBe("acceleration")
    expect(state.masteryByNode).toEqual({})
    expect(state.goalsByNode).toEqual({})
  })

  it("records evidence by learning stage instead of answer length", () => {
    const state = useLearningStore.getState()
    expect(state.recordAttempt({ answer: "不知道", kind: "diagnostic" })).toBe(true)
    expect(useLearningStore.getState().masteryByNode.acceleration).toBe("started")

    expect(useLearningStore.getState().recordAttempt({ answer: "完成了一次操作并记录了结果", kind: "guided-practice", passed: null })).toBe(true)
    expect(useLearningStore.getState().masteryByNode.acceleration).toBe("practiced")

    expect(useLearningStore.getState().recordAttempt({ answer: "换了一个条件仍然独立完成", kind: "verification", passed: true, score: 86 })).toBe(true)
    expect(useLearningStore.getState().masteryByNode.acceleration).toBe("mastered")
    expect(useLearningStore.getState().attempts.map((attempt) => attempt.kind)).toEqual(["diagnostic", "guided-practice", "verification"])
  })

  it("does not mark an unverified or failed answer as mastered", () => {
    useLearningStore.getState().recordAttempt({ answer: "我提交了验证回答", kind: "verification", passed: null })
    expect(useLearningStore.getState().masteryByNode.acceleration).toBe("practiced")
    useLearningStore.getState().recordAttempt({ answer: "第二次回答仍有缺口", kind: "verification", passed: false, score: 55 })
    expect(useLearningStore.getState().masteryByNode.acceleration).toBe("practiced")
  })

  it("never downgrades a mastered concept after another practice", () => {
    useLearningStore.getState().hydrate("C:/project-a", {
      schemaVersion: 3,
      selectedNodeId: "acceleration",
      masteryByNode: { acceleration: "mastered" },
      attempts: [],
      goalsByNode: {},
      lessonCache: {},
      updatedAt: "2026-08-04T00:00:00.000Z",
    })
    useLearningStore.getState().recordAttempt({ answer: "再次练习", kind: "guided-practice", passed: false })
    expect(useLearningStore.getState().masteryByNode.acceleration).toBe("mastered")
  })

  it("does not downgrade the knowledge base's existing understanding during diagnosis", () => {
    useLearningStore.setState({ masteryByNode: { acceleration: "started" } })
    useLearningStore.getState().recordAttempt({
      answer: "我还不确定一个细节",
      kind: "diagnostic",
      baselineMastery: "understood",
    })
    expect(useLearningStore.getState().masteryByNode.acceleration).toBe("understood")
  })
})
