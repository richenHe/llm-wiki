import { convertFileSrc } from "@tauri-apps/api/core"
import { AlertTriangle, CheckCircle2, Loader2, Play, RotateCcw, Sparkles, X } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"
import { MermaidDiagram } from "@/components/mermaid-diagram"
import { loadTeachingImageConfig } from "@/lib/project-store"
import type { LearningMastery, LearningNode, LearningRelation } from "./learning-data"
import { getLearningBreadcrumb } from "./learning-data"
import { useLearningStore } from "./learning-store"
import { prepareTeachingLesson, evaluateTeachingAnswer } from "./teaching-agent"
import { buildTeachingContext } from "./teaching-context"
import { generateTeachingImage } from "./teaching-image"
import type { TeachingQuestionKind, TeachingStage } from "./teaching-types"

const STAGES: Array<{ id: TeachingStage; label: string; helper: string }> = [
  { id: "locate", label: "定位", helper: "位置与本质" },
  { id: "explain", label: "讲懂", helper: "解释与关联" },
  { id: "apply", label: "用会", helper: "回答与判断" },
  { id: "retain", label: "记牢", helper: "复习与巩固" },
]

const VERDICT_LABEL = {
  correct: "回答正确",
  partial: "部分正确",
  incorrect: "需要纠正",
  off_topic: "没有回答题目",
  unjudgeable: "依据不足，暂不能判断",
} as const

function displayImageSource(source: string): string {
  return /^(?:https?:|data:|blob:)/i.test(source) ? source : convertFileSrc(source)
}

function friendlyTeachingError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  if (/Network error reaching/i.test(message)) return "教学模型连接失败。请到“设置 → LLM 模型”检查接口地址、密钥和网络，然后重试。"
  if (/HTTP (401|403)/i.test(message)) return "教学模型拒绝了请求。请到“设置 → LLM 模型”检查密钥是否正确、是否有权限。"
  if (/timed out|timeout/i.test(message)) return "教学模型响应超时。可以重试，或在设置中换一个更快的模型。"
  if (/empty|没有返回内容/i.test(message)) return "教学模型没有给出有效内容。请重试；连续失败时可以更换教学模型。"
  return message
}

