import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  responses: [] as Array<Record<string, unknown> | ((messages: Array<{ content: string }>) => Record<string, unknown>)>,
  calls: 0,
}))

vi.mock("@/lib/llm-client", () => ({
  streamChat: (_config: unknown, messages: Array<{ content: string }>, callbacks: { onToken: (token: string) => void; onDone: () => void; onError: (error: Error) => void }) => {
    mocks.calls++
    const next = mocks.responses.shift()
    queueMicrotask(() => {
      if (!next) {
        callbacks.onError(new Error("missing mock response"))
        return
      }
      const response = typeof next === "function" ? next(messages) : next
      callbacks.onToken(JSON.stringify(response))
      callbacks.onDone()
    })
    return Promise.resolve()
  },
}))

import { generateReviewedLearningBoards, type LearningRouteCandidate } from "./learning-route-agent"

const CANDIDATES: LearningRouteCandidate[] = [
  { id: "quadratic", title: "二次函数", semanticType: "concept", summary: "图象是抛物线。", sourcePath: "二次函数.md", outline: [], neighborIds: [], content: "二次函数图象与横轴交点对应方程根。" },
  { id: "equation", title: "二次函数与一元二次方程", semanticType: "concept", summary: "交点横坐标是方程根。", sourcePath: "方程.md", outline: [], neighborIds: [], content: "利用二次函数图象可以判断一元二次方程实数根。" },
]

const PROPOSAL = {
  title: "二次函数与方程根",
  centralQuestion: "怎样由二次函数图象理解方程根？",
  kind: "prerequisite",
  nodeIds: ["quadratic", "equation"],
  orderedNodeIds: ["quadratic", "equation"],
  reason: "先理解二次函数图象，再由横轴交点判断方程根。",
  confidence: 0.92,
}

describe("learning route exhaustive AI processing", () => {
  beforeEach(() => {
    mocks.responses = []
    mocks.calls = 0
  })

  it("retries an incomplete node ledger and only completes after every proposal is audited", async () => {
    mocks.responses.push(
      { boards: [PROPOSAL], decisions: [{ nodeId: "quadratic", status: "proposed", reason: "进入候选。" }] },
      {
        boards: [PROPOSAL],
        decisions: [
          { nodeId: "quadratic", status: "proposed", reason: "提供函数图象基础。" },
          { nodeId: "equation", status: "proposed", reason: "依赖图象交点解释方程根。" },
        ],
      },
      (messages) => {
        const user = messages[messages.length - 1].content
        const serialized = user.match(/候选板块：\n([\s\S]*?)\n\n对应知识详情/)?.[1] ?? "[]"
        const proposalId = (JSON.parse(serialized) as Array<{ proposalId: string }>)[0].proposalId
        return {
          reviews: [{
            proposalId,
            approved: true,
            ...PROPOSAL,
            evidence: [
              { nodeId: "quadratic", detail: "图象与横轴交点对应方程根。" },
              { nodeId: "equation", detail: "利用交点判断实数根。" },
            ],
            relations: [{ sourceId: "quadratic", targetId: "equation", kind: "prerequisite", label: "理解前置", evidence: "先理解函数图象，再由交点判断方程根。" }],
            mnemonic: "先画二次线，再从交点看方程。",
            mnemonicParts: [
              { nodeId: "quadratic", phrase: "先画二次线" },
              { nodeId: "equation", phrase: "再从交点看方程" },
            ],
          }],
        }
      },
    )

    const result = await generateReviewedLearningBoards({
      candidates: CANDIDATES,
      config: { provider: "openai", apiKey: "test", model: "test-model", ollamaUrl: "", customEndpoint: "", maxContextSize: 32_768 },
    })

    expect(mocks.calls).toBe(3)
    expect(result.boards).toHaveLength(1)
    expect(result.decisions).toEqual([
      expect.objectContaining({ nodeId: "quadratic", status: "linked" }),
      expect.objectContaining({ nodeId: "equation", status: "linked" }),
    ])
  })

  it("falls back to one-by-one audits when a multi-board audit keeps omitting results", async () => {
    const candidates: LearningRouteCandidate[] = Array.from({ length: 6 }, (_, index) => ({
      id: `node-${index}`,
      title: `知识${index}`,
      semanticType: "concept",
      summary: `知识${index}摘要`,
      sourcePath: `知识${index}.md`,
      outline: [],
      neighborIds: [],
      content: `知识${index}详情`,
    }))
    const proposals = [0, 2, 4].map((index) => ({
      title: `板块${index / 2 + 1}`,
      centralQuestion: `知识${index}和知识${index + 1}有什么共同点？`,
      kind: "category",
      nodeIds: [`node-${index}`, `node-${index + 1}`],
      orderedNodeIds: [`node-${index}`, `node-${index + 1}`],
      reason: "使用同一分类标准的并列项。",
      confidence: 0.9,
    }))
    const completeSingleReview = (messages: Array<{ content: string }>) => {
      const user = messages[messages.length - 1].content
      const serialized = user.match(/候选板块：\n([\s\S]*?)\n\n对应知识详情/)?.[1] ?? "[]"
      const proposal = (JSON.parse(serialized) as Array<Record<string, unknown>>)[0]
      const nodeIds = proposal.nodeIds as string[]
      return {
        reviews: [{
          ...proposal,
          approved: true,
          evidence: nodeIds.map((nodeId) => ({ nodeId, detail: `${nodeId}的详情支持这一并列关系。` })),
          relations: [{ sourceId: nodeIds[0], targetId: nodeIds[1], kind: "connection", label: "同类并列", evidence: "两项使用同一分类标准。" }],
          mnemonic: nodeIds.join("并"),
          mnemonicParts: nodeIds.map((nodeId) => ({ nodeId, phrase: nodeId })),
        }],
      }
    }
    mocks.responses.push(
      {
        boards: proposals,
        decisions: candidates.map((candidate) => ({ nodeId: candidate.id, status: "proposed", reason: "进入候选板块。" })),
      },
      { reviews: [] },
      { reviews: [] },
      completeSingleReview,
      completeSingleReview,
      completeSingleReview,
    )

    const result = await generateReviewedLearningBoards({
      candidates,
      config: { provider: "openai", apiKey: "test", model: "test-model", ollamaUrl: "", customEndpoint: "", maxContextSize: 32_768 },
    })

    expect(mocks.calls).toBe(6)
    expect(result.boards).toHaveLength(3)
    expect(result.decisions.every((decision) => decision.status === "linked")).toBe(true)
  })
})
