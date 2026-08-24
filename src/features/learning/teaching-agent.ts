import { streamChat, type ChatMessage } from "@/lib/llm-client"
import { getTaskLlmConfig } from "@/lib/llm-task-routing"
import type { TeachingContext, TeachingEvaluation, TeachingLesson, TeachingQuestionKind, TeachingVisualBrief } from "./teaching-types"

function compactNode(node: TeachingContext["node"]): string {
  return `${node.title}：${node.essence}`
}

function contextText(context: TeachingContext): string {
  const board = context.learningBoard
  const boardText = board ? [
    `已审核串联板块：${board.title}（${board.kind === "category" ? "同类知识" : board.kind === "process" ? "同一流程" : "学习前置顺序"}）`,
    `板块核心问题：${board.centralQuestion}`,
    `板块知识：${context.learningBoardNodes.map(compactNode).join(board.kind === "category" ? " · " : " → ")}`,
    `归类理由：${board.reason}`,
    `节点依据：${board.evidence.map((item) => `${context.learningBoardNodes.find((node) => node.id === item.nodeId)?.title ?? item.nodeId}：${item.detail}`).join("；")}`,
    `审核关系：${board.relations.map((relation) => `${context.learningBoardNodes.find((node) => node.id === relation.sourceId)?.title ?? relation.sourceId}—${relation.label}—${context.learningBoardNodes.find((node) => node.id === relation.targetId)?.title ?? relation.targetId}`).join("；") || "旧版串联尚无逐条关系"}`,
    `顺口溜：${board.mnemonic}`,
    `精华句对应：${board.mnemonicParts.map((item) => `${item.nodeId}：${item.phrase}`).join("；")}`,
  ].join("\n") : "当前知识尚未进入证据充分的串联板块；不要为了建立关系而强行关联。"
  return [
    `当前知识：${compactNode(context.node)}`,
    boardText,
    `来源内容：\n${context.sourceExcerpt}`,
  ].join("\n\n")
}

function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]
  const candidate = (fenced ?? text).trim()
  const start = candidate.indexOf("{")
  const end = candidate.lastIndexOf("}")
  if (start < 0 || end <= start) throw new Error("模型没有返回可读取的教学结果。")
  return JSON.parse(candidate.slice(start, end + 1))
}

function stringValue(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`教学结果缺少“${field}”。`)
  return value.trim()
}

function conciseStringValue(value: unknown, field: string, maxChars: number): string {
  const text = stringValue(value, field)
  if (Array.from(text).length <= maxChars) return text
  const sentences = text.match(/[^。！？!?]+[。！？!?]?/g) ?? []
  let result = ""
  for (const sentence of sentences) {
    if (Array.from(result + sentence).length > maxChars) break
    result += sentence
  }
  if (result.trim()) return result.trim()
  return `${Array.from(text).slice(0, Math.max(1, maxChars - 1)).join("").trimEnd()}…`
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).map((item) => item.trim()).slice(0, 8) : []
}

function parseVisual(value: unknown, field: string, cacheFingerprint: string): TeachingVisualBrief {
  const visual = value && typeof value === "object" ? value as Record<string, unknown> : {}
  const focus = typeof visual.focus === "string" ? visual.focus.trim() : ""
  const form = typeof visual.form === "string" ? visual.form.trim() : "形象图"
  const kind = visual.kind === "image" && focus ? "image" : "none"
  const generatedPrompt = `核心画面：${focus}。视觉形式：${form}。`
  const imagePrompt = kind === "image" ? generatedPrompt : undefined
  return {
    kind,
    title: typeof visual.title === "string" && visual.title.trim() ? visual.title.trim() : field,
    reason: typeof visual.reason === "string" && visual.reason.trim() ? visual.reason.trim() : `帮助理解${field}。`,
    imagePrompt,
    cacheFingerprint,
  }
}

function callTeachingModel(task: "learn" | "judge", messages: ChatMessage[], signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    let result = ""
    let settled = false
    streamChat(getTaskLlmConfig(task), messages, {
      onToken: (token) => { result += token },
      onDone: () => {
        if (settled) return
        settled = true
        result.trim() ? resolve(result) : reject(new Error("教学模型没有返回内容。"))
      },
      onError: (error) => {
        if (settled) return
        settled = true
        reject(error)
      },
    }, signal, { temperature: 0.2, max_tokens: 1600 })
  })
}

function parseLesson(raw: string, context: TeachingContext): TeachingLesson {
  const value = extractJson(raw) as Record<string, unknown>
  return {
    schemaVersion: 3,
    nodeId: context.node.id,
    sourceFingerprint: context.sourceFingerprint,
    essence: conciseStringValue(value.essence, "一句精华", 36),
    explanation: conciseStringValue(value.explanation, "通俗解释", 90),
    mechanism: conciseStringValue(value.mechanism, "核心机制", 70),
    example: conciseStringValue(value.example, "正例", 70),
    counterexample: conciseStringValue(value.counterexample, "反例或边界", 70),
    relationshipExplanation: conciseStringValue(value.relationshipExplanation, "串联关系说明", 80),
    checkQuestion: conciseStringValue(value.checkQuestion, "检查题", 60),
    conceptVisual: parseVisual(value.conceptVisual, "概念形象图", `${context.sourceFingerprint}-concept-minimal-visual-v5`),
    relationshipVisual: {
      kind: "none",
      title: "知识关系",
      reason: "知识关系由已审核精华串直接展示，不重复生成文字图片。",
      cacheFingerprint: `${context.learningBoardFingerprint ?? context.sourceFingerprint}-relationship-disabled-v1`,
    },
    preparedAt: new Date().toISOString(),
  }
}

