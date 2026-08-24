import { AlertTriangle, CheckCircle2, Loader2, Sparkles, X, ZoomIn } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { loadTeachingImageConfig } from "@/lib/project-store"
import type { LearningMastery, LearningNode, LearningRelation } from "./learning-data"
import { LearningRelationMap } from "./learning-relation-map"
import type { LearningBoard } from "./learning-routes"
import { useLearningStore } from "./learning-store"
import { evaluateTeachingAnswer, prepareTeachingLesson } from "./teaching-agent"
import { buildTeachingContext } from "./teaching-context"
import { generateTeachingImage } from "./teaching-image"
import type { TeachingVisualBrief } from "./teaching-types"

const VERDICT_LABEL = {
  correct: "已经讲清楚",
  partial: "有一部分没讲清",
  incorrect: "关键理解需要纠正",
  off_topic: "没有回答题目",
  unjudgeable: "依据不足，暂不能判断",
} as const

const BOARD_LABELS = {
  category: "知识联系",
  process: "实际过程",
  prerequisite: "理解前置",
} as const

function friendlyTeachingError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  if (/Network error reaching/i.test(message)) return "教学模型连接失败。请到“设置 → LLM 模型”检查接口地址、密钥和网络，然后重试。"
  if (/HTTP (401|403)/i.test(message)) return "教学模型拒绝了请求。请到“设置 → LLM 模型”检查密钥是否正确、是否有权限。"
  if (/timed out|timeout/i.test(message)) return "教学模型响应超时。可以重试，或在设置中换一个更快的模型。"
  if (/empty|没有返回内容/i.test(message)) return "教学模型没有给出有效内容。请重试；连续失败时可以更换教学模型。"
  return message
}

function TeachingVisual({ brief, projectPath }: { brief: TeachingVisualBrief; projectPath: string }) {
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [imageError, setImageError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    setImageUrl(null)
    setImageError(null)
    if (brief.kind !== "image" || !brief.imagePrompt || !brief.cacheFingerprint) return
    let cancelled = false
    const controller = new AbortController()
    loadTeachingImageConfig().then(async (config) => {
      if (!config.enabled) {
        if (!cancelled) setImageError("请到“设置 → 教学”开启图片生成。")
        return
      }
      if (!config.apiKey.trim()) {
        if (!cancelled) setImageError("请到“设置 → 教学”填写图片接口密钥。")
        return
      }
      try {
        const url = await generateTeachingImage({ projectPath, fingerprint: brief.cacheFingerprint!, prompt: brief.imagePrompt!, config, signal: controller.signal })
        if (!cancelled) setImageUrl(url)
      } catch (error) {
        if (!cancelled && !controller.signal.aborted) setImageError(error instanceof Error ? error.message : String(error))
      }
    }).catch((error) => { if (!cancelled) setImageError(error instanceof Error ? error.message : String(error)) })
    return () => { cancelled = true; controller.abort() }
  }, [brief, projectPath])

  useEffect(() => {
    if (!expanded) return
    const previousOverflow = document.body.style.overflow
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setExpanded(false)
    }
    document.body.style.overflow = "hidden"
    window.addEventListener("keydown", closeOnEscape)
    return () => {
      window.removeEventListener("keydown", closeOnEscape)
      document.body.style.overflow = previousOverflow
    }
  }, [expanded])

  if (brief.kind === "none") return null
  return <figure className="overflow-hidden rounded-xl border bg-slate-50/60 p-3">
    {imageUrl && <button type="button" onClick={() => setExpanded(true)} className="group relative block w-full overflow-hidden rounded-lg bg-white outline-none focus-visible:ring-2 focus-visible:ring-blue-500" aria-label={`放大查看${brief.title}`}>
      <img src={imageUrl} alt={`${brief.title}，AI 生成的辅助理解图`} className="max-h-80 w-full object-contain" />
      <span className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-md bg-slate-950/70 text-white opacity-90 shadow-sm transition-opacity group-hover:opacity-100" aria-hidden="true"><ZoomIn className="h-4 w-4" /></span>
    </button>}
    {!imageUrl && !imageError && <div className="flex min-h-40 items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />正在生成{brief.title}…</div>}
    {!imageUrl && imageError && <p className="text-sm leading-6 text-amber-700">图片暂未生成：{imageError}</p>}
    <figcaption className="mt-2 text-xs leading-5 text-muted-foreground">AI 形象辅助图，不作为知识依据{imageUrl ? " · 点击图片放大" : ""}</figcaption>
    {expanded && imageUrl && createPortal(<div data-teaching-image-lightbox role="dialog" aria-modal="true" aria-label={`放大查看${brief.title}`} className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-950/90 p-5" onClick={() => setExpanded(false)}>
      <div className="relative flex max-h-full max-w-full items-center justify-center" onClick={(event) => event.stopPropagation()}>
        <img src={imageUrl} alt={`${brief.title}，放大后的 AI 生成辅助理解图`} className="max-h-[calc(100vh-40px)] max-w-[calc(100vw-40px)] object-contain" />
        <button type="button" autoFocus onClick={() => setExpanded(false)} className="absolute right-2 top-2 flex h-10 w-10 items-center justify-center rounded-md bg-slate-950/75 text-white shadow-lg outline-none hover:bg-slate-950 focus-visible:ring-2 focus-visible:ring-white" aria-label="关闭大图"><X className="h-5 w-5" /></button>
      </div>
    </div>, document.body)}
  </figure>
}

