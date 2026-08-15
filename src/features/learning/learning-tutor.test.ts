import { describe, expect, it } from "vitest"
import type { LearningNode } from "./learning-data"
import {
  createFallbackLesson,
  defaultLearningGoal,
  inferLearningTargetKind,
  parseEvaluationResponse,
  parseLessonResponse,
} from "./learning-tutor"

function node(overrides: Partial<LearningNode> = {}): LearningNode {
  return {
    id: "servo",
    title: "舵机校准",
    glyph: "舵",
    essence: "通过调整脉冲值确定舵机的安全活动范围。",
    parentId: null,
    prerequisiteIds: [],
    source: "机器人知识库",
    sourceDetail: "/wiki/servo.md",
    capabilities: [],
    mastery: "unseen",
    position: { x: 0, y: 0 },
    semanticType: "concept",
    ...overrides,
  }
}

describe("universal learning tutor", () => {
  it("chooses teaching behavior from the outcome implied by the knowledge, not from a school subject", () => {
    expect(inferLearningTargetKind(node(), "## 校准流程\n先粗调，再细调并记录结果。")).toBe("apply")
    expect(inferLearningTargetKind(node({ title: "Web 端功能实机验证", essence: "根据证据判断功能是否真实可用。" }))).toBe("judge")
    expect(inferLearningTargetKind(node({ title: "反向传播", essence: "利用链式法则计算梯度。" }))).toBe("understand")
    expect(inferLearningTargetKind(node({ title: "Andrej Karpathy", semanticType: "entity", essence: "人工智能研究者。" }))).toBe("remember")
  })

  it("creates a source-grounded fallback when no model is available", () => {
    const lesson = createFallbackLesson(node(), defaultLearningGoal(node(), "apply"), "# 舵机校准\n\n## 校准流程\n先粗调，再细调，最后记录 LOW 和 HIGH。")
    expect(lesson.generatedBy).toBe("fallback")
    expect(lesson.targetKind).toBe("apply")
    expect(lesson.keyPoints.join(" ")).toContain("粗调")
    expect(lesson.verification.successCriteria).toContain("结果可以检查")
  })

  it("accepts a model lesson but keeps required fallback fields", () => {
    const fallback = createFallbackLesson(node(), "独立完成一次校准", "校准要记录结果。")
    const lesson = parseLessonResponse(JSON.stringify({
      targetKind: "apply",
      objective: "独立校准一个新舵机",
      keyPoints: ["先确认机械极限", "逐步调整脉冲"],
      visual: { kind: "mermaid", code: "flowchart LR\nA[粗调] --> B[细调]", caption: "校准流程" },
      practice: { prompt: "记录一次校准", hint: "从中位开始", successCriteria: ["没有机械干涉"] },
      verification: { prompt: "换一个舵机独立完成", successCriteria: ["结果可复查"] },
    }), fallback)
    expect(lesson.generatedBy).toBe("model")
    expect(lesson.visual?.code).toContain("flowchart")
    expect(lesson.diagnosticPrompt).toBe(fallback.diagnosticPrompt)
  })

  it("parses evidence-based evaluation instead of treating long text as mastery", () => {
    const evaluation = parseEvaluationResponse('{"passed":false,"score":58,"feedback":"缺少实际结果。","strengths":["步骤顺序正确"],"gaps":["没有记录数值"],"nextAction":"补充 LOW/HIGH 数值。"}')
    expect(evaluation.passed).toBe(false)
    expect(evaluation.score).toBe(58)
    expect(evaluation.gaps).toEqual(["没有记录数值"])
  })
})
