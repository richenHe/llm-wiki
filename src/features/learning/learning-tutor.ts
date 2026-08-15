import { streamChat } from "@/lib/llm-client"
import type { LlmConfig } from "@/stores/wiki-store"
import type { LearningNode, LearningTargetKind } from "./learning-data"

export interface LearningLesson {
  schemaVersion: 1
  nodeId: string
  sourceKey: string
  goal: string
  targetKind: LearningTargetKind
  objective: string
  diagnosticPrompt: string
  overview: string
  keyPoints: string[]
  workedExample: { title: string; body: string }
  visual: { kind: "mermaid"; code: string; caption: string } | null
  practice: { prompt: string; hint: string; successCriteria: string[] }
  verification: { prompt: string; successCriteria: string[] }
  sourceNotes: string[]
  generatedBy: "model" | "fallback"
  generatedAt: string
}

export interface LearningEvaluation {
  passed: boolean | null
  score: number | null
  feedback: string
  strengths: string[]
  gaps: string[]
  nextAction: string
  evaluatedBy: "model" | "unverified"
}

const PROCEDURE_RE = /(步骤|流程|操作|安装|配置|校准|部署|实现|制作|使用|训练循环|算法步骤|教程)/i
const JUDGMENT_RE = /(判断|比较|选择|权衡|验证|诊断|评估|审查|测试|是否|风险|优缺点|证据)/i
const CREATION_RE = /(设计|创建|构建|开发|写作|制作|项目|方案|作品|架构)/i
const FACT_RE = /(清单|术语|定义|组成|人物|机构|作者|时间|地点|参数|规格)/i

export function inferLearningTargetKind(node: LearningNode, sourceBody = ""): LearningTargetKind {
  if (node.targetKind) return node.targetKind
  const sample = `${node.title}\n${node.essence}\n${sourceBody.slice(0, 4_000)}`
  if (PROCEDURE_RE.test(sample)) return "apply"
  if (JUDGMENT_RE.test(sample)) return "judge"
  if (CREATION_RE.test(sample)) return "create"
  if (node.semanticType === "source") return "reference"
  if (node.semanticType === "entity" || FACT_RE.test(sample)) return "remember"
  return "understand"
}

export function defaultLearningGoal(node: LearningNode, kind = inferLearningTargetKind(node)): string {
  switch (kind) {
    case "remember": return `能够准确说出“${node.title}”的关键信息，并知道什么时候需要它。`
    case "apply": return `能够不照抄资料，独立完成一次与“${node.title}”有关的操作。`
    case "judge": return `能够使用明确标准判断与“${node.title}”有关的新案例，并说明理由。`
    case "create": return `能够运用“${node.title}”产出一个可以检查和改进的结果。`
    case "reference": return `能够说明“${node.title}”提供了什么证据，以及需要时怎样查到它。`
    default: return `能够用自己的话解释“${node.title}”，并把它用于一个新场景。`
  }
}

export function sourceKeyFor(node: LearningNode, sourceBody: string): string {
  let hash = 2166136261
  const value = `${node.sourcePath ?? node.id}\u0000${sourceBody}`
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return `${value.length}-${(hash >>> 0).toString(36)}`
}

