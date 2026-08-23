import { useId, useMemo } from "react"
import type { LearningNode } from "./learning-data"
import type { LearningBoard, LearningBoardRelation, LearningBoardRelationKind } from "./learning-routes"
import { learningBoardNodes } from "./learning-routes"

const CANVAS_WIDTH = 360
const NODE_WIDTH = 108
const NODE_HEIGHT = 52
const ROW_GAP = 96
const MAX_NODES_PER_ROW = 3

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

function fallbackMap(board: LearningBoard, nodes: readonly LearningNode[]): { mapNodes: RelationMapNode[]; relations: LearningBoardRelation[] } {
  const mapNodes = nodes.map((node) => ({ id: node.id, title: node.title }))
  if (board.relations.length > 0) return { mapNodes, relations: board.relations }
  const hubId = `board:${board.id}`
  return {
    mapNodes: [{ id: hubId, title: board.title, virtual: true }, ...mapNodes],
    relations: mapNodes.map((node) => ({
      sourceId: hubId,
      targetId: node.id,
      kind: "connection" as const,
      label: "共同属于",
      evidence: board.reason,
    })),
  }
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const result: T[][] = []
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size))
  return result
}

function rowCenters(count: number): number[] {
  if (count === 1) return [CANVAS_WIDTH / 2]
  if (count === 2) return [96, 264]
  return [56, 180, 304]
}

function layoutRelationMap(board: LearningBoard, nodes: readonly LearningNode[]): { nodes: PositionedNode[]; relations: LearningBoardRelation[]; height: number } {
  const { mapNodes, relations } = fallbackMap(board, nodes)
  const nodeById = new Map(mapNodes.map((node) => [node.id, node]))
  const order = new Map(mapNodes.map((node, index) => [node.id, index]))
  const neighbors = new Map(mapNodes.map((node) => [node.id, new Set<string>()]))
  const incoming = new Map(mapNodes.map((node) => [node.id, 0]))
  for (const relation of relations) {
    if (!nodeById.has(relation.sourceId) || !nodeById.has(relation.targetId)) continue
    neighbors.get(relation.sourceId)?.add(relation.targetId)
    neighbors.get(relation.targetId)?.add(relation.sourceId)
    incoming.set(relation.targetId, (incoming.get(relation.targetId) ?? 0) + 1)
  }
  const preferredRoot = board.kind !== "category" ? board.orderedNodeIds[0] : undefined
  const root = nodeById.get(preferredRoot ?? "")
    ?? [...mapNodes].sort((a, b) => {
      if (board.kind === "category") return (neighbors.get(b.id)?.size ?? 0) - (neighbors.get(a.id)?.size ?? 0) || (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0)
      const incomingDifference = (incoming.get(a.id) ?? 0) - (incoming.get(b.id) ?? 0)
      if (incomingDifference !== 0) return incomingDifference
      return (neighbors.get(b.id)?.size ?? 0) - (neighbors.get(a.id)?.size ?? 0) || (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0)
    })[0]
  const levels = new Map<string, number>()
  const queue = root ? [root.id] : []
  if (root) levels.set(root.id, 0)
  while (queue.length > 0) {
    const current = queue.shift()!
    const nextLevel = (levels.get(current) ?? 0) + 1
    for (const neighbor of neighbors.get(current) ?? []) {
      if (levels.has(neighbor)) continue
      levels.set(neighbor, nextLevel)
      queue.push(neighbor)
    }
  }
  let lastLevel = Math.max(0, ...levels.values())
  for (const node of mapNodes) {
    if (levels.has(node.id)) continue
    levels.set(node.id, ++lastLevel)
  }
  const levelGroups = new Map<number, RelationMapNode[]>()
  for (const node of mapNodes) {
    const level = levels.get(node.id) ?? 0
    const group = levelGroups.get(level) ?? []
    group.push(node)
    levelGroups.set(level, group)
  }
  const rows = [...levelGroups.entries()]
    .sort(([a], [b]) => a - b)
    .flatMap(([, group]) => chunk(group.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0)), MAX_NODES_PER_ROW))
  const positioned = rows.flatMap((row, rowIndex) => {
    const centers = rowCenters(row.length)
    return row.map((node, index) => ({ ...node, x: centers[index], y: 42 + rowIndex * ROW_GAP }))
  })
  return { nodes: positioned, relations, height: Math.max(138, rows.length * ROW_GAP + 18) }
}

