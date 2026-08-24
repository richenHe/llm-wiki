import { useId, useMemo, useState } from "react"
import type { LearningNode } from "./learning-data"
import type { LearningBoard, LearningBoardRelation, LearningBoardRelationKind } from "./learning-routes"
import { learningBoardNodes } from "./learning-routes"

const CANVAS_WIDTH = 360
const NODE_WIDTH = 104
const NODE_HEIGHT = 48
const ROW_GAP = 88
const RELATION_COLORS: Record<LearningBoardRelationKind, string> = {
  connection: "#7c3aed",
  prerequisite: "#2563eb",
  process: "#d97706",
  application: "#059669",
}

interface RelationMapNode {
  id: string
  title: string
  virtual?: boolean
}

interface PositionedNode extends RelationMapNode {
  x: number
  y: number
}

function relationMapData(board: LearningBoard, nodes: readonly LearningNode[]): {
  nodes: RelationMapNode[]
  relations: LearningBoardRelation[]
} {
  const boardNodes = learningBoardNodes(board, nodes).map((node) => ({ id: node.id, title: node.title }))
  if (board.relations.length > 0) return { nodes: boardNodes, relations: board.relations }
  const hubId = `board:${board.id}`
  return {
    nodes: [{ id: hubId, title: board.title, virtual: true }, ...boardNodes],
    relations: boardNodes.map((node) => ({
      sourceId: hubId,
      targetId: node.id,
      kind: "connection" as const,
      label: "共同属于",
      evidence: board.reason,
    })),
  }
}

function rowCenters(count: number): number[] {
  if (count === 1) return [CANVAS_WIDTH / 2]
  if (count === 2) return [96, 264]
  return [56, 180, 304]
}

function layoutNodes(nodes: readonly RelationMapNode[]): { nodes: PositionedNode[]; height: number } {
  const rows: RelationMapNode[][] = []
  for (let index = 0; index < nodes.length; index += 3) rows.push(nodes.slice(index, index + 3))
  const positioned = rows.flatMap((row, rowIndex) => {
    const centers = rowCenters(row.length)
    return row.map((node, index) => ({ ...node, x: centers[index], y: 36 + rowIndex * ROW_GAP }))
  })
  return { nodes: positioned, height: Math.max(96, 72 + Math.max(0, rows.length - 1) * ROW_GAP) }
}

function edgePath(source: PositionedNode, target: PositionedNode): string {
  if (Math.abs(source.y - target.y) < 4) {
    const direction = target.x >= source.x ? 1 : -1
    return `M ${source.x + direction * NODE_WIDTH / 2} ${source.y} L ${target.x - direction * NODE_WIDTH / 2} ${target.y}`
  }
  const downward = target.y > source.y
  const sourceY = source.y + (downward ? NODE_HEIGHT / 2 : -NODE_HEIGHT / 2)
  const targetY = target.y + (downward ? -NODE_HEIGHT / 2 : NODE_HEIGHT / 2)
  const controlY = (sourceY + targetY) / 2
  return `M ${source.x} ${sourceY} C ${source.x} ${controlY}, ${target.x} ${controlY}, ${target.x} ${targetY}`
}

function RelationNode({ item, currentNodeId, activeNodeId, connectedNodeIds, onSelect, onActivate }: {
  item: PositionedNode
  currentNodeId: string
  activeNodeId: string | null
  connectedNodeIds: ReadonlySet<string>
  onSelect: (nodeId: string) => void
  onActivate: (nodeId: string | null) => void
}) {
  const isCurrent = item.id === currentNodeId
  const isActive = item.id === activeNodeId
  const isConnected = connectedNodeIds.has(item.id)
  const commonClass = "absolute z-20 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-xl px-2 py-2 text-center text-xs leading-4 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-violet-400"
  const style = { left: item.x, top: item.y, width: NODE_WIDTH, minHeight: NODE_HEIGHT }
  const stateClass = isCurrent
    ? "bg-blue-600 font-semibold text-white shadow-[0_5px_14px_rgb(37_99_235/0.2)]"
    : isActive
      ? "bg-violet-600 font-semibold text-white shadow-[0_5px_14px_rgb(124_58_237/0.18)]"
      : isConnected
        ? "bg-violet-50 font-medium text-violet-800 ring-1 ring-violet-200"
        : "bg-slate-50 font-medium text-slate-700 ring-1 ring-slate-200 hover:bg-violet-50 hover:text-violet-800"
  const activate = () => onActivate(item.id)
  if (item.virtual) {
    return <div tabIndex={0} onMouseEnter={activate} onFocus={activate} className={`${commonClass} ${stateClass}`} style={style}>{item.title}</div>
  }
  return <button type="button" onClick={() => onSelect(item.id)} onMouseEnter={activate} onFocus={activate} aria-current={isCurrent ? "true" : undefined} title={item.title} className={`${commonClass} ${stateClass}`} style={style}>{item.title}</button>
}