function cleanSourceBody(sourceBody: string): string {
  return sourceBody
    .replace(/^---[\s\S]*?---\s*/m, "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_match, target: string, label?: string) => label ?? target)
}

function extractSourcePoints(sourceBody: string, fallback: string): string[] {
  const paragraphs = cleanSourceBody(sourceBody)
    .split(/\n\s*\n|^#{1,6}\s+/m)
    .map((value) => value.replace(/^[-*+]\s+/gm, "").replace(/\s+/g, " ").trim())
    .filter((value) => value.length >= 18)
  const unique: string[] = []
  for (const paragraph of [fallback, ...paragraphs]) {
    const point = paragraph.slice(0, 220)
    if (!unique.some((item) => item === point)) unique.push(point)
    if (unique.length === 4) break
  }
  return unique.length > 0 ? unique : [fallback]
}

function promptsFor(kind: LearningTargetKind, title: string) {
  switch (kind) {
    case "remember":
      return {
        diagnostic: `先不要看资料：你现在能说出“${title}”的哪些关键信息？不知道也可以直接写“不知道”。`,
        practice: `合上资料，用三条以内的信息介绍“${title}”，并说明其中哪一条最容易混淆。`,
        verification: `换一种问法：如果别人只给你一个相关线索，你怎样确认它指的是“${title}”？`,
        criteria: ["信息准确", "抓住关键特征", "能与相近内容区分"],
      }
    case "apply":
      return {
        diagnostic: `如果现在让你完成“${title}”，你会从哪一步开始？请写出你已经知道的步骤和不确定处。`,
        practice: `按照讲解完成一次“${title}”相关操作，记录关键步骤、实际结果和遇到的问题。`,
        verification: `在不照抄示例的情况下，说明你会怎样独立完成一次新的“${title}”任务，并给出可检查的结果。`,
        criteria: ["步骤完整且顺序合理", "结果可以检查", "能处理关键风险或错误"],
      }
    case "judge":
      return {
        diagnostic: `面对一个与“${title}”有关的案例，你会依据什么作出判断？先写出目前想到的标准。`,
        practice: `使用讲解中的判断标准分析一个案例：先给结论，再逐条给证据。`,
        verification: `换一个条件不完全相同的新案例，作出判断并说明哪些证据会让你改变结论。`,
        criteria: ["标准明确", "结论有证据支持", "能说明限制和反例"],
      }
    case "create":
      return {
        diagnostic: `如果今天要用“${title}”做出一个真实成果，你准备做什么？完成标准是什么？`,
        practice: `先做一个最小版本，说明它解决什么问题，并按完成标准自己检查一次。`,
        verification: `根据反馈修改成果，说明你改了什么、为什么改，以及最终结果怎样验证。`,
        criteria: ["成果与目标一致", "关键选择有理由", "根据反馈完成了修改"],
      }
    case "reference":
      return {
        diagnostic: `你认为“${title}”能回答什么问题？哪些内容还不能从它得到确认？`,
        practice: `从原知识页找出一条可直接使用的证据，并说明它支持什么结论。`,
        verification: `遇到一个相关新问题时，说明你会怎样利用“${title}”查证，而不是凭印象回答。`,
        criteria: ["能找到原始依据", "没有把未知内容说成事实", "能说明证据适用范围"],
      }
    default:
      return {
        diagnostic: `先不要看资料：用自己的话说说“${title}”是什么，哪里还不确定？`,
        practice: `解释“${title}”为什么成立或怎样运作，再给一个例子和一个容易误解的反例。`,
        verification: `换一个没有在讲解中出现的新场景，说明“${title}”是否仍然适用以及为什么。`,
        criteria: ["解释了核心机制", "例子与概念一致", "能处理新场景或边界"],
      }
  }
}

export function createFallbackLesson(node: LearningNode, goal: string, sourceBody: string): LearningLesson {
  const targetKind = inferLearningTargetKind(node, sourceBody)
  const prompts = promptsFor(targetKind, node.title)
  const keyPoints = extractSourcePoints(sourceBody, node.essence)
  return {
    schemaVersion: 1,
    nodeId: node.id,
    sourceKey: sourceKeyFor(node, sourceBody),
    goal,
    targetKind,
    objective: goal,
    diagnosticPrompt: prompts.diagnostic,
    overview: node.essence,
    keyPoints,
    workedExample: {
      title: "从原知识页抓住一个可用例子",
      body: keyPoints[1] ?? `先用“${node.essence}”解释一个与你当前目标直接相关的情况，再核对原知识页。`,
    },
    visual: null,
    practice: { prompt: prompts.practice, hint: "先回到上面的关键点，只使用与你当前任务直接有关的内容。", successCriteria: prompts.criteria },
    verification: { prompt: prompts.verification, successCriteria: prompts.criteria },
    sourceNotes: [node.sourceDetail || node.source],
    generatedBy: "fallback",
    generatedAt: new Date().toISOString(),
  }
}

function unwrapJson(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenced) return fenced[1].trim()
  const start = raw.indexOf("{")
  const end = raw.lastIndexOf("}")
  return start >= 0 && end > start ? raw.slice(start, end + 1) : raw.trim()
}

function stringArray(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return fallback
  const result = value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim())
  return result.length > 0 ? result.slice(0, 6) : fallback
}

