import { describe, expect, it } from "vitest"
import {
  buildDocumentPipelineSignature,
  countBuiltinPdfPages,
  documentIntegrityFailures,
} from "./document-ingest-result"

describe("document ingest result", () => {
  it("counts unique built-in PDF page markers", () => {
    expect(countBuiltinPdfPages("## Page 1\na\n## Page 2\nb\n## Page 2\nb")).toBe(2)
    expect(countBuiltinPdfPages("plain markdown")).toBeNull()
  })

  it("rejects empty or page-incomplete extraction", () => {
    expect(documentIntegrityFailures({
      content: "x",
      extractionMode: "builtin",
      sourcePageCount: 10,
      processedPageCount: 9,
      savedImages: [],
      degraded: true,
      warnings: [],
    })).toEqual(["Document page coverage is incomplete: processed 9/10 page(s)."])
    expect(documentIntegrityFailures({
      content: "usable Markdown without page metadata",
      extractionMode: "mineru",
      sourcePageCount: 10,
      processedPageCount: null,
      savedImages: [],
      degraded: false,
      warnings: [],
    })).toEqual(["Document page coverage could not be verified against the 10-page source."])
  })

  it("changes the signature when image, extraction, or ingest settings change", () => {
    const base = {
      mineruEnabled: true,
      mineruBackend: "cloud",
      mineruModelVersion: "vlm",
      imageCaptioningEnabled: true,
      imageCaptionProvider: "custom",
      imageCaptionModel: "qwen-vl",
      ingestProvider: "deepseek",
      ingestModel: "deepseek-v4",
    }
    expect(buildDocumentPipelineSignature(base)).not.toBe(
      buildDocumentPipelineSignature({ ...base, imageCaptionModel: "qwen-vl-next" }),
    )
    expect(buildDocumentPipelineSignature(base)).not.toBe(
      buildDocumentPipelineSignature({ ...base, ingestModel: "deepseek-v5" }),
    )
  })
})
