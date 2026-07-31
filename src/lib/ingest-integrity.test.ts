import { describe, expect, it } from "vitest"
import {
  buildUniqueIngestPathRedirects,
  repairIngestReferences,
  validateAndRepairSourceSummaryMetadata,
} from "./ingest-integrity"

describe("ingest same-batch path integrity", () => {
  it("rewrites body links, anchors, aliases, related values, and log links", () => {
    const redirects = buildUniqueIngestPathRedirects([
      {
        aliases: ["wiki/entities/beanbot.md"],
        finalPath: "wiki/entities/beanbot豆仔.md",
      },
      {
        aliases: ["wiki/entities/xiaozhi-esp32.md"],
        finalPath: "wiki/entities/小智-esp32-xiaozhi-esp32.md",
      },
    ])
    const input = [
      "---",
      "type: concept",
      "title: Test",
      "related: [beanbot, xiaozhi-esp32, missing]",
      "---",
      "",
      "[[beanbot]]",
      "[[beanbot#硬件]]",
      "[[xiaozhi-esp32|小智]]",
      "`[[beanbot]]`",
      "```md",
      "[[beanbot]]",
      "```",
    ].join("\n")

    const result = repairIngestReferences(input, redirects)

    expect(result.content).toContain(
      'related: ["beanbot豆仔", "小智-esp32-xiaozhi-esp32", "missing"]',
    )
    expect(result.content).toContain("[[entities/beanbot豆仔]]")
    expect(result.content).toContain("[[entities/beanbot豆仔#硬件]]")
    expect(result.content).toContain("[[entities/小智-esp32-xiaozhi-esp32|小智]]")
    expect(result.content).toContain("`[[beanbot]]`")
    expect(result.content).toContain("```md\n[[beanbot]]\n```")
    expect(result.repairedCount).toBe(5)
  })

  it("does not guess when a bare alias maps to multiple final pages", () => {
    const redirects = buildUniqueIngestPathRedirects([
      {
        aliases: ["wiki/entities/shared.md"],
        finalPath: "wiki/entities/实体-shared.md",
      },
      {
        aliases: ["wiki/concepts/shared.md"],
        finalPath: "wiki/concepts/概念-shared.md",
      },
    ])

    const result = repairIngestReferences(
      "[[shared]] [[entities/shared]] [[concepts/shared]]",
      redirects,
    )

    expect(result.content).toBe(
      "[[shared]] [[entities/实体-shared]] [[concepts/概念-shared]]",
    )
    expect(result.repairedCount).toBe(2)
  })

  it("leaves already-canonical and genuinely missing links unchanged", () => {
    const redirects = buildUniqueIngestPathRedirects([
      {
        aliases: ["wiki/entities/beanbot.md"],
        finalPath: "wiki/entities/beanbot豆仔.md",
      },
    ])

    const result = repairIngestReferences(
      "[[entities/beanbot豆仔]] [[Coco]]",
      redirects,
    )

    expect(result).toEqual({
      content: "[[entities/beanbot豆仔]] [[Coco]]",
      repairedCount: 0,
    })
  })

  it("resolves page titles, raw source names, and historical source-summary slugs", () => {
    const redirects = buildUniqueIngestPathRedirects([
      {
        aliases: [
          "3D Printed WALL·E 完整教程",
          "collected/robot-coco/02-walle-complete-tutorial.md",
          "wiki/sources/9-collected--10-robot-coco--26-02-walle-complete-tutorial--71tpnl.md",
        ],
        finalPath:
          "wiki/sources/9-collected--10-robot-coco--27-02-walle-complete-tutorial--71tpnl.md",
      },
    ])

    const result = repairIngestReferences(
      [
        "[[3D Printed WALL·E 完整教程]]",
        "[[02-walle-complete-tutorial]]",
        "[[sources/9-collected--10-robot-coco--26-02-walle-complete-tutorial--71tpnl]]",
      ].join("\n"),
      redirects,
    )

    expect(result.content).toBe(
      [
        "[[sources/9-collected--10-robot-coco--27-02-walle-complete-tutorial--71tpnl]]",
        "[[sources/9-collected--10-robot-coco--27-02-walle-complete-tutorial--71tpnl]]",
        "[[sources/9-collected--10-robot-coco--27-02-walle-complete-tutorial--71tpnl]]",
      ].join("\n"),
    )
    expect(result.repairedCount).toBe(3)
  })

  it("normalizes Unicode and URL encoding without fuzzy matching", () => {
    const redirects = buildUniqueIngestPathRedirects([
      {
        aliases: ["WALL·E 完整教程"],
        finalPath: "wiki/sources/wall-e.md",
      },
    ])

    const result = repairIngestReferences(
      "[[WALL%C2%B7E%20完整教程]] [[WALL-E 完整教程]]",
      redirects,
    )

    expect(result.content).toBe(
      "[[sources/wall-e]] [[WALL-E 完整教程]]",
    )
    expect(result.repairedCount).toBe(1)
  })

  it("does not override an exact page that already exists on disk", () => {
    const redirects = buildUniqueIngestPathRedirects(
      [
        {
          aliases: ["wiki/entities/beanbot.md"],
          finalPath: "wiki/entities/豆仔-beanbot.md",
        },
      ],
      ["wiki/entities/beanbot.md"],
    )

    const result = repairIngestReferences("[[entities/beanbot]]", redirects)

    expect(result.content).toBe("[[entities/beanbot]]")
    expect(result.repairedCount).toBe(0)
  })
})

