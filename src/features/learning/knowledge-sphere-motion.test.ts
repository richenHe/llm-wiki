import { describe, expect, it } from "vitest"
import type { LearningNode } from "./learning-data"
import {
  getKnowledgeScopeCount,
  getKnowledgeScopeIds,
  getSphereNavigationKind,
  getSphereRadius,
} from "./knowledge-sphere-motion"

function node(id: string, parentId: string | null): LearningNode {
  return { id, title: id, glyph: "知", essence: id, parentId, prerequisiteIds: [], source: "测试", sourceDetail: "测试", capabilities: [], mastery: "unseen", position: { x: 0, y: 0 } }
}

const NODES = [node("root-a", null), node("child-a", "root-a"), node("leaf-a", "child-a"), node("root-b", null)]

describe("knowledge sphere motion", () => {
  it("distinguishes entering, returning, and jumping between spheres", () => {
    expect(getSphereNavigationKind(null, "root-a", NODES)).toBe("enter")
    expect(getSphereNavigationKind("root-a", "leaf-a", NODES)).toBe("enter")
    expect(getSphereNavigationKind("leaf-a", "root-a", NODES)).toBe("back")
    expect(getSphereNavigationKind("root-a", "root-b", NODES)).toBe("jump")
  })

  it("uses the selected branch to size an inner sphere", () => {
    expect(getKnowledgeScopeCount(NODES, null)).toBe(4)
    expect(getKnowledgeScopeCount(NODES, "root-a")).toBe(3)
    expect(getKnowledgeScopeCount(NODES, "leaf-a")).toBe(1)
    expect([...getKnowledgeScopeIds(NODES, "root-a")]).toEqual(["root-a", "child-a", "leaf-a"])
  })

  it("grows the layout radius with the amount of knowledge", () => {
    expect(getSphereRadius(257)).toBeGreaterThan(getSphereRadius(4))
  })
})
