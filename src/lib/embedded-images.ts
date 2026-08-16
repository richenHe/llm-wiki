export const MANAGED_EMBEDDED_IMAGES_MARKER = "<!-- llm-wiki:embedded-images -->"

/**
 * Keep the on-disk source page complete while excluding the automatically
 * appended image inventory from semantic indexing. User-authored images and
 * every byte outside the paired managed markers remain untouched.
 */
export function stripManagedEmbeddedImagesForIndex(content: string): string {
  let output = ""
  let cursor = 0
  let changed = false

  while (cursor < content.length) {
    const start = content.indexOf(MANAGED_EMBEDDED_IMAGES_MARKER, cursor)
    if (start < 0) break
    changed = true
    output += content.slice(cursor, start)
    const afterStart = start + MANAGED_EMBEDDED_IMAGES_MARKER.length
    const end = content.indexOf(MANAGED_EMBEDDED_IMAGES_MARKER, afterStart)
    if (end < 0) {
      cursor = content.length
      break
    }
    cursor = end + MANAGED_EMBEDDED_IMAGES_MARKER.length
    if (content[cursor] === "\r") cursor++
    if (content[cursor] === "\n") cursor++
  }

  if (!changed) return content
  output += content.slice(cursor)
  return output
}
