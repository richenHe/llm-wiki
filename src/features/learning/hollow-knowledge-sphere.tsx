import { Html, OrbitControls } from "@react-three/drei"
import { Canvas, useFrame } from "@react-three/fiber"
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { Matrix4, Quaternion, Vector3, type Group, type InstancedMesh, type MeshBasicMaterial } from "three"
import type { LearningNode, LearningRelation } from "./learning-data"
import {
  getKnowledgeScopeCount,
  getSphereNavigationKind,
  getSphereRadius,
  type SphereNavigationKind,
} from "./knowledge-sphere-motion"
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
type LayerRole = "current" | "departing"

interface SphereTransition {
  from: string | null
  kind: SphereNavigationKind
  serial: number
}

function hashText(value: string): number {
  let hash = 2166136261
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function fibonacciPoint(index: number, count: number, radius: number, seed: number): Point {
  const safeCount = Math.max(count, 1)
  const y = 1 - ((index + 0.5) / safeCount) * 2
  const ring = Math.sqrt(Math.max(0, 1 - y * y))
  const theta = Math.PI * (3 - Math.sqrt(5)) * index + seed * 0.0001
  const surface = radius * (1 + Math.sin(index * 1.73 + seed) * 0.018)
  return [Math.cos(theta) * ring * surface, y * surface, Math.sin(theta) * ring * surface]
}

function easeOutCubic(progress: number): number {
  return 1 - Math.pow(1 - progress, 3)
}

function transitionTransform(kind: SphereNavigationKind, role: LayerRole, progress: number) {
  const eased = easeOutCubic(progress)
  if (kind === "enter") {
    return role === "departing"
      ? { x: 0, scale: 1 + eased * 2.8, opacity: 1 - progress }
      : { x: 0, scale: 0.18 + eased * 0.82, opacity: Math.min(1, progress * 1.8) }
  }
  if (kind === "back") {
    return role === "departing"
      ? { x: 0, scale: 1 - eased * 0.82, opacity: 1 - progress }
      : { x: 0, scale: 3.4 - eased * 2.4, opacity: Math.min(1, progress * 1.8) }
  }
  return role === "departing"
    ? { x: -eased * 5.2, scale: 1 - eased * 0.26, opacity: 1 - progress }
    : { x: 5.2 - eased * 5.2, scale: 0.74 + eased * 0.26, opacity: Math.min(1, progress * 1.8) }
}

function ParticleSphereLayer({
  nodes,
  selectedNodeId,
  childWindowOffset,
  childWindowSize,
  reduceMotion,
  role,
  navigationKind,
  animate,
  interactive,
  onSelectNode,
  onHoverNode,
}: {
  nodes: readonly LearningNode[]
  selectedNodeId: string | null
  childWindowOffset: number
  childWindowSize: number
  reduceMotion?: boolean
  role: LayerRole
  navigationKind: SphereNavigationKind
  animate: boolean
  interactive: boolean
  onSelectNode: (nodeId: string) => void
  onHoverNode: (nodeId: string | null) => void
}) {
  const motionRef = useRef<Group>(null)
  const flowRef = useRef<Group>(null)
  const meshRef = useRef<InstancedMesh>(null)
  const materialRef = useRef<MeshBasicMaterial>(null)
  const startedAt = useRef<number | null>(null)
  const visibleNodes = useMemo(
    () => selectVisibleLearningNodes(nodes, selectedNodeId, childWindowOffset, childWindowSize),
    [childWindowOffset, childWindowSize, nodes, selectedNodeId],
  )
  const sphereLayout = useMemo(() => {
    const scopeCount = getKnowledgeScopeCount(nodes, selectedNodeId)
    const particleCount = visibleNodes.length
    const radius = getSphereRadius(scopeCount)
    const seed = hashText(selectedNodeId ?? "global")
    const surfaceNodes = selectedNodeId
      ? visibleNodes.filter((node) => node.id !== selectedNodeId)
      : visibleNodes
    const surfacePoints = Array.from(
      { length: surfaceNodes.length },
      (_, index) => fibonacciPoint(index, surfaceNodes.length, radius, seed),
    )
    const pointByNodeId = new Map<string, Point>()
    if (selectedNodeId && visibleNodes.some((node) => node.id === selectedNodeId)) {
      pointByNodeId.set(selectedNodeId, [0, 0, 0])
    }
    surfaceNodes.forEach((node, index) => {
      pointByNodeId.set(node.id, surfacePoints[index] ?? [0, 0, 0])
    })
    const points = visibleNodes.map((node): Point => pointByNodeId.get(node.id) ?? [0, 0, 0])
    const nodeByInstance = new Map(visibleNodes.map((node, index) => [index, node]))
    const labelPoints = new Map(visibleNodes.map((node, index) => [node.id, points[index] ?? [0, 0, 0] as Point]))
    const matrices = visibleNodes.map((node, index) => {
      const point = points[index] ?? [0, 0, 0]
      const selected = node.id === selectedNodeId
      const size = selected ? 0.13 : 0.095
      return new Matrix4().compose(new Vector3(...point), new Quaternion(), new Vector3(size, size, size))
    })
    return { labelPoints, matrices, nodeByInstance, particleCount, seed }
  }, [nodes, selectedNodeId, visibleNodes])

  useLayoutEffect(() => {
    const mesh = meshRef.current
    if (!mesh) return
    sphereLayout.matrices.forEach((matrix, index) => mesh.setMatrixAt(index, matrix))
    mesh.instanceMatrix.needsUpdate = true
  }, [sphereLayout])

  useFrame((state, delta) => {
    const motion = motionRef.current
    const flow = flowRef.current
    if (!motion || !flow) return
    if (startedAt.current === null) startedAt.current = state.clock.elapsedTime
    const elapsed = state.clock.elapsedTime - startedAt.current
    const progress = !animate || reduceMotion ? 1 : Math.min(1, elapsed / 0.72)
    const transform = transitionTransform(navigationKind, role, progress)
    motion.position.x = transform.x
    motion.scale.setScalar(transform.scale)
    if (materialRef.current) materialRef.current.opacity = 0.84 * transform.opacity

    if (!reduceMotion) {
      const direction = sphereLayout.seed % 2 === 0 ? 1 : -1
      flow.rotation.y += direction * delta * 0.045
      flow.rotation.x = Math.sin(state.clock.elapsedTime * 0.22 + sphereLayout.seed) * 0.055
      flow.scale.setScalar(1 + Math.sin(state.clock.elapsedTime * 0.7 + sphereLayout.seed) * 0.006)
    }
  })

  const getInteractiveNode = (instanceId: number | undefined) => {
    if (!interactive || instanceId === undefined) return undefined
    return sphereLayout.nodeByInstance.get(instanceId)
  }

  return (
    <group ref={motionRef}>
      <group ref={flowRef} position={[0, -0.18, 0]}>
        <instancedMesh
          ref={meshRef}
          args={[undefined, undefined, sphereLayout.particleCount]}
          onClick={(event) => {
            const node = getInteractiveNode(event.instanceId)
            if (!node) return
            event.stopPropagation()
            onSelectNode(node.id)
          }}
          onPointerMove={(event) => {
            const node = getInteractiveNode(event.instanceId)
            onHoverNode(node?.id ?? null)
          }}
          onPointerOut={() => onHoverNode(null)}
        >
          <sphereGeometry args={[1, 12, 10]} />
          <meshBasicMaterial ref={materialRef} color="#aeb6c1" transparent opacity={0.84} />
        </instancedMesh>

        {interactive && visibleNodes.map((node) => {
          const point = sphereLayout.labelPoints.get(node.id) ?? [0, 0, 0]
          const selected = node.id === selectedNodeId
          const directChild = selectedNodeId !== null && node.parentId === selectedNodeId
          return (
            <Html key={node.id} center position={point} distanceFactor={7.8} style={{ pointerEvents: "auto" }}>
              <button
                type="button"
                onClick={() => onSelectNode(node.id)}
                onPointerEnter={() => onHoverNode(node.id)}
                onPointerLeave={() => onHoverNode(null)}
                className={`knowledge-sphere-label ${selected ? "is-selected" : directChild ? "is-child" : ""}`}
                title={`${node.title}：${node.essence}`}
              >
                <span aria-hidden="true">{node.glyph}</span>
                <strong>{node.title}</strong>
              </button>
            </Html>
          )
        })}
      </group>
    </group>
  )
}

function SphereScene({
  nodes,
  selectedNodeId,
  childWindowOffset,
  childWindowSize,
  reduceMotion,
  onSelectNode,
  onHoverNode,
}: Omit<HollowKnowledgeSphereProps, "childWindowSize"> & { childWindowSize: number }) {
  const previousSelectedNodeId = useRef(selectedNodeId)
  const serial = useRef(0)
  const [transition, setTransition] = useState<SphereTransition | null>(null)

  useEffect(() => {
    const previous = previousSelectedNodeId.current
    if (previous === selectedNodeId) return
    previousSelectedNodeId.current = selectedNodeId
    if (reduceMotion) {
      setTransition(null)
      return
    }

    serial.current += 1
    setTransition({ from: previous, kind: getSphereNavigationKind(previous, selectedNodeId, nodes), serial: serial.current })
    const timer = window.setTimeout(() => setTransition(null), 760)
    return () => window.clearTimeout(timer)
  }, [nodes, reduceMotion, selectedNodeId])

  return (
    <>
      {transition ? (
        <ParticleSphereLayer
          key={`departing:${transition.serial}`}
          nodes={nodes}
          selectedNodeId={transition.from}
          childWindowOffset={childWindowOffset}
          childWindowSize={childWindowSize}
          reduceMotion={reduceMotion}
          role="departing"
          navigationKind={transition.kind}
          animate
          interactive={false}
          onSelectNode={onSelectNode}
          onHoverNode={onHoverNode}
        />
      ) : null}
      <ParticleSphereLayer
        key={`current:${selectedNodeId ?? "global"}:${transition?.serial ?? 0}`}
        nodes={nodes}
        selectedNodeId={selectedNodeId}
        childWindowOffset={childWindowOffset}
        childWindowSize={childWindowSize}
        reduceMotion={reduceMotion}
        role="current"
        navigationKind={transition?.kind ?? "enter"}
        animate={transition !== null}
        interactive
        onSelectNode={onSelectNode}
        onHoverNode={onHoverNode}
      />
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
      dpr={[1, 1.5]}
      gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
      aria-label="可旋转的粒子知识球；也可以使用左侧知识脉络访问全部节点"
    >
      <SphereScene {...props} childWindowSize={childWindowSize} />
    </Canvas>
  )
})
