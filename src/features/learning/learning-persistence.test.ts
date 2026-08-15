import { describe, expect, it } from "vitest"
import { parseLearningProgressSnapshot } from "./learning-persistence"

describe("learning progress migration", () => {
  it("keeps old self-explanation records while adding goals and lesson cache", () => {
    const snapshot = parseLearningProgressSnapshot(JSON.stringify({
      schemaVersion: 2,
      selectedNodeId: "velocity",
      masteryByNode: { velocity: "practiced" },
      attempts: [{ nodeId: "velocity", answer: "速度包含方向", createdAt: "2026-08-04T00:00:00.000Z", kind: "self-explanation" }],
      updatedAt: "2026-08-04T00:00:00.000Z",
    }))
    expect(snapshot?.schemaVersion).toBe(3)
    expect(snapshot?.attempts[0]?.kind).toBe("self-explanation")
    expect(snapshot?.goalsByNode).toEqual({})
    expect(snapshot?.lessonCache).toEqual({})
  })
})
