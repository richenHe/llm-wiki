import { describe, expect, it } from "vitest"
import { findBestLearningBoard, type LearningRouteSnapshot } from "./learning-routes"

describe("learning board selection", () => {
  it("prefers the strongest reviewed board for the hovered knowledge point", () => {
    const snapshot: LearningRouteSnapshot = {
      schemaVersion: 2,
      generatedAt: "2026-08-22T00:00:00.000Z",
      model: "test",
      status: "ready",
      progress: { processed: 3, total: 3 },
      communities: [{
        key: "bio",
        fingerprint: "abc",
        nodeIds: ["inheritance", "variation", "health"],
        status: "ready",
        boards: [
          { id: "wide", title: "宽板块", centralQuestion: "?", kind: "category", nodeIds: ["variation", "health", "evolution"], orderedNodeIds: ["variation", "health", "evolution"], reason: "test", evidence: [], confidence: 0.8, mnemonic: "test", mnemonicParts: [], relations: [] },
          { id: "focused", title: "遗传与变异", centralQuestion: "?", kind: "prerequisite", nodeIds: ["inheritance", "variation"], orderedNodeIds: ["inheritance", "variation"], reason: "test", evidence: [], confidence: 0.93, mnemonic: "test", mnemonicParts: [], relations: [] },
        ],
        decisions: [
          { nodeId: "inheritance", status: "linked", boardIds: ["focused"], reason: "test" },
          { nodeId: "variation", status: "linked", boardIds: ["wide", "focused"], reason: "test" },
          { nodeId: "health", status: "linked", boardIds: ["wide"], reason: "test" },
        ],
      }],
    }

    expect(findBestLearningBoard(snapshot, "variation")?.id).toBe("focused")
    expect(findBestLearningBoard(snapshot, "unknown")).toBeNull()
  })
})
