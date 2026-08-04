/*
THESIS: A large knowledge system becomes controllable when it compresses into nested regions and expands only around the learner's focus.
OWN-WORLD: Existing LLM Wiki white surfaces, hairline dividers, Geist typography, compact controls, violet knowledge regions, and blue actions.
STORY: Find a concept, see where it lives, inspect its essence and source, then prove understanding without losing map position.
FIRST VIEWPORT: The semantic atlas owns the canvas, a thin breadcrumb and search sit above it, and the selected node opens in a stable right inspector.
FORM: Operate-first spatial atlas extending the incumbent desktop system; the selected ImageGen composition is the fixed visual target.
*/
import { useEffect, useMemo, useRef, useState } from "react"
import {
  Atom,
  BookOpen,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Crosshair,
  Lightbulb,
  Magnet,
  Minus,
  Play,
  Plus,
  Search,
  Sparkles,
  Sun,
  Thermometer,
  X,
} from "lucide-react"
import { useWikiStore } from "@/stores/wiki-store"
import {
  LEARNING_NODES,
  LEARNING_REGIONS,
  findLearningNode,
  getLearningBreadcrumb,
  type LearningNode,
  type LearningRegion,
} from "./learning-data"
import { loadProjectLearningAtlas, type LearningAtlas } from "./learning-atlas"
import { loadLearningProgress, saveLearningProgress } from "./learning-persistence"
import { useLearningStore } from "./learning-store"

const REGION_ICONS = {
  mechanics: Sparkles,
  thermal: Thermometer,
  electromagnetism: Magnet,
  optics: Sun,
  atomic: Atom,
} as const

const MASTERY_LABELS = {
  unseen: "未学",
  started: "入门",
  understood: "理解",
  practiced: "熟练",
  mastered: "精通",
} as const

const REGION_DOTS = [
  [12, 19], [24, 27], [35, 15], [47, 24], [59, 14], [70, 22], [82, 17], [89, 34],
  [16, 44], [31, 48], [44, 39], [58, 48], [73, 43], [85, 55], [21, 65], [36, 72],
  [50, 66], [63, 76], [76, 69], [88, 78], [15, 82], [45, 86], [69, 88],
]