describe("source-summary metadata integrity", () => {
  it("corrects a repository URL and removes metadata forbidden by the capsule", () => {
    const source = [
      "---",
      "type: repository-capsule",
      "report_contract: repository-framework-v2",
      "repository: 78/xiaozhi-esp32",
      "source_url: https://github.com/78/xiaozhi-esp32",
      "commit: dd99da00dc4c89ed4ab07fcec038c03f13f4de50",
      "retrieved_at: 2026-07-30",
      "license: MIT",
      "---",
      "",
      "# Capsule",
    ].join("\n")
    const generated = [
      "---",
      "type: source",
      "title: Xiaozhi",
      "authors: []",
      "year: 2024",
      'url: "https://example.invalid/wrong"',
      "---",
      "",
      "# Xiaozhi",
    ].join("\n")

    const result = validateAndRepairSourceSummaryMetadata(generated, source)

    expect(result.content).toContain(
      'url: "https://github.com/78/xiaozhi-esp32"',
    )
    expect(result.content).not.toMatch(/^authors:/m)
    expect(result.content).not.toMatch(/^year:/m)
    expect(result.repairedCount).toBe(3)
    expect(result.warnings).toHaveLength(3)
  })

  it("corrects an ordinary Jina source URL without deleting extracted metadata", () => {
    const source = [
      "Title: 3D Printed WALL·E",
      "",
      "URL Source: https://wired.chillibasket.com/3d-printed-wall-e/",
      "",
      "Markdown Content:",
    ].join("\n")
    const generated = [
      "---",
      "type: source",
      "authors: [chillibasket]",
      "year: 2023",
      'url: "https://github.com/chillibasket/walle-replica"',
      "---",
      "",
      "# WALL·E",
    ].join("\n")

    const result = validateAndRepairSourceSummaryMetadata(generated, source)

    expect(result.content).toContain(
      'url: "https://wired.chillibasket.com/3d-printed-wall-e/"',
    )
    expect(result.content).toContain("authors: [chillibasket]")
    expect(result.content).toContain("year: 2023")
    expect(result.repairedCount).toBe(1)
  })

  it("removes a multiline unverified author list and supports CRLF", () => {
    const source = [
      "---",
      "type: repository-capsule",
      "report_contract: repository-framework-v2",
      "source_url: https://github.com/example/project",
      "---",
    ].join("\r\n")
    const generated = [
      "---",
      "type: source",
      "authors:",
      "  - guessed-one",
      "  - guessed-two",
      "url: https://example.invalid",
      "---",
      "",
      "# Project",
    ].join("\r\n")

    const result = validateAndRepairSourceSummaryMetadata(generated, source)

    expect(result.content).not.toMatch(/^authors:/m)
    expect(result.content).not.toContain("guessed-one")
    expect(result.content).toContain(
      'url: "https://github.com/example/project"',
    )
    expect(result.repairedCount).toBe(2)
  })
})