export function parseLessonResponse(raw: string, fallback: LearningLesson): LearningLesson {
  const parsed = JSON.parse(unwrapJson(raw)) as Record<string, unknown>
  const targetKind = (["remember", "understand", "apply", "judge", "create", "reference"] as const).includes(parsed.targetKind as LearningTargetKind)
    ? parsed.targetKind as LearningTargetKind
    : fallback.targetKind
  const worked = parsed.workedExample as Record<string, unknown> | undefined
  const practice = parsed.practice as Record<string, unknown> | undefined
  const verification = parsed.verification as Record<string, unknown> | undefined
  const visual = parsed.visual as Record<string, unknown> | null | undefined
  return {
    ...fallback,
    targetKind,
    objective: typeof parsed.objective === "string" && parsed.objective.trim() ? parsed.objective.trim() : fallback.objective,
    diagnosticPrompt: typeof parsed.diagnosticPrompt === "string" && parsed.diagnosticPrompt.trim() ? parsed.diagnosticPrompt.trim() : fallback.diagnosticPrompt,
    overview: typeof parsed.overview === "string" && parsed.overview.trim() ? parsed.overview.trim() : fallback.overview,
    keyPoints: stringArray(parsed.keyPoints, fallback.keyPoints),
    workedExample: {
      title: typeof worked?.title === "string" && worked.title.trim() ? worked.title.trim() : fallback.workedExample.title,
      body: typeof worked?.body === "string" && worked.body.trim() ? worked.body.trim() : fallback.workedExample.body,
    },
    visual: visual?.kind === "mermaid" && typeof visual.code === "string" && visual.code.trim()
      ? { kind: "mermaid", code: visual.code.trim(), caption: typeof visual.caption === "string" ? visual.caption.trim() : "知识结构图" }
      : null,
    practice: {
      prompt: typeof practice?.prompt === "string" && practice.prompt.trim() ? practice.prompt.trim() : fallback.practice.prompt,
      hint: typeof practice?.hint === "string" && practice.hint.trim() ? practice.hint.trim() : fallback.practice.hint,
      successCriteria: stringArray(practice?.successCriteria, fallback.practice.successCriteria),
    },
    verification: {
      prompt: typeof verification?.prompt === "string" && verification.prompt.trim() ? verification.prompt.trim() : fallback.verification.prompt,
      successCriteria: stringArray(verification?.successCriteria, fallback.verification.successCriteria),
    },
    sourceNotes: stringArray(parsed.sourceNotes, fallback.sourceNotes),
    generatedBy: "model",
    generatedAt: new Date().toISOString(),
  }
}

function canUseModel(config: LlmConfig): boolean {
  if (config.provider === "ollama" || config.provider === "claude-code" || config.provider === "codex-cli") return Boolean(config.model.trim())
  if (config.provider === "custom") return Boolean(config.customEndpoint.trim() && config.model.trim())
  return Boolean(config.apiKey.trim() && config.model.trim())
}

async function runModel(config: LlmConfig, system: string, user: string, signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    let output = ""
    let settled = false
    void streamChat(config, [{ role: "system", content: system }, { role: "user", content: user }], {
      onToken: (token) => { output += token },
      onDone: () => {
        if (settled) return
        settled = true
        resolve(output)
      },
      onError: (error) => {
        if (settled) return
        settled = true
        reject(error)
      },
    }, signal, { temperature: 0.2, max_tokens: 2_400, reasoning: { mode: "off" } }).catch((error) => {
      if (settled) return
      settled = true
      reject(error)
    })
  })
}

