import { beforeEach, describe, expect, it } from "vitest"
import { useLearningStore } from "./learning-store"

describe("learning store", () => {
  beforeEach(() => useLearningStore.getState().resetProject())

  it("keeps project progress isolated during hydration", () => {
    useLearningStore.getState().hydrate("C:/project-a", {
      schemaVersion: 2,
      selectedNodeId: "velocity",
      masteryByNode: { velocity: "mastered" },
      attempts: [],
      updatedAt: "2026-08-04T00:00:00.000Z",
    })
    expect(useLearningStore.getState().selectedNodeId).toBe("velocity")
    useLearningStore.getState().hydrate("C:/project-b", null)
    const state = useLearningStore.getState()
    expect(state.hydratedProjectPath).toBe("C:/project-b")
    expect(state.selectedNodeId).toBe("acceleration")
    expect(state.masteryByNode).toEqual({})
  })

  it("requires a meaningful answer before recording practice", () => {
    useLearningStore.getState().setLessonAnswer("太短")
    useLearningStore.getState().submitLesson()
    expect(useLearningStore.getState().lessonSubmitted).toBe(false)
    useLearningStore.getState().setLessonAnswer("加速度表示速度随时间变化的快慢")
    useLearningStore.getState().submitLesson()
    expect(useLearningStore.getState().lessonSubmitted).toBe(true)
    expect(useLearningStore.getState().masteryByNode.acceleration).toBe("practiced")
    expect(useLearningStore.getState().attempts[0]?.answer).toBe("加速度表示速度随时间变化的快慢")
  })

  it("never downgrades a mastered concept after another practice", () => {
    useLearningStore.getState().hydrate("C:/project-a", {
      schemaVersion: 2,
      selectedNodeId: "acceleration",
      masteryByNode: { acceleration: "mastered" },
      attempts: [],
      updatedAt: "2026-08-04T00:00:00.000Z",
    })
    useLearningStore.getState().setLessonAnswer("我用一个完整解释再次复习这个知识点")
    useLearningStore.getState().submitLesson()
    expect(useLearningStore.getState().masteryByNode.acceleration).toBe("mastered")
  })
})
