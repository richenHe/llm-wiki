import { Html, Line, OrbitControls } from "@react-three/drei"
import { Canvas, useFrame } from "@react-three/fiber"
import { memo, useMemo, useRef, useState, type ReactNode } from "react"
import { Vector3, type Group, type MeshBasicMaterial } from "three"
import type { LearningNode, LearningRelation } from "./learning-data"
import { selectVisibleLearningNodes } from "./learning-viewport"

export interface HollowKnowledgeSphereProps {
  nodes: readonly LearningNode[]
  relations: readonly LearningRelation[]
  selectedNodeId: string | null
  childWindowOffset: number
  childWindowSize?: number
  reduceMotion?: boolean
  onSelectNode: (nodeId: string) => void
  onHoverNode: (nodeId: string | null) => void
}

type Point = readonly [number, number, number]

function hashText(value: string): number {
  let hash = 2166136261
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function fibonacciPoint(index: number, count: number, radius = 3.15): Point {
  const safeCount = Math.max(count, 1)
  const y = 1 - (index / Math.max(safeCount - 1, 1)) * 2
  const ring = Math.sqrt(Math.max(0, 1 - y * y))
  const theta = Math.PI * (3 - Math.sqrt(5)) * index
  return [Math.cos(theta) * ring * radius, y * radius, Math.sin(theta) * ring * radius]
}

function circlePoints(axis: "x" | "y" | "z", tilt = 0, radius = 3.15): Point[] {
  return Array.from({ length: 65 }, (_, index) => {
    const angle = (index / 64) * Math.PI * 2
    const a = Math.cos(angle) * radius
    const b = Math.sin(angle) * radius
    if (axis === "x") return [0, a * Math.cos(tilt) - b * Math.sin(tilt), a * Math.sin(tilt) + b * Math.cos(tilt)] as Point
    if (axis === "y") return [a * Math.cos(tilt) + b * Math.sin(tilt), 0, -a * Math.sin(tilt) + b * Math.cos(tilt)] as Point
    return [a * Math.cos(tilt) - b * Math.sin(tilt), a * Math.sin(tilt) + b * Math.cos(tilt), 0] as Point
  })
}

function KnowledgePoint({ node, point, selected, directChild, root, reduceMotion, showLabel, onSelectNode, onHoverNode }: {
  node: LearningNode
  point: Point
  selected: boolean
  directChild: boolean
  root: boolean
  reduceMotion?: boolean
  showLabel: boolean
  onSelectNode: (nodeId: string) => void
  onHoverNode: (nodeId: string | null) => void
}) {
  const groupRef = useRef<Group>(null)
  const materialRef = useRef<MeshBasicMaterial>(null)
  const target = useMemo(() => new Vector3(...point), [point])
  const [initial] = useState(() => new Vector3(...point))
  const radius = selected ? 0.16 : root ? 0.115 : directChild ? 0.09 : 0.058
  const color = selected ? "#2563eb" : directChild ? "#384b65" : root ? "#66758c" : "#a4adba"

  useFrame((_state, delta) => {
    const group = groupRef.current
    if (!group) return
    const strength = reduceMotion ? 1 : 1 - Math.exp(-delta * 7)
    group.position.lerp(target, strength)
    if (materialRef.current) {
      const depth = Math.max(0, Math.min(1, (group.position.z + 3.15) / 6.3))
      materialRef.current.opacity = selected ? 1 : 0.34 + depth * 0.6
    }
  })

  return (
    <group ref={groupRef} position={initial}>
      <mesh
        onClick={(event) => { event.stopPropagation(); onSelectNode(node.id) }}
        onPointerEnter={(event) => { event.stopPropagation(); onHoverNode(node.id) }}
        onPointerLeave={() => onHoverNode(null)}
      >
        <sphereGeometry args={[radius, 18, 18]} />
        <meshBasicMaterial ref={materialRef} color={color} transparent opacity={selected ? 1 : 0.78} />
      </mesh>
      {showLabel && (
        <Html center distanceFactor={7.8} style={{ pointerEvents: "auto" }}>
          <button type="button" onClick={() => onSelectNode(node.id)} onPointerEnter={() => onHoverNode(node.id)} onPointerLeave={() => onHoverNode(null)} className={`knowledge-sphere-label ${selected ? "is-selected" : directChild ? "is-child" : ""}`} title={`${node.title}：${node.essence}`}>
            <span aria-hidden="true">{node.glyph}</span>
            {(selected || root) && <strong>{node.title}</strong>}
          </button>
        </Html>
      )}
    </group>
  )
}

function TransitionLayer({ children, reduceMotion }: { children: ReactNode; reduceMotion?: boolean }) {
  const ref = useRef<Group>(null)
  useFrame((_state, delta) => {
    const group = ref.current
    if (!group) return
    const strength = reduceMotion ? 1 : 1 - Math.exp(-delta * 6)
    group.position.x += (0 - group.position.x) * strength
    group.rotation.y += (0 - group.rotation.y) * strength
    const nextScale = group.scale.x + (1 - group.scale.x) * strength
    group.scale.setScalar(nextScale)
  })
  return <group ref={ref} position={[reduceMotion ? 0 : 0.7, 0, 0]} rotation={[0, reduceMotion ? 0 : -0.18, 0]} scale={reduceMotion ? 1 : 0.84}>{children}</group>
}

function SphereScene({
  nodes,
  relations,
  selectedNodeId,
  childWindowOffset,
  childWindowSize,
  reduceMotion,
  onSelectNode,
  onHoverNode,
}: Omit<HollowKnowledgeSphereProps, "selectedNodeId" | "childWindowSize"> & { selectedNodeId: string | null; childWindowSize: number }) {
  const groupRef = useRef<Group>(null)
  const [relationsExpanded, setRelationsExpanded] = useState(false)
  const visibleNodes = useMemo(
    () => selectVisibleLearningNodes(nodes, selectedNodeId, childWindowOffset, childWindowSize),
    [childWindowOffset, childWindowSize, nodes, selectedNodeId],
  )
  const visibleIds = useMemo(() => new Set(visibleNodes.map((node) => node.id)), [visibleNodes])
  const nodeIndex = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes])
  const positions = useMemo(() => {
    const map = new Map<string, Point>()
    visibleNodes.forEach((node, index) => {
      if (node.id === selectedNodeId) map.set(node.id, [0, 0, 3.15])
      else map.set(node.id, fibonacciPoint(index + (selectedNodeId ? 3 : 0), visibleNodes.length + (selectedNodeId ? 4 : 0)))
    })
    return map
  }, [selectedNodeId, visibleNodes])
  const hierarchyEdges = useMemo(() => visibleNodes.flatMap((node) => {
    if (!node.parentId || !visibleIds.has(node.parentId)) return []
    const from = positions.get(node.parentId)
    const to = positions.get(node.id)
    return from && to ? [{ id: `${node.parentId}:${node.id}`, from, to }] : []
  }), [positions, visibleIds, visibleNodes])
  const crossRelations = useMemo(() => {
    if (!selectedNodeId) return []
    return relations
      .filter((relation) => relation.sourceId === selectedNodeId || relation.targetId === selectedNodeId)
      .sort((a, b) => b.weight - a.weight)
      .map((relation) => ({
        ...relation,
        targetId: relation.sourceId === selectedNodeId ? relation.targetId : relation.sourceId,
      }))
      .filter((relation) => nodeIndex.has(relation.targetId) && !visibleIds.has(relation.targetId))
  }, [nodeIndex, relations, selectedNodeId, visibleIds])
  const targetRotation = useMemo(() => {
    const hash = hashText(selectedNodeId ?? "global")
    return { x: ((hash % 17) - 8) * 0.018, y: (((hash >> 5) % 29) - 14) * 0.022 }
  }, [selectedNodeId])
  const shellRings = useMemo(() => [
    circlePoints("y"),
    circlePoints("z"),
    circlePoints("z", Math.PI / 3),
    circlePoints("z", -Math.PI / 3),
    circlePoints("x", Math.PI / 4),
    circlePoints("x", -Math.PI / 4),
  ], [])

  useFrame((_state, delta) => {
    const group = groupRef.current
    if (!group) return
    const speed = reduceMotion ? 1 : Math.min(1, delta * 4.8)
    group.rotation.x += (targetRotation.x - group.rotation.x) * speed
    group.rotation.y += (targetRotation.y - group.rotation.y) * speed
  })

  return (
    <>
      <ambientLight intensity={1.8} />
      <group ref={groupRef} position={[0, -0.22, 0]}>
        {shellRings.map((points, index) => (
          <Line key={`shell:${index}`} points={points} color="#94a3b8" transparent opacity={index < 2 ? 0.2 : 0.11} lineWidth={0.55} />
        ))}
        <TransitionLayer key={`${selectedNodeId ?? "global"}:${childWindowOffset}`} reduceMotion={reduceMotion}>
          {hierarchyEdges.map((edge) => (
            <Line key={edge.id} points={[edge.from, edge.to]} color="#b8c1cf" transparent opacity={0.34} lineWidth={0.65} />
          ))}
          {visibleNodes.map((node) => {
            const point = positions.get(node.id) ?? [0, 0, 0]
            const selected = node.id === selectedNodeId
            const directChild = selectedNodeId !== null && node.parentId === selectedNodeId
            const root = node.parentId === null
            const showLabel = selected || root || directChild || visibleNodes.length <= 28
            return <KnowledgePoint key={node.id} node={node} point={point} selected={selected} directChild={directChild} root={root} reduceMotion={reduceMotion} showLabel={showLabel} onSelectNode={onSelectNode} onHoverNode={onHoverNode} />
          })}
        </TransitionLayer>
      </group>

      {crossRelations.slice(0, relationsExpanded ? 12 : 5).map((relation, index) => {
        const target = nodeIndex.get(relation.targetId)
        const targetPath: string[] = []
        let cursor = target
        while (cursor) {
          targetPath.unshift(cursor.title)
          cursor = cursor.parentId ? nodeIndex.get(cursor.parentId) : undefined
        }
        const relationColumn = Math.floor(index / 5)
        const relationRow = index % 5
        const relationY = (relationRow - Math.min(crossRelations.length - 1, 4) / 2) * 0.92
        return (
          <group key={`${relation.sourceId}:${relation.targetId}`} position={[4.1 + relationColumn * 0.5, relationY, 0.5]}>
            <mesh onClick={() => onSelectNode(relation.targetId)}>
              <torusGeometry args={[0.095, 0.026, 12, 30]} />
              <meshBasicMaterial color="#7c3aed" />
            </mesh>
            <Html center position={[0.42, 0, 0]}>
              <button
                type="button"
                className="knowledge-relation-label"
                onClick={() => onSelectNode(relation.targetId)}
                title={`${targetPath.join(" → ")}：${relation.reason}`}
              >
                {target?.glyph ?? "联"}
              </button>
            </Html>
          </group>
        )
      })}
      {crossRelations.length > 5 && (
        <Html center position={[4.1, -1.65, 0.5]}>
          <button type="button" className="knowledge-relation-count" onClick={() => setRelationsExpanded((value) => !value)}>{relationsExpanded ? `已显示 ${Math.min(12, crossRelations.length)} / ${crossRelations.length}` : `+${crossRelations.length - 5}`}</button>
        </Html>
      )}
      <OrbitControls enablePan={false} enableZoom={false} rotateSpeed={0.55} minPolarAngle={0.3} maxPolarAngle={Math.PI - 0.3} />
    </>
  )
}

export const HollowKnowledgeSphere = memo(function HollowKnowledgeSphere({
  childWindowSize = 24,
  ...props
}: HollowKnowledgeSphereProps) {
  return (
    <Canvas
      camera={{ position: [0, 0, 9.2], fov: 43 }}
      dpr={[1, 1.6]}
      gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
      aria-label="可旋转的镂空知识球；也可以使用左侧知识脉络访问全部节点"
    >
      <SphereScene {...props} childWindowSize={childWindowSize} />
    </Canvas>
  )
})