export function TeachingDrawer({ node, nodes, relations, projectPath, mastery, onClose, onSelect }: {
  node: LearningNode
  nodes: readonly LearningNode[]
  relations: readonly LearningRelation[]
  projectPath: string
  mastery: LearningMastery
  onClose: () => void
  onSelect: (nodeId: string) => void
}) {
  const attempts = useLearningStore((state) => state.attempts)
  const sessionsByNode = useLearningStore((state) => state.sessionsByNode)
  const draftAnswer = useLearningStore((state) => state.draftAnswer)
  const setDraftAnswer = useLearningStore((state) => state.setDraftAnswer)
  const setActiveStage = useLearningStore((state) => state.setActiveStage)
  const setLesson = useLearningStore((state) => state.setLesson)
  const setTeachingError = useLearningStore((state) => state.setTeachingError)
  const markLearningStarted = useLearningStore((state) => state.markLearningStarted)
  const recordAttempt = useLearningStore((state) => state.recordAttempt)
  const session = sessionsByNode[node.id] ?? { activeStage: "locate" as const }
  const lesson = session.lesson
  const nodeAttempts = useMemo(() => attempts.filter((attempt) => attempt.nodeId === node.id), [attempts, node.id])
  const latestAttempt = nodeAttempts[nodeAttempts.length - 1]
  const [busy, setBusy] = useState<"lesson" | "judge" | null>(null)
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [imageError, setImageError] = useState<string | null>(null)
  const controllerRef = useRef<AbortController | null>(null)

  useEffect(() => () => controllerRef.current?.abort(), [])
  useEffect(() => {
    controllerRef.current?.abort()
    setBusy(null)
  }, [node.id])
  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose() }
    window.addEventListener("keydown", handleEscape)
    return () => window.removeEventListener("keydown", handleEscape)
  }, [onClose])
  useEffect(() => { setImageUrl(null); setImageError(null) }, [node.id, lesson?.sourceFingerprint])

  const makeContext = () => buildTeachingContext({ projectPath, node, nodes, relations, attempts, mastery })

  const prepare = async () => {
    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller
    setBusy("lesson")
    setTeachingError(node.id, undefined)
    try {
      const prepared = await prepareTeachingLesson(await makeContext(), controller.signal)
      setLesson(node.id, prepared)
      markLearningStarted(node.id)
      setActiveStage(node.id, "explain")
    } catch (error) {
      if (!controller.signal.aborted) setTeachingError(node.id, friendlyTeachingError(error))
    } finally {
      if (!controller.signal.aborted) setBusy(null)
    }
  }

  useEffect(() => {
    if (!lesson || lesson.visual.kind !== "image" || !lesson.visual.imagePrompt || imageUrl || imageError) return
    let cancelled = false
    loadTeachingImageConfig().then(async (config) => {
      if (!config.enabled || cancelled) {
        if (!cancelled) setImageError("尚未在“设置 → 教学”中开启教学图片生成。")
        return
      }
      try {
        const url = await generateTeachingImage({ projectPath, fingerprint: lesson.sourceFingerprint, prompt: lesson.visual.imagePrompt!, config })
        if (!cancelled) setImageUrl(url)
      } catch (error) {
        if (!cancelled) setImageError(error instanceof Error ? error.message : String(error))
      }
    }).catch((error) => { if (!cancelled) setImageError(error instanceof Error ? error.message : String(error)) })
    return () => { cancelled = true }
  }, [imageError, imageUrl, lesson, projectPath])

  const successfulRecall = nodeAttempts.some((attempt) => attempt.kind === "recall" && attempt.evaluation.verdict === "correct" && attempt.evaluation.passedRecall)
  const successfulApplication = nodeAttempts.some((attempt) => (attempt.kind === "application" || attempt.kind === "transfer") && attempt.evaluation.verdict === "correct" && attempt.evaluation.passedApplication)
  const questionKind: TeachingQuestionKind = session.activeStage === "retain"
    ? "review"
    : !successfulRecall
      ? "recall"
      : !successfulApplication
        ? "application"
        : "transfer"
  const question = !lesson ? "" : questionKind === "recall" || questionKind === "review" ? lesson.recallQuestion : questionKind === "application" ? lesson.applicationQuestion : lesson.transferQuestion

  const submit = async () => {
    const answer = draftAnswer.trim()
    if (!lesson || !answer) return
    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller
    setBusy("judge")
    setTeachingError(node.id, undefined)
    try {
      const context = await makeContext()
      const evaluation = await evaluateTeachingAnswer({ context, question, answer, kind: questionKind, signal: controller.signal })
      recordAttempt({ id: crypto.randomUUID(), nodeId: node.id, question, answer, kind: questionKind, evaluation, createdAt: new Date().toISOString(), assisted: false })
    } catch (error) {
      if (!controller.signal.aborted) setTeachingError(node.id, friendlyTeachingError(error))
    } finally {
      if (!controller.signal.aborted) setBusy(null)
    }
  }

  const changeStage = (stage: TeachingStage) => {
    setActiveStage(node.id, stage)
    if (!lesson && stage !== "locate") void prepare()
  }

  return (
    <aside className="knowledge-detail-drawer teaching-drawer" aria-label={`${node.title}教学`}>
      <div className="flex items-start justify-between border-b px-5 py-4">
        <div className="min-w-0"><div className="text-xs text-muted-foreground">知识教学 · {mastery === "unseen" ? "未学习" : mastery === "learning" ? "理解中" : mastery === "applicable" ? "会应用" : mastery === "mastered" ? "本次掌握" : "已巩固"}</div><h2 className="mt-1 truncate text-lg font-semibold">{node.glyph} · {node.title}</h2></div>
        <button type="button" onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500" aria-label="关闭教学"><X className="h-4 w-4" /></button>
      </div>
      <nav className="grid grid-cols-4 border-b" aria-label="教学阶段">
        {STAGES.map((stage) => <button key={stage.id} type="button" aria-current={session.activeStage === stage.id ? "step" : undefined} onClick={() => changeStage(stage.id)} className={`min-w-0 border-r px-2 py-3 text-left last:border-r-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500 ${session.activeStage === stage.id ? "bg-blue-600 text-white" : "bg-background hover:bg-slate-50"}`}><strong className="block text-sm">{stage.label}</strong><span className={`mt-0.5 block truncate text-[10px] ${session.activeStage === stage.id ? "text-blue-100" : "text-muted-foreground"}`}>{stage.helper}</span></button>)}
      </nav>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
        {session.activeStage === "locate" && <div className="space-y-5"><div className="teaching-essence"><span aria-hidden="true">{node.glyph}</span><div><div className="text-xs font-medium text-blue-700">一句精华</div><p className="mt-1 text-[15px] leading-7">{lesson?.essence ?? node.essence}</p></div></div><div><div className="text-xs font-medium text-muted-foreground">知识位置</div><p className="mt-1 text-sm leading-6">{getLearningBreadcrumb(node.id, nodes).map((item) => item.title).join(" → ")}</p></div><div><div className="text-xs font-medium text-muted-foreground">来源</div><p className="mt-1 text-sm font-medium">{node.source}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{node.sourceDetail}</p></div><div><div className="text-xs font-medium text-muted-foreground">学完能做什么</div><p className="mt-1 text-sm leading-6">{node.capabilities.length ? node.capabilities.join("、") : `能解释并应用“${node.title}”。`}</p></div><button type="button" onClick={() => void prepare()} disabled={busy !== null} className="flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">{busy === "lesson" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}{busy === "lesson" ? "AI 正在准备讲解…" : lesson ? "重新准备讲解" : "开始 AI 教学"}</button></div>}

        {session.activeStage === "explain" && <div className="space-y-5">{lesson ? <><section><h3 className="text-sm font-semibold">先讲懂</h3><p className="mt-2 text-sm leading-7 text-foreground/80">{lesson.explanation}</p></section><section><h3 className="text-sm font-semibold">换个具体例子</h3><p className="mt-2 text-sm leading-7 text-foreground/80">{lesson.analogy}</p></section>{lesson.visual.kind !== "none" && <figure className="overflow-hidden rounded-xl border bg-slate-50/60 p-3">{lesson.visual.kind === "source" && lesson.visual.sourceImage && <img src={displayImageSource(lesson.visual.sourceImage)} alt={`${lesson.visual.title}，来自当前资料`} className="max-h-80 w-full object-contain" />}{lesson.visual.kind === "mermaid" && lesson.visual.mermaid && <MermaidDiagram code={lesson.visual.mermaid} />}{lesson.visual.kind === "image" && imageUrl && <img src={imageUrl} alt={`${lesson.visual.title}，AI 生成的辅助理解图`} className="max-h-80 w-full object-contain" />}{lesson.visual.kind === "image" && !imageUrl && !imageError && <div className="flex min-h-36 items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />正在生成辅助理解图…</div>}{lesson.visual.kind === "image" && imageError && <p className="text-sm leading-6 text-amber-700">图片暂未生成：{imageError}</p>}<figcaption className="mt-2 text-xs leading-5 text-muted-foreground">{lesson.visual.kind === "source" ? "来源证据" : "辅助理解，不作为知识依据"} · {lesson.visual.reason}</figcaption></figure>}<section><h3 className="text-sm font-semibold">和哪些知识有关</h3><div className="mt-2 space-y-2">{lesson.connections.map((connection, index) => <button key={`${connection.title}-${index}`} type="button" disabled={!connection.nodeId} onClick={() => connection.nodeId && onSelect(connection.nodeId)} className="block w-full rounded-lg border px-3 py-2 text-left disabled:cursor-default"><strong className="text-sm">{connection.title}</strong><span className="mt-1 block text-xs leading-5 text-muted-foreground">{connection.explanation}</span></button>)}</div></section><div className="rounded-lg bg-amber-50 px-3 py-2 text-sm leading-6 text-amber-900"><strong>容易误解：</strong>{lesson.commonMistake}</div><button type="button" onClick={() => setActiveStage(node.id, "apply")} className="h-10 w-full rounded-lg bg-blue-600 text-sm font-medium text-white hover:bg-blue-700">我来试着回答</button></> : <button type="button" onClick={() => void prepare()} disabled={busy !== null} className="flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-blue-600 text-sm font-medium text-white disabled:opacity-50"><Play className="h-4 w-4" />生成讲解</button>}</div>}

        {session.activeStage === "apply" && <div className="space-y-4">{lesson ? <><div><div className="text-xs font-medium text-blue-700">{questionKind === "recall" ? "主动回忆" : questionKind === "application" ? "实际应用" : "迁移练习"}</div><h3 className="mt-2 text-base font-semibold leading-7">{question}</h3><p className="mt-1 text-xs leading-5 text-muted-foreground">请独立回答。AI 会说明答对了什么、缺了什么，并给出下一步。</p></div><textarea value={draftAnswer} onChange={(event) => setDraftAnswer(event.target.value)} className="min-h-40 w-full resize-y rounded-lg border p-3 text-sm leading-6 outline-none focus-visible:ring-2 focus-visible:ring-blue-500" placeholder="用自己的话作答；不知道也可以写出卡住的位置。" /><button type="button" onClick={() => void submit()} disabled={busy !== null || !draftAnswer.trim()} className="flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-blue-600 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">{busy === "judge" && <Loader2 className="h-4 w-4 animate-spin" />}{busy === "judge" ? "AI 正在核对答案…" : "提交给 AI 判断"}</button>{latestAttempt && <div className={`rounded-xl border p-4 ${latestAttempt.evaluation.verdict === "correct" ? "border-emerald-200 bg-emerald-50/70" : "border-amber-200 bg-amber-50/70"}`}><div className="flex items-center gap-2">{latestAttempt.evaluation.verdict === "correct" ? <CheckCircle2 className="h-4 w-4 text-emerald-700" /> : <AlertTriangle className="h-4 w-4 text-amber-700" />}<strong className="text-sm">{VERDICT_LABEL[latestAttempt.evaluation.verdict]}</strong></div><p className="mt-2 text-sm leading-6">{latestAttempt.evaluation.feedback}</p>{latestAttempt.evaluation.missingPoints.length > 0 && <div className="mt-3"><div className="text-xs font-medium">还缺这些关键点</div><ul className="mt-1 list-disc space-y-1 pl-5 text-xs leading-5">{latestAttempt.evaluation.missingPoints.map((point) => <li key={point}>{point}</li>)}</ul></div>}<p className="mt-3 text-xs leading-5"><strong>下一步：</strong>{latestAttempt.evaluation.nextAction}</p></div>}</> : <p className="text-sm text-muted-foreground">请先让 AI 准备讲解，再进入练习。</p>}</div>}

        {session.activeStage === "retain" && <div className="space-y-5"><div className="teaching-essence"><span aria-hidden="true">{node.glyph}</span><div><div className="text-xs font-medium text-blue-700">用这个字提取整段知识</div><p className="mt-1 text-[15px] leading-7">先遮住解释，只看“{node.glyph}”，尝试说出“{node.title}”的本质、一个关联和一个应用。</p></div></div><div><h3 className="text-sm font-semibold">本次证据</h3><p className="mt-2 text-sm leading-6 text-muted-foreground">已完成 {nodeAttempts.length} 次回答；回忆{successfulRecall ? "已通过" : "未通过"}，应用{successfulApplication ? "已通过" : "未通过"}。</p></div>{session.reviewDueAt && <div className="rounded-lg border p-3 text-sm leading-6"><strong>建议复习时间：</strong>{new Date(session.reviewDueAt).toLocaleString()}。到时间后不看资料再答一次，正确才会变成“已巩固”。</div>}<button type="button" onClick={() => setActiveStage(node.id, "apply")} className="flex h-10 w-full items-center justify-center gap-2 rounded-lg border text-sm font-medium hover:bg-slate-50"><RotateCcw className="h-4 w-4" />现在复习一次</button></div>}

        {session.lastError && <div role="alert" className="mt-5 rounded-lg border border-red-200 bg-red-50 p-3 text-sm leading-6 text-red-800"><strong>这一步没有完成：</strong>{session.lastError}<button type="button" onClick={() => session.activeStage === "apply" ? void submit() : void prepare()} className="mt-2 block text-sm font-medium underline">保留当前内容并重试</button></div>}
      </div>
    </aside>
  )
}
