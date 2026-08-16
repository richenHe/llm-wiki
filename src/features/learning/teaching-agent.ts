import { streamChat, type ChatMessage } from "@/lib/llm-client"
import { getTaskLlmConfig } from "@/lib/llm-task-routing"
import type { TeachingContext, TeachingEvaluation, TeachingLesson, TeachingQuestionKind } from "./teaching-types"

function compactNode(node: TeachingContext["node"]): string {
  return `${node.title}：${node.essence}`
}

function contextText(context: TeachingContext): string {
  return [
    `当前知识：${compactNode(context.node)}`,
    `位置：${context.breadcrumb.map((node) => node.title).join(" → ")}`,
    `前置知识：${context.prerequisites.map(compactNode).join("；") || "无"}`,
    `下一层知识：${context.children.map(compactNode).join("；") || "无"}`,
    `同级知识：${context.siblings.map(compactNode).join("；") || "无"}`,
    `其他关联：${context.related.map(compactNode).join("；") || "无"}`,
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

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).map((item) => item.trim()).slice(0, 8) : []
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
    }, signal, { temperature: 0.2, max_tokens: 2600 })
  })
}

function parseLesson(raw: string, context: TeachingContext): TeachingLesson {
  const value = extractJson(raw) as Record<string, unknown>
  const rawConnections = Array.isArray(value.connections) ? value.connections : []
  const visual = (value.visual && typeof value.visual === "object" ? value.visual : {}) as Record<string, unknown>
  const visualKind = visual.kind === "mermaid" || visual.kind === "image" ? visual.kind : "none"
  return {
    nodeId: context.node.id,
    sourceFingerprint: context.sourceFingerprint,
    essence: stringValue(value.essence, "一句精华"),
    explanation: stringValue(value.explanation, "通俗解释"),
    analogy: stringValue(value.analogy, "具体例子或类比"),
    commonMistake: stringValue(value.commonMistake, "常见误区"),
    connections: rawConnections.slice(0, 8).map((item) => {
      const connection = item as Record<string, unknown>
      const relation = ["prerequisite", "child", "sibling", "related", "example"].includes(String(connection.relation))
        ? connection.relation as "prerequisite" | "child" | "sibling" | "related" | "example"
        : "related"
      return {
        nodeId: typeof connection.nodeId === "string" ? connection.nodeId : undefined,
        title: stringValue(connection.title, "关联名称"),
        relation,
        explanation: stringValue(connection.explanation, "关联说明"),
      }
    }),
    recallQuestion: stringValue(value.recallQuestion, "回忆题"),
    applicationQuestion: stringValue(value.applicationQuestion, "应用题"),
    transferQuestion: stringValue(value.transferQuestion, "迁移题"),
    visual: context.sourceImage ? {
      kind: "source",
      title: "资料原图",
      reason: "这张图来自当前知识来源，可直接对照原文理解。",
      sourceImage: context.sourceImage,
    } : {
      kind: visualKind,
      title: typeof visual.title === "string" ? visual.title.trim() : "辅助理解图",
      reason: typeof visual.reason === "string" ? visual.reason.trim() : "帮助看清知识结构。",
      mermaid: visualKind === "mermaid" && typeof visual.mermaid === "string" ? visual.mermaid.trim().replace(/^```mermaid\s*|```$/gi, "") : undefined,
      imagePrompt: visualKind === "image" && typeof visual.imagePrompt === "string" ? visual.imagePrompt.trim() : undefined,
    },
    preparedAt: new Date().toISOString(),
  }
}

export async function prepareTeachingLesson(context: TeachingContext, signal?: AbortSignal): Promise<TeachingLesson> {
  const messages: ChatMessage[] = [
    { role: "system", content: `你是个人知识库中的教学设计师。只能依据用户提供的来源内容和知识关系教学；来源不足时要明确说不足，不能补造事实。面向普通学习者，用日常语言和具体例子。内部检查八件事：定位、建图、理解、连接、练习、检验、迁移、复习。返回且只返回 JSON：{"essence":"一个字标签所串联的一句话本质","explanation":"通俗但准确的解释","analogy":"具体例子或类比","commonMistake":"一个核心误区","connections":[{"nodeId":"可选","title":"名称","relation":"prerequisite|child|sibling|related|example","explanation":"为什么有关"}],"recallQuestion":"不看资料的回忆题","applicationQuestion":"能验证会用的应用题","transferQuestion":"换场景的迁移题","visual":{"kind":"mermaid|image|none","title":"图名","reason":"为什么需要图","mermaid":"只在mermaid时提供合法代码","imagePrompt":"只在image时提供客观教学图提示词"}}。关系或流程优先 Mermaid；只有场景、空间或形象类比确实有帮助时才选择 image。` },
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
    passedRecall: value.passedRecall === true,
    passedApplication: value.passedApplication === true,
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
    { role: "system", content: `你是独立的学习效果判断员，不负责鼓励式放水。只能依据来源和题目判断。区分 correct、partial、incorrect、off_topic、unjudgeable。引用依据只能短句转述，不得编造原文。返回且只返回 JSON：{"verdict":"correct|partial|incorrect|off_topic|unjudgeable","feedback":"直白说明为什么","strengths":["答对之处"],"missingPoints":["缺失或错误"],"evidence":["来源依据"],"nextAction":"下一步具体动作","passedRecall":false,"passedApplication":false,"unresolvedCoreMisconception":true}。回忆题正确只能通过回忆；应用或迁移题正确才能通过应用。若来源不足以判断，必须用 unjudgeable。` },
    { role: "user", content: `${contextText(input.context)}\n\n题目类型：${input.kind}\n题目：${input.question}\n学习者回答：${input.answer}` },
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
