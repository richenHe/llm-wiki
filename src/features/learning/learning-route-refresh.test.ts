import { beforeEach, describe, expect, it, vi } from "vitest"
import { useWikiStore } from "@/stores/wiki-store"
import type { LearningBoard, LearningRouteSnapshot } from "./learning-routes"

const mocks = vi.hoisted(() => ({
  contentSuffix: "v1",
  snapshot: null as LearningRouteSnapshot | null,
  generate: vi.fn(),
  save: vi.fn(),
}))

vi.mock("@/commands/fs", () => ({
  readFile: vi.fn(async (path: string) => `${path}:${mocks.contentSuffix}`),
}))

vi.mock("@/lib/has-usable-llm", () => ({ hasUsableLlm: () => true }))
vi.mock("@/lib/llm-task-routing", () => ({
  getTaskLlmConfig: () => ({ provider: "openai", apiKey: "key", model: "route-model" }),
}))
vi.mock("@/lib/wiki-graph", () => ({
  buildWikiGraph: vi.fn(async () => ({
    nodes: [
      { id: "inheritance", label: "遗传", type: "concept", path: "D:/kb/wiki/遗传.md", linkCount: 1, community: 0, summary: "亲代向子代传递遗传信息。", outline: [] },
      { id: "variation", label: "变异", type: "concept", path: "D:/kb/wiki/变异.md", linkCount: 1, community: 0, summary: "亲子及个体间存在差异。", outline: [] },
    ],
    edges: [{ source: "inheritance", target: "variation", weight: 1 }],
    communities: [],
  })),
}))
vi.mock("./learning-route-agent", () => ({
  generateReviewedLearningBoards: (...args: unknown[]) => mocks.generate(...args),
}))
vi.mock("./learning-route-persistence", () => ({
  loadLearningRouteSnapshot: vi.fn(async () => mocks.snapshot),
  saveLearningRouteSnapshot: vi.fn(async (_path: string, snapshot: LearningRouteSnapshot) => {
    mocks.snapshot = snapshot
    mocks.save(snapshot)
  }),
}))

import { refreshLearningRoutes } from "./learning-route-refresh"

const BOARD: LearningBoard = {
  id: "genetics",
  title: "遗传与变异",
  centralQuestion: "亲代信息与后代差异有什么关系？",
  kind: "prerequisite",
  nodeIds: ["inheritance", "variation"],
  orderedNodeIds: ["inheritance", "variation"],
  reason: "先理解遗传，才能判断亲子差异。",
  evidence: [
    { nodeId: "inheritance", detail: "亲代传递信息。" },
    { nodeId: "variation", detail: "个体间存在差异。" },
  ],
  confidence: 0.9,
  mnemonic: "先遗传，再看变。",
  mnemonicParts: [
    { nodeId: "inheritance", phrase: "先遗传" },
    { nodeId: "variation", phrase: "再看变" },
  ],
}

const DECISIONS = [
  { nodeId: "inheritance", status: "linked" as const, boardIds: ["genetics"], reason: "已进入遗传与变异板块。" },
  { nodeId: "variation", status: "linked" as const, boardIds: ["genetics"], reason: "已进入遗传与变异板块。" },
]

describe("learning route refresh", () => {
  beforeEach(() => {
    mocks.contentSuffix = "v1"
    mocks.snapshot = null
    mocks.generate.mockReset().mockResolvedValue({ boards: [BOARD], decisions: DECISIONS })
    mocks.save.mockReset()
    useWikiStore.setState({ project: { id: "project-1", name: "知识库", path: "D:/kb" } })
  })

  it("reuses a persisted community when its full knowledge content is unchanged", async () => {
    await refreshLearningRoutes({ id: "project-1", path: "D:/kb" })
    await refreshLearningRoutes({ id: "project-1", path: "D:/kb" })

    expect(mocks.generate).toHaveBeenCalledTimes(1)
    expect(mocks.snapshot?.status).toBe("ready")
    expect(mocks.snapshot?.communities[0].boards[0].id).toBe("genetics")
  })

  it("persists a usable partial result before marking the full refresh ready", async () => {
    await refreshLearningRoutes({ id: "project-1", path: "D:/kb" })

    expect(mocks.save).toHaveBeenCalledTimes(2)
    expect(mocks.save.mock.calls[0][0].status).toBe("processing")
    expect(mocks.save.mock.calls[0][0].progress).toEqual({ processed: 2, total: 2 })
    expect(mocks.save.mock.calls[0][0].communities[0].boards).toEqual([BOARD])
    expect(mocks.save.mock.calls[1][0].status).toBe("ready")
  })

  it("regenerates a changed community and preserves its old board if AI fails", async () => {
    await refreshLearningRoutes({ id: "project-1", path: "D:/kb" })
    mocks.contentSuffix = "v2"
    mocks.generate.mockRejectedValueOnce(new Error("model unavailable"))

    const result = await refreshLearningRoutes({ id: "project-1", path: "D:/kb" })

    expect(mocks.generate).toHaveBeenCalledTimes(2)
    expect(result.status).toBe("stale")
    expect(result.communities[0].boards).toEqual([BOARD])
    expect(result.communities[0].lastError).toContain("model unavailable")
  })
})
