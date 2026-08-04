import JSZip from "jszip"
import type { MineruConfig } from "@/stores/wiki-store"
import { createDirectory, getFileSize, readFileAsBase64, writeFileBase64 } from "@/commands/fs"
import { getHttpFetch } from "@/lib/tauri-fetch"
import { downloadMineruZipDirect } from "@/lib/mineru-direct-download"
import { getFileName, normalizePath } from "@/lib/path-utils"
import type { SavedImage } from "@/lib/extract-source-images"

const API_BASE = "https://mineru.net/api/v4"
export const DEFAULT_LOCAL_MINERU_ENDPOINT = "http://127.0.0.1:8000"
const POLL_INTERVAL_MS = 3_000
const POLL_TIMEOUT_MS = 300_000 // 5 minutes
const LOCAL_POLL_TIMEOUT_MS = 3_600_000 // Official mineru-api tasks can include model cold starts.
const MAX_ACCURATE_PARSE_BYTES = 200 * 1024 * 1024
const ZIP_DOWNLOAD_ATTEMPTS = 2
const ZIP_DOWNLOAD_RETRY_MS = 500
const MINERU_API_REQUEST_TIMEOUT_MS = 30_000
const MINERU_UPLOAD_MIN_TIMEOUT_MS = 120_000
const MINERU_UPLOAD_MAX_TIMEOUT_MS = 600_000
const MINERU_UPLOAD_MIN_BYTES_PER_SECOND = 128 * 1024
const MINERU_UPLOAD_ATTEMPTS = 3
const MINERU_IMAGE_EXTS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "bmp",
  "svg",
  "tif",
  "tiff",
])

// ── Types ──

interface TaskResponse {
  code: number | string
  data: { task_id: string }
  msg: string
}

type MineruTaskState = "pending" | "running" | "converting" | "done" | "failed" | "waiting-file"

interface TaskStatus {
  code: number | string
  data: {
    task_id: string
    state: MineruTaskState
    full_zip_url?: string
    err_msg?: string
    extract_progress?: { extracted_pages: number; total_pages: number }
  }
  msg: string
}

interface BatchStatus {
  code: number | string
  data: {
    batch_id: string
    extract_result: Array<{
      file_name: string
      state: MineruTaskState
      full_zip_url?: string
      err_msg?: string
    }>
  }
  msg: string
}

interface UploadUrlResponse {
  code: number | string
  data: {
    batch_id: string
    file_urls: string[]
  }
  msg: string
}

interface MineruAssetOptions {
  projectPath: string
  sourceSummarySlug: string
}

interface MineruExtractedMarkdown {
  markdown: string
  savedImages: SavedImage[]
  /** Last page represented by MinerU's structured result, when available. */
  processedPageCount?: number | null
}

class MineruZipHttpError extends Error {
  constructor(readonly status: number) {
    super(`MinerU zip download failed: HTTP ${status}`)
    this.name = "MineruZipHttpError"
  }
}

function isExpiredMineruZipError(error: unknown): boolean {
  return error instanceof MineruZipHttpError
    && [401, 403, 404, 410].includes(error.status)
}

function collectMineruPageNumbers(value: unknown, pages: Set<number>): void {
  if (Array.isArray(value)) {
    for (const item of value) collectMineruPageNumbers(item, pages)
    return
  }
  if (!value || typeof value !== "object") return
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if ((key === "page_idx" || key === "page_index") && typeof child === "number" && child >= 0) {
      pages.add(Math.floor(child) + 1)
    } else if ((key === "page_no" || key === "page_number") && typeof child === "number") {
      pages.add(child > 0 ? Math.floor(child) : Math.floor(child) + 1)
    }
    if (typeof child === "object" && child !== null) collectMineruPageNumbers(child, pages)
  }
}

async function countMineruStructuredPages(zip: JSZip): Promise<number | null> {
  const candidates: JSZip.JSZipObject[] = []
  zip.forEach((relativePath, file) => {
    if (!file.dir && /(?:content_list|middle)[^/]*\.json$/i.test(relativePath)) {
      candidates.push(file)
    }
  })
  const pages = new Set<number>()
  for (const file of candidates) {
    try {
      collectMineruPageNumbers(JSON.parse(await file.async("string")), pages)
    } catch {
      // A non-standard auxiliary JSON file must not discard valid Markdown.
    }
  }
  return pages.size > 0 ? Math.max(...pages) : null
}

function localMineruApiBase(endpoint: string | undefined): string {
  const candidate = endpoint?.trim() || DEFAULT_LOCAL_MINERU_ENDPOINT
  let parsed: URL
  try {
    parsed = new URL(candidate)
  } catch {
    throw new Error("Local MinerU endpoint must be a valid HTTP(S) URL")
  }
  if (!/^https?:$/.test(parsed.protocol) || parsed.username || parsed.password) {
    throw new Error("Local MinerU endpoint must be an HTTP(S) URL without credentials")
  }
  return candidate.replace(/\/+$/, "")
}

// ── API calls ──

async function mineruHeaders(token: string): Promise<HeadersInit> {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  }
}

