import {
  type MouseEvent as ReactMouseEvent,
  type ClipboardEvent as ReactClipboardEvent,
  useCallback,
  useEffect,
  useRef,
} from 'react'
import { languages } from '@codemirror/language-data'
import { EditorView as CodeMirrorEditorView } from '@codemirror/view'
import { Crepe } from '@milkdown/crepe'
import {
  HighlightStyle,
  LanguageDescription,
  LanguageSupport,
  StreamLanguage,
  syntaxHighlighting,
  type StreamParser,
  type StringStream,
} from '@codemirror/language'
import { commandsCtx, editorViewCtx } from '@milkdown/kit/core'
import { redoCommand, undoCommand } from '@milkdown/kit/plugin/history'
import { TextSelection } from '@milkdown/kit/prose/state'
import type { EditorView as ProseMirrorEditorView } from '@milkdown/kit/prose/view'
import {
  addBlockTypeCommand,
  clearTextInCurrentBlockCommand,
  codeBlockSchema,
  createCodeBlockCommand,
  listItemSchema,
  toggleEmphasisCommand,
  toggleStrongCommand,
  wrapInBlockquoteCommand,
  wrapInBlockTypeCommand,
  wrapInBulletListCommand,
  wrapInHeadingCommand,
  wrapInOrderedListCommand,
} from '@milkdown/kit/preset/commonmark'
import { insertTableCommand } from '@milkdown/kit/preset/gfm'
import { insert, replaceAll } from '@milkdown/kit/utils'
import { tags as t } from '@lezer/highlight'
import { Milkdown, useEditor } from '@milkdown/react'
import mermaid from 'mermaid'

import { type ToolbarAction, type WysiwygEditorApi } from '@/features/app/shared'
import {
  MARKDOWN_SELECTION_CARET_MARKER,
  MARKDOWN_SELECTION_END_MARKER,
  MARKDOWN_SELECTION_START_MARKER,
  extractMarkdownSelectionMarkers,
  injectMarkdownSelectionMarkers,
  type MarkdownSelection,
} from '@/features/app/editor-selection'

import '@milkdown/crepe/theme/common/style.css'
import '@milkdown/crepe/theme/frame.css'

const MERMAID_LANGUAGE_ALIASES = new Set(['mermaid', 'mmd'])
const MERMAID_RENDER_TIMEOUT_MS = 12_000

const mermaidStreamParser: StreamParser<null> = {
  startState: () => null,
  token: (stream: StringStream) => {
    if (stream.eatSpace()) {
      return null
    }

    if (stream.match(/^%%.*/)) {
      return 'comment'
    }

    if (stream.match(/^"(?:[^"\\]|\\.)*"/) || stream.match(/^'(?:[^'\\]|\\.)*'/)) {
      return 'string'
    }

    if (
      stream.match(
        /\b(flowchart|graph|sequenceDiagram|classDiagram|stateDiagram|stateDiagram-v2|erDiagram|journey|gantt|pie|mindmap|timeline|quadrantChart|requirementDiagram|gitGraph|C4Context|C4Container|C4Component|C4Dynamic|C4Deployment|subgraph|end|participant|actor|class|state|style|linkStyle|click)\b/,
      )
    ) {
      return 'keyword'
    }

    if (stream.match(/(-->|==>|-.->|---|\|\|)/)) {
      return 'operator'
    }

    if (stream.match(/[0-9]+(?:\.[0-9]+)?/)) {
      return 'number'
    }

    if (stream.match(/[A-Za-z_][A-Za-z0-9_-]*/)) {
      return 'variableName'
    }

    stream.next()
    return null
  },
  languageData: {
    commentTokens: { line: '%%' },
  },
}

const mermaidLanguage = LanguageDescription.of({
  alias: ['mermaid', 'mmd'],
  extensions: ['mermaid', 'mmd'],
  name: 'Mermaid',
  support: new LanguageSupport(StreamLanguage.define(mermaidStreamParser)),
})

const codeHighlightStyle = HighlightStyle.define([
  { tag: t.keyword, color: 'var(--mf-code-token-keyword)', fontWeight: '600' },
  { tag: [t.name, t.propertyName, t.variableName], color: 'var(--mf-code-token-name)' },
  { tag: [t.function(t.variableName), t.labelName], color: 'var(--mf-code-token-function)' },
  { tag: [t.number, t.integer, t.float, t.bool], color: 'var(--mf-code-token-number)' },
  { tag: [t.string, t.special(t.string)], color: 'var(--mf-code-token-string)' },
  { tag: [t.operator, t.punctuation], color: 'var(--mf-code-token-operator)' },
  { tag: [t.comment, t.meta], color: 'var(--mf-code-token-comment)', fontStyle: 'italic' },
  { tag: [t.link, t.url], color: 'var(--mf-code-token-link)', textDecoration: 'underline' },
])