export function TeachingDrawer({ node, nodes, relations, projectPath, mastery, learningBoard, onClose, onSelect }: {
  node: LearningNode
  nodes: readonly LearningNode[]
  relations: readonly LearningRelation[]
  projectPath: string
  mastery: LearningMastery
  learningBoard?: LearningBoard | null
  onClose: () => void
  onSelect: (nodeId: string) => void
}) {
  const attempts = useLearningStore((state) => state.attempts)
  const sessionsByNode = useLearningStore((state) => state.sessionsByNode)
  const draftAnswer = useLearningStore((state) => state.draftAnswer)
  const setDraftAnswer = useLearningStore((state) => state.setDraftAnswer)
  const setLesson = useLearningStore((state) => state.setLesson)
  const setTeachingError = useLearningStore((state) => state.setTeachingError)
  const markLearningStarted = useLearningStore((state) => state.markLearningStarted)
  const recordAttempt = useLearningStore((state) => state.recordAttempt)
  const session = sessionsByNode[node.id] ?? { activeStage: "locate" as const }
  const lesson = session.lesson?.schemaVersion === 3 ? session.lesson : undefined
  const latestAttempt = useMemo(() => {
    const matching = attempts.filter((attempt) => attempt.nodeId === node.id && attempt.question === lesson?.checkQuestion)
    return matching[matching.length - 1]
  }, [attempts, lesson?.checkQuestion, node.id])
  const [busy, setBusy] = useState<"lesson" | "judge" | null>(null)
  const controllerRef = useRef<AbortController | null>(null)

  useEffect(() => () => controllerRef.current?.abort(), [])
  useEffect(() => { controllerRef.current?.abort(); setBusy(null) }, [node.id])
  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !document.querySelector("[data-teaching-image-lightbox]")) onClose()
    }
    window.addEventListener("keydown", handleEscape)
    return () => window.removeEventListener("keydown", handleEscape)
  }, [onClose])

  const makeContext = () => buildTeachingContext({ projectPath, node, nodes, relations, attempts, mastery, learningBoard })

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
    } catch (error) {
      if (!controller.signal.aborted) setTeachingError(node.id, friendlyTeachingError(error))
    } finally {
      if (!controller.signal.aborted) setBusy(null)
    }
  }

  const submit = async () => {
    const answer = draftAnswer.trim()
    if (!lesson || !answer) return
    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller
    setBusy("judge")
    setTeachingError(node.id, undefined)
    try {
      const evaluation = await evaluateTeachingAnswer({ context: await makeContext(), question: lesson.checkQuestion, answer, kind: "application", signal: controller.signal })
      recordAttempt({ id: crypto.randomUUID(), nodeId: node.id, question: lesson.checkQuestion, answer, kind: "application", evaluation, createdAt: new Date().toISOString(), assisted: false })
    } catch (error) {
      if (!controller.signal.aborted) setTeachingError(node.id, friendlyTeachingError(error))
    } finally {
      if (!controller.signal.aborted) setBusy(null)
    }
  }

  return <aside className="knowledge-detail-drawer teaching-drawer" aria-label={`${node.title}教学`}>
    <div className="flex items-start justify-between border-b px-5 py-4">
      <div className="min-w-0"><div className="text-xs text-muted-foreground">知识教学 · 讲懂后检验一次</div><h2 className="mt-1 truncate text-lg font-semibold">{node.glyph} · {node.title}</h2></div>
      <button type="button" onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-slate-100" aria-label="关闭教学"><X className="h-4 w-4" /></button>
    </div>
    <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
      {!lesson && <div className="space-y-5">
        <div className="teaching-essence"><span aria-hidden="true">{node.glyph}</span><div><div className="text-xs font-medium text-blue-700">一句精华</div><p className="mt-1 text-[15px] leading-7">{node.essence}</p></div></div>
        <p className="text-sm leading-6 text-muted-foreground">核心讲解、图片、一个例子和反例，再检验一次。</p>
        <button type="button" onClick={() => void prepare()} disabled={busy !== null} className="flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-blue-600 text-sm font-medium text-white disabled:opacity-50">{busy === "lesson" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}{busy === "lesson" ? "AI 正在准备讲解…" : "开始 AI 教学"}</button>
      </div>}

      {lesson && <div className="space-y-5">
        <section>
          <div className="teaching-essence"><span aria-hidden="true">{node.glyph}</span><div><div className="text-xs font-medium text-blue-700">核心</div><p className="mt-1 text-[15px] leading-7">{lesson.essence}</p></div></div>
          <p className="mt-3 text-sm leading-7 text-foreground/80">{lesson.explanation}</p>
          <p className="mt-2 border-l-2 border-blue-200 pl-3 text-sm leading-6 text-foreground/70">{lesson.mechanism}</p>
        </section>

        {lesson.conceptVisual.kind === "image" && <TeachingVisual brief={lesson.conceptVisual} projectPath={projectPath} />}

        <section className="grid gap-3 sm:grid-cols-2"><div className="rounded-xl border border-emerald-100 bg-emerald-50/50 p-3"><h3 className="text-sm font-semibold text-emerald-800">例子</h3><p className="mt-1 text-sm leading-6 text-foreground/80">{lesson.example}</p></div><div className="rounded-xl border border-amber-100 bg-amber-50/50 p-3"><h3 className="text-sm font-semibold text-amber-800">反例</h3><p className="mt-1 text-sm leading-6 text-foreground/80">{lesson.counterexample}</p></div></section>

        {learningBoard && <section>
          <div className="text-xs font-medium text-violet-700">知识关联</div>
          <div className="mt-2 overflow-hidden rounded-xl border border-violet-100 bg-violet-50/30">
            <div className="flex items-start justify-between gap-3 border-b border-violet-100 bg-white px-3 py-3"><div><strong className="text-sm text-slate-800">{learningBoard.title}</strong><p className="mt-1 text-xs leading-5 text-slate-500">{learningBoard.centralQuestion}</p></div><span className="shrink-0 rounded-md bg-violet-50 px-2 py-1 text-[10px] font-medium text-violet-700">{BOARD_LABELS[learningBoard.kind]}</span></div>
            <div className="bg-white/70 px-2 py-3"><LearningRelationMap board={learningBoard} nodes={nodes} currentNodeId={node.id} onSelect={onSelect} /></div>
          </div>
        </section>}

        <section className="rounded-xl border p-4">
          <div className="text-xs font-medium text-blue-700">一次轻量 AI 检验</div>
          <h3 className="mt-2 text-base font-semibold leading-7">{lesson.checkQuestion}</h3>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">用自己的话回答。</p>
          <textarea value={draftAnswer} onChange={(event) => setDraftAnswer(event.target.value)} className="mt-3 min-h-32 w-full resize-y rounded-lg border p-3 text-sm leading-6 outline-none focus-visible:ring-2 focus-visible:ring-blue-500" placeholder="写下你的理解；不知道也可以直接写卡住的地方。" />
          <button type="button" onClick={() => void submit()} disabled={busy !== null || !draftAnswer.trim()} className="mt-3 flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-blue-600 text-sm font-medium text-white disabled:opacity-50">{busy === "judge" && <Loader2 className="h-4 w-4 animate-spin" />}{busy === "judge" ? "AI 正在核对…" : "提交给 AI 检验"}</button>
          {latestAttempt && <div className={`mt-4 rounded-xl border p-4 ${latestAttempt.evaluation.verdict === "correct" ? "border-emerald-200 bg-emerald-50/70" : "border-amber-200 bg-amber-50/70"}`}><div className="flex items-center gap-2">{latestAttempt.evaluation.verdict === "correct" ? <CheckCircle2 className="h-4 w-4 text-emerald-700" /> : <AlertTriangle className="h-4 w-4 text-amber-700" />}<strong className="text-sm">{VERDICT_LABEL[latestAttempt.evaluation.verdict]}</strong></div><p className="mt-2 text-sm leading-6">{latestAttempt.evaluation.feedback}</p>{latestAttempt.evaluation.missingPoints.length > 0 && <ul className="mt-2 list-disc pl-5 text-xs leading-5">{latestAttempt.evaluation.missingPoints.map((point) => <li key={point}>{point}</li>)}</ul>}<p className="mt-3 text-xs leading-5"><strong>现在补清楚：</strong>{latestAttempt.evaluation.nextAction}</p></div>}
        </section>

        <button type="button" onClick={() => void prepare()} disabled={busy !== null} className="text-xs text-muted-foreground underline disabled:opacity-50">{busy === "lesson" ? "正在重新讲解…" : "重新讲解"}</button>
      </div>}

      {session.lastError && <div role="alert" className="mt-5 rounded-lg border border-red-200 bg-red-50 p-3 text-sm leading-6 text-red-800"><strong>这一步没有完成：</strong>{session.lastError}<button type="button" onClick={() => lesson && draftAnswer.trim() ? void submit() : void prepare()} className="mt-2 block font-medium underline">保留当前内容并重试</button></div>}
    </div>
  </aside>
}
