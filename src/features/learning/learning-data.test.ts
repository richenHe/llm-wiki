import { describe, expect, it } from "vitest"
import { buildLearningRoute, getLearningSiblings, type LearningNode } from "./learning-data"

function node(id: string, title: string, glyph: string, parentId: string | null, prerequisiteIds: string[] = []): LearningNode {
  return {
    id,
    title,
    glyph,
    essence: title,
    parentId,
    prerequisiteIds,
    source: "测试知识库",
    sourceDetail: "测试",
    capabilities: [],
    mastery: "unseen",
    position: { x: 0, y: 0 },
  }
}

describe("learning hierarchy and route", () => {
  const nodes = [
    node("shop", "咖啡店经营", "店", null),
    node("customer", "顾客", "客", "shop"),
    node("product", "产品", "品", "shop", ["customer"]),
    node("place", "场景", "场", "shop", ["product"]),
    node("service", "服务", "服", "shop", ["place"]),
    node("operation", "运营", "营", "shop", ["service"]),
    node("finance", "财务", "财", "shop", ["operation"]),
    node("growth", "增长", "增", "shop", ["finance"]),
    node("bean", "咖啡豆", "豆", "product"),
    node("milk", "牛奶", "奶", "product"),
    node("sugar", "糖", "糖", "product"),
    node("equipment", "器具", "器", "product"),
  ]

  it("orders only direct siblings as the recommended route", () => {
    expect(buildLearningRoute("operation", nodes).map((item) => item.glyph).join(" → ")).toBe("客 → 品 → 场 → 服 → 营 → 财 → 增")
    expect(getLearningSiblings("operation", nodes).some((item) => item.id === "bean")).toBe(false)
  })

  it("keeps children under their real parent instead of mixing levels", () => {
    expect(getLearningSiblings("bean", nodes).map((item) => item.glyph).join(" · ")).toBe("豆 · 奶 · 糖 · 器")
  })
})
