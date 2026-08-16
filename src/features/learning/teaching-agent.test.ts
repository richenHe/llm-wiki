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
  priorAttempts: [], currentMastery: "unseen",
}

describe("teaching agent", () => {
  beforeEach(() => { mocks.output = ""; mocks.tasks.length = 0 })

  it("prepares a complete lesson and keeps a source image ahead of generated visuals", async () => {
    mocks.output = JSON.stringify({
      essence: "缓存就是把旧结果先放在手边。", explanation: "系统先找已经算好的结果。", analogy: "像把常用书放在桌面。", commonMistake: "缓存不是永久真相。",
      connections: [{ title: "存储", relation: "related", explanation: "都会保存数据。" }],
      recallQuestion: "缓存是什么？", applicationQuestion: "网页头像没更新怎么办？", transferQuestion: "给出另一个缓存场景。",
      visual: { kind: "image", title: "缓存类比", reason: "帮助理解", imagePrompt: "桌面上的常用书" },
    })
    const lesson = await prepareTeachingLesson(context)
    expect(mocks.tasks).toEqual(["learn"])
    expect(lesson.visual.kind).toBe("source")
    expect(lesson.recallQuestion).toContain("缓存")
  })

  it("uses the independent judge route and preserves missing points", async () => {
    mocks.output = JSON.stringify({ verdict: "partial", feedback: "说到了复用，但没有说失效。", strengths: ["提到复用"], missingPoints: ["失效条件"], evidence: ["缓存需要更新"], nextAction: "补充何时失效", passedRecall: false, passedApplication: false, unresolvedCoreMisconception: true })
    const result = await evaluateTeachingAnswer({ context, question: "缓存是什么？", answer: "复用旧结果", kind: "recall" })
    expect(mocks.tasks).toEqual(["judge"])
    expect(result.verdict).toBe("partial")
    expect(result.missingPoints).toEqual(["失效条件"])
  })

  it("rejects prose that cannot be checked instead of pretending the lesson succeeded", async () => {
    mocks.output = "这里是一段普通回答，没有约定的数据结构。"
    await expect(prepareTeachingLesson(context)).rejects.toThrow("没有返回可读取的教学结果")
    expect(mocks.tasks).toEqual(["learn", "learn"])
  })
})
