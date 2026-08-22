import { beforeEach, describe, expect, it, vi } from "vitest"
import type { TeachingContext } from "./teaching-types"

const mocks = vi.hoisted(() => ({ output: "", tasks: [] as string[] }))

vi.mock("@/lib/llm-task-routing", () => ({
  getTaskLlmConfig: (task: string) => {
    mocks.tasks.push(task)
    return { provider: "openai", apiKey: "test", model: "test", ollamaUrl: "", customEndpoint: "" }
  },
}))

vi.mock("@/lib/llm-client", () => ({
  streamChat: async (_config: unknown, _messages: unknown, callbacks: { onToken: (value: string) => void; onDone: () => void }) => {
    callbacks.onToken(mocks.output)
    callbacks.onDone()
  },
}))

import { evaluateTeachingAnswer, prepareTeachingLesson } from "./teaching-agent"

const context: TeachingContext = {
  node: { id: "cache", title: "缓存", glyph: "缓", essence: "暂时保存结果以便复用。", parentId: null, prerequisiteIds: [], source: "测试", sourceDetail: "cache.md", capabilities: [], mastery: "unseen", position: { x: 0, y: 0 } },
  breadcrumb: [], prerequisites: [], children: [], siblings: [], related: [],
  sourceExcerpt: "缓存会暂时保存已经得到的结果。",
  sourceFingerprint: "abc",
  sourceImage: "C:/project/wiki/media/cache.png",
  learningBoard: {
    id: "storage",
    title: "结果保存方式",
    centralQuestion: "系统怎样保留已经得到的结果？",
    kind: "category",
    nodeIds: ["cache", "storage"],
    orderedNodeIds: [],
    reason: "两者都是保存结果的方式。",
    evidence: [],
    confidence: 0.95,
    mnemonic: "缓存重在临时复用，存储重在长期保留。",
    mnemonicParts: [],
  },
  learningBoardFingerprint: "board-abc",
  learningBoardNodes: [
    { id: "cache", title: "缓存", glyph: "缓", essence: "暂时保存结果以便复用。", parentId: null, prerequisiteIds: [], source: "测试", sourceDetail: "cache.md", capabilities: [], mastery: "unseen", position: { x: 0, y: 0 } },
    { id: "storage", title: "存储", glyph: "存", essence: "长期保存数据。", parentId: null, prerequisiteIds: [], source: "测试", sourceDetail: "storage.md", capabilities: [], mastery: "unseen", position: { x: 0, y: 0 } },
  ],
  priorAttempts: [], currentMastery: "unseen",
}

describe("teaching agent", () => {
  beforeEach(() => { mocks.output = ""; mocks.tasks.length = 0 })

  it("prepares one simple lesson with concept and relationship image rules", async () => {
    mocks.output = JSON.stringify({
      essence: "缓存就是把旧结果先放在手边。",
      relationshipExplanation: "缓存和存储是回答同一问题的两种并列方式，没有先后顺序。",
      explanation: "系统先找已经算好的结果。",
      mechanism: "命中旧结果时就不用重复计算。",
      example: "网页复用已经下载的头像。",
      counterexample: "数据库长期保存原始订单，不是缓存。",
      checkQuestion: "缓存与存储是什么关系，缓存为什么能加快访问？",
      conceptVisual: { kind: "image", form: "真实场景图", focus: "旧结果被再次取用", reason: "帮助看出复用" },
      relationshipVisual: { focus: "缓存与存储并列", reason: "看清二者区别" },
    })
    const lesson = await prepareTeachingLesson(context)
    expect(mocks.tasks).toEqual(["learn"])
    expect(lesson.schemaVersion).toBe(3)
    expect(lesson.conceptVisual.imagePrompt).toContain("生物结构用形象、准确的结构示意")
    expect(lesson.relationshipVisual.imagePrompt).toContain("同类并列关系")
    expect(lesson.relationshipVisual.imagePrompt).toContain("不画先后箭头")
    expect(lesson.checkQuestion).toContain("缓存")
  })

  it("uses the independent judge route and preserves missing points", async () => {
    mocks.output = JSON.stringify({ verdict: "partial", feedback: "说到了复用，但没有说失效。", strengths: ["提到复用"], missingPoints: ["失效条件"], evidence: ["缓存需要更新"], nextAction: "补充何时失效", passedRecall: false, passedApplication: false, unresolvedCoreMisconception: true })
    const result = await evaluateTeachingAnswer({ context, question: "缓存是什么？", answer: "复用旧结果", kind: "recall" })
    expect(mocks.tasks).toEqual(["judge"])
    expect(result.verdict).toBe("partial")
    expect(result.missingPoints).toEqual(["失效条件"])
  })

  it("keeps every visible teaching section concise even when the model writes too much", async () => {
    const longText = "这是第一句核心说明。".repeat(20)
    mocks.output = JSON.stringify({
      essence: longText,
      relationshipExplanation: longText,
      explanation: longText,
      mechanism: longText,
      example: longText,
      counterexample: longText,
      checkQuestion: longText,
      conceptVisual: { kind: "none", reason: "不适合画图" },
      relationshipVisual: { focus: "并列关系" },
    })
    const lesson = await prepareTeachingLesson({ ...context, learningBoard: undefined, learningBoardFingerprint: undefined, learningBoardNodes: [] })
    expect(Array.from(lesson.essence).length).toBeLessThanOrEqual(36)
    expect(Array.from(lesson.explanation).length).toBeLessThanOrEqual(90)
    expect(Array.from(lesson.mechanism).length).toBeLessThanOrEqual(70)
    expect(Array.from(lesson.example).length).toBeLessThanOrEqual(70)
    expect(Array.from(lesson.counterexample).length).toBeLessThanOrEqual(70)
    expect(Array.from(lesson.relationshipExplanation).length).toBeLessThanOrEqual(80)
    expect(Array.from(lesson.checkQuestion).length).toBeLessThanOrEqual(60)
    expect(lesson.relationshipVisual.kind).toBe("none")
  })

  it("rejects prose that cannot be checked instead of pretending the lesson succeeded", async () => {
    mocks.output = "这里是一段普通回答，没有约定的数据结构。"
    await expect(prepareTeachingLesson(context)).rejects.toThrow("没有返回可读取的教学结果")
    expect(mocks.tasks).toEqual(["learn", "learn"])
  })
})
