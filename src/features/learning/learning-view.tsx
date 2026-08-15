/*
THESIS: The knowledge sphere is for orientation; teaching begins only after a learner chooses an observable outcome.
OWN-WORLD: LLM Wiki white surfaces and Geist type, graphite hairlines, cobalt focus, and restrained violet relations.
STORY: Find a knowledge page, define what "learned" means, try from memory, learn with evidence, then prove transfer.
FIRST VIEWPORT: The sphere remains dominant; the selected knowledge opens a stable teaching drawer with one clear next action.
FORM: Operate-first spatial learning instrument; it replaces the eight-button checklist with a three-stage evidence loop.
*/
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react"
import {
  BookOpen,
  Brain,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleDot,
  Crosshair,
  ExternalLink,
  Globe2,
  Info,
  Lightbulb,
  ListChecks,
  ListTree,
  LoaderCircle,
  Minus,
  Network,
  Play,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Target,
  X,
} from "lucide-react"
import { readFile } from "@/commands/fs"
import { MermaidDiagram } from "@/components/mermaid-diagram"
import { WikiReader } from "@/components/editor/wiki-reader"
import { getTaskLlmConfig } from "@/lib/llm-task-routing"
import { useWikiStore } from "@/stores/wiki-store"
import {
  LEARNING_NODES,
  LEARNING_REGIONS,
  findLearningNode,
  getLearningBreadcrumb,
  getLearningChildren,
  type LearningMastery,
  type LearningNode,
  type LearningRelation,
  type LearningTargetKind,
} from "./learning-data"
import { loadProjectLearningAtlas, type LearningAtlas } from "./learning-atlas"
import { loadLearningProgress, saveLearningProgress } from "./learning-persistence"
import { useLearningStore } from "./learning-store"
import {
  defaultLearningGoal,
  evaluateLearningAnswer,
  generateLearningLesson,
  inferLearningTargetKind,
  sourceKeyFor,
  type LearningEvaluation,
  type LearningLesson,
} from "./learning-tutor"

const HollowKnowledgeSphere = lazy(() => import("./hollow-knowledge-sphere").then((module) => ({ default: module.HollowKnowledgeSphere })))

const MASTERY_LABELS: Record<LearningMastery, string> = {
  unseen: "未开始",
  started: "已尝试",
  understood: "已理解",
  practiced: "已练习",
  mastered: "已验证",
}

const TARGET_LABELS: Record<LearningTargetKind, { label: string; description: string }> = {
  remember: { label: "准确记住", description: "辨认关键信息，并与相近内容区分。" },
  understand: { label: "理解原理", description: "解释为什么成立，并用于新例子。" },
  apply: { label: "完成操作", description: "按正确步骤做出可以检查的结果。" },
  judge: { label: "作出判断", description: "依据标准和证据说明结论。" },
  create: { label: "创造结果", description: "产出作品，并根据反馈修改。" },
  reference: { label: "查证资料", description: "知道它能证明什么，也知道不能证明什么。" },
}

const CONTENT_ROLE_LABELS = {
  teachable: "可学习知识",
  reference: "参考对象",
  evidence: "来源证据",
  overview: "知识总览",
} as const

const SAMPLE_RELATIONS: LearningRelation[] = LEARNING_NODES.flatMap((node) => node.prerequisiteIds.map((prerequisiteId) => ({
  sourceId: prerequisiteId,
  targetId: node.id,
  kind: "prerequisite" as const,
  weight: 1,
  reason: `先理解“${findLearningNode(prerequisiteId).title}”，再学习“${node.title}”。`,
})))

const SAMPLE_ATLAS: LearningAtlas = {
  nodes: LEARNING_NODES,
  regions: LEARNING_REGIONS,
  relations: SAMPLE_RELATIONS,
  isSample: true,
  totalConcepts: LEARNING_NODES.length,
}

const EMPTY_NODE: LearningNode = {
  id: "learning-empty",
  title: "知识地图",
  glyph: "知",
  essence: "当前项目还没有可用于生成地图的知识页。",
  parentId: null,
  prerequisiteIds: [],
  source: "当前项目知识库",
  sourceDetail: "请先导入资料并生成知识页",
  capabilities: ["建立框架"],
  mastery: "unseen",
  position: { x: 50, y: 50 },
  contentRole: "overview",
}

type LessonStage = 0 | 1 | 2

function stripFrontmatter(markdown: string): string {
  return markdown.replace(/^---[\s\S]*?---\s*/m, "")
}