function mineruApiErrorMessage(code: number | string | undefined, msg?: string): string {
  const key = String(code ?? "")
  const known: Record<string, string> = {
    A0202: "MinerU token is invalid. Check the API token in Settings.",
    A0211: "MinerU token has expired. Create a new API token and update Settings.",
    "-60005": "MinerU rejected the file because it is larger than 200 MB.",
    "-60006": "MinerU rejected the file because it exceeds the 200 page limit.",
    "-60018": "MinerU daily parsing quota has been reached.",
  }
  const knownMessage = known[key]
  if (knownMessage) return msg ? `${knownMessage} (${msg})` : knownMessage
  return msg ? `MinerU API error ${key || "unknown"}: ${msg}` : `MinerU API error ${key || "unknown"}`
}

function assertMineruSuccess(json: { code: number | string; msg?: string }): void {
  if (json.code !== 0 && json.code !== "0") {
    throw new Error(mineruApiErrorMessage(json.code, json.msg))
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new Error("MinerU parsing cancelled")
  }
}

function decodeBase64ToBytes(base64: string): Uint8Array {
  if (typeof atob !== "function") {
    throw new Error("Base64 decoding is not available in this runtime")
  }
  const binaryStr = atob(base64)
  const bytes = new Uint8Array(binaryStr.length)
  for (let i = 0; i < binaryStr.length; i++) {
    bytes[i] = binaryStr.charCodeAt(i)
  }
  return bytes
}

function bytesToUploadBody(bytes: Uint8Array): ArrayBuffer {
  if (bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength) {
    return bytes.buffer as ArrayBuffer
  }
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ""
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize)
    binary += String.fromCharCode(...chunk)
  }
  return btoa(binary)
}

async function sha256OfBytes(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytesToUploadBody(bytes))
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}

function mineruImageMimeType(path: string): string {
  const ext = getFileName(path).split(".").pop()?.toLowerCase() ?? ""
  switch (ext) {
    case "jpg":
    case "jpeg":
      return "image/jpeg"
    case "png":
      return "image/png"
    case "gif":
      return "image/gif"
    case "webp":
      return "image/webp"
    case "bmp":
      return "image/bmp"
    case "svg":
      return "image/svg+xml"
    case "tif":
    case "tiff":
      return "image/tiff"
    default:
      return "application/octet-stream"
  }
}

function mineruExtensionForMimeType(mimeType: string): string | null {
  switch (mimeType.trim().toLowerCase()) {
    case "image/jpeg": return "jpg"
    case "image/png": return "png"
    case "image/gif": return "gif"
    case "image/webp": return "webp"
    case "image/bmp": return "bmp"
    case "image/svg+xml": return "svg"
    case "image/tiff": return "tiff"
    default: return null
  }
}

