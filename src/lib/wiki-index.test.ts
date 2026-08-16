import { describe, expect, it } from "vitest"
import { buildManagedWikiIndex, type WikiIndexPage } from "./wiki-index"

describe("buildManagedWikiIndex", () => {
  it("replaces empty template headings with a complete grouped catalog", () => {
    const existing = [
      "# Wiki Index",
      "",
      "## Entities",
      "",
      "## Concepts",
      "",
      "## Sources",
      "",
      "## Queries",
      "",
      "## Comparisons",
      "",
      "## Synthesis",
      "",
    ].join("\n")
    const pages: WikiIndexPage[] = [
      { target: "concepts/表达能力", title: "表达能力", type: "concept" },
      { target: "entities/patrick-winston", title: "Patrick Winston", type: "entity" },
      { target: "sources/talk", title: "How to Speak", type: "source" },
    ]

    const result = buildManagedWikiIndex(existing, pages, ["wiki/concepts/表达能力.md"])

    expect(result.match(/^## Entities$/gm)).toHaveLength(1)
    expect(result.match(/^## Concepts$/gm)).toHaveLength(1)
    expect(result).toContain("- [[entities/patrick-winston]] — Patrick Winston")
    expect(result).toContain("- [[concepts/表达能力]] — 表达能力")
    expect(result).toContain("- [[sources/talk]] — How to Speak")
    expect(result).toContain("## Recently Updated\n- [[concepts/表达能力]] — 表达能力")
  })

  it("preserves custom text and replaces only the application-owned catalog", () => {
    const first = buildManagedWikiIndex(
      "# Wiki Index\n\n这份说明由用户维护。\n",
      [{ target: "concepts/old", title: "Old", type: "concept" }],
      ["concepts/old"],
    )
    const second = buildManagedWikiIndex(
      first,
      [{ target: "concepts/new", title: "New", type: "concept" }],
      ["concepts/new"],
    )

    expect(second).toContain("这份说明由用户维护。")
    expect(second).not.toContain("[[concepts/old]]")
    expect(second).toContain("[[concepts/new]]")
    expect(second.match(/llm-wiki:catalog:start/g)).toHaveLength(1)
  })

  it("keeps every catalog page while bounding only the recent list", () => {
    const pages = Array.from({ length: 205 }, (_, index) => ({
      target: `concepts/page-${index}`,
      title: `Page ${index}`,
      type: "concept",
    }))
    const result = buildManagedWikiIndex(
      "# Wiki Index\n",
      pages,
      pages.map((page) => page.target),
    )
    const catalog = result.split("<!-- llm-wiki:catalog:end -->")[0]
    const recent = result.split("## Recently Updated")[1]

    expect(catalog.match(/^- \[\[/gm)).toHaveLength(205)
    expect(recent.match(/^- \[\[/gm)).toHaveLength(200)
  })
})