const codeEditorTheme = CodeMirrorEditorView.theme({
  '&': {
    backgroundColor: 'var(--mf-code-block-bg)',
    border: '1px solid var(--mf-code-block-border)',
    borderRadius: '10px',
  },
  '.cm-content': {
    color: 'var(--mf-code-block-text)',
    fontFamily: '"JetBrains Mono", "SFMono-Regular", Menlo, Consolas, monospace',
    fontSize: '13px',
    lineHeight: '1.7',
  },
  '.cm-line': {
    padding: '0 0 0 2px',
  },
  '.cm-gutters': {
    backgroundColor: 'var(--mf-code-block-bg)',
    borderRight: '1px solid var(--mf-code-gutter-border)',
    color: 'var(--mf-code-gutter-text)',
  },
  '.cm-activeLine': {
    backgroundColor: 'var(--mf-code-line-active)',
  },
  '.cm-activeLineGutter': {
    backgroundColor: 'var(--mf-code-line-active)',
  },
  '.cm-selectionBackground, .cm-content ::selection': {
    backgroundColor: 'var(--mf-code-selection)',
  },
  '.cm-cursor, .cm-dropCursor': {
    borderLeftColor: 'var(--mf-code-cursor)',
  },
})

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function withTimeout<T>(task: Promise<T>, timeoutMs: number, timeoutMessage: string) {
  return new Promise<T>((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      reject(new Error(timeoutMessage))
    }, timeoutMs)

    void task
      .then((value) => {
        window.clearTimeout(timeoutId)
        resolve(value)
      })
      .catch((error) => {
        window.clearTimeout(timeoutId)
        reject(error)
      })
  })
}

function resolveMermaidTheme() {
  if (typeof document === 'undefined') {
    return 'default' as const
  }

  const explicitTheme = document.documentElement.dataset.theme
  if (explicitTheme === 'dark') {
    return 'dark' as const
  }
  if (explicitTheme === 'light') {
    return 'default' as const
  }
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? ('dark' as const) : ('default' as const)
  }
  return 'default' as const
}

