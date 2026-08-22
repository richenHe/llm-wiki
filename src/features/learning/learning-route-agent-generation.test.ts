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
})