function PathTree({
  nodes,
  selectedNodeId,
  onSelect,
}: {
  nodes: readonly LearningNode[]
  selectedNodeId: string
  onSelect: (nodeId: string) => void
}) {
  const [mode, setMode] = useState<"path" | "catalog">("path")
  const [expandedIds, setExpandedIds] = useState(() => new Set<string>())
  const [catalogLimit, setCatalogLimit] = useState(200)
  const breadcrumb = useMemo(() => getLearningBreadcrumb(selectedNodeId, nodes), [nodes, selectedNodeId])
  const rootCount = useMemo(() => getLearningChildren(null, nodes).length, [nodes])

  useEffect(() => {
    setExpandedIds((current) => {
      const missingIds = breadcrumb.filter((node) => !current.has(node.id))
      if (missingIds.length === 0) return current
      return new Set([...current, ...missingIds.map((node) => node.id)])
    })
  }, [breadcrumb])

  const toggle = (nodeId: string) => {
    setExpandedIds((current) => {
      const next = new Set(current)
      if (next.has(nodeId)) next.delete(nodeId)
      else next.add(nodeId)
      return next
    })
  }

  const renderBranch = (parentId: string | null, depth: number): React.ReactNode => {
    const allChildren = getLearningChildren(parentId, nodes)
    const children = parentId === null ? allChildren.slice(0, catalogLimit) : allChildren
    return children.map((node) => {
      const childCount = getLearningChildren(node.id, nodes).length
      const expanded = expandedIds.has(node.id)
      const active = node.id === selectedNodeId
      return (
        <div key={node.id}>
          <div className={`knowledge-tree-row ${active ? "is-active" : ""}`} style={{ paddingLeft: `${8 + depth * 18}px` }}>
            {childCount > 0 ? (
              <button type="button" onClick={() => toggle(node.id)} className="knowledge-tree-toggle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500" aria-label={`${expanded ? "收起" : "展开"}${node.title}`}>
                <ChevronRight className={`h-3.5 w-3.5 transition-transform motion-reduce:transition-none ${expanded ? "rotate-90" : ""}`} />
              </button>
            ) : <span className="knowledge-tree-leaf" aria-hidden="true" />}
            <button type="button" onClick={() => onSelect(node.id)} className="knowledge-tree-name focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
              <span className="knowledge-tree-dot" aria-hidden="true" />
              <span className="truncate">{node.title}</span>
              {childCount > 0 ? <span className="ml-auto text-[10px] tabular-nums text-muted-foreground/70">{childCount}</span> : null}
            </button>
          </div>
          {expanded ? renderBranch(node.id, depth + 1) : null}
        </div>
      )
    })
  }

  return (
    <aside className="knowledge-path-panel" aria-label="知识脉络">
      <div className="flex items-center gap-2 px-4 pb-3 pt-4">
        <ListTree className="h-4 w-4 text-slate-500" />
        <h2 className="text-sm font-semibold">知识脉络</h2>
      </div>
      <div className="mx-3 grid grid-cols-2 rounded-md bg-slate-100 p-0.5 text-xs">
        <button type="button" onClick={() => setMode("path")} className={`rounded-[5px] px-3 py-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${mode === "path" ? "bg-white font-medium shadow-sm" : "text-muted-foreground"}`}>当前位置</button>
        <button type="button" onClick={() => setMode("catalog")} className={`rounded-[5px] px-3 py-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${mode === "catalog" ? "bg-white font-medium shadow-sm" : "text-muted-foreground"}`}>全部目录</button>
      </div>
      <div className="knowledge-tree-scroll">
        {mode === "path" ? (
          <div className="px-3 py-3">
            {breadcrumb.map((node, index) => (
              <div key={node.id} className="relative flex items-stretch">
                <div className="flex w-5 justify-center">
                  <span className={`mt-3 h-2 w-2 rounded-full border ${node.id === selectedNodeId ? "border-blue-600 bg-blue-600" : "border-slate-400 bg-white"}`} />
                  {index < breadcrumb.length - 1 ? <span className="absolute bottom-0 left-[9px] top-5 w-px bg-slate-200" /> : null}
                </div>
                <button type="button" onClick={() => onSelect(node.id)} className={`min-w-0 flex-1 rounded-md px-2 py-2 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${node.id === selectedNodeId ? "bg-blue-50 font-medium text-blue-700" : "hover:bg-slate-50"}`}>
                  <span className="block truncate">{node.title}</span>
                  {node.id === selectedNodeId ? <span className="mt-0.5 block truncate text-[11px] font-normal text-blue-700/75">{node.essence}</span> : null}
                </button>
              </div>
            ))}
            {getLearningChildren(selectedNodeId, nodes).length > 0 ? (
              <div className="mt-3 border-t pt-3">
                <div className="mb-1 px-2 text-[10px] font-medium text-muted-foreground">继续探索</div>
                {getLearningChildren(selectedNodeId, nodes).map((child) => (
                  <button key={child.id} type="button" onClick={() => onSelect(child.id)} className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
                    <CircleDot className="h-3.5 w-3.5 text-slate-400" /><span className="truncate">{child.title}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : (
          <div className="py-2">
            {renderBranch(null, 0)}
            {catalogLimit < rootCount ? <button type="button" onClick={() => setCatalogLimit((value) => Math.min(rootCount, value + 200))} className="mx-3 my-2 w-[calc(100%-24px)] rounded-md border px-3 py-2 text-xs text-slate-600 hover:bg-slate-50">继续显示 {Math.min(200, rootCount - catalogLimit)} 个顶层主题</button> : null}
          </div>
        )}
      </div>
    </aside>
  )
}

function EvaluationCard({ evaluation }: { evaluation: LearningEvaluation }) {
  const tone = evaluation.passed === true ? "border-emerald-200 bg-emerald-50 text-emerald-950" : evaluation.passed === false ? "border-amber-200 bg-amber-50 text-amber-950" : "border-slate-200 bg-slate-50 text-slate-800"
  return (
    <div className={`mt-4 rounded-xl border p-4 ${tone}`} role="status">
      <div className="flex items-center gap-2 text-sm font-semibold">
        {evaluation.passed === true ? <CheckCircle2 className="h-4 w-4" /> : <ShieldCheck className="h-4 w-4" />}
        {evaluation.passed === true ? "通过验证" : evaluation.passed === false ? "还需要补充" : "已记录，尚未自动验证"}
        {evaluation.score !== null ? <span className="ml-auto tabular-nums">{evaluation.score}/100</span> : null}
      </div>
      <p className="mt-2 text-sm leading-6">{evaluation.feedback}</p>
      {evaluation.gaps.length > 0 ? <ul className="mt-2 list-disc space-y-1 pl-5 text-xs leading-5">{evaluation.gaps.map((item) => <li key={item}>{item}</li>)}</ul> : null}
      <p className="mt-3 text-xs font-medium">下一步：{evaluation.nextAction}</p>
    </div>
  )
}

function StageButton({ index, stage, availableStage, label, description, onSelect }: {
  index: LessonStage
  stage: LessonStage
  availableStage: LessonStage
  label: string
  description: string
  onSelect: (stage: LessonStage) => void
}) {
  const active = stage === index
  const available = index <= availableStage
  return (
    <button
      type="button"
      disabled={!available}
      onClick={() => onSelect(index)}
      className={`learning-stage-button ${active ? "is-active" : ""}`}
      aria-current={active ? "step" : undefined}
    >
      <span className="learning-stage-index">{index < availableStage ? <Check className="h-3.5 w-3.5" /> : index + 1}</span>
      <span className="min-w-0 text-left"><strong>{label}</strong><small>{description}</small></span>
    </button>
  )
}

function SourceEvidence({ sourceBody, sourcePath, onOpenSource }: { sourceBody: string; sourcePath?: string; onOpenSource: () => void }) {
  const [open, setOpen] = useState(false)
  return (
    <section className="mt-6 border-t pt-5">
      <div className="flex items-center justify-between gap-3">
        <div><h4 className="text-sm font-semibold">原知识页与图片</h4><p className="mt-1 text-xs text-muted-foreground">讲解来自这里；需要核对时再展开，不必每次重读。</p></div>
        {sourcePath ? <button type="button" onClick={onOpenSource} className="flex shrink-0 items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs hover:bg-slate-50"><ExternalLink className="h-3.5 w-3.5" />打开原页</button> : null}
      </div>
      {sourceBody ? (
        <div className="mt-3">
          <button type="button" onClick={() => setOpen((value) => !value)} className="text-xs font-medium text-blue-700 hover:underline">{open ? "收起原文" : "展开原文与原图"}</button>
          {open ? <div className="learning-source-reader mt-4"><WikiReader body={stripFrontmatter(sourceBody)} filePath={sourcePath} /></div> : null}
        </div>
      ) : <p className="mt-3 text-xs text-amber-700">当前知识点只有摘要，没有可展开的原知识页。</p>}
    </section>
  )
}

interface DetailDrawerProps {
  node: LearningNode
  nodes: readonly LearningNode[]
  mastery: LearningMastery
  goal: string
  lessonOpen: boolean
  lesson: LearningLesson | null
  lessonStage: LessonStage
  availableStage: LessonStage
  generating: boolean
  evaluating: boolean
  sourceBody: string
  sourceLoading: boolean
  sourceError: string | null
  diagnosticAnswer: string
  practiceAnswer: string
  verificationAnswer: string
  practiceEvaluation: LearningEvaluation | null
  verificationEvaluation: LearningEvaluation | null
  onClose: () => void
  onGoalChange: (goal: string) => void
  onStartLesson: (regenerate?: boolean) => void
  onStopLesson: () => void
  onStageChange: (stage: LessonStage) => void
  onDiagnosticAnswer: (answer: string) => void
  onPracticeAnswer: (answer: string) => void
  onVerificationAnswer: (answer: string) => void
  onSubmitDiagnostic: () => void
  onSubmitPractice: () => void
  onSubmitVerification: () => void
  onSelect: (nodeId: string) => void
  onOpenSource: () => void
}

function DetailDrawer(props: DetailDrawerProps) {
  const { node, nodes, mastery, goal, lessonOpen, lesson, lessonStage, availableStage, generating, evaluating, sourceBody, sourceLoading, sourceError, diagnosticAnswer, practiceAnswer, verificationAnswer, practiceEvaluation, verificationEvaluation } = props
  const prerequisites = node.prerequisiteIds.map((id) => nodes.find((item) => item.id === id)).filter(Boolean) as LearningNode[]
  const children = getLearningChildren(node.id, nodes)
  const inferredKind = lesson?.targetKind ?? inferLearningTargetKind(node, sourceBody)
  const target = TARGET_LABELS[inferredKind]

  return (
    <aside className="knowledge-detail-drawer" aria-label={`${node.title}教学面板`}>
      <div className="flex items-start justify-between border-b px-6 py-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
            <span>{CONTENT_ROLE_LABELS[node.contentRole ?? "teachable"]}</span><span aria-hidden="true">·</span><span>{target.label}</span><span aria-hidden="true">·</span><span>{MASTERY_LABELS[mastery]}</span>
          </div>
          <h2 className="mt-1 truncate text-xl font-semibold tracking-[-0.02em]">{node.title}</h2>
        </div>
        <button type="button" onClick={props.onClose} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500" aria-label="关闭教学面板"><X className="h-4 w-4" /></button>
      </div>

      {!lessonOpen ? (
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
          <section className="learning-essence-panel">
            <div className="flex items-center gap-2 text-xs font-semibold text-blue-800"><Brain className="h-4 w-4" />这项知识的核心</div>
            <p className="mt-3 text-[15px] leading-7 text-slate-950">{node.essence}</p>
          </section>

          <section className="mt-7">
            <div className="flex items-center gap-2"><Target className="h-4 w-4 text-slate-500" /><h3 className="text-sm font-semibold">你最后想会做什么</h3></div>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">系统会围绕这个结果选择讲解、练习和验证方式。目标越具体，课程越有用。</p>
            <textarea value={goal} onChange={(event) => props.onGoalChange(event.target.value)} className="mt-3 min-h-24 w-full resize-y rounded-xl border bg-white p-3 text-sm leading-6 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100" aria-label="学习目标" />
            <div className="mt-2 flex items-start gap-2 text-xs leading-5 text-slate-600"><Info className="mt-0.5 h-3.5 w-3.5 shrink-0" /><span>当前建议按“{target.label}”来教：{target.description}</span></div>
          </section>

          <section className="mt-7 grid gap-3 sm:grid-cols-3" aria-label="教学过程">
            {[{ icon: Brain, title: "先试一下", text: "先暴露已经会的和不确定的。" }, { icon: Lightbulb, title: "学会并做", text: "只讲当前目标需要的内容。" }, { icon: ShieldCheck, title: "换场景证明", text: "真正通过后才记录为掌握。" }].map(({ icon: Icon, title, text }) => (
              <div key={title} className="border-t border-slate-300 pt-3"><Icon className="h-4 w-4 text-blue-700" /><strong className="mt-2 block text-xs">{title}</strong><span className="mt-1 block text-[11px] leading-5 text-muted-foreground">{text}</span></div>
            ))}
          </section>

          <section className="mt-7 border-t pt-5">
            <h3 className="text-sm font-semibold">知识依据</h3>
            <p className="mt-2 text-sm font-medium">{node.source}</p>
            <p className="mt-1 break-all text-xs leading-5 text-muted-foreground">{node.sourceDetail}</p>
            {sourceLoading ? <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground"><LoaderCircle className="h-3.5 w-3.5 animate-spin" />正在读取原知识页…</p> : null}
            {sourceError ? <p className="mt-3 text-xs leading-5 text-amber-700">{sourceError}</p> : null}
          </section>

          {prerequisites.length > 0 || children.length > 0 ? (
            <section className="mt-7 border-t pt-5">
              <h3 className="text-sm font-semibold">相关知识</h3>
              <div className="mt-3 flex flex-wrap gap-2">
                {[...prerequisites, ...children.slice(0, 8)].map((item) => <button key={item.id} type="button" onClick={() => props.onSelect(item.id)} className="rounded-md border px-2.5 py-1.5 text-xs hover:bg-slate-50">{item.title}</button>)}
              </div>
            </section>
          ) : null}

          <button type="button" onClick={() => props.onStartLesson()} disabled={generating || !goal.trim()} className="mt-8 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-blue-600 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2">
            {generating ? <><LoaderCircle className="h-4 w-4 animate-spin" />正在准备这节课…</> : <><Play className="h-4 w-4 fill-current" />开始学习这个知识</>}
          </button>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="border-b px-6 py-4">
            <div className="grid grid-cols-3 gap-2" aria-label="三阶段教学流程">
              <StageButton index={0} stage={lessonStage} availableStage={availableStage} label="先试" description="找出起点" onSelect={props.onStageChange} />
              <StageButton index={1} stage={lessonStage} availableStage={availableStage} label="学会" description="讲解与练习" onSelect={props.onStageChange} />
              <StageButton index={2} stage={lessonStage} availableStage={availableStage} label="证明" description="独立迁移" onSelect={props.onStageChange} />
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
            {generating || !lesson ? (
              <div className="flex min-h-64 flex-col items-center justify-center text-center"><LoaderCircle className="h-6 w-6 animate-spin text-blue-600" /><h3 className="mt-4 text-sm font-semibold">正在根据目标和原知识页准备课程</h3><p className="mt-2 max-w-sm text-xs leading-5 text-muted-foreground">只处理当前知识，不会预先生成整个知识库。</p></div>
            ) : lessonStage === 0 ? (
              <section>
                <div className="flex items-center gap-2 text-xs font-semibold text-blue-800"><Brain className="h-4 w-4" />先暴露真实起点</div>
                <h3 className="mt-3 text-lg font-semibold leading-7">{lesson.diagnosticPrompt}</h3>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">这一步不是考试，也不计分。不知道就写“不知道”，系统会据此避免重复讲你已经会的内容。</p>
                <textarea value={diagnosticAnswer} onChange={(event) => props.onDiagnosticAnswer(event.target.value)} className="mt-5 min-h-40 w-full resize-y rounded-xl border p-3 text-sm leading-6 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100" placeholder="写下你现在能说出的内容和不确定处…" />
                <button type="button" onClick={props.onSubmitDiagnostic} disabled={!diagnosticAnswer.trim()} className="mt-3 h-10 w-full rounded-xl bg-blue-600 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40">保存起点并看讲解</button>
              </section>
            ) : lessonStage === 1 ? (
              <section>
                <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-blue-800"><Sparkles className="h-4 w-4" />围绕你的目标讲解<span className="rounded-md bg-blue-50 px-2 py-1 font-normal text-blue-700">{lesson.generatedBy === "model" ? "模型按需生成" : "原知识页基础课程"}</span></div>
                <h3 className="mt-3 text-lg font-semibold leading-7">{lesson.objective}</h3>
                <p className="mt-3 text-sm leading-7 text-slate-700">{lesson.overview}</p>

                <div className="mt-6 border-y py-5">
                  <h4 className="flex items-center gap-2 text-sm font-semibold"><ListChecks className="h-4 w-4 text-slate-500" />只抓住这些关键点</h4>
                  <ol className="mt-3 space-y-3">
                    {lesson.keyPoints.map((point, index) => <li key={`${index}-${point}`} className="flex gap-3 text-sm leading-6"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600">{index + 1}</span><span>{point}</span></li>)}
                  </ol>
                </div>

                {lesson.visual ? <figure className="mt-6"><MermaidDiagram code={lesson.visual.code} /><figcaption className="mt-2 text-center text-xs text-muted-foreground">{lesson.visual.caption}</figcaption></figure> : null}

                <div className="mt-6 bg-slate-50 p-4">
                  <h4 className="text-sm font-semibold">{lesson.workedExample.title}</h4>
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-7 text-slate-700">{lesson.workedExample.body}</p>
                </div>

                <div className="mt-7">
                  <div className="flex items-center gap-2 text-xs font-semibold text-violet-800"><Lightbulb className="h-4 w-4" />现在做一次</div>
                  <h4 className="mt-2 text-base font-semibold leading-7">{lesson.practice.prompt}</h4>
                  <details className="mt-3 text-xs text-muted-foreground"><summary className="cursor-pointer font-medium text-blue-700">需要提示时再打开</summary><p className="mt-2 leading-5">{lesson.practice.hint}</p></details>
                  <textarea value={practiceAnswer} onChange={(event) => props.onPracticeAnswer(event.target.value)} className="mt-4 min-h-40 w-full resize-y rounded-xl border p-3 text-sm leading-6 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100" placeholder="写下你的解释、步骤、判断依据或作品结果…" />
                  <button type="button" onClick={props.onSubmitPractice} disabled={evaluating || !practiceAnswer.trim()} className="mt-3 flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-blue-600 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40">{evaluating ? <><LoaderCircle className="h-4 w-4 animate-spin" />正在检查…</> : "提交并获得反馈"}</button>
                  {practiceEvaluation ? <EvaluationCard evaluation={practiceEvaluation} /> : null}
                  {practiceEvaluation ? <button type="button" onClick={() => props.onStageChange(2)} className="mt-4 h-10 w-full rounded-xl border border-blue-300 text-sm font-semibold text-blue-700 hover:bg-blue-50">继续独立验证</button> : null}
                </div>

                <SourceEvidence sourceBody={sourceBody} sourcePath={node.sourcePath} onOpenSource={props.onOpenSource} />
              </section>
            ) : (
              <section>
                <div className="flex items-center gap-2 text-xs font-semibold text-blue-800"><ShieldCheck className="h-4 w-4" />换个场景，独立证明</div>
                <h3 className="mt-3 text-lg font-semibold leading-7">{lesson.verification.prompt}</h3>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">这里不再给示例。系统会按下面的完成标准检查，而不是按文字长短判断。</p>
                <ul className="mt-4 space-y-2 border-y py-4">{lesson.verification.successCriteria.map((criterion) => <li key={criterion} className="flex items-start gap-2 text-sm leading-6"><CheckCircle2 className="mt-1 h-3.5 w-3.5 shrink-0 text-slate-400" />{criterion}</li>)}</ul>
                <textarea value={verificationAnswer} onChange={(event) => props.onVerificationAnswer(event.target.value)} className="mt-5 min-h-48 w-full resize-y rounded-xl border p-3 text-sm leading-6 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100" placeholder="独立完成，并提供可以检查的结果或理由…" />
                <button type="button" onClick={props.onSubmitVerification} disabled={evaluating || !verificationAnswer.trim()} className="mt-3 flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-blue-600 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40">{evaluating ? <><LoaderCircle className="h-4 w-4 animate-spin" />正在验证…</> : "提交掌握证据"}</button>
                {verificationEvaluation ? <EvaluationCard evaluation={verificationEvaluation} /> : null}
                {verificationEvaluation?.passed === true ? <p className="mt-4 text-center text-sm font-medium text-emerald-700">这项知识已经有通过记录，以后只需要按遗忘情况复习。</p> : null}
              </section>
            )}
          </div>

          <div className="flex items-center justify-between gap-3 border-t px-6 py-3">
            <button type="button" onClick={props.onStopLesson} className="text-xs font-medium text-slate-600 hover:text-slate-950">返回知识详情</button>
            {lesson ? <button type="button" onClick={() => props.onStartLesson(true)} disabled={generating || evaluating} className="flex items-center gap-1.5 text-xs font-medium text-blue-700 disabled:opacity-40"><RefreshCw className="h-3.5 w-3.5" />根据当前目标重新准备</button> : null}
          </div>
        </div>
      )}
    </aside>
  )
}

export function LearningView() {
  const project = useWikiStore((state) => state.project)
  const dataVersion = useWikiStore((state) => state.dataVersion)
  const openPathInPreview = useWikiStore((state) => state.openPathInPreview)
  const selectedNodeId = useLearningStore((state) => state.selectedNodeId)
  const zoom = useLearningStore((state) => state.zoom)
  const query = useLearningStore((state) => state.query)
  const detailOpen = useLearningStore((state) => state.detailOpen)
  const lessonOpen = useLearningStore((state) => state.lessonOpen)
  const masteryByNode = useLearningStore((state) => state.masteryByNode)
  const attempts = useLearningStore((state) => state.attempts)
  const goalsByNode = useLearningStore((state) => state.goalsByNode)
  const lessonCache = useLearningStore((state) => state.lessonCache)
  const hydratedProjectPath = useLearningStore((state) => state.hydratedProjectPath)
  const selectNode = useLearningStore((state) => state.selectNode)
  const setZoom = useLearningStore((state) => state.setZoom)
  const setQuery = useLearningStore((state) => state.setQuery)
  const setDetailOpen = useLearningStore((state) => state.setDetailOpen)
  const setLessonOpen = useLearningStore((state) => state.setLessonOpen)
  const setLearningGoal = useLearningStore((state) => state.setLearningGoal)
  const cacheLesson = useLearningStore((state) => state.cacheLesson)
  const removeCachedLesson = useLearningStore((state) => state.removeCachedLesson)
  const recordAttempt = useLearningStore((state) => state.recordAttempt)
  const hydrate = useLearningStore((state) => state.hydrate)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const wheelAccumulator = useRef(0)
  const lessonRequest = useRef<AbortController | null>(null)
  const evaluationRequest = useRef<AbortController | null>(null)
  const [atlas, setAtlas] = useState<LearningAtlas>(SAMPLE_ATLAS)
  const [atlasLoading, setAtlasLoading] = useState(true)
  const [focusNodeId, setFocusNodeId] = useState<string | null>(null)
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null)
  const [childWindowOffset, setChildWindowOffset] = useState(0)
  const [sourceBody, setSourceBody] = useState("")
  const [sourceLoading, setSourceLoading] = useState(false)
  const [sourceError, setSourceError] = useState<string | null>(null)
  const [lesson, setLesson] = useState<LearningLesson | null>(null)
  const [lessonStage, setLessonStage] = useState<LessonStage>(0)
  const [availableStage, setAvailableStage] = useState<LessonStage>(0)
  const [generating, setGenerating] = useState(false)
  const [evaluating, setEvaluating] = useState(false)
  const [diagnosticAnswer, setDiagnosticAnswer] = useState("")
  const [practiceAnswer, setPracticeAnswer] = useState("")
  const [verificationAnswer, setVerificationAnswer] = useState("")
  const [practiceEvaluation, setPracticeEvaluation] = useState<LearningEvaluation | null>(null)
  const [verificationEvaluation, setVerificationEvaluation] = useState<LearningEvaluation | null>(null)
  const previewMode = typeof window !== "undefined"
    && (import.meta.env.DEV || window.location.hostname === "127.0.0.1" || window.location.hostname === "localhost")
    && new URLSearchParams(window.location.search).has("learning-preview")
  const reduceMotion = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
  const activeNodes = atlas.nodes.length > 0 ? atlas.nodes : [EMPTY_NODE]
  const node = findLearningNode(selectedNodeId, activeNodes)
  const focusNode = focusNodeId ? findLearningNode(focusNodeId, activeNodes) : null
  const childCount = focusNode ? getLearningChildren(focusNode.id, activeNodes).length : 0
  const mastery = masteryByNode[node.id] ?? node.mastery
  const suggestedGoal = defaultLearningGoal(node, inferLearningTargetKind(node, sourceBody))
  const goal = goalsByNode[node.id] ?? suggestedGoal
  const matches = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("zh-CN")
    if (!normalized) return []
    return activeNodes.filter((item) => `${item.title}${item.glyph}${item.essence}`.toLocaleLowerCase("zh-CN").includes(normalized)).slice(0, 8)
  }, [activeNodes, query])

  useEffect(() => {
    if (!project || previewMode) {
      setAtlas(SAMPLE_ATLAS)
      setAtlasLoading(false)
      return
    }
    let cancelled = false
    setAtlasLoading(true)
    loadProjectLearningAtlas(project.path).then((result) => {
      if (cancelled) return
      setAtlas(result)
      setAtlasLoading(false)
      const current = useLearningStore.getState().selectedNodeId
      if (!result.nodes.some((item) => item.id === current)) {
        const first = result.nodes.find((item) => item.contentRole === "teachable") ?? result.nodes.find((item) => item.kind === "concept") ?? result.nodes[0]
        if (first) selectNode(first.id)
      }
    }).catch((error) => {
      if (!cancelled) {
        console.warn("[learning] failed to build project atlas", error)
        setAtlas({ nodes: [], regions: [], relations: [], isSample: false, totalConcepts: 0 })
        setAtlasLoading(false)
      }
    })
    return () => { cancelled = true }
  }, [dataVersion, previewMode, project, selectNode])

  useEffect(() => {
    if (!project) return
    let cancelled = false
    loadLearningProgress(project.path).then((snapshot) => {
      if (!cancelled) hydrate(project.path, snapshot)
    })
    return () => { cancelled = true }
  }, [hydrate, project])

  useEffect(() => {
    if (!project || hydratedProjectPath !== project.path) return
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      saveLearningProgress(project.path, useLearningStore.getState().toSnapshot()).catch((error) => console.warn("[learning] failed to save progress", error))
    }, 300)
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current) }
  }, [attempts, goalsByNode, hydratedProjectPath, lessonCache, masteryByNode, project, selectedNodeId])

  useEffect(() => {
    lessonRequest.current?.abort()
    evaluationRequest.current?.abort()
    setLesson(null)
    setLessonStage(0)
    setAvailableStage(0)
    setDiagnosticAnswer("")
    setPracticeAnswer("")
    setVerificationAnswer("")
    setPracticeEvaluation(null)
    setVerificationEvaluation(null)
  }, [node.id])

  useEffect(() => {
    if (!detailOpen || !node.sourcePath) {
      setSourceBody("")
      setSourceError(null)
      return
    }
    let cancelled = false
    setSourceLoading(true)
    setSourceError(null)
    readFile(node.sourcePath).then((body) => {
      if (!cancelled) setSourceBody(body)
    }).catch((error) => {
      if (!cancelled) {
        console.warn("[learning] failed to read knowledge page", error)
        setSourceBody("")
        setSourceError("原知识页暂时无法读取；课程仍可使用摘要，但图片和完整证据不会显示。")
      }
    }).finally(() => { if (!cancelled) setSourceLoading(false) })
    return () => { cancelled = true }
  }, [detailOpen, node.sourcePath])

  const navigateTo = (nodeId: string) => {
    selectNode(nodeId)
    setFocusNodeId(nodeId)
    setChildWindowOffset(0)
    setHoveredNodeId(null)
  }

  const handleWheel = (event: React.WheelEvent<HTMLElement>) => {
    if (childCount <= 24) return
    wheelAccumulator.current += event.deltaY
    if (Math.abs(wheelAccumulator.current) < 55) return
    const direction = wheelAccumulator.current > 0 ? 1 : -1
    wheelAccumulator.current = 0
    setChildWindowOffset((current) => (current + direction * 8 + childCount) % childCount)
  }

  const persistNow = async () => {
    if (!project) return
    if (saveTimer.current) clearTimeout(saveTimer.current)
    try {
      await saveLearningProgress(project.path, useLearningStore.getState().toSnapshot())
    } catch (error) {
      console.warn("[learning] failed to save progress immediately", error)
    }
  }

  const handleStartLesson = async (regenerate = false) => {
    const normalizedGoal = goal.trim() || suggestedGoal
    setLearningGoal(node.id, normalizedGoal)
    setLessonOpen(true)
    setLessonStage(0)
    setAvailableStage(0)
    setDiagnosticAnswer("")
    setPracticeAnswer("")
    setVerificationAnswer("")
    setPracticeEvaluation(null)
    setVerificationEvaluation(null)
    setGenerating(true)
    lessonRequest.current?.abort()
    const controller = new AbortController()
    lessonRequest.current = controller
    try {
      let body = sourceBody
      if (!body && node.sourcePath) {
        try {
          body = await readFile(node.sourcePath)
          if (!controller.signal.aborted) setSourceBody(body)
        } catch {
          body = ""
        }
      }
      const sourceKey = sourceKeyFor(node, body)
      const cached = lessonCache[node.id]
      if (!regenerate && cached?.sourceKey === sourceKey && cached.goal === normalizedGoal) {
        setLesson(cached)
        return
      }
      if (regenerate) removeCachedLesson(node.id)
      const generated = await generateLearningLesson(node, normalizedGoal, body, getTaskLlmConfig("chat"), controller.signal)
      if (controller.signal.aborted) return
      setLesson(generated)
      cacheLesson(generated)
    } catch (error) {
      if (!controller.signal.aborted) console.warn("[learning] lesson request stopped", error)
    } finally {
      if (!controller.signal.aborted) setGenerating(false)
    }
  }

  const handleSubmitDiagnostic = () => {
    if (!lesson || !recordAttempt({ nodeId: node.id, baselineMastery: node.mastery, answer: diagnosticAnswer, kind: "diagnostic", goal: lesson.goal })) return
    setAvailableStage(1)
    setLessonStage(1)
    void persistNow()
  }

  const evaluate = async (stage: "practice" | "verification") => {
    if (!lesson) return
    const answer = stage === "practice" ? practiceAnswer : verificationAnswer
    if (!answer.trim()) return
    evaluationRequest.current?.abort()
    const controller = new AbortController()
    evaluationRequest.current = controller
    setEvaluating(true)
    try {
      const evaluation = await evaluateLearningAnswer(lesson, stage, answer, sourceBody, getTaskLlmConfig("chat"), controller.signal)
      if (controller.signal.aborted) return
      recordAttempt({
        nodeId: node.id,
        baselineMastery: node.mastery,
        answer,
        kind: stage === "practice" ? "guided-practice" : "verification",
        goal: lesson.goal,
        passed: evaluation.passed,
        score: evaluation.score,
        feedback: evaluation.feedback,
      })
      if (stage === "practice") {
        setPracticeEvaluation(evaluation)
        setAvailableStage(2)
      } else {
        setVerificationEvaluation(evaluation)
      }
      await persistNow()
    } catch (error) {
      if (!controller.signal.aborted) console.warn("[learning] evaluation request stopped", error)
    } finally {
      if (!controller.signal.aborted) setEvaluating(false)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background">
      <header className="knowledge-atlas-header">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border bg-white"><Network className="h-4 w-4 text-slate-700" /></div>
          <div className="min-w-0"><h1 className="truncate text-sm font-semibold">知识宇宙</h1><p className="truncate text-[11px] text-muted-foreground">{project?.name ?? "通用知识库"} · {atlas.totalConcepts} 个知识页</p></div>
        </div>
        <nav className="hidden min-w-0 flex-1 items-center justify-center gap-1.5 overflow-hidden px-4 text-xs text-muted-foreground lg:flex" aria-label="当前知识路径">
          <button type="button" onClick={() => setFocusNodeId(null)} className="shrink-0 rounded-md px-2 py-1 hover:bg-slate-100 hover:text-foreground">全局</button>
          {getLearningBreadcrumb(node.id, activeNodes).map((item) => <span key={item.id} className="flex min-w-0 items-center gap-1.5"><ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-300" /><button type="button" onClick={() => navigateTo(item.id)} className={`truncate rounded-md px-2 py-1 hover:bg-slate-100 ${item.id === node.id ? "font-medium text-blue-700" : ""}`}>{item.title}</button></span>)}
        </nav>
        <div className="relative w-[240px] shrink-0 xl:w-[320px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} aria-label="搜索知识" placeholder="搜索整个知识库…" className="h-9 w-full rounded-lg border bg-white pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-blue-200" />
          {matches.length > 0 ? <div className="absolute left-0 right-0 top-11 z-50 overflow-hidden rounded-lg border bg-white shadow-xl">{matches.map((item) => <button key={item.id} type="button" onClick={() => { navigateTo(item.id); setQuery("") }} className="flex w-full items-center gap-3 border-b px-3 py-2.5 text-left last:border-b-0 hover:bg-slate-50"><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-blue-50 text-xs font-semibold text-blue-700">{item.glyph}</span><span className="min-w-0"><strong className="block truncate text-sm">{item.title}</strong><span className="block truncate text-xs font-normal text-muted-foreground">{item.essence}</span></span></button>)}</div> : null}
        </div>
        <button type="button" onClick={() => { setDetailOpen(true); setLessonOpen(false) }} className="flex h-9 shrink-0 items-center gap-2 rounded-lg bg-blue-600 px-4 text-sm font-medium text-white hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"><Target className="h-3.5 w-3.5" />学习当前知识</button>
      </header>

      <div className="relative min-h-0 flex-1 overflow-hidden bg-[#f8fafc]">
        <div aria-hidden="true" className="knowledge-canvas-grid" />
        <PathTree nodes={activeNodes} selectedNodeId={node.id} onSelect={navigateTo} />

        <main className="absolute inset-0 overflow-hidden" aria-label="镂空知识球工作区" onWheel={handleWheel}>
          <div className="absolute inset-0 transition-transform duration-200 motion-reduce:transition-none" style={{ transform: `scale(${zoom})` }}>
            <Suspense fallback={<div className="flex h-full items-center justify-center text-sm text-muted-foreground">正在加载三维知识球…</div>}>
              <HollowKnowledgeSphere nodes={activeNodes} relations={atlas.relations} selectedNodeId={focusNodeId} childWindowOffset={childWindowOffset} reduceMotion={reduceMotion} onSelectNode={navigateTo} onHoverNode={setHoveredNodeId} />
            </Suspense>
          </div>
          {childCount > 24 ? <div className="absolute bottom-6 left-1/2 -translate-x-1/2 rounded-full border bg-white/95 px-4 py-2 text-xs text-slate-600 shadow-sm">滚轮浏览子节点 · 当前 {childWindowOffset + 1}–{Math.min(childWindowOffset + 24, childCount)} / {childCount}</div> : null}
        </main>

        <div className="absolute right-5 top-5 z-30 flex items-center gap-2">
          <button type="button" onClick={() => setFocusNodeId(null)} className="knowledge-tool-button" title="返回全局地图"><Globe2 className="h-4 w-4" /><span>全局</span></button>
          <button type="button" onClick={() => setDetailOpen(true)} className="knowledge-tool-button" title="查看当前知识详情"><Info className="h-4 w-4" /><span>详情</span></button>
        </div>

        <div className="absolute bottom-5 right-5 z-30 overflow-hidden rounded-lg border bg-white shadow-sm">
          <button type="button" onClick={() => setZoom(1)} className="knowledge-zoom-button border-b" aria-label="恢复默认缩放"><Crosshair className="h-4 w-4" /></button>
          <button type="button" onClick={() => setZoom(zoom + 0.1)} className="knowledge-zoom-button border-b" aria-label="放大"><Plus className="h-4 w-4" /></button>
          <div className="flex h-8 w-10 items-center justify-center border-b text-[10px] tabular-nums text-muted-foreground">{Math.round(zoom * 100)}%</div>
          <button type="button" onClick={() => setZoom(zoom - 0.1)} className="knowledge-zoom-button" aria-label="缩小"><Minus className="h-4 w-4" /></button>
        </div>

        {focusNodeId ? <button type="button" onClick={() => setDetailOpen(true)} className="knowledge-focus-card"><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-600 text-xs font-semibold text-white">{findLearningNode(focusNodeId, activeNodes).glyph}</span><span className="min-w-0 text-left"><strong className="block truncate text-sm">{findLearningNode(focusNodeId, activeNodes).title}</strong><small className="block truncate text-[11px] text-muted-foreground">点击设定目标并开始学习</small></span><ChevronRight className="ml-auto h-4 w-4 shrink-0 text-slate-400" /></button> : null}
        {!focusNodeId && hoveredNodeId ? <div className="absolute bottom-5 right-20 z-20 rounded-md border bg-white/90 px-3 py-2 text-[11px] text-muted-foreground">当前指向：{findLearningNode(hoveredNodeId, activeNodes).title}</div> : null}
        {atlasLoading ? <div className="absolute inset-0 z-40 flex items-center justify-center bg-white/70 text-sm text-muted-foreground">正在整理当前知识库的结构…</div> : null}
        {!atlasLoading && !atlas.isSample && atlas.totalConcepts === 0 ? <div className="absolute inset-0 z-20 flex items-center justify-center"><div className="max-w-sm rounded-xl border bg-white p-6 text-center shadow-sm"><BookOpen className="mx-auto h-6 w-6 text-slate-400" /><div className="mt-3 text-base font-semibold">知识库还没有可学习的知识页</div><p className="mt-2 text-sm leading-6 text-muted-foreground">请先导入资料并完成知识生成。系统会从知识页准备课程，不会把原始文件名当成课程。</p></div></div> : null}

        {detailOpen ? <DetailDrawer
          node={node}
          nodes={activeNodes}
          mastery={mastery}
          goal={goal}
          lessonOpen={lessonOpen}
          lesson={lesson}
          lessonStage={lessonStage}
          availableStage={availableStage}
          generating={generating}
          evaluating={evaluating}
          sourceBody={sourceBody}
          sourceLoading={sourceLoading}
          sourceError={sourceError}
          diagnosticAnswer={diagnosticAnswer}
          practiceAnswer={practiceAnswer}
          verificationAnswer={verificationAnswer}
          practiceEvaluation={practiceEvaluation}
          verificationEvaluation={verificationEvaluation}
          onClose={() => setDetailOpen(false)}
          onGoalChange={(value) => setLearningGoal(node.id, value)}
          onStartLesson={handleStartLesson}
          onStopLesson={() => setLessonOpen(false)}
          onStageChange={(stage) => { if (stage <= availableStage) setLessonStage(stage) }}
          onDiagnosticAnswer={setDiagnosticAnswer}
          onPracticeAnswer={(answer) => { setPracticeAnswer(answer); setPracticeEvaluation(null) }}
          onVerificationAnswer={(answer) => { setVerificationAnswer(answer); setVerificationEvaluation(null) }}
          onSubmitDiagnostic={handleSubmitDiagnostic}
          onSubmitPractice={() => { void evaluate("practice") }}
          onSubmitVerification={() => { void evaluate("verification") }}
          onSelect={navigateTo}
          onOpenSource={() => { if (node.sourcePath) openPathInPreview(node.sourcePath) }}
        /> : null}
      </div>
      <div className="sr-only" aria-live="polite">当前知识：{node.title}。学习状态：{MASTERY_LABELS[mastery]}。</div>
    </div>
  )
}