function safeMineruAssetSegment(segment: string): string {
  const decoded = (() => {
    try {
      return decodeURIComponent(segment)
    } catch {
      return segment
    }
  })()
  const cleaned = decoded
    .replace(/[<>:"|?*\x00-\x1f]/g, "_")
    .replace(/[\\/]+/g, "_")
    .replace(/^\.+$/, "_")
    .replace(/[. ]+$/g, "_")
  if (!cleaned) return "asset"
  if (cleaned.length <= 80) return cleaned

  const dot = cleaned.lastIndexOf(".")
  if (dot > 0 && dot < cleaned.length - 1) {
    const ext = cleaned.slice(dot).slice(0, 16)
    return `${cleaned.slice(0, Math.max(1, 80 - ext.length))}${ext}`
  }
  return cleaned.slice(0, 80)
}

function normalizeMineruZipPath(path: string): string {
  return normalizePath(path)
    .replace(/^\.\/+/, "")
    .split("/")
    .filter((part) => part && part !== "." && part !== "..")
    .join("/")
}

function decodeMineruPath(path: string): string {
  try {
    return decodeURIComponent(path)
  } catch {
    return path
  }
}

function isMineruImagePath(path: string): boolean {
  const ext = getFileName(path).split(".").pop()?.toLowerCase() ?? ""
  return MINERU_IMAGE_EXTS.has(ext)
}

function mineruAssetRelPath(sourceSummarySlug: string, zipPath: string): string {
  const safeParts = normalizeMineruZipPath(zipPath)
    .split("/")
    .map(safeMineruAssetSegment)
    .filter(Boolean)
  const safePath = safeParts.length > 0 ? safeParts.join("/") : "image.png"
  return `media/${sourceSummarySlug}/mineru/${safePath}`
}

function isExternalOrDataUrl(url: string): boolean {
  return /^(https?:|data:|blob:|file:|tauri:|asset:)/i.test(url)
}

function decodeHtmlEntities(text: string): string {
  const safeCodePoint = (raw: string, radix: 10 | 16): string => {
    const n = Number.parseInt(raw, radix)
    if (!Number.isFinite(n) || n < 0 || n > 0x10ffff) return radix === 16 ? `&#x${raw};` : `&#${raw};`
    try {
      return String.fromCodePoint(n)
    } catch {
      return radix === 16 ? `&#x${raw};` : `&#${raw};`
    }
  }

  return text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_m, code: string) => safeCodePoint(code, 10))
    .replace(/&#x([0-9a-f]+);/gi, (_m, code: string) => safeCodePoint(code, 16))
}

function htmlImgTagsToMarkdown(html: string): string {
  return html.replace(/<img\b[^>]*\bsrc=(["'])([^"']+)\1[^>]*>/gi, (full, _quote: string, src: string) => {
    const alt = full.match(/\balt=(["'])([^"']*)\1/i)?.[2] ?? ""
    return `![${alt}](${src})`
  })
}

function htmlCellToMarkdown(cell: string): string {
  return decodeHtmlEntities(
    htmlImgTagsToMarkdown(cell)
      .replace(/<br\s*\/?>/gi, "<br>")
      .replace(/<\/p\s*>/gi, "<br>")
      .replace(/<[^>]+>/g, "")
      .replace(/\s*<br>\s*/gi, "<br>")
      .replace(/\s+/g, " ")
      .trim(),
  ).replace(/\|/g, "\\|")
}

function convertHtmlTablesInSegment(segment: string): string {
  return segment.replace(/<table\b[\s\S]*?<\/table>/gi, (tableHtml) => {
    const rows: string[][] = []
    for (const rowMatch of tableHtml.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
      const rowHtml = rowMatch[1] ?? ""
      const cells: string[] = []
      for (const cellMatch of rowHtml.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)) {
        cells.push(htmlCellToMarkdown(cellMatch[1] ?? ""))
      }
      if (cells.length > 0) rows.push(cells)
    }
    if (rows.length === 0) return tableHtml

    const width = Math.max(...rows.map((row) => row.length))
    const padded = rows.map((row) => {
      const out = [...row]
      while (out.length < width) out.push("")
      return out
    })
    const header = padded[0]
    const separator = Array.from({ length: width }, () => "---")
    const body = padded.slice(1)
    return [
      "",
      `| ${header.join(" | ")} |`,
      `| ${separator.join(" | ")} |`,
      ...body.map((row) => `| ${row.join(" | ")} |`),
      "",
    ].join("\n")
  })
}

function convertHtmlTablesToMarkdown(markdown: string): string {
  return markdown
    .split(/(```[\s\S]*?```|~~~[\s\S]*?~~~)/g)
    .map((segment) => (
      segment.startsWith("```") || segment.startsWith("~~~")
        ? segment
        : convertHtmlTablesInSegment(segment)
    ))
    .join("")
}

function encodeMarkdownImageUrl(relPath: string): string {
  return relPath
    .split("/")
    .map((part) =>
      encodeURIComponent(part).replace(/[!'()*]/g, (char) =>
        `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
      ),
    )
    .join("/")
}

function rewriteMineruMarkdownImages(markdown: string, pathMap: Map<string, string>): string {
  const lookup = (rawUrl: string): string | null => {
    if (!rawUrl || isExternalOrDataUrl(rawUrl)) return null
    const cleaned = normalizeMineruZipPath(rawUrl.split("#")[0])
    if (!cleaned) return null
    const decoded = decodeMineruPath(cleaned)
    return pathMap.get(cleaned) ?? pathMap.get(decoded) ?? pathMap.get(getFileName(decoded)) ?? null
  }

  const withMarkdownImages = markdown.replace(
    /!\[([^\]]*)]\(((?:[^()]|\([^()]*\))*)\)/g,
    (full, alt: string, target: string) => {
      const trimmed = target.trim()
      const candidates: Array<{ url: string; suffix: string }> = []
      if (trimmed.startsWith("<") && trimmed.includes(">")) {
        const end = trimmed.indexOf(">")
        candidates.push({ url: trimmed.slice(1, end), suffix: trimmed.slice(end + 1) })
      } else {
        const titleMatch = trimmed.match(/^([\s\S]+?)(\s+["'][^"']*["']\s*)$/)
        if (titleMatch) candidates.push({ url: titleMatch[1].trim(), suffix: titleMatch[2] })
        candidates.push({ url: trimmed, suffix: "" })
        const tokenMatch = trimmed.match(/^(\S+)([\s\S]*)$/)
        if (tokenMatch) candidates.push({ url: tokenMatch[1], suffix: tokenMatch[2] })
      }

      for (const candidate of candidates) {
        const rel = lookup(candidate.url)
        if (!rel) continue
        const rewrittenTarget = `${encodeMarkdownImageUrl(rel)}${candidate.suffix}`
        return `![${alt}](${rewrittenTarget})`
      }
      return full
    },
  )

  return withMarkdownImages.replace(
    /<img\b[^>]*\bsrc=(["'])([^"']+)\1[^>]*>/gi,
    (full, _quote: string, src: string) => {
      const rel = lookup(src)
      if (!rel) return full
      const alt = full.match(/\balt=(["'])([^"']*)\1/i)?.[2] ?? ""
      return `![${alt}](${encodeMarkdownImageUrl(rel)})`
    },
  )
}

function unresolvedLocalImageRefs(markdown: string): string[] {
  const refs = new Set<string>()
  const isSavedMineruRef = (target: string): boolean =>
    /^media\/[^/]+\/mineru\//i.test(target)
  for (const match of markdown.matchAll(/!\[[^\]]*]\(((?:[^()]|\([^()]*\))*)\)/g)) {
    const target = match[1].trim().replace(/^<|>$/g, "").split(/\s+["']/)[0]
    if (target && !isExternalOrDataUrl(target) && !isSavedMineruRef(target)) refs.add(target)
  }
  for (const match of markdown.matchAll(/<img\b[^>]*\bsrc=(["'])([^"']+)\1[^>]*>/gi)) {
    const target = match[2].trim()
    if (target && !isExternalOrDataUrl(target) && !isSavedMineruRef(target)) refs.add(target)
  }
  return [...refs]
}

async function fetchWithTimeout(
  httpFetch: typeof globalThis.fetch,
  url: string,
  init: RequestInit,
  timeoutMs: number,
  label: string,
  signal?: AbortSignal,
): Promise<Response> {
  throwIfAborted(signal)
  const controller = new AbortController()
  let timedOut = false
  let rejectGuard: ((error: Error) => void) | null = null
  const guard = new Promise<never>((_resolve, reject) => {
    rejectGuard = reject
  })
  const onAbort = () => {
    controller.abort()
    rejectGuard?.(new Error("MinerU parsing cancelled"))
  }
  signal?.addEventListener("abort", onAbort, { once: true })
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
    rejectGuard?.(new Error(`${label} timed out after ${Math.max(1, Math.ceil(timeoutMs / 1000))} seconds`))
  }, timeoutMs)

  try {
    return await Promise.race([
      httpFetch(url, { ...init, signal: controller.signal }),
      guard,
    ])
  } catch (error) {
    throwIfAborted(signal)
    if (timedOut) {
      throw new Error(`${label} timed out after ${Math.max(1, Math.ceil(timeoutMs / 1000))} seconds`)
    }
    throw error
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener("abort", onAbort)
  }
}

function waitForUploadRetry(delayMs: number, signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal)
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort)
      resolve()
    }, delayMs)
    const onAbort = () => {
      clearTimeout(timer)
      signal?.removeEventListener("abort", onAbort)
      reject(new Error("MinerU parsing cancelled"))
    }
    signal?.addEventListener("abort", onAbort, { once: true })
  })
}

function uploadTimeoutMs(byteLength: number): number {
  const slowTransferMs = Math.ceil(byteLength / MINERU_UPLOAD_MIN_BYTES_PER_SECOND) * 1_000
  return Math.min(
    MINERU_UPLOAD_MAX_TIMEOUT_MS,
    Math.max(MINERU_UPLOAD_MIN_TIMEOUT_MS, slowTransferMs),
  )
}

function formatMegabytes(byteLength: number): string {
  return `${(byteLength / (1024 * 1024)).toFixed(1)} MB`
}

async function submitUrlTask(
  token: string,
  url: string,
  modelVersion: string,
  signal?: AbortSignal,
): Promise<string> {
  const httpFetch = await getHttpFetch()
  throwIfAborted(signal)
  const res = await fetchWithTimeout(httpFetch, `${API_BASE}/extract/task`, {
    method: "POST",
    headers: await mineruHeaders(token),
    body: JSON.stringify({ url, model_version: modelVersion }),
  }, MINERU_API_REQUEST_TIMEOUT_MS, "MinerU task submission", signal)
  if (!res.ok) throw new Error(`MinerU submit failed: HTTP ${res.status}`)
  const json: TaskResponse = await res.json()
  assertMineruSuccess(json)
  return json.data.task_id
}

async function uploadFileForTask(
  token: string,
  fileName: string,
  fileBase64: string,
  modelVersion: string,
  signal?: AbortSignal,
  onProgress?: (msg: string) => void,
): Promise<{ batchId: string; uploadUrl: string }> {
  const httpFetch = await getHttpFetch()
  const headers = await mineruHeaders(token)
  throwIfAborted(signal)
  const bytes = decodeBase64ToBytes(fileBase64)
  const sizeLabel = formatMegabytes(bytes.byteLength)
  const timeoutMs = uploadTimeoutMs(bytes.byteLength)
  let lastError: Error | null = null

  for (let attempt = 1; attempt <= MINERU_UPLOAD_ATTEMPTS; attempt++) {
    throwIfAborted(signal)
    try {
      onProgress?.(`Requesting MinerU upload address (attempt ${attempt}/${MINERU_UPLOAD_ATTEMPTS})...`)
      const res = await fetchWithTimeout(httpFetch, `${API_BASE}/file-urls/batch`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          files: [{ name: fileName, data_id: fileName }],
          model_version: modelVersion,
        }),
      }, MINERU_API_REQUEST_TIMEOUT_MS, "MinerU upload-address request", signal)
      if (!res.ok) throw new Error(`MinerU batch submit failed: HTTP ${res.status}`)
      const json: UploadUrlResponse = await res.json()
      assertMineruSuccess(json)

      const batchId = json.data.batch_id
      const uploadUrl = json.data.file_urls[0]
      if (!batchId || !uploadUrl) {
        throw new Error("MinerU did not return a file upload URL")
      }

      onProgress?.(`Uploading ${sizeLabel} to MinerU (attempt ${attempt}/${MINERU_UPLOAD_ATTEMPTS})...`)
      const uploadRes = await fetchWithTimeout(httpFetch, uploadUrl, {
        method: "PUT",
        body: bytesToUploadBody(bytes),
      }, timeoutMs, "MinerU file upload", signal)
      if (!uploadRes.ok && uploadRes.status !== 200 && uploadRes.status !== 201) {
        throw new Error(`MinerU file upload failed: HTTP ${uploadRes.status}`)
      }

      return { batchId, uploadUrl }
    } catch (error) {
      throwIfAborted(signal)
      lastError = error instanceof Error ? error : new Error(String(error))
      if (attempt >= MINERU_UPLOAD_ATTEMPTS) break
      onProgress?.(`MinerU upload attempt ${attempt}/${MINERU_UPLOAD_ATTEMPTS} failed; retrying...`)
      await waitForUploadRetry(attempt === 1 ? 1_000 : 3_000, signal)
    }
  }

  throw new Error(
    `MinerU upload failed after ${MINERU_UPLOAD_ATTEMPTS} attempts: ${lastError?.message ?? "unknown error"}`,
  )
}

function waitForPollInterval(signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal)
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort)
      resolve()
    }, POLL_INTERVAL_MS)
    const onAbort = () => {
      clearTimeout(timer)
      signal?.removeEventListener("abort", onAbort)
      reject(new Error("MinerU parsing cancelled"))
    }
    signal?.addEventListener("abort", onAbort, { once: true })
  })
}

async function pollTask(token: string, taskId: string, signal?: AbortSignal): Promise<string> {
  const httpFetch = await getHttpFetch()
  const headers = await mineruHeaders(token)
  const start = Date.now()

  while (Date.now() - start < POLL_TIMEOUT_MS) {
    throwIfAborted(signal)
    const res = await fetchWithTimeout(httpFetch, `${API_BASE}/extract/task/${taskId}`, {
      headers,
    }, MINERU_API_REQUEST_TIMEOUT_MS, "MinerU status request", signal)
    if (!res.ok) throw new Error(`MinerU poll failed: HTTP ${res.status}`)
    const json: TaskStatus = await res.json()
    assertMineruSuccess(json)

    if (json.data.state === "done" && json.data.full_zip_url) {
      return json.data.full_zip_url
    }
    if (json.data.state === "failed") {
      throw new Error(`MinerU parsing failed: ${json.data.err_msg ?? "unknown error"}`)
    }

    await waitForPollInterval(signal)
  }

  throw new Error("MinerU parsing timed out after 5 minutes")
}

async function pollBatchTask(
  token: string,
  batchId: string,
  signal?: AbortSignal,
): Promise<string> {
  const httpFetch = await getHttpFetch()
  const headers = await mineruHeaders(token)
  const start = Date.now()

  while (Date.now() - start < POLL_TIMEOUT_MS) {
    throwIfAborted(signal)
    const res = await fetchWithTimeout(
      httpFetch,
      `${API_BASE}/extract-results/batch/${batchId}`,
      { headers },
      MINERU_API_REQUEST_TIMEOUT_MS,
      "MinerU status request",
      signal,
    )
    if (!res.ok) throw new Error(`MinerU batch poll failed: HTTP ${res.status}`)
    const json: BatchStatus = await res.json()
    assertMineruSuccess(json)

    const result = json.data.extract_result[0]
    if (result?.state === "done" && result.full_zip_url) {
      return result.full_zip_url
    }
    if (result?.state === "failed") {
      throw new Error(`MinerU parsing failed: ${result.err_msg ?? "unknown error"}`)
    }

    await waitForPollInterval(signal)
  }

  throw new Error("MinerU parsing timed out after 5 minutes")
}

async function saveMineruZipImages(
  zip: JSZip,
  options: MineruAssetOptions,
  signal?: AbortSignal,
): Promise<{ pathMap: Map<string, string>; savedImages: SavedImage[] }> {
  const pp = normalizePath(options.projectPath)
  const rootDir = `${pp}/wiki/media/${options.sourceSummarySlug}/mineru`
  const pathMap = new Map<string, string>()
  const savedImages: SavedImage[] = []
  const imageEntries: Array<[string, JSZip.JSZipObject]> = []
  const basenameCounts = new Map<string, number>()

  zip.forEach((relativePath, file) => {
    const normalized = normalizeMineruZipPath(relativePath)
    if (!file.dir && normalized && isMineruImagePath(normalized)) {
      imageEntries.push([normalized, file])
      const basename = getFileName(normalized)
      basenameCounts.set(basename, (basenameCounts.get(basename) ?? 0) + 1)
    }
  })

  if (imageEntries.length === 0) return { pathMap, savedImages }

  await createDirectory(rootDir)
  for (const [zipPath, file] of imageEntries) {
    throwIfAborted(signal)
    const relPath = mineruAssetRelPath(options.sourceSummarySlug, zipPath)
    const absPath = `${pp}/wiki/${relPath}`
    const bytes = await file.async("uint8array")
    await writeFileBase64(absPath, bytesToBase64(bytes))
    pathMap.set(zipPath, relPath)
    pathMap.set(decodeMineruPath(zipPath), relPath)
    const basename = getFileName(zipPath)
    if (basenameCounts.get(basename) === 1) {
      pathMap.set(basename, relPath)
      pathMap.set(decodeMineruPath(basename), relPath)
    }
    savedImages.push({
      index: savedImages.length + 1,
      mimeType: mineruImageMimeType(relPath),
      page: null,
      width: 0,
      height: 0,
      relPath,
      absPath,
      sha256: await sha256OfBytes(bytes),
    })
  }

  return { pathMap, savedImages }
}

async function downloadAndExtractMarkdown(
  zipUrl: string,
  signal?: AbortSignal,
  assetOptions?: MineruAssetOptions,
  onProgress?: (msg: string) => void,
): Promise<MineruExtractedMarkdown> {
  const httpFetch = await getHttpFetch()
  let buffer: ArrayBuffer | null = null
  let lastDownloadError: Error | null = null
  for (let attempt = 1; attempt <= ZIP_DOWNLOAD_ATTEMPTS; attempt++) {
    throwIfAborted(signal)
    try {
      const res = await httpFetch(zipUrl, { signal })
      if (res.ok) {
        buffer = await res.arrayBuffer()
        break
      }
      lastDownloadError = new MineruZipHttpError(res.status)
      if (res.status < 500) throw lastDownloadError
    } catch (err) {
      throwIfAborted(signal)
      lastDownloadError = err instanceof Error ? err : new Error(String(err))
      if (lastDownloadError instanceof MineruZipHttpError && lastDownloadError.status < 500) {
        throw lastDownloadError
      }
    }
    if (attempt < ZIP_DOWNLOAD_ATTEMPTS) await waitForZipDownloadRetry(signal)
  }
  if (!buffer) {
    throwIfAborted(signal)
    onProgress?.("Proxy download failed; retrying MinerU CDN directly...")
    try {
      buffer = await downloadMineruZipDirect(zipUrl)
      throwIfAborted(signal)
    } catch (directError) {
      throwIfAborted(signal)
      const normalMessage = lastDownloadError?.message ?? "no response"
      const directMessage = directError instanceof Error ? directError.message : String(directError)
      throw new Error(
        `MinerU ZIP download failed through both the normal route (${normalMessage}) and the secure direct route (${directMessage})`,
      )
    }
  }
  const zip = await JSZip.loadAsync(buffer)

  // Official MinerU result archives contain full.md. An arbitrary secondary
  // Markdown file may represent only one page or an intermediate artifact, so
  // accepting it would silently ingest an incomplete document.
  const mdEntries: [string, JSZip.JSZipObject][] = []
  zip.forEach((relativePath, file) => {
    if (!file.dir && relativePath.endsWith(".md")) {
      mdEntries.push([relativePath, file])
    }
  })

  if (mdEntries.length === 0) {
    throw new Error("No Markdown file found in MinerU result zip")
  }

  const fullMd = mdEntries.find(([relativePath]) =>
    relativePath.split("/").pop()?.toLowerCase() === "full.md"
  )
  if (!fullMd) {
    throw new Error("MinerU result zip did not contain full.md; PDF ingest was stopped to avoid using a partial Markdown file")
  }
  const markdown = await fullMd[1].async("string")
  const markdownWithTables = convertHtmlTablesToMarkdown(markdown)
  const processedPageCount = await countMineruStructuredPages(zip)
  if (!assetOptions) return { markdown: markdownWithTables, savedImages: [], processedPageCount }

  try {
    const { pathMap, savedImages } = await saveMineruZipImages(zip, assetOptions, signal)
    const rewrittenMarkdown = pathMap.size > 0
      ? rewriteMineruMarkdownImages(markdownWithTables, pathMap)
      : markdownWithTables
    const unresolvedImageRefs = unresolvedLocalImageRefs(rewrittenMarkdown)
    if (unresolvedImageRefs.length > 0) {
      throw new Error(
        `MinerU result is missing ${unresolvedImageRefs.length} referenced image asset(s): ${unresolvedImageRefs.slice(0, 5).join(", ")}`,
      )
    }
    return {
      markdown: rewrittenMarkdown,
      savedImages,
      processedPageCount,
    }
  } catch (err) {
    if (signal?.aborted) throw err
    const message = err instanceof Error ? err.message : String(err)
    throw new Error(
      `MinerU result images could not be saved; PDF ingest must stop instead of dropping them: ${message}`,
    )
  }
}

function waitForZipDownloadRetry(signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal)
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort)
      resolve()
    }, ZIP_DOWNLOAD_RETRY_MS)
    const onAbort = () => {
      clearTimeout(timer)
      signal?.removeEventListener("abort", onAbort)
      reject(new Error("MinerU parsing cancelled"))
    }
    signal?.addEventListener("abort", onAbort, { once: true })
  })
}

// ── Local backend ──

/**
 * Parse a document through the official `mineru-api` asynchronous protocol.
 * Files are submitted as multipart/form-data to `/tasks`; the task status and
 * result contracts mirror MinerU's own API client.
 */
async function parseWithLocalMineru(
  config: MineruConfig,
  sourcePath: string,
  fileName: string,
  onProgress?: (msg: string) => void,
  signal?: AbortSignal,
  assetOptions?: MineruAssetOptions,
): Promise<MineruExtractedMarkdown> {
  const httpFetch = await getHttpFetch()
  const apiBase = localMineruApiBase(config.localEndpoint)
  if (config.localBackend?.endsWith("http-client") && !config.localServerUrl?.trim()) {
    throw new Error("MinerU HTTP client backends require a model server URL")
  }
  const fileSize = await getFileSize(sourcePath)
  if (fileSize > MAX_ACCURATE_PARSE_BYTES) {
    throw new Error("MinerU accurate parsing supports files up to 200 MB")
  }
  throwIfAborted(signal)
  const { base64 } = await readFileAsBase64(sourcePath)
  const bytes = decodeBase64ToBytes(base64)
  const fileBuffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer
  const form = new FormData()
  form.append("files", new Blob([fileBuffer], { type: "application/pdf" }), fileName)
  form.append("lang_list", config.localLanguage || "ch")
  form.append("backend", config.localBackend || "hybrid-engine")
  form.append("effort", config.localEffort || "medium")
  form.append("parse_method", config.localParseMethod || "auto")
  form.append("formula_enable", String(config.localFormulaEnabled !== false))
  form.append("table_enable", String(config.localTableEnabled !== false))
  form.append("image_analysis", String(config.localImageAnalysis !== false))
  form.append("return_md", "true")
  form.append("return_images", String(Boolean(assetOptions)))
  form.append("response_format_zip", "false")
  if (config.localServerUrl?.trim()) form.append("server_url", config.localServerUrl.trim())

  onProgress?.("Uploading to local MinerU...")
  const submitRes = await httpFetch(`${apiBase}/tasks`, {
    method: "POST",
    signal,
    body: form,
  })
  if (!submitRes.ok) {
    const text = await submitRes.text().catch(() => "")
    throw new Error(`Local MinerU submit failed: HTTP ${submitRes.status}: ${text}`)
  }

  const submitData = await submitRes.json() as { task_id?: unknown }
  const taskId = typeof submitData.task_id === "string" ? submitData.task_id.trim() : ""
  if (!taskId) throw new Error("Local MinerU returned no task ID")
  const encodedTaskId = encodeURIComponent(taskId)
  // Keep all follow-up requests pinned to the user-configured service. The
  // official response includes absolute URLs, but following arbitrary values
  // from a compromised or incompatible server would create an SSRF redirect.
  const statusUrl = `${apiBase}/tasks/${encodedTaskId}`
  const resultUrl = `${apiBase}/tasks/${encodedTaskId}/result`

  onProgress?.("Waiting for local MinerU to finish...")
  const start = Date.now()
  while (Date.now() - start < LOCAL_POLL_TIMEOUT_MS) {
    throwIfAborted(signal)

    const statusRes = await httpFetch(statusUrl, { signal })
    if (!statusRes.ok) {
      throw new Error(`Local MinerU status check failed: HTTP ${statusRes.status}`)
    }
    const status = await statusRes.json()

    if (status.status === "completed") {
      onProgress?.("Downloading parsed result...")
      const resultRes = await httpFetch(resultUrl, { signal })
      if (!resultRes.ok) {
        throw new Error(`Local MinerU download failed: HTTP ${resultRes.status}`)
      }
      const result = await resultRes.json() as {
        results?: Record<string, { md_content?: unknown; images?: unknown }>
      }
      const first = result.results && Object.values(result.results)[0]
      if (!first || typeof first.md_content !== "string" || !first.md_content.trim()) {
        throw new Error("Local MinerU returned an empty parsing result")
      }
      let markdown = convertHtmlTablesToMarkdown(first.md_content)
      const savedImages: SavedImage[] = []
      const pathMap = new Map<string, string>()
      if (assetOptions && first.images && typeof first.images === "object") {
        const mediaDir = `${normalizePath(assetOptions.projectPath)}/wiki/media/${assetOptions.sourceSummarySlug}/mineru/images`
        await createDirectory(mediaDir)
        for (const [rawName, rawData] of Object.entries(first.images)) {
          throwIfAborted(signal)
          if (typeof rawData !== "string") continue
          const match = rawData.match(/^data:(image\/[^;]+);base64,(.+)$/s)
          if (!match) continue
          const sourceName = getFileName(normalizeMineruZipPath(rawName))
          if (!sourceName || !isMineruImagePath(sourceName)) continue
          // The data URI describes the bytes actually written. The server's
          // filename is untrusted lookup metadata and may carry a mismatched
          // extension, which would break previews and downstream MIME handling.
          const mimeType = match[1].toLowerCase()
          const extension = mineruExtensionForMimeType(mimeType)
          if (!extension) continue
          // Server-provided names are untrusted and may collide or contain a
          // Windows reserved device name. Generate deterministic local names
          // while retaining lookup entries for the original Markdown target.
          const safeName = `image-${savedImages.length + 1}.${extension}`
          const absPath = `${mediaDir}/${safeName}`
          const relPath = `media/${assetOptions.sourceSummarySlug}/mineru/images/${safeName}`
          await writeFileBase64(absPath, match[2])
          savedImages.push({
            index: savedImages.length,
            mimeType,
            page: null,
            width: 0,
            height: 0,
            relPath,
            absPath,
            sha256: "",
          })
          pathMap.set(rawName, relPath)
          pathMap.set(sourceName, relPath)
        }
      }
      if (pathMap.size > 0) markdown = rewriteMineruMarkdownImages(markdown, pathMap)
      return { markdown, savedImages, processedPageCount: null }
    }
    if (status.status === "failed") {
      throw new Error(`Local MinerU parsing failed: ${status.error || "unknown error"}`)
    }

    await waitForPollInterval(signal)
  }

  throw new Error("Local MinerU parsing timed out")
}

// ── Public API ──

/**
 * Parse a PDF file using MinerU cloud API.
 *
 * @param config MinerU configuration (token, model version)
 * @param sourcePath Local file path to the PDF
 * @param sourceUrl Optional URL if the PDF was fetched from the web — avoids re-upload
 * @param onProgress Optional progress callback
 * @returns Parsed Markdown content
 */
export async function parseWithMineru(
  config: MineruConfig,
  sourcePath: string,
  sourceUrl?: string,
  onProgress?: (msg: string) => void,
  signal?: AbortSignal,
  assetOptions?: MineruAssetOptions,
): Promise<string> {
  return (await parseWithMineruResult(config, sourcePath, sourceUrl, onProgress, signal, assetOptions)).markdown
}

export async function parseWithMineruResult(
  config: MineruConfig,
  sourcePath: string,
  sourceUrl?: string,
  onProgress?: (msg: string) => void,
  signal?: AbortSignal,
  assetOptions?: MineruAssetOptions,
): Promise<MineruExtractedMarkdown> {
  throwIfAborted(signal)

  if (config.backend === "local") {
    const fileName = getFileName(sourcePath) || "document.pdf"
    const result = await parseWithLocalMineru(
      config,
      sourcePath,
      fileName,
      onProgress,
      signal,
      assetOptions,
    )
    onProgress?.("Done")
    return result
  }

  if (!config.token) throw new Error("MinerU API token not configured")
  if (config.modelVersion !== "pipeline" && config.modelVersion !== "vlm") {
    throw new Error("MinerU PDF parsing supports only pipeline or vlm model versions")
  }

  let zipUrl: string
  let refreshZipUrl: (() => Promise<string>) | null = null

  if (sourceUrl) {
    onProgress?.("Submitting URL to MinerU...")
    const taskId = await submitUrlTask(config.token, sourceUrl, config.modelVersion, signal)
    onProgress?.("Waiting for MinerU to finish...")
    refreshZipUrl = () => pollTask(config.token, taskId, signal)
    zipUrl = await refreshZipUrl()
  } else {
    throwIfAborted(signal)
    const fileSize = await getFileSize(sourcePath)
    if (fileSize > MAX_ACCURATE_PARSE_BYTES) {
      throw new Error("MinerU accurate parsing supports files up to 200 MB")
    }

    onProgress?.(`Reading ${formatMegabytes(fileSize)} PDF for MinerU upload...`)
    const fileName = sourcePath.split("/").pop() ?? "document.pdf"
    throwIfAborted(signal)
    const { base64 } = await readFileAsBase64(sourcePath)

    const { batchId } = await uploadFileForTask(
      config.token,
      fileName,
      base64,
      config.modelVersion,
      signal,
      onProgress,
    )
    onProgress?.("Waiting for MinerU to finish...")
    refreshZipUrl = () => pollBatchTask(config.token, batchId, signal)
    zipUrl = await refreshZipUrl()
  }

  onProgress?.("Downloading parsed result...")
  let result: MineruExtractedMarkdown
  try {
    result = await downloadAndExtractMarkdown(zipUrl, signal, assetOptions, onProgress)
  } catch (error) {
    if (!isExpiredMineruZipError(error) || !refreshZipUrl) throw error
    onProgress?.("MinerU download address expired; requesting a fresh address...")
    zipUrl = await refreshZipUrl()
    result = await downloadAndExtractMarkdown(zipUrl, signal, assetOptions, onProgress)
  }
  onProgress?.("Done")

  return result
}

/**
 * Test MinerU connectivity.
 *
 * Cloud backend: submits a minimal task to validate the token.
 * Local backend: checks the local service health endpoint (no token needed).
 */
export async function testMineruConnection(
  token: string,
  config?: Pick<MineruConfig, "backend" | "localEndpoint">,
): Promise<void> {
  const httpFetch = await getHttpFetch()

  if (config?.backend === "local") {
    const res = await httpFetch(`${localMineruApiBase(config.localEndpoint)}/health`)
    if (!res.ok) {
      const text = await res.text().catch(() => "")
      throw new Error(`Local MinerU service unavailable: HTTP ${res.status}: ${text}`)
    }
    const health = await res.json().catch(() => null) as { status?: unknown } | null
    if (health?.status !== "healthy") {
      throw new Error("Local MinerU service returned an invalid or unhealthy status")
    }
    return
  }

  const res = await httpFetch(`${API_BASE}/extract/task`, {
    method: "POST",
    headers: await mineruHeaders(token),
    body: JSON.stringify({
      url: "https://cdn-mineru.openxlab.org.cn/demo/example.pdf",
      model_version: "pipeline",
    }),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new Error(`HTTP ${res.status}: ${text}`)
  }

  const json: TaskResponse = await res.json()
  assertMineruSuccess(json)
}

// Test-only hooks for MinerU's browser/Tauri boundary helpers.
export const __mineruTest = {
  downloadAndExtractMarkdown: async (
    zipUrl: string,
    signal?: AbortSignal,
    assetOptions?: MineruAssetOptions,
  ) => (await downloadAndExtractMarkdown(zipUrl, signal, assetOptions)).markdown,
  downloadAndExtractMarkdownResult: downloadAndExtractMarkdown,
  mineruApiErrorMessage,
  decodeBase64ToBytes,
  rewriteMineruMarkdownImages,
  convertHtmlTablesToMarkdown,
  fetchWithTimeout,
  MAX_ACCURATE_PARSE_BYTES,
}
