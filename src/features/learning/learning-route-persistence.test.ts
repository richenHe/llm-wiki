import { describe, expect, it } from "vitest"
import { parseLearningRouteSnapshot } from "./learning-route-persistence"

describe("learning route persistence", () => {
  it("loads a valid reviewed route snapshot", () => {
    const result = parseLearningRouteSnapshot(JSON.stringify({
      schemaVersion: 2,
      generatedAt: "2026-08-22T00:00:00.000Z",
      model: "teaching-model",
      status: "ready",
      progress: { processed: 2, total: 2 },
      communities: [{
        key: "biology",
        fingerprint: "abc",
        nodeIds: ["inheritance", "variation"],
        status: "ready",
        boards: [{
          id: "board-1",
          title: "遗传与变异",
          centralQuestion: "亲代信息和后代差异有什么关系？",
          kind: "prerequisite",
          nodeIds: ["inheritance", "variation"],
          orderedNodeIds: ["inheritance", "variation"],
          reason: "后项依赖前项。",
          confidence: 0.9,
          evidence: [
            { nodeId: "inheritance", detail: "亲代传递信息。" },
            { nodeId: "variation", detail: "子代出现差异。" },
          ],
          mnemonic: "先遗传，再看变。",
          mnemonicParts: [
            { nodeId: "inheritance", phrase: "先遗传" },
            { nodeId: "variation", phrase: "再看变" },
          ],
          relations: [{
            sourceId: "inheritance",
            targetId: "variation",
            kind: "prerequisite",
            label: "理解前置",
            evidence: "先理解亲代信息传递，再判断后代差异。",
          }],
        }],
        decisions: [
          { nodeId: "inheritance", status: "linked", boardIds: ["board-1"], reason: "已进入遗传与变异板块。" },
          { nodeId: "variation", status: "linked", boardIds: ["board-1"], reason: "已进入遗传与变异板块。" },
        ],
      }],
    }))

    expect(result?.status).toBe("ready")
    expect(result?.communities[0].boards[0].mnemonic).toBe("先遗传，再看变。")
    expect(result?.communities[0].boards[0].relations[0].label).toBe("理解前置")
  })

  it("marks the whole snapshot stale when any community needs regeneration", () => {
    const result = parseLearningRouteSnapshot(JSON.stringify({
      schemaVersion: 2,
      status: "ready",
      progress: { processed: 0, total: 1 },
      communities: [{ key: "biology", fingerprint: "abc", nodeIds: ["inheritance"], status: "stale", boards: [], decisions: [] }],
    }))

    expect(result?.status).toBe("stale")
  })

  it("does not mark a snapshot ready when the completion count omits a knowledge point", () => {
    const result = parseLearningRouteSnapshot(JSON.stringify({
      schemaVersion: 2,
      status: "ready",
      progress: { processed: 1, total: 1 },
      communities: [{
        key: "biology",
        fingerprint: "abc",
        nodeIds: ["inheritance", "variation"],
        status: "ready",
        boards: [],
        decisions: [
          { nodeId: "inheritance", status: "unlinked", boardIds: [], reason: "证据不足。" },
          { nodeId: "variation", status: "unlinked", boardIds: [], reason: "证据不足。" },
        ],
      }],
    }))

    expect(result?.status).toBe("stale")
  })

  it("rejects unsupported schemas instead of guessing", () => {
    expect(parseLearningRouteSnapshot('{"schemaVersion":3,"communities":[]}')).toBeNull()
    expect(parseLearningRouteSnapshot("not json")).toBeNull()
  })

  it("keeps legacy boards visible while requiring a new exhaustive ledger", () => {
    const result = parseLearningRouteSnapshot(JSON.stringify({
      schemaVersion: 1,
      status: "ready",
      communities: [{
        key: "math",
        fingerprint: "old",
        nodeIds: ["quadratic", "equation", "vertex"],
        status: "ready",
        boards: [{
          id: "old-board",
          title: "二次函数主线",
          centralQuestion: "怎样理解二次函数？",
          kind: "prerequisite",
          nodeIds: ["quadratic", "equation"],
          orderedNodeIds: ["quadratic", "equation"],
          reason: "先函数再方程。",
          confidence: 0.9,
          evidence: [{ nodeId: "quadratic", detail: "函数图象。" }, { nodeId: "equation", detail: "方程根。" }],
          mnemonic: "先函数，再方程。",
          mnemonicParts: [{ nodeId: "quadratic", phrase: "先函数" }, { nodeId: "equation", phrase: "再方程" }],
        }],
      }],
    }))

    expect(result?.status).toBe("stale")
    expect(result?.communities[0].boards).toHaveLength(1)
    expect(result?.communities[0].boards[0].relations[0]).toMatchObject({ sourceId: "quadratic", targetId: "equation", kind: "prerequisite" })
    expect(result?.progress).toEqual({ processed: 2, total: 3 })
  })
})
