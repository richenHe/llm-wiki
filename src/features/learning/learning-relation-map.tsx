import { ArrowRight } from "lucide-react"
import { useMemo } from "react"
import type { LearningNode } from "./learning-data"
import type { LearningBoard, LearningBoardRelation, LearningBoardRelationKind } from "./learning-routes"
import { learningBoardNodes } from "./learning-routes"

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

function relationMapData(board: LearningBoard, nodes: readonly LearningNode[]): {
  nodes: Map<string, RelationMapNode>
  relations: LearningBoardRelation[]
} {
  const boardNodes = learningBoardNodes(board, nodes)
  const mapNodes = new Map<string, RelationMapNode>(boardNodes.map((node) => [node.id, { id: node.id, title: node.title }]))
  if (board.relations.length > 0) return { nodes: mapNodes, relations: board.relations }
  const hubId = `board:${board.id}`
  mapNodes.set(hubId, { id: hubId, title: board.title, virtual: true })
  return {
    nodes: mapNodes,
    relations: boardNodes.map((node) => ({
      sourceId: hubId,
      targetId: node.id,
      kind: "connection" as const,
      label: "共同属于",
      evidence: board.reason,
    })),
  }
}

function RelationNode({ item, currentNodeId, onSelect }: {
  item: RelationMapNode
  currentNodeId: string
  onSelect: (nodeId: string) => void
}) {
  if (item.virtual) {
    return <div className="flex min-h-12 items-center justify-center rounded-xl bg-violet-50 px-2.5 py-2 text-center text-xs font-semibold leading-4 text-violet-800">{item.title}</div>
  }
  const isCurrent = item.id === currentNodeId
  return <button
    type="button"
    onClick={() => onSelect(item.id)}
    title={item.title}
    aria-current={isCurrent ? "true" : undefined}
    className={isCurrent
      ? "flex min-h-12 w-full items-center justify-center rounded-xl bg-blue-600 px-2.5 py-2 text-center text-xs font-semibold leading-4 text-white shadow-[0_5px_14px_rgb(37_99_235/0.2)] outline-none focus-visible:ring-2 focus-visible:ring-blue-300"
      : "flex min-h-12 w-full items-center justify-center rounded-xl bg-slate-50 px-2.5 py-2 text-center text-xs font-medium leading-4 text-slate-700 outline-none hover:bg-blue-50 hover:text-blue-700 focus-visible:ring-2 focus-visible:ring-blue-400"
    }
  >{item.title}</button>
}

export function LearningRelationMap({ board, nodes, currentNodeId, onSelect }: {
  board: LearningBoard
  nodes: readonly LearningNode[]
  currentNodeId: string
  onSelect: (nodeId: string) => void
}) {
  const map = useMemo(() => relationMapData(board, nodes), [board, nodes])

  return <div className="divide-y divide-violet-100" role="list" aria-label={`${board.title}知识关系图`}>
    {map.relations.map((relation, index) => {
      const source = map.nodes.get(relation.sourceId)
      const target = map.nodes.get(relation.targetId)
      if (!source || !target) return null
      const color = RELATION_COLORS[relation.kind]
      return <div key={`${relation.sourceId}-${relation.targetId}-${index}`} className="grid grid-cols-[minmax(0,1fr)_88px_minmax(0,1fr)] items-center gap-2 py-3" role="listitem">
        <RelationNode item={source} currentNodeId={currentNodeId} onSelect={onSelect} />
        <div className="min-w-0 text-center" title={`关系依据：${relation.evidence}`}>
          <div className="truncate text-[10px] font-semibold" style={{ color }}>{relation.label}</div>
          <ArrowRight className="mx-auto mt-0.5" aria-hidden="true" size={24} strokeWidth={2.25} style={{ color }} />
          <span className="sr-only">从{source.title}指向{target.title}。依据：{relation.evidence}</span>
        </div>
        <RelationNode item={target} currentNodeId={currentNodeId} onSelect={onSelect} />
      </div>
    })}
  </div>
}
