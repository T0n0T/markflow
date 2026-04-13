export type MarkdownSelection = {
  end: number
  start: number
}

export const MARKDOWN_SELECTION_CARET_MARKER = '\uE000MFSELCARET\uE001'
export const MARKDOWN_SELECTION_START_MARKER = '\uE000MFSELSTART\uE001'
export const MARKDOWN_SELECTION_END_MARKER = '\uE000MFSELEND\uE001'

const LEGACY_MARKER_REPLACEMENTS = [
  ['\uE000MFSEL_CARET\uE001', MARKDOWN_SELECTION_CARET_MARKER],
  ['\uE000MFSEL\\_CARET\uE001', MARKDOWN_SELECTION_CARET_MARKER],
  ['\uE000MFSEL_START\uE001', MARKDOWN_SELECTION_START_MARKER],
  ['\uE000MFSEL\\_START\uE001', MARKDOWN_SELECTION_START_MARKER],
  ['\uE000MFSEL_END\uE001', MARKDOWN_SELECTION_END_MARKER],
  ['\uE000MFSEL\\_END\uE001', MARKDOWN_SELECTION_END_MARKER],
] as const

function normalizeSelectionMarkers(markdown: string) {
  return LEGACY_MARKER_REPLACEMENTS.reduce(
    (value, [legacyMarker, nextMarker]) => value.replaceAll(legacyMarker, nextMarker),
    markdown,
  )
}

function normalizeMarkdownSelection(markdown: string, selection: MarkdownSelection) {
  const max = markdown.length
  const start = Math.max(0, Math.min(selection.start, max))
  const end = Math.max(0, Math.min(selection.end, max))

  if (start <= end) {
    return { start, end }
  }

  return { start: end, end: start }
}

export function injectMarkdownSelectionMarkers(markdown: string, selection: MarkdownSelection) {
  const normalized = normalizeMarkdownSelection(markdown, selection)
  if (normalized.start === normalized.end) {
    return `${markdown.slice(0, normalized.start)}${MARKDOWN_SELECTION_CARET_MARKER}${markdown.slice(normalized.end)}`
  }

  return [
    markdown.slice(0, normalized.start),
    MARKDOWN_SELECTION_START_MARKER,
    markdown.slice(normalized.start, normalized.end),
    MARKDOWN_SELECTION_END_MARKER,
    markdown.slice(normalized.end),
  ].join('')
}

export function extractMarkdownSelectionMarkers(markdown: string) {
  const normalizedMarkdown = normalizeSelectionMarkers(markdown)

  const caretIndex = normalizedMarkdown.indexOf(MARKDOWN_SELECTION_CARET_MARKER)
  if (caretIndex >= 0) {
    return {
      markdown: normalizedMarkdown.replace(MARKDOWN_SELECTION_CARET_MARKER, ''),
      selection: { start: caretIndex, end: caretIndex },
    }
  }

  const startIndex = normalizedMarkdown.indexOf(MARKDOWN_SELECTION_START_MARKER)
  const endIndex = normalizedMarkdown.indexOf(MARKDOWN_SELECTION_END_MARKER)
  if (startIndex < 0 || endIndex < 0 || startIndex > endIndex) {
    return {
      markdown: normalizedMarkdown,
      selection: null,
    }
  }

  const withoutStart = normalizedMarkdown.replace(MARKDOWN_SELECTION_START_MARKER, '')
  const adjustedEndIndex = endIndex - MARKDOWN_SELECTION_START_MARKER.length

  return {
    markdown: withoutStart.replace(MARKDOWN_SELECTION_END_MARKER, ''),
    selection: {
      start: startIndex,
      end: adjustedEndIndex,
    },
  }
}
