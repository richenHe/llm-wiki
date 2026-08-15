/*
THESIS: A hollow knowledge sphere makes a massive system controllable by revealing only the learner's current structural context.
OWN-WORLD: LLM Wiki white surfaces and Geist type, graphite hairlines, cobalt focus, and restrained violet relation points.
STORY: Start global, enter a topic, read its path, follow a sibling route, then explain the idea in your own words.
FIRST VIEWPORT: The hollow sphere dominates; knowledge-path navigation sits upper-left, search above, and route guidance appears lower-right when relevant.
FORM: Operate-first spatial learning instrument following the user-approved hollow-sphere compositions; it refuses grids, solid globes, and decorative dashboards.
*/
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react"
import {
  BookOpen,
  ChevronRight,
  CircleDot,
  Crosshair,
  Eye,
  Globe2,
  Info,
  ListTree,
  Minus,
  Network,
  Pin,
  PinOff,
  Play,
  Plus,
  Search,
  X,
} from "lucide-react"
import { useWikiStore } from "@/stores/wiki-store"
import {
  LEARNING_NODES,
  LEARNING_REGIONS,
  buildLearningRoute,
  buildRouteMnemonic,
  findLearningNode,
  getLearningBreadcrumb,
  getLearningChildren,
  type LearningNode,
  type LearningRelation,
} from "./learning-data"
import { loadProjectLearningAtlas, type LearningAtlas } from "./learning-atlas"
import { loadLearningProgress, saveLearningProgress } from "./learning-persistence"
import { useLearningStore } from "./learning-store"

const HollowKnowledgeSphere = lazy(() => import("./hollow-knowledge-sphere").then((module) => ({ default: module.HollowKnowledgeSphere })))

const MASTERY_LABELS = {
  unseen: "未学",
  started: "入门",
  understood: "理解",
  practiced: "练习",
  mastered: "掌握",
} as const