export async function prepareTeachingLesson(context: TeachingContext, signal?: AbortSignal): Promise<TeachingLesson> {
  const messages: ChatMessage[] = [
    { role: "system", content: `你是个人知识库中的讲解老师，目标是用最少的话让普通学习者准确看懂。只能依据来源和已审核精华串；资料不足要直说，不能补造。不要重复知识目录位置或已有前置基础。

严格控制长度：essence 不超过 36 个汉字；explanation 不超过 90 个汉字，只说“是什么”；mechanism 不超过 70 个汉字，只说“为什么”；example 和 counterexample 各不超过 70 个汉字且只给一个；relationshipExplanation 不超过 80 个汉字；checkQuestion 不超过 60 个汉字。每项先说结论，不写开场、总结或重复句。

category 是并列，绝不能写成先后；process 才是实际顺序；prerequisite 只是理解依赖。没有已审核精华串时，relationshipExplanation 只写“暂无可靠知识关联”，不要臆造关系。只允许生成一张帮助看见概念的极简形象图片。conceptVisual.focus 不超过 45 个汉字，只写能够直接画出来的必要对象及其关系，不写知识名称、定义、解释、文字内容或装饰。例如并联电路写“一节电池分出两条独立支路，每条支路各连接一只点亮的灯泡”。删除后仍不影响识别概念的对象一律不要写。生物用一个结构或生命现象，物理和化学用最少的物体、装置或变化，数学用一组曲线、形状或空间数量关系；无法脱离文字表达的概念选择 none。知识关系只用精华串展示，不生成关系图片。不要安排回忆、迁移、复习或延迟任务。

返回且只返回 JSON：{"essence":"一句最短本质","relationshipExplanation":"精华串关系和当前知识的作用","explanation":"是什么","mechanism":"为什么","example":"一个正例","counterexample":"一个反例及不成立原因","checkQuestion":"一道轻量检验题","conceptVisual":{"kind":"image|none","title":"概念形象图","form":"形象结构图|现象场景图|过程变化图|空间关系图|对比图|数量关系图","focus":"不靠文字也必须看出的关键点","reason":"为什么适合或不适合用形象图"}}。` },
    { role: "user", content: contextText(context) },
  ]
  const raw = await callTeachingModel("learn", messages, signal)
  try {
    return parseLesson(raw, context)
  } catch (error) {
    const repaired = await callTeachingModel("learn", [
      { role: "system", content: "把下面的教学结果修正成上一次要求的合法 JSON。不要增添新知识，不要解释，只返回修正后的 JSON。" },
      { role: "user", content: raw },
    ], signal)
    try {
      return parseLesson(repaired, context)
    } catch {
      throw error
    }
  }
}

function parseEvaluation(raw: string): TeachingEvaluation {
  const value = extractJson(raw) as Record<string, unknown>
  const allowed = ["correct", "partial", "incorrect", "off_topic", "unjudgeable"]
  const verdict = allowed.includes(String(value.verdict)) ? value.verdict as TeachingEvaluation["verdict"] : "unjudgeable"
  return {
    verdict,
    feedback: stringValue(value.feedback, "判断说明"),
    strengths: stringList(value.strengths),
    missingPoints: stringList(value.missingPoints),
    evidence: stringList(value.evidence),
    nextAction: stringValue(value.nextAction, "下一步"),
    passedRecall: false,
    passedApplication: verdict === "correct" && value.unresolvedCoreMisconception === false,
    unresolvedCoreMisconception: value.unresolvedCoreMisconception !== false,
  }
}

export async function evaluateTeachingAnswer(input: {
  context: TeachingContext
  question: string
  answer: string
  kind: TeachingQuestionKind
  signal?: AbortSignal
}): Promise<TeachingEvaluation> {
  const messages: ChatMessage[] = [
    { role: "system", content: `你是一次性理解检验的判断员。只能依据来源、精华串和题目判断，不安排记忆或延迟复习。区分 correct、partial、incorrect、off_topic、unjudgeable；来源不足必须用 unjudgeable。返回且只返回 JSON：{"verdict":"correct|partial|incorrect|off_topic|unjudgeable","feedback":"直白说明为什么","strengths":["答对之处"],"missingPoints":["缺失或错误"],"evidence":["来源依据"],"nextAction":"只说明当前答案怎样补清楚，不安排以后复习","unresolvedCoreMisconception":true}。` },
    { role: "user", content: `${contextText(input.context)}\n\n题目：${input.question}\n学习者回答：${input.answer}` },
  ]
  const raw = await callTeachingModel("judge", messages, input.signal)
  try {
    return parseEvaluation(raw)
  } catch (error) {
    const repaired = await callTeachingModel("judge", [
      { role: "system", content: "把下面的判断结果修正成上一次要求的合法 JSON。不得改变原判断，不要解释，只返回修正后的 JSON。" },
      { role: "user", content: raw },
    ], input.signal)
    try {
      return parseEvaluation(repaired)
    } catch {
      throw error
    }
  }
}