export function LearningRelationMap({ board, nodes, currentNodeId, onSelect }: {
  board: LearningBoard
  nodes: readonly LearningNode[]
  currentNodeId: string
  onSelect: (nodeId: string) => void
}) {
  const map = useMemo(() => relationMapData(board, nodes), [board, nodes])
  const layout = useMemo(() => layoutNodes(map.nodes), [map.nodes])
  const positionedById = useMemo(() => new Map(layout.nodes.map((node) => [node.id, node])), [layout.nodes])
  const markerPrefix = useId().replace(/:/g, "")
  const [activeNodeId, setActiveNodeId] = useState<string | null>(null)
  const activeRelations = useMemo(() => activeNodeId
    ? map.relations.filter((relation) => relation.sourceId === activeNodeId || relation.targetId === activeNodeId)
    : [], [activeNodeId, map.relations])
  const connectedNodeIds = useMemo(() => new Set(activeRelations.flatMap((relation) => [relation.sourceId, relation.targetId])), [activeRelations])
  const activeNode = activeNodeId ? positionedById.get(activeNodeId) : undefined

  return <div onMouseLeave={() => setActiveNodeId(null)} onBlur={(event) => {
    if (!event.currentTarget.contains(event.relatedTarget)) setActiveNodeId(null)
  }}>
    <div className="overflow-x-auto">
      <div className="relative mx-auto" style={{ width: CANVAS_WIDTH, height: layout.height }} role="group" aria-label={`${board.title}知识关系图`}>
        <svg className="absolute inset-0" width={CANVAS_WIDTH} height={layout.height} viewBox={`0 0 ${CANVAS_WIDTH} ${layout.height}`} aria-hidden="true">
          <defs>{Object.entries(RELATION_COLORS).map(([kind, color]) => <marker key={kind} id={`${markerPrefix}-${kind}`} markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 Z" fill={color} /></marker>)}</defs>
          {map.relations.map((relation) => {
            const source = positionedById.get(relation.sourceId)
            const target = positionedById.get(relation.targetId)
            if (!source || !target) return null
            const active = activeNodeId === relation.sourceId || activeNodeId === relation.targetId
            return <path key={`${relation.sourceId}-${relation.targetId}`} d={edgePath(source, target)} fill="none" stroke={RELATION_COLORS[relation.kind]} strokeLinecap="round" strokeWidth={active ? 2.5 : 1.25} opacity={activeNodeId ? active ? 1 : 0.12 : 0.38} markerEnd={`url(#${markerPrefix}-${relation.kind})`} />
          })}
        </svg>
        {layout.nodes.map((item) => <RelationNode key={item.id} item={item} currentNodeId={currentNodeId} activeNodeId={activeNodeId} connectedNodeIds={connectedNodeIds} onSelect={onSelect} onActivate={setActiveNodeId} />)}
      </div>
    </div>

    {activeNode && <div className="border-t border-violet-100 bg-violet-50/60 px-3 py-3" role="status" aria-live="polite">
      <div className="text-xs font-semibold text-violet-900">{activeNode.title}的知识关系</div>
      <div className="mt-2 space-y-2">{activeRelations.map((relation) => {
        const outgoing = relation.sourceId === activeNode.id
        const other = positionedById.get(outgoing ? relation.targetId : relation.sourceId)
        if (!other) return null
        return <div key={`${relation.sourceId}-${relation.targetId}`} className="text-xs leading-5 text-violet-950" title={relation.evidence}>
          <span className="mr-1.5 font-semibold" style={{ color: RELATION_COLORS[relation.kind] }}>{outgoing ? "→" : "←"}</span>
          <strong>{other.title}</strong><span className="mx-1.5 text-violet-300">·</span><span>{relation.label}</span>
          <div className="pl-4 text-[11px] leading-4 text-violet-700">{relation.evidence}</div>
        </div>
      })}</div>
    </div>}
    {!activeNode && <div className="border-t border-violet-100 px-3 py-2 text-center text-[11px] text-violet-700">悬浮或聚焦知识点，查看相连关系</div>}
  </div>
}