function edgePath(source: PositionedNode, target: PositionedNode): string {
  if (Math.abs(source.y - target.y) < 8) {
    const direction = target.x >= source.x ? 1 : -1
    return `M ${source.x + direction * NODE_WIDTH / 2} ${source.y} L ${target.x - direction * NODE_WIDTH / 2} ${target.y}`
  }
  const downward = target.y > source.y
  const sourceY = source.y + (downward ? NODE_HEIGHT / 2 : -NODE_HEIGHT / 2)
  const targetY = target.y + (downward ? -NODE_HEIGHT / 2 : NODE_HEIGHT / 2)
  const controlY = (sourceY + targetY) / 2
  return `M ${source.x} ${sourceY} C ${source.x} ${controlY}, ${target.x} ${controlY}, ${target.x} ${targetY}`
}

export function LearningRelationMap({ board, nodes, currentNodeId, onSelect }: {
  board: LearningBoard
  nodes: readonly LearningNode[]
  currentNodeId: string
  onSelect: (nodeId: string) => void
}) {
  const boardNodes = useMemo(() => learningBoardNodes(board, nodes), [board, nodes])
  const layout = useMemo(() => layoutRelationMap(board, boardNodes), [board, boardNodes])
  const markerPrefix = useId().replace(/:/g, "")
  const positionedById = useMemo(() => new Map(layout.nodes.map((node) => [node.id, node])), [layout.nodes])

  return <div className="overflow-x-auto pb-1">
    <div className="relative mx-auto" style={{ width: CANVAS_WIDTH, height: layout.height }} role="group" aria-label={`${board.title}知识关系图`}>
      <svg className="absolute inset-0" width={CANVAS_WIDTH} height={layout.height} viewBox={`0 0 ${CANVAS_WIDTH} ${layout.height}`} aria-hidden="true">
        <defs>{Object.entries(RELATION_COLORS).map(([kind, color]) => <marker key={kind} id={`${markerPrefix}-${kind}`} markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0,0 L7,3.5 L0,7 Z" fill={color} /></marker>)}</defs>
        {layout.relations.map((relation) => {
          const source = positionedById.get(relation.sourceId)
          const target = positionedById.get(relation.targetId)
          if (!source || !target) return null
          const color = RELATION_COLORS[relation.kind]
          return <path key={`${relation.sourceId}-${relation.targetId}`} d={edgePath(source, target)} fill="none" stroke={color} strokeWidth="1.5" markerEnd={relation.kind === "connection" ? undefined : `url(#${markerPrefix}-${relation.kind})`} />
        })}
      </svg>
      {layout.relations.map((relation) => {
        const source = positionedById.get(relation.sourceId)
        const target = positionedById.get(relation.targetId)
        if (!source || !target) return null
        const width = Math.max(48, Math.min(108, Array.from(relation.label).length * 12 + 16))
        return <span key={`${relation.sourceId}-${relation.targetId}-label`} title={relation.evidence} className="absolute z-10 flex h-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded bg-white px-1.5 text-[10px] font-medium shadow-[0_1px_3px_rgb(15_23_42/0.12)]" style={{ left: (source.x + target.x) / 2, top: (source.y + target.y) / 2, width, color: RELATION_COLORS[relation.kind] }}>{relation.label}</span>
      })}
      {layout.nodes.map((mapNode) => mapNode.virtual
        ? <div key={mapNode.id} className="absolute z-20 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-xl border border-violet-200 bg-violet-50 px-3 text-center text-xs font-semibold leading-4 text-violet-800" style={{ left: mapNode.x, top: mapNode.y, width: NODE_WIDTH, height: NODE_HEIGHT }}>{mapNode.title}</div>
        : <button key={mapNode.id} type="button" onClick={() => onSelect(mapNode.id)} title={mapNode.title} className={mapNode.id === currentNodeId ? "absolute z-20 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-xl border border-blue-600 bg-blue-600 px-2 text-center text-xs font-semibold leading-4 text-white shadow-[0_6px_16px_rgb(37_99_235/0.22)] outline-none focus-visible:ring-2 focus-visible:ring-blue-300" : "absolute z-20 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-xl border border-slate-200 bg-white px-2 text-center text-xs font-medium leading-4 text-slate-700 shadow-[0_2px_8px_rgb(15_23_42/0.08)] outline-none hover:border-blue-300 hover:text-blue-700 focus-visible:ring-2 focus-visible:ring-blue-400"} style={{ left: mapNode.x, top: mapNode.y, width: NODE_WIDTH, height: NODE_HEIGHT }}>{mapNode.title}</button>)}
      <ul className="sr-only">{layout.relations.map((relation) => <li key={`${relation.sourceId}-${relation.targetId}-description`}>{positionedById.get(relation.sourceId)?.title}，{relation.label}，{positionedById.get(relation.targetId)?.title}。依据：{relation.evidence}</li>)}</ul>
    </div>
  </div>
}