export async function generateLearningLesson(
  node: LearningNode,
  goal: string,
  sourceBody: string,
  config: LlmConfig,
  signal?: AbortSignal,
): Promise<LearningLesson> {
  const fallback = createFallbackLesson(node, goal, sourceBody)
  if (!canUseModel(config)) return fallback
  const source = sourceBody.slice(0, 24_000)
  const system = `你是 LLM Wiki 内的教学设计器。只使用用户给出的知识页，不补写无法从资料确认的事实。课程必须适合当前学习目标，而不是套固定学科模板。输出严格 JSON，不要代码围栏。图确实能帮助理解时才给 Mermaid；真实物体、精确数值、人物外貌不要用 Mermaid 或臆造图片。`
  const user = `请把下面知识组织成一节短而可操作的课程。\n\n知识：${node.title}\n一句话摘要：${node.essence}\n学习目标：${goal}\n来源：${node.sourceDetail || node.source}\n\n原知识页：\n${source || "当前只有摘要，没有更多正文。"}\n\n输出字段：targetKind（remember/understand/apply/judge/create/reference）、objective、diagnosticPrompt、overview、keyPoints（2-5条）、workedExample {title,body}、visual（null 或 {kind:"mermaid",code,caption}）、practice {prompt,hint,successCriteria}、verification {prompt,successCriteria}、sourceNotes。练习必须要求学习者实际回答、操作、判断或产出；验证题必须换一个场景。`
  try {
    const raw = await runModel(config, system, user, signal)
    return parseLessonResponse(raw, fallback)
  } catch (error) {
    if (signal?.aborted) throw error
    console.warn("[learning] failed to generate tailored lesson; using source-grounded fallback", error)
    return fallback
  }
}

export function parseEvaluationResponse(raw: string): LearningEvaluation {
  const parsed = JSON.parse(unwrapJson(raw)) as Record<string, unknown>
  const score = typeof parsed.score === "number" && Number.isFinite(parsed.score) ? Math.max(0, Math.min(100, Math.round(parsed.score))) : null
  return {
    passed: typeof parsed.passed === "boolean" ? parsed.passed : (score === null ? null : score >= 70),
    score,
    feedback: typeof parsed.feedback === "string" && parsed.feedback.trim() ? parsed.feedback.trim() : "已经记录回答，但模型没有给出明确反馈。",
    strengths: stringArray(parsed.strengths, []),
    gaps: stringArray(parsed.gaps, []),
    nextAction: typeof parsed.nextAction === "string" && parsed.nextAction.trim() ? parsed.nextAction.trim() : "对照完成标准补充后再试一次。",
    evaluatedBy: "model",
  }
}

export async function evaluateLearningAnswer(
  lesson: LearningLesson,
  stage: "practice" | "verification",
  answer: string,
  sourceBody: string,
  config: LlmConfig,
  signal?: AbortSignal,
): Promise<LearningEvaluation> {
  if (!canUseModel(config)) {
    return {
      passed: null,
      score: null,
      feedback: "回答已经保存，但当前没有可用模型，所以系统不会假装判断正确。你可以对照完成标准自查，配置模型后再让系统验证。",
      strengths: [],
      gaps: [],
      nextAction: "对照完成标准补充可检查的证据。",
      evaluatedBy: "unverified",
    }
  }
  const task = stage === "practice" ? lesson.practice : lesson.verification
  const system = "你是严格但直白的学习反馈员。只依据课程目标、原资料和完成标准判断，不因为文字长就判通过。输出严格 JSON，不要代码围栏。"
  const user = `知识：${lesson.objective}\n任务：${task.prompt}\n完成标准：${task.successCriteria.join("；")}\n学习者回答：${answer}\n\n原资料摘要：${sourceBody.slice(0, 12_000) || lesson.overview}\n\n输出：passed（布尔值）、score（0-100）、feedback（先说结论和原因）、strengths（数组）、gaps（数组）、nextAction。只有回答给出了可检查证据，并满足主要标准时才通过。`
  try {
    return parseEvaluationResponse(await runModel(config, system, user, signal))
  } catch (error) {
    if (signal?.aborted) throw error
    console.warn("[learning] failed to evaluate answer", error)
    return {
      passed: null,
      score: null,
      feedback: "自动检查失败，回答已经保留，但不会被标记为掌握。请稍后重试。",
      strengths: [],
      gaps: [],
      nextAction: "检查模型连接后重新提交。",
      evaluatedBy: "unverified",
    }
  }
}