const SAMPLE_ATLAS: LearningAtlas = {
  nodes: LEARNING_NODES,
  regions: LEARNING_REGIONS,
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

function regionColors(color: LearningRegion["color"]) {
  if (color === "cyan") return { border: "border-cyan-300/80", dot: "bg-cyan-300/70", text: "text-cyan-700", tint: "bg-cyan-50/50" }
  if (color === "blue") return { border: "border-blue-300/70", dot: "bg-blue-300/65", text: "text-blue-700", tint: "bg-blue-50/35" }
  return { border: "border-violet-300/80", dot: "bg-violet-300/70", text: "text-violet-700", tint: "bg-violet-50/55" }
}

function MasteryScale({ active }: { active: keyof typeof MASTERY_LABELS }) {
  const keys = Object.keys(MASTERY_LABELS) as (keyof typeof MASTERY_LABELS)[]
  return (
    <div className="grid grid-cols-5 gap-1 pt-2">
      {keys.map((key) => (
        <div key={key} className="flex flex-col items-center gap-2 text-[11px] text-muted-foreground">
          <span className={`h-3 w-3 rounded-full border ${key === active ? "border-violet-600 bg-violet-600 ring-4 ring-violet-100" : "border-border bg-background"}`} />
          <span className={key === active ? "font-medium text-foreground" : ""}>{MASTERY_LABELS[key]}</span>
        </div>
      ))}
    </div>
  )
}

function AtlasRegion({ region, nodes, selectedNodeId, onSelect }: { region: LearningRegion; nodes: readonly LearningNode[]; selectedNodeId: string; onSelect: (nodeId: string) => void }) {
  const colors = regionColors(region.color)
  const Icon = REGION_ICONS[region.id as keyof typeof REGION_ICONS] ?? Sparkles
  const isMechanics = region.id === "mechanics"
  return (
    <section
      className={`absolute overflow-hidden rounded-[44%] border border-dashed ${colors.border} ${colors.tint}`}
      style={{ left: `${region.position.x}%`, top: `${region.position.y}%`, width: `${region.position.width}%`, height: `${region.position.height}%` }}
      aria-label={`${region.title}知识区域`}
    >
      {REGION_DOTS.map(([x, y], index) => (
        <span
          key={index}
          aria-hidden="true"
          className={`absolute rounded-full ${colors.dot}`}
          style={{ left: `${x}%`, top: `${y}%`, width: `${6 + (index % 3) * 3}px`, height: `${6 + (index % 3) * 3}px` }}
        />
      ))}
      <button
        type="button"
        onClick={() => onSelect(region.id)}
        className={`absolute left-1/2 top-[18%] z-10 flex -translate-x-1/2 items-center gap-2 whitespace-nowrap rounded-lg bg-background/95 px-3 py-2 text-sm font-semibold shadow-sm ring-1 ring-border/60 ${colors.text} hover:bg-background focus-visible:outline-2 focus-visible:outline-blue-600 xl:px-4`}
      >
        <Icon className="h-4 w-4" />
        {region.title}
      </button>
      <>
        {isMechanics && (
          <>
          <div aria-hidden="true" className="absolute left-[8%] top-[25%] h-[48%] w-[46%] rounded-[45%] border border-dashed border-violet-300/70 bg-violet-50/60" />
          <div aria-hidden="true" className="absolute left-[54%] top-[29%] h-[26%] w-[29%] rounded-[45%] border border-dashed border-violet-300/60 bg-violet-50/45" />
          <div aria-hidden="true" className="absolute left-[50%] top-[57%] h-[24%] w-[28%] rounded-[45%] border border-dashed border-violet-300/60 bg-violet-50/45" />
          </>
        )}
          {region.nodeIds.filter((id) => id !== region.id).map((nodeId) => {
            const node = findLearningNode(nodeId, nodes)
            const selected = node.id === selectedNodeId
            return (
              <button
                key={node.id}
                type="button"
                onClick={(event) => { event.stopPropagation(); onSelect(node.id) }}
                title={`${node.title}：${node.essence}`}
                className={`absolute z-20 flex items-center justify-center rounded-full text-sm font-semibold transition-[transform,border-color,box-shadow] duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 ${node.kind === "group" ? "h-8 min-w-8 px-2 text-[11px]" : "h-10 w-10"} ${selected ? "border-2 border-blue-600 bg-background text-blue-700 shadow-md ring-4 ring-blue-100" : "border border-violet-100 bg-background/95 text-violet-700 shadow-sm hover:-translate-y-0.5 hover:border-violet-300"}`}
                style={{ left: `${node.position.x}%`, top: `${node.position.y}%`, transform: "translate(-50%, -50%)" }}
                aria-label={`${node.title}：${node.essence}`}
                aria-pressed={selected}
              >
                {node.glyph}
              </button>
            )
          })}
        </>
    </section>
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
  const [legendOpen, setLegendOpen] = useState(true)
  const [lessonSaving, setLessonSaving] = useState(false)
  const [lessonSaveError, setLessonSaveError] = useState<string | null>(null)
  const previewMode = typeof window !== "undefined"
    && (import.meta.env.DEV || window.location.hostname === "127.0.0.1" || window.location.hostname === "localhost")
    && new URLSearchParams(window.location.search).has("learning-preview")
  const [atlas, setAtlas] = useState<LearningAtlas>(SAMPLE_ATLAS)
  const [atlasLoading, setAtlasLoading] = useState(!previewMode)
  const activeNodes = atlas.nodes.length > 0 ? atlas.nodes : [EMPTY_NODE]

  const node = findLearningNode(selectedNodeId, activeNodes)
  const breadcrumb = getLearningBreadcrumb(node.id, activeNodes)
  const prerequisite = node.prerequisiteIds[0] ? findLearningNode(node.prerequisiteIds[0], activeNodes) : null
  const childNodes = activeNodes.filter((item) => item.parentId === node.id).slice(0, 12)
  const mastery = masteryByNode[node.id] ?? node.mastery
  const matches = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    if (!normalized) return []
    return activeNodes.filter((item) => item.kind !== "region" && `${item.title}${item.glyph}${item.essence}`.toLowerCase().includes(normalized)).slice(0, 6)
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
        setAtlas({ nodes: [], regions: [], isSample: false, totalConcepts: 0 })
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
      saveLearningProgress(project.path, useLearningStore.getState().toSnapshot()).catch((error) => {
        console.warn("[learning] failed to save progress", error)
      })
    }, 300)
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
    }
  }, [attempts, hydratedProjectPath, masteryByNode, project, selectedNodeId])

  const handleSubmitLesson = async () => {
    if (!submitLesson() || !project) return
    if (saveTimer.current) clearTimeout(saveTimer.current)
    setLessonSaving(true)
    setLessonSaveError(null)
    try {
      await saveLearningProgress(project.path, useLearningStore.getState().toSnapshot())
    } catch (error) {
      console.warn("[learning] failed to save submitted lesson", error)
      setLessonSaveError("保存失败，请检查项目目录是否可写，然后重试。")
    } finally {
      setLessonSaving(false)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <header className="flex h-[66px] shrink-0 items-center border-b px-7">
        <div className="min-w-[170px] shrink-0 text-lg font-semibold tracking-tight xl:min-w-[260px]">语义地图 <span className="hidden font-normal text-muted-foreground xl:inline">/ Semantic Atlas</span></div>
        <nav className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden text-sm text-muted-foreground" aria-label="知识路径">
          <span className="shrink-0 font-medium text-foreground">{project?.name ?? "知识库"}</span>
          {breadcrumb.map((item) => (
            <span key={item.id} className="flex min-w-0 items-center gap-2">
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/60" />
              <button type="button" onClick={() => selectNode(item.id)} className={`truncate focus-visible:outline-2 focus-visible:outline-blue-600 ${item.id === node.id ? "font-medium text-blue-600" : "hover:text-foreground"}`}>{item.title}</button>
            </span>
          ))}
        </nav>
        <div className="relative mx-3 w-[250px] shrink-0 xl:mx-4 xl:w-[330px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input aria-label="搜索知识地图" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索知识点、公式、定理…" className="h-10 w-full rounded-lg border bg-background pl-9 pr-3 text-sm outline-none transition-shadow focus:ring-2 focus:ring-blue-200" />
          {matches.length > 0 && (
            <div className="absolute left-0 right-0 top-12 z-50 overflow-hidden rounded-lg border bg-popover shadow-lg">
              {matches.map((item) => (
                <button key={item.id} type="button" onClick={() => { selectNode(item.id); setQuery("") }} className="flex w-full items-start gap-3 border-b px-3 py-2.5 text-left last:border-b-0 hover:bg-accent focus-visible:bg-accent focus-visible:outline-none">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-violet-50 text-xs font-semibold text-violet-700">{item.glyph}</span>
                  <span className="min-w-0"><span className="block text-sm font-medium">{item.title}</span><span className="block truncate text-xs text-muted-foreground">{item.essence}</span></span>
                </button>
              ))}
            </div>
          )}
        </div>
        <button type="button" onClick={() => setLessonOpen(true)} className="flex h-10 shrink-0 items-center gap-2 rounded-lg bg-blue-600 px-5 text-sm font-medium text-white hover:bg-blue-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600">
          <Play className="h-4 w-4 fill-current" />进入学习
        </button>
      </header>

      <div className="flex min-h-0 flex-1">
        <main className="relative min-w-0 flex-1 overflow-hidden bg-[color:oklch(0.99_0.006_265)]">
          <button type="button" onClick={() => setLegendOpen((value) => !value)} className="absolute left-6 top-6 z-30 flex h-10 items-center gap-2 rounded-lg border bg-background px-3 text-sm shadow-sm hover:bg-accent focus-visible:outline-2 focus-visible:outline-blue-600">
            <CircleHelp className="h-4 w-4" />图例<ChevronDown className={`h-4 w-4 transition-transform ${legendOpen ? "rotate-180" : ""}`} />
          </button>
          <div className="absolute inset-0 origin-center transition-transform duration-200 motion-reduce:transition-none" style={{ transform: `scale(${zoom})` }}>
            {atlas.regions.map((region) => <AtlasRegion key={region.id} region={region} nodes={activeNodes} selectedNodeId={node.id} onSelect={selectNode} />)}
          </div>
          {atlasLoading && <div className="absolute inset-0 z-40 flex items-center justify-center bg-background/65 text-sm text-muted-foreground">正在整理当前知识库的知识地图…</div>}
          {!atlasLoading && !atlas.isSample && atlas.totalConcepts === 0 && <div className="absolute inset-0 z-20 flex items-center justify-center"><div className="max-w-sm rounded-xl border bg-background p-6 text-center shadow-sm"><div className="text-base font-semibold">知识库还没有可绘制的知识页</div><p className="mt-2 text-sm leading-6 text-muted-foreground">请先导入资料并完成知识生成。生成后的概念会自动按关联区域进入这里。</p></div></div>}
          {legendOpen && (
            <div className="absolute bottom-6 left-6 z-30 w-36 rounded-lg border bg-background p-3 text-xs shadow-sm">
              <div className="mb-2 font-medium">地图层级</div>
              {["学科领域", "一级主题", "二级主题", "当前节点"].map((label, index) => (
                <div key={label} className="flex items-center gap-2 py-1 text-muted-foreground"><span className={index === 3 ? "h-3 w-3 rounded-full border-2 border-blue-600 bg-background" : "h-2.5 w-2.5 rounded-full bg-violet-300"} />{label}</div>
              ))}
            </div>
          )}
          <div className="absolute bottom-6 right-6 z-30 overflow-hidden rounded-lg border bg-background shadow-sm">
            <button type="button" onClick={() => setZoom(1)} className="flex h-10 w-11 items-center justify-center border-b hover:bg-accent focus-visible:bg-accent focus-visible:outline-none" aria-label="重置缩放"><Crosshair className="h-4 w-4" /></button>
            <button type="button" onClick={() => setZoom(zoom + 0.1)} className="flex h-10 w-11 items-center justify-center border-b hover:bg-accent focus-visible:bg-accent focus-visible:outline-none" aria-label="放大"><Plus className="h-4 w-4" /></button>
            <div className="flex h-9 w-11 items-center justify-center border-b text-[11px] text-muted-foreground" aria-live="polite">{Math.round(zoom * 100)}%</div>
            <button type="button" onClick={() => setZoom(zoom - 0.1)} className="flex h-10 w-11 items-center justify-center hover:bg-accent focus-visible:bg-accent focus-visible:outline-none" aria-label="缩小"><Minus className="h-4 w-4" /></button>
          </div>
        </main>

        {detailOpen && (
          <aside className="flex w-[350px] shrink-0 flex-col overflow-y-auto border-l bg-background">
            <div className="flex items-center justify-between border-b px-6 py-5">
              <div className="flex items-center gap-2 text-lg font-semibold text-violet-700"><span className="h-3 w-3 rounded-full bg-violet-400" />{node.title}</div>
              <button type="button" onClick={() => setDetailOpen(false)} className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent focus-visible:outline-2 focus-visible:outline-blue-600" aria-label="关闭详情"><X className="h-4 w-4" /></button>
            </div>
            {lessonOpen ? (
              <div className="flex flex-1 flex-col px-6 py-5">
                <button type="button" onClick={() => setLessonOpen(false)} className="mb-5 self-start text-sm text-blue-600 hover:underline focus-visible:outline-2 focus-visible:outline-blue-600">返回知识详情</button>
                <div className="mb-2 text-xs font-medium text-violet-700">主动回忆</div>
                <h2 className="text-xl font-semibold">用自己的话解释“{node.title}”</h2>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">不要照抄定义。请说明它描述什么、与“{prerequisite?.title ?? "前置知识"}”有什么关系，并举一个生活中的例子。</p>
                <textarea value={lessonAnswer} onChange={(event) => { setLessonAnswer(event.target.value); setLessonSaveError(null) }} className="mt-5 min-h-40 resize-none rounded-lg border p-3 text-sm leading-6 outline-none focus:ring-2 focus:ring-blue-200" placeholder="例如：汽车从静止开始越来越快……" aria-describedby="lesson-help" />
                <div id="lesson-help" className="mt-2 text-xs text-muted-foreground">至少输入 12 个字，系统才会记录本次练习。</div>
                {lessonSubmitted && lessonSaving && <div role="status" className="mt-4 rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground">正在保存本次解释…</div>}
                {lessonSubmitted && !lessonSaving && !lessonSaveError && <div role="status" className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">已保存一次主动解释证据。下一步将加入独立评分与迁移题。</div>}
                {lessonSaveError && <div role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{lessonSaveError}</div>}
                <button type="button" onClick={handleSubmitLesson} disabled={lessonAnswer.trim().length < 12 || lessonSaving} className="mt-auto h-11 rounded-lg bg-blue-600 text-sm font-medium text-white hover:bg-blue-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:cursor-not-allowed disabled:opacity-40">{lessonSaving ? "正在保存…" : "提交理解"}</button>
              </div>
            ) : (
              <div className="divide-y px-6">
                <section className="py-6"><div className="text-sm text-muted-foreground">本质</div><p className="mt-3 text-base leading-7">{node.essence}</p></section>
                <section className="py-6"><div className="flex items-center gap-2 text-sm text-muted-foreground">先修知识 <CircleHelp className="h-3.5 w-3.5" /></div>{prerequisite ? <button type="button" onClick={() => selectNode(prerequisite.id)} className="mt-4 flex w-full items-start gap-3 text-left focus-visible:outline-2 focus-visible:outline-blue-600"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-violet-50 font-semibold text-violet-700">{prerequisite.glyph}</span><span><span className="block text-sm font-medium text-violet-700">{prerequisite.title}</span><span className="mt-1 block text-xs leading-5 text-muted-foreground">{prerequisite.essence}</span></span></button> : <p className="mt-3 text-sm text-muted-foreground">这是该分支的起点，不要求额外先修知识。</p>}</section>
                {childNodes.length > 0 && <section className="py-6"><div className="text-sm text-muted-foreground">下一层知识</div><div className="mt-3 space-y-2">{childNodes.map((child) => <button key={child.id} type="button" onClick={() => selectNode(child.id)} className="flex w-full items-center gap-3 rounded-lg border p-3 text-left hover:bg-accent focus-visible:outline-2 focus-visible:outline-blue-600"><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-violet-50 text-sm font-semibold text-violet-700">{child.glyph}</span><span className="min-w-0"><span className="block truncate text-sm font-medium">{child.title}</span><span className="mt-0.5 block truncate text-xs text-muted-foreground">{child.essence}</span></span></button>)}</div></section>}
                <section className="py-6"><div className="flex items-center gap-2 text-sm text-muted-foreground">来源 <BookOpen className="h-4 w-4" /></div><div className="mt-4 rounded-lg border p-3"><div className="text-sm font-medium">{node.source}</div><div className="mt-1 text-xs text-muted-foreground">{node.sourceDetail}</div></div></section>
                <section className="py-6"><div className="flex items-center gap-2 text-sm text-muted-foreground">掌握状态 <CircleHelp className="h-3.5 w-3.5" /></div><div className="mt-4 text-sm font-medium">{MASTERY_LABELS[mastery]}</div><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full bg-violet-600" style={{ width: `${(["unseen", "started", "understood", "practiced", "mastered"].indexOf(mastery) + 1) * 20}%` }} /></div><MasteryScale active={mastery} /></section>
                <section className="py-6"><div className="text-sm text-muted-foreground">相关能力</div><div className="mt-3 flex flex-wrap gap-2">{node.capabilities.map((capability) => <span key={capability} className="rounded-md border bg-muted/35 px-2 py-1 text-xs">{capability}</span>)}</div></section>
              </div>
            )}
            {!lessonOpen && <div className="mt-auto border-t p-5"><button type="button" onClick={() => setLessonOpen(true)} className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-blue-600 text-sm font-medium text-white hover:bg-blue-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"><Play className="h-4 w-4 fill-current" />进入学习</button><button type="button" onClick={() => setLessonOpen(true)} className="mt-2 flex h-10 w-full items-center justify-center gap-2 rounded-lg border text-sm hover:bg-accent focus-visible:outline-2 focus-visible:outline-blue-600"><Lightbulb className="h-4 w-4" />练习</button></div>}
          </aside>
        )}
      </div>
    </div>
  )
}