const LEARNING_FLOW = [
  { key: "定", label: "定位" },
  { key: "图", label: "建图" },
  { key: "懂", label: "理解" },
  { key: "联", label: "连接" },
  { key: "练", label: "练习" },
  { key: "测", label: "检验" },
  { key: "迁", label: "迁移" },
  { key: "复", label: "复习" },
] as const

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
              <button type="button" onClick={() => toggle(node.id)} className="knowledge-tree-toggle" aria-label={`${expanded ? "收起" : "展开"}${node.title}`}>
                <ChevronRight className={`h-3.5 w-3.5 transition-transform ${expanded ? "rotate-90" : ""}`} />
              </button>
            ) : <span className="knowledge-tree-leaf" aria-hidden="true" />}
            <button type="button" onClick={() => onSelect(node.id)} className="knowledge-tree-name">
              <span className="knowledge-tree-dot" aria-hidden="true" />
              <span className="truncate">{node.title}</span>
              {childCount > 0 && <span className="ml-auto text-[10px] tabular-nums text-muted-foreground/70">{childCount}</span>}
            </button>
          </div>
          {expanded && renderBranch(node.id, depth + 1)}
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
        <button type="button" onClick={() => setMode("path")} className={`rounded-[5px] px-3 py-1.5 ${mode === "path" ? "bg-white font-medium shadow-sm" : "text-muted-foreground"}`}>路径</button>
        <button type="button" onClick={() => setMode("catalog")} className={`rounded-[5px] px-3 py-1.5 ${mode === "catalog" ? "bg-white font-medium shadow-sm" : "text-muted-foreground"}`}>目录</button>
      </div>
      <div className="knowledge-tree-scroll">
        {mode === "path" ? (
          <div className="px-3 py-3">
            {breadcrumb.map((node, index) => (
              <div key={node.id} className="relative flex items-stretch">
                <div className="flex w-5 justify-center">
                  <span className={`mt-3 h-2 w-2 rounded-full border ${node.id === selectedNodeId ? "border-blue-600 bg-blue-600" : "border-slate-400 bg-white"}`} />
                  {index < breadcrumb.length - 1 && <span className="absolute bottom-0 left-[9px] top-5 w-px bg-slate-200" />}
                </div>
                <button type="button" onClick={() => onSelect(node.id)} className={`min-w-0 flex-1 rounded-md px-2 py-2 text-left text-sm ${node.id === selectedNodeId ? "bg-blue-50 font-medium text-blue-700" : "hover:bg-slate-50"}`}>
                  <span className="block truncate">{node.title}</span>
                  {node.id === selectedNodeId && <span className="mt-0.5 block truncate text-[11px] font-normal text-blue-600/70">{node.essence}</span>}
                </button>
              </div>
            ))}
            {getLearningChildren(selectedNodeId, nodes).length > 0 && (
              <div className="mt-3 border-t pt-3">
                <div className="mb-1 px-2 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">下一层</div>
                {getLearningChildren(selectedNodeId, nodes).map((child) => (
                  <button key={child.id} type="button" onClick={() => onSelect(child.id)} className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-slate-50">
                    <CircleDot className="h-3.5 w-3.5 text-slate-400" /><span className="truncate">{child.title}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : <div className="py-2">{renderBranch(null, 0)}{catalogLimit < rootCount && <button type="button" onClick={() => setCatalogLimit((value) => Math.min(rootCount, value + 200))} className="mx-3 my-2 w-[calc(100%-24px)] rounded-md border px-3 py-2 text-xs text-slate-600 hover:bg-slate-50">继续显示 {Math.min(200, rootCount - catalogLimit)} 个顶层主题</button>}</div>}
      </div>
    </aside>
  )
}

function RouteCard({ node, nodes, pinned, onTogglePin, onSelect }: {
  node: LearningNode
  nodes: readonly LearningNode[]
  pinned: boolean
  onTogglePin: () => void
  onSelect: (nodeId: string) => void
}) {
  const route = buildLearningRoute(node.id, nodes)
  if (route.length < 2) return null
  return (
    <section className="knowledge-route-card" aria-label="推荐学习路线">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">同级主线 · 推荐顺序</div>
          <div className="mt-1 text-xs text-muted-foreground">按前置关系与知识库目录顺序排列</div>
        </div>
        <button type="button" onClick={onTogglePin} className="flex h-8 w-8 items-center justify-center rounded-md border bg-white hover:bg-slate-50" aria-label={pinned ? "取消固定路线" : "固定路线"}>
          {pinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
        </button>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-1.5">
        {route.map((item, index) => (
          <span key={item.id} className="flex items-center gap-1.5">
            <button type="button" onClick={() => onSelect(item.id)} className={`route-glyph ${item.id === node.id ? "is-current" : ""}`} title={item.title}>{item.glyph}</button>
            {index < route.length - 1 && <span className="text-slate-300">→</span>}
          </span>
        ))}
      </div>
      <div className="mt-3 flex items-center gap-2 text-xs"><span className="text-muted-foreground">当前</span><strong>{node.title}</strong></div>
      <p className="mt-2 border-l-2 border-violet-300 pl-3 text-xs leading-5 text-slate-600">{buildRouteMnemonic(route)}</p>
    </section>
  )
}

function DetailDrawer({ node, nodes, lessonOpen, answer, submitted, saving, saveError, onClose, onStartLesson, onStopLesson, onAnswer, onSubmit, onSelect }: {
  node: LearningNode
  nodes: readonly LearningNode[]
  lessonOpen: boolean
  answer: string
  submitted: boolean
  saving: boolean
  saveError: string | null
  onClose: () => void
  onStartLesson: () => void
  onStopLesson: () => void
  onAnswer: (answer: string) => void
  onSubmit: () => void
  onSelect: (nodeId: string) => void
}) {
  const [flowStep, setFlowStep] = useState(0)
  const prerequisites = node.prerequisiteIds.map((id) => nodes.find((item) => item.id === id)).filter(Boolean) as LearningNode[]
  const children = getLearningChildren(node.id, nodes)
  const siblings = buildLearningRoute(node.id, nodes)
  useEffect(() => setFlowStep(0), [node.id])
  useEffect(() => { if (lessonOpen) setFlowStep(5) }, [lessonOpen])
  const flowPrompt = [
    `先确认位置：${getLearningBreadcrumb(node.id, nodes).map((item) => item.title).join(" → ")}。`,
    `看清结构：${prerequisites.length} 个前置、${siblings.length} 个同级、${children.length} 个下一层知识。`,
    `用一句话抓住本质：${node.essence}`,
    `把“${node.title}”与前置知识、同级知识和真实场景各连接一次。`,
    `先做识别题，再做解释或操作题；遇到错误时回到“懂”和“联”。`,
    `不看资料，用自己的话解释“${node.title}”，并给出一个例子。`,
    `换一个场景使用“${node.title}”，检查规律是否仍然成立。`,
    `稍后只看短标签“${node.glyph}”复述完整含义，不必重读全部资料。`,
  ][flowStep]
  return (
    <aside className="knowledge-detail-drawer">
      <div className="flex items-start justify-between border-b px-5 py-4">
        <div className="min-w-0">
          <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">知识详情</div>
          <h2 className="mt-1 truncate text-lg font-semibold">{node.title}</h2>
        </div>
        <button type="button" onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-slate-100" aria-label="关闭知识详情"><X className="h-4 w-4" /></button>
      </div>
      <div className="border-b px-5 py-3">
        <div className="grid grid-cols-8 gap-1" aria-label="标准学习流程">
          {LEARNING_FLOW.map((item, index) => <button key={item.key} type="button" onClick={() => { setFlowStep(index); if (item.key === "测") onStartLesson(); else onStopLesson() }} className={`rounded-md py-1.5 text-center ${flowStep === index ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`} title={item.label}><span className="block text-xs font-semibold">{item.key}</span><span className="mt-0.5 hidden text-[9px] xl:block">{item.label}</span></button>)}
        </div>
        <p className="mt-2 text-xs leading-5 text-slate-600">{flowPrompt}</p>
      </div>
      {lessonOpen ? (
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 py-5">
          <button type="button" onClick={onStopLesson} className="mb-4 self-start text-xs text-blue-600 hover:underline">返回知识详情</button>
          <div className="text-xs font-medium text-violet-700">主动回忆</div>
          <h3 className="mt-2 text-lg font-semibold">用自己的话解释“{node.title}”</h3>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">不要照抄定义。说明它是什么、为什么重要，并给一个例子。</p>
          <textarea value={answer} onChange={(event) => onAnswer(event.target.value)} className="mt-4 min-h-44 resize-y rounded-lg border p-3 text-sm leading-6 outline-none focus:ring-2 focus:ring-blue-200" placeholder={`例如：${node.title}的本质是……它可以用在……`} />
          <button type="button" onClick={onSubmit} disabled={saving || answer.trim().length < 12} className="mt-3 h-10 rounded-lg bg-blue-600 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-40">{saving ? "正在保存…" : "保存这次讲解"}</button>
          {submitted && <p className="mt-3 text-sm text-emerald-700">已保存。这表示你完成了一次主动讲解，但当前版本不会自动判断内容是否正确。</p>}
          {saveError && <p className="mt-3 text-sm text-red-600">{saveError}</p>}
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
          <div className="rounded-lg border bg-slate-50/70 p-4">
            <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">精华</div>
            <p className="mt-2 text-[15px] leading-7 text-slate-900">{node.essence}</p>
          </div>
          <div className="mt-5">
            <div className="text-xs font-medium text-muted-foreground">来源</div>
            <div className="mt-1 text-sm font-medium">{node.source}</div>
            <div className="mt-1 text-xs leading-5 text-muted-foreground">{node.sourceDetail}</div>
          </div>
          <div className="mt-5">
            <div className="text-xs font-medium text-muted-foreground">前置知识</div>
            {prerequisites.length > 0 ? prerequisites.map((item) => <button key={item.id} type="button" onClick={() => onSelect(item.id)} className="mt-2 mr-2 rounded-md border px-2.5 py-1.5 text-xs hover:bg-slate-50">{item.title}</button>) : <p className="mt-1 text-sm text-slate-600">这是该分支的起点，不要求额外先修知识。</p>}
          </div>
          <div className="mt-5">
            <div className="text-xs font-medium text-muted-foreground">下一层知识</div>
            {children.length > 0 ? children.slice(0, 12).map((item) => <button key={item.id} type="button" onClick={() => onSelect(item.id)} className="mt-2 flex w-full items-center gap-2 rounded-lg border p-2.5 text-left hover:bg-slate-50"><span className="flex h-7 w-7 items-center justify-center rounded-md bg-blue-50 text-xs font-semibold text-blue-700">{item.glyph}</span><span className="min-w-0"><strong className="block truncate text-sm">{item.title}</strong><span className="block truncate text-xs font-normal text-muted-foreground">{item.essence}</span></span></button>) : <p className="mt-1 text-sm text-slate-600">这是当前知识树的叶节点，可以直接进入练习。</p>}
          </div>
          <button type="button" onClick={onStartLesson} className="mt-6 flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-blue-600 text-sm font-medium text-white hover:bg-blue-700"><Play className="h-4 w-4 fill-current" />开始主动讲解</button>
        </div>
      )}
    </aside>
  )
}

export function LearningView() {
  const project = useWikiStore((state) => state.project)
  const dataVersion = useWikiStore((state) => state.dataVersion)
  const selectedNodeId = useLearningStore((state) => state.selectedNodeId)
  const zoom = useLearningStore((state) => state.zoom)
  const query = useLearningStore((state) => state.query)
  const detailOpen = useLearningStore((state) => state.detailOpen)
  const lessonOpen = useLearningStore((state) => state.lessonOpen)
  const lessonAnswer = useLearningStore((state) => state.lessonAnswer)
  const lessonSubmitted = useLearningStore((state) => state.lessonSubmitted)
  const masteryByNode = useLearningStore((state) => state.masteryByNode)
  const attempts = useLearningStore((state) => state.attempts)
  const hydratedProjectPath = useLearningStore((state) => state.hydratedProjectPath)
  const selectNode = useLearningStore((state) => state.selectNode)
  const setZoom = useLearningStore((state) => state.setZoom)
  const setQuery = useLearningStore((state) => state.setQuery)
  const setDetailOpen = useLearningStore((state) => state.setDetailOpen)
  const setLessonOpen = useLearningStore((state) => state.setLessonOpen)
  const setLessonAnswer = useLearningStore((state) => state.setLessonAnswer)
  const submitLesson = useLearningStore((state) => state.submitLesson)
  const hydrate = useLearningStore((state) => state.hydrate)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const wheelAccumulator = useRef(0)
  const [atlas, setAtlas] = useState<LearningAtlas>(SAMPLE_ATLAS)
  const [atlasLoading, setAtlasLoading] = useState(true)
  const [focusNodeId, setFocusNodeId] = useState<string | null>(null)
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null)
  const [routePinned, setRoutePinned] = useState(false)
  const [childWindowOffset, setChildWindowOffset] = useState(0)
  const [lessonSaving, setLessonSaving] = useState(false)
  const [lessonSaveError, setLessonSaveError] = useState<string | null>(null)
  const previewMode = typeof window !== "undefined"
    && (import.meta.env.DEV || window.location.hostname === "127.0.0.1" || window.location.hostname === "localhost")
    && new URLSearchParams(window.location.search).has("learning-preview")
  const reduceMotion = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
  const activeNodes = atlas.nodes.length > 0 ? atlas.nodes : [EMPTY_NODE]
  const node = findLearningNode(selectedNodeId, activeNodes)
  const focusNode = focusNodeId ? findLearningNode(focusNodeId, activeNodes) : null
  const childCount = focusNode ? getLearningChildren(focusNode.id, activeNodes).length : 0
  const routeNodeId = routePinned ? selectedNodeId : (hoveredNodeId ?? focusNodeId)
  const routeNode = routeNodeId ? activeNodes.find((item) => item.id === routeNodeId) ?? null : null
  const mastery = masteryByNode[node.id] ?? node.mastery
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
        const first = result.nodes.find((item) => item.kind === "concept") ?? result.nodes[0]
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
  }, [attempts, hydratedProjectPath, masteryByNode, project, selectedNodeId])

  const navigateTo = (nodeId: string) => {
    selectNode(nodeId)
    setFocusNodeId(nodeId)
    setChildWindowOffset(0)
    if (!routePinned) setHoveredNodeId(null)
  }

  const handleWheel = (event: React.WheelEvent<HTMLElement>) => {
    if (childCount <= 24) return
    wheelAccumulator.current += event.deltaY
    if (Math.abs(wheelAccumulator.current) < 55) return
    const direction = wheelAccumulator.current > 0 ? 1 : -1
    wheelAccumulator.current = 0
    setChildWindowOffset((current) => (current + direction * 8 + childCount) % childCount)
  }

  const handleSubmitLesson = async () => {
    if (!submitLesson() || !project) return
    if (saveTimer.current) clearTimeout(saveTimer.current)
    setLessonSaving(true)
    setLessonSaveError(null)
    try {
      await saveLearningProgress(project.path, useLearningStore.getState().toSnapshot())
    } catch (error) {
      console.warn("[learning] failed to save submitted lesson", error)
      setLessonSaveError("保存失败。请确认项目目录可以写入，然后重试。")
    } finally {
      setLessonSaving(false)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background">
      <header className="knowledge-atlas-header">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border bg-white"><Network className="h-4 w-4 text-slate-700" /></div>
          <div className="min-w-0"><h1 className="truncate text-sm font-semibold">知识宇宙</h1><p className="truncate text-[11px] text-muted-foreground">{project?.name ?? "通用知识库"} · {atlas.totalConcepts} 个知识节点</p></div>
        </div>
        <nav className="hidden min-w-0 flex-1 items-center justify-center gap-1.5 overflow-hidden px-4 text-xs text-muted-foreground lg:flex" aria-label="当前知识路径">
          <button type="button" onClick={() => setFocusNodeId(null)} className="shrink-0 rounded-md px-2 py-1 hover:bg-slate-100 hover:text-foreground">全局</button>
          {getLearningBreadcrumb(node.id, activeNodes).map((item) => <span key={item.id} className="flex min-w-0 items-center gap-1.5"><ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-300" /><button type="button" onClick={() => navigateTo(item.id)} className={`truncate rounded-md px-2 py-1 hover:bg-slate-100 ${item.id === node.id ? "font-medium text-blue-700" : ""}`}>{item.title}</button></span>)}
        </nav>
        <div className="relative w-[260px] shrink-0 xl:w-[340px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} aria-label="搜索知识" placeholder="搜索知识、公式、定理…" className="h-9 w-full rounded-lg border bg-white pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-blue-200" />
          {matches.length > 0 && <div className="absolute left-0 right-0 top-11 z-50 overflow-hidden rounded-lg border bg-white shadow-xl">{matches.map((item) => <button key={item.id} type="button" onClick={() => { navigateTo(item.id); setQuery("") }} className="flex w-full items-center gap-3 border-b px-3 py-2.5 text-left last:border-b-0 hover:bg-slate-50"><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-blue-50 text-xs font-semibold text-blue-700">{item.glyph}</span><span className="min-w-0"><strong className="block truncate text-sm">{item.title}</strong><span className="block truncate text-xs font-normal text-muted-foreground">{item.essence}</span></span></button>)}</div>}
        </div>
        <button type="button" onClick={() => { setDetailOpen(true); setLessonOpen(false) }} className="flex h-9 shrink-0 items-center gap-2 rounded-lg bg-blue-600 px-4 text-sm font-medium text-white hover:bg-blue-700"><Play className="h-3.5 w-3.5 fill-current" />进入学习</button>
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
          {childCount > 24 && <div className="absolute bottom-6 left-1/2 -translate-x-1/2 rounded-full border bg-white/95 px-4 py-2 text-xs text-slate-600 shadow-sm">滚轮浏览子节点 · 当前 {childWindowOffset + 1}–{Math.min(childWindowOffset + 24, childCount)} / {childCount}</div>}
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

        {routeNode && <RouteCard node={routeNode} nodes={activeNodes} pinned={routePinned} onTogglePin={() => setRoutePinned((value) => !value)} onSelect={navigateTo} />}
        {!routeNode && <div className="absolute bottom-5 right-20 z-20 flex items-center gap-2 rounded-md border bg-white/90 px-3 py-2 text-[11px] text-muted-foreground"><Eye className="h-3.5 w-3.5" />悬停知识点查看同级学习顺序</div>}
        {atlasLoading && <div className="absolute inset-0 z-40 flex items-center justify-center bg-white/70 text-sm text-muted-foreground">正在整理当前知识库的结构…</div>}
        {!atlasLoading && !atlas.isSample && atlas.totalConcepts === 0 && <div className="absolute inset-0 z-20 flex items-center justify-center"><div className="max-w-sm rounded-xl border bg-white p-6 text-center shadow-sm"><BookOpen className="mx-auto h-6 w-6 text-slate-400" /><div className="mt-3 text-base font-semibold">知识库还没有可绘制的知识页</div><p className="mt-2 text-sm leading-6 text-muted-foreground">请先导入资料并完成知识生成。生成后的页面和章节会自动进入知识球。</p></div></div>}

        {detailOpen && <DetailDrawer node={node} nodes={activeNodes} lessonOpen={lessonOpen} answer={lessonAnswer} submitted={lessonSubmitted} saving={lessonSaving} saveError={lessonSaveError} onClose={() => setDetailOpen(false)} onStartLesson={() => setLessonOpen(true)} onStopLesson={() => setLessonOpen(false)} onAnswer={setLessonAnswer} onSubmit={handleSubmitLesson} onSelect={navigateTo} />}
      </div>
      <div className="sr-only" aria-live="polite">当前知识：{node.title}。掌握状态：{MASTERY_LABELS[mastery]}。</div>
    </div>
  )
}