function hasMermaidFence(markdown: string) {
  return /```(?:mermaid|mmd)\b/i.test(markdown)
}

export type WysiwygMarkdownEditorProps = {
  editable: boolean
  markdown: string
  onApiChange: (api: WysiwygEditorApi | null) => void
  onChange: (nextValue: string) => void
  onContextMenu?: (event: ReactMouseEvent<HTMLDivElement>) => void
  onImageUpload: (file: File) => Promise<string>
  onPasteCapture?: (event: ReactClipboardEvent<HTMLDivElement>) => void
  onSelectionRestoreHandled?: (requestId: number) => void
  resolveImageSrc: (url: string) => Promise<string> | string
  selectionToRestore?: null | {
    id: number
    selection: MarkdownSelection
  }
  syncVersion: number
}

type TextChunk = {
  startOffset: number
  startPos: number
  text: string
}

function buildTextChunks(view: ProseMirrorEditorView) {
  const chunks: TextChunk[] = []
  let offset = 0

  view.state.doc.descendants((node, pos) => {
    if (!node.isText || !node.text) {
      return
    }

    chunks.push({
      startOffset: offset,
      startPos: pos,
      text: node.text,
    })
    offset += node.text.length
  })

  return {
    chunks,
    text: chunks.map((chunk) => chunk.text).join(''),
  }
}

function textOffsetToDocPos(chunks: TextChunk[], offset: number) {
  for (const chunk of chunks) {
    const chunkEnd = chunk.startOffset + chunk.text.length
    if (offset < chunkEnd) {
      return chunk.startPos + (offset - chunk.startOffset)
    }
  }

  const lastChunk = chunks[chunks.length - 1]
  if (!lastChunk) {
    return 1
  }

  return lastChunk.startPos + lastChunk.text.length
}

function restoreSelectionFromMarkers(view: ProseMirrorEditorView) {
  const { chunks, text } = buildTextChunks(view)

  const caretOffset = text.indexOf(MARKDOWN_SELECTION_CARET_MARKER)
  if (caretOffset >= 0) {
    const markerStart = textOffsetToDocPos(chunks, caretOffset)
    const markerEnd = textOffsetToDocPos(chunks, caretOffset + MARKDOWN_SELECTION_CARET_MARKER.length)
    const transaction = view.state.tr.delete(markerStart, markerEnd)
    transaction.setSelection(TextSelection.create(transaction.doc, markerStart))
    view.dispatch(transaction.scrollIntoView())
    view.focus()
    return true
  }

  const startOffset = text.indexOf(MARKDOWN_SELECTION_START_MARKER)
  const endOffset = text.indexOf(MARKDOWN_SELECTION_END_MARKER)
  if (startOffset < 0 || endOffset < 0 || startOffset > endOffset) {
    return false
  }

  const startMarkerStart = textOffsetToDocPos(chunks, startOffset)
  const startMarkerEnd = textOffsetToDocPos(chunks, startOffset + MARKDOWN_SELECTION_START_MARKER.length)
  const endMarkerStart = textOffsetToDocPos(chunks, endOffset)
  const endMarkerEnd = textOffsetToDocPos(chunks, endOffset + MARKDOWN_SELECTION_END_MARKER.length)

  let transaction = view.state.tr.delete(endMarkerStart, endMarkerEnd)
  transaction = transaction.delete(startMarkerStart, startMarkerEnd)

  const selection = TextSelection.between(
    transaction.doc.resolve(startMarkerStart),
    transaction.doc.resolve(endMarkerStart - MARKDOWN_SELECTION_START_MARKER.length),
  )

  transaction.setSelection(selection)
  view.dispatch(transaction.scrollIntoView())
  view.focus()
  return true
}

export function WysiwygMarkdownEditor({
  editable,
  markdown,
  onApiChange,
  onChange,
  onContextMenu,
  onImageUpload,
  onPasteCapture,
  onSelectionRestoreHandled,
  resolveImageSrc,
  selectionToRestore,
  syncVersion,
}: WysiwygMarkdownEditorProps) {
  const editorShellRef = useRef<HTMLDivElement | null>(null)
  const crepeRef = useRef<Crepe | null>(null)
  const onChangeRef = useRef(onChange)
  const onImageUploadRef = useRef(onImageUpload)
  const resolveImageSrcRef = useRef(resolveImageSrc)
  const mermaidRenderSeqRef = useRef(0)
  const mermaidThemeRef = useRef<null | 'dark' | 'default'>(null)
  const mermaidSvgCacheRef = useRef(new Map<string, string>())
  const mermaidPendingRenderRef = useRef(new Map<string, Promise<string>>())
  const markdownRef = useRef(markdown)
  const suppressChangeRef = useRef(false)
  const pendingMarkdownRef = useRef<string | null>(null)
  const flushFrameRef = useRef<number | null>(null)

  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  useEffect(() => {
    onImageUploadRef.current = onImageUpload
  }, [onImageUpload])

  useEffect(() => {
    resolveImageSrcRef.current = resolveImageSrc
  }, [resolveImageSrc])

  useEffect(() => {
    markdownRef.current = markdown
  }, [markdown])

  const withSuppressedChange = useCallback((task: () => void, settleFrames = 1) => {
    suppressChangeRef.current = true
    pendingMarkdownRef.current = null
    if (flushFrameRef.current !== null) {
      cancelAnimationFrame(flushFrameRef.current)
      flushFrameRef.current = null
    }
    task()

    const release = (remainingFrames: number) => {
      if (remainingFrames <= 0) {
        suppressChangeRef.current = false
        return
      }
      requestAnimationFrame(() => {
        release(remainingFrames - 1)
      })
    }

    release(settleFrames)
  }, [])

  const disableSpellcheckInEditor = useCallback(() => {
    const root = editorShellRef.current
    if (!root) {
      return
    }

    const nodes = root.querySelectorAll<HTMLElement>('[contenteditable="true"], textarea, input')
    for (const node of nodes) {
      node.setAttribute('spellcheck', 'false')
      node.setAttribute('autocorrect', 'off')
      node.setAttribute('autocapitalize', 'off')
    }
  }, [])

  useEffect(
    () => () => {
      if (flushFrameRef.current !== null) {
        cancelAnimationFrame(flushFrameRef.current)
      }
    },
    [],
  )

  useEffect(() => {
    if (typeof document === 'undefined') {
      return
    }

    const observer = new MutationObserver((mutations) => {
      if (!mutations.some((entry) => entry.attributeName === 'data-theme')) {
        return
      }

      const currentMarkdown = markdownRef.current
      if (!hasMermaidFence(currentMarkdown)) {
        return
      }

      const crepe = crepeRef.current
      if (!crepe) {
        return
      }

      mermaidThemeRef.current = null
      mermaidSvgCacheRef.current.clear()
      mermaidPendingRenderRef.current.clear()
      suppressChangeRef.current = true
      crepe.editor.action(replaceAll(currentMarkdown, true))
      requestAnimationFrame(() => {
        suppressChangeRef.current = false
      })
    })

    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => {
      observer.disconnect()
    }
  }, [])

  const ensureMermaidConfigured = useCallback(() => {
    const theme = resolveMermaidTheme()
    if (mermaidThemeRef.current === theme) {
      return theme
    }

    mermaid.initialize({
      securityLevel: 'strict',
      startOnLoad: false,
      suppressErrorRendering: true,
      theme,
      htmlLabels: false,
      flowchart: {
        htmlLabels: false,
      },
    })
    mermaidThemeRef.current = theme
    mermaidSvgCacheRef.current.clear()
    mermaidPendingRenderRef.current.clear()
    return theme
  }, [])

  useEditor(
    (root) => {
      const renderCodePreview = (
        language: string,
        content: string,
        applyPreview: (value: null | string | HTMLElement) => void,
      ) => {
        const normalizedLanguage = language.trim().toLowerCase()
        if (!MERMAID_LANGUAGE_ALIASES.has(normalizedLanguage)) {
          return null
        }

        const source = content.trim()
        if (!source) {
          return '<div class="mf-mermaid-preview-empty">Mermaid 图表内容为空</div>'
        }

        const theme = ensureMermaidConfigured()
        const cacheKey = `${theme}:${source}`
        const cachedSvg = mermaidSvgCacheRef.current.get(cacheKey)
        if (cachedSvg) {
          return cachedSvg
        }

        let pendingRender = mermaidPendingRenderRef.current.get(cacheKey)
        if (!pendingRender) {
          const renderTask = Promise.resolve().then(() => {
            const renderId = ++mermaidRenderSeqRef.current
            return mermaid.render(`mf-mermaid-${renderId}`, source)
          })

          pendingRender = withTimeout(
            renderTask,
            MERMAID_RENDER_TIMEOUT_MS,
            `Mermaid 渲染超时（>${MERMAID_RENDER_TIMEOUT_MS / 1000} 秒）`,
          )
            .then(({ svg }) => {
              mermaidSvgCacheRef.current.set(cacheKey, svg)
              return svg
            })
            .finally(() => {
              mermaidPendingRenderRef.current.delete(cacheKey)
            })

          mermaidPendingRenderRef.current.set(cacheKey, pendingRender)
        }

        void pendingRender
          .then((svg) => {
            applyPreview(svg)
          })
          .catch((error) => {
            const message = error instanceof Error ? error.message : 'Mermaid render failed'
            applyPreview(`<pre class="mf-mermaid-preview-error">${escapeHtml(message)}</pre>`)
          })

        return undefined
      }

      const crepe = new Crepe({
        featureConfigs: {
          [Crepe.Feature.CodeMirror]: {
            extensions: [syntaxHighlighting(codeHighlightStyle)],
            languages: [...languages, mermaidLanguage],
            previewLabel: 'Diagram Preview',
            previewLoading: '<div class="mf-mermaid-preview-loading">Rendering diagram...</div>',
            previewOnlyByDefault: true,
            renderPreview: renderCodePreview,
            theme: codeEditorTheme,
          },
          [Crepe.Feature.ImageBlock]: {
            blockOnUpload: (file) => onImageUploadRef.current(file),
            inlineOnUpload: (file) => onImageUploadRef.current(file),
            onUpload: (file) => onImageUploadRef.current(file),
            proxyDomURL: (url) => resolveImageSrcRef.current(url),
          },
        },
        root,
        defaultValue: markdownRef.current,
      })

      crepe.on((listener) => {
        listener.markdownUpdated((_ctx, nextMarkdown) => {
          if (suppressChangeRef.current || nextMarkdown === markdownRef.current) {
            return
          }
          pendingMarkdownRef.current = nextMarkdown
          if (flushFrameRef.current !== null) {
            return
          }
          flushFrameRef.current = requestAnimationFrame(() => {
            flushFrameRef.current = null
            const pendingMarkdown = pendingMarkdownRef.current
            if (!pendingMarkdown) {
              return
            }
            pendingMarkdownRef.current = null
            markdownRef.current = pendingMarkdown
            onChangeRef.current(pendingMarkdown)
          })
        })
      })

      crepeRef.current = crepe
      return crepe
    },
    [],
  )

  useEffect(() => {
    const crepe = crepeRef.current
    const nextMarkdown = markdownRef.current
    if (!crepe || crepe.getMarkdown() === nextMarkdown) {
      return
    }

    withSuppressedChange(() => {
      crepe.editor.action(replaceAll(nextMarkdown, true))
    }, 1)
  }, [syncVersion, withSuppressedChange])

  useEffect(() => {
    if (!selectionToRestore) {
      return
    }

    let cancelled = false
    let frameId: number | null = null

    const restoreWhenReady = () => {
      if (cancelled) {
        return
      }

      const crepe = crepeRef.current
      if (!crepe) {
        frameId = requestAnimationFrame(restoreWhenReady)
        return
      }

      const markedMarkdown = injectMarkdownSelectionMarkers(markdownRef.current, selectionToRestore.selection)
      withSuppressedChange(() => {
        crepe.editor.action(replaceAll(markedMarkdown, true))
        const restored = crepe.editor.action((ctx) => {
          const view = ctx.get(editorViewCtx) as ProseMirrorEditorView
          return restoreSelectionFromMarkers(view)
        })
        if (!restored) {
          crepe.editor.action(replaceAll(markdownRef.current, true))
        }
      }, 2)

      onSelectionRestoreHandled?.(selectionToRestore.id)
    }

    frameId = requestAnimationFrame(restoreWhenReady)

    return () => {
      cancelled = true
      if (frameId !== null) {
        cancelAnimationFrame(frameId)
      }
    }
  }, [onSelectionRestoreHandled, selectionToRestore, withSuppressedChange])

  useEffect(() => {
    crepeRef.current?.setReadonly(!editable)
  }, [editable])

  useEffect(() => {
    const root = editorShellRef.current
    if (!root) {
      return
    }

    disableSpellcheckInEditor()

    const observer = new MutationObserver(() => {
      disableSpellcheckInEditor()
    })

    observer.observe(root, {
      attributeFilter: ['contenteditable'],
      attributes: true,
      childList: true,
      subtree: true,
    })

    return () => {
      observer.disconnect()
    }
  }, [disableSpellcheckInEditor])

  const applyToolbarAction = useCallback((action: ToolbarAction) => {
    const crepe = crepeRef.current
    if (!crepe) {
      return false
    }

    crepe.editor.action((ctx) => {
      const commands = ctx.get(commandsCtx)

      switch (action) {
        case 'undo':
          commands.call(undoCommand.key)
          return
        case 'redo':
          commands.call(redoCommand.key)
          return
        case 'h1':
          commands.call(wrapInHeadingCommand.key, 1)
          return
        case 'h2':
          commands.call(wrapInHeadingCommand.key, 2)
          return
        case 'bold':
          commands.call(toggleStrongCommand.key)
          return
        case 'italic':
          commands.call(toggleEmphasisCommand.key)
          return
        case 'bullet':
          commands.call(wrapInBulletListCommand.key)
          return
        case 'ordered':
          commands.call(wrapInOrderedListCommand.key)
          return
        case 'quote':
          commands.call(wrapInBlockquoteCommand.key)
          return
        case 'code':
          commands.call(createCodeBlockCommand.key)
          return
        case 'table':
          commands.call(insertTableCommand.key, { col: 3, row: 3 })
          return
        case 'task':
          commands.call(clearTextInCurrentBlockCommand.key)
          commands.call(wrapInBlockTypeCommand.key, {
            attrs: { checked: false },
            nodeType: listItemSchema.type(ctx),
          })
          return
        case 'math':
          commands.call(clearTextInCurrentBlockCommand.key)
          commands.call(addBlockTypeCommand.key, {
            attrs: { language: 'LaTex' },
            nodeType: codeBlockSchema.type(ctx),
          })
          return
      }
    })

    return true
  }, [])

  const insertMarkdownSnippet = useCallback((snippet: string) => {
    const crepe = crepeRef.current
    if (!crepe) {
      return false
    }
    crepe.editor.action(insert(snippet))
    return true
  }, [])

  const runDocumentCommand = useCallback((command: 'copy' | 'cut' | 'paste' | 'selectAll') => {
    const crepe = crepeRef.current
    if (!crepe) {
      return false
    }

    return crepe.editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      view.focus()
      return document.execCommand(command)
    })
  }, [])

  const findImagePosFromTarget = useCallback((target: EventTarget | null) => {
    if (!(target instanceof Element)) {
      return null
    }

    const imageRoot = target.closest('.milkdown-image-block')
    if (!imageRoot) {
      return null
    }

    const crepe = crepeRef.current
    if (!crepe) {
      return null
    }

    return crepe.editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      try {
        const domPosition = view.posAtDOM(imageRoot, 0)
        const candidatePositions = [domPosition, domPosition - 1, domPosition + 1]

        for (const position of candidatePositions) {
          if (position < 0 || position > view.state.doc.content.size) {
            continue
          }
          const node = view.state.doc.nodeAt(position)
          if (node?.type.name === 'image-block') {
            return position
          }
        }
      } catch {
        return null
      }

      return null
    })
  }, [])

  const resizeImageByPos = useCallback((pos: number, ratio: number) => {
    const crepe = crepeRef.current
    if (!crepe || ratio <= 0) {
      return false
    }

    return crepe.editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      const node = view.state.doc.nodeAt(pos)
      if (!node || node.type.name !== 'image-block') {
        return false
      }
      const nextRatio = Number.parseFloat(ratio.toFixed(2))
      view.dispatch(view.state.tr.setNodeAttribute(pos, 'ratio', nextRatio))
      view.focus()
      return true
    })
  }, [])

  const insertPlainText = useCallback((text: string) => {
    const crepe = crepeRef.current
    if (!crepe) {
      return false
    }

    return crepe.editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      const { from, to } = view.state.selection
      view.dispatch(view.state.tr.insertText(text, from, to))
      view.focus()
      return true
    })
  }, [])

  const getMarkdownSelection = useCallback(() => {
    const crepe = crepeRef.current
    if (!crepe) {
      return null
    }

    const currentMarkdown = markdownRef.current
    const markedMarkdown = (() => {
      suppressChangeRef.current = true
      const result = (() => {
        try {
          return crepe.editor.action((ctx) => {
            const view = ctx.get(editorViewCtx) as ProseMirrorEditorView
            const { from, to } = view.state.selection
            const transaction =
              from === to
                ? view.state.tr.insertText(MARKDOWN_SELECTION_CARET_MARKER, from)
                : view.state.tr
                    .insertText(MARKDOWN_SELECTION_END_MARKER, to)
                    .insertText(MARKDOWN_SELECTION_START_MARKER, from)

            view.dispatch(transaction)
            return crepe.getMarkdown()
          })
        } catch {
          return null
        }
      })()

      crepe.editor.action(replaceAll(currentMarkdown, true))
      markdownRef.current = currentMarkdown
      pendingMarkdownRef.current = null
      if (flushFrameRef.current !== null) {
        cancelAnimationFrame(flushFrameRef.current)
        flushFrameRef.current = null
      }
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          suppressChangeRef.current = false
        })
      })
      return result
    })()

    if (!markedMarkdown) {
      return null
    }

    return extractMarkdownSelectionMarkers(markedMarkdown).selection
  }, [])

  useEffect(() => {
    onApiChange({
      applyToolbarAction,
      copy: () => runDocumentCommand('copy'),
      cut: () => runDocumentCommand('cut'),
      findImagePosFromTarget,
      getMarkdownSelection,
      insertMarkdown: insertMarkdownSnippet,
      insertPlainText,
      pasteWithFormatting: () => runDocumentCommand('paste'),
      resizeImageByPos,
      selectAll: () => runDocumentCommand('selectAll'),
    })

    return () => {
      onApiChange(null)
    }
  }, [
    applyToolbarAction,
    findImagePosFromTarget,
    getMarkdownSelection,
    insertMarkdownSnippet,
    insertPlainText,
    onApiChange,
    resizeImageByPos,
    runDocumentCommand,
  ])

  return (
    <div
      ref={editorShellRef}
      className={`crepe-editor-shell h-full ${editable ? '' : 'crepe-editor-readonly'}`}
      spellCheck={false}
      autoCorrect="off"
      autoCapitalize="off"
      onContextMenu={onContextMenu}
      onPasteCapture={onPasteCapture}
    >
      <Milkdown />
    </div>
  )
}
