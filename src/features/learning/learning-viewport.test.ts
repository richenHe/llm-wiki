import { describe, expect, it } from "vitest"
import type { LearningNode } from "./learning-data"
import { selectVisibleLearningNodes } from "./learning-viewport"

function node(id: string, parentId: string | null): LearningNode {
  return { id, title: id, glyph: "知", essence: id, parentId, prerequisiteIds: [], source: "测试", sourceDetail: "测试", capabilities: [], mastery: "unseen", position: { x: 0, y: 0 } }
}

describe("learning viewport", () => {
  it("caps a global map with hundreds of roots", () => {
    const nodes = Array.from({ length: 1_000 }, (_, index) => node(`root-${index}`, null))
    expect(selectVisibleLearningNodes(nodes, null, 0, 24)).toHaveLength(48)
  })

  it("windows large child collections while keeping the focus", () => {
    const nodes = [node("root", null), ...Array.from({ length: 300 }, (_, index) => node(`child-${index}`, "root"))]
    const visible = selectVisibleLearningNodes(nodes, "root", 40, 24)
    expect(visible).toHaveLength(25)
    expect(visible[0]?.id).toBe("root")
    expect(visible[1]?.id).toBe("child-40")
  })

  it("shows only top-level knowledge in the global view", () => {
    const nodes = [
      node("root-a", null),
      node("child-a", "root-a"),
      node("grandchild-a", "child-a"),
      node("root-b", null),
      node("child-b", "root-b"),
    ]

    expect(selectVisibleLearningNodes(nodes, null, 0, 24).map((item) => item.id)).toEqual(["root-a", "root-b"])
  })

  it("shows the selected knowledge and only its direct children", () => {
    const nodes = [
      node("root-a", null),
      node("selected", "root-a"),
      node("sibling", "root-a"),
      node("direct-child", "selected"),
      node("grandchild", "direct-child"),
      node("root-b", null),
    ]

    expect(selectVisibleLearningNodes(nodes, "selected", 0, 24).map((item) => item.id)).toEqual([
      "selected",
      "direct-child",
    ])
  })
})
