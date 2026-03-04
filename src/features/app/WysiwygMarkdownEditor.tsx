import {
  type MouseEvent as ReactMouseEvent,
  type ClipboardEvent as ReactClipboardEvent,
  useCallback,
  useEffect,
  useRef,
} from 'react'
import { Crepe } from '@milkdown/crepe'
import { commandsCtx, editorViewCtx } from '@milkdown/kit/core'
import { redoCommand, undoCommand } from '@milkdown/kit/plugin/history'
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
import { Milkdown, useEditor } from '@milkdown/react'

import { type ToolbarAction, type WysiwygEditorApi } from '@/features/app/shared'

import '@milkdown/crepe/theme/common/style.css'
import '@milkdown/crepe/theme/frame.css'

export type WysiwygMarkdownEditorProps = {
  editable: boolean
  markdown: string
  onApiChange: (api: WysiwygEditorApi | null) => void
  onChange: (nextValue: string) => void
  onContextMenu?: (event: ReactMouseEvent<HTMLDivElement>) => void
  onImageUpload: (file: File) => Promise<string>
  onPasteCapture?: (event: ReactClipboardEvent<HTMLDivElement>) => void
  resolveImageSrc: (url: string) => Promise<string> | string
  syncVersion: number
}

export function WysiwygMarkdownEditor({
  editable,
  markdown,
  onApiChange,
  onChange,
  onContextMenu,
  onImageUpload,
  onPasteCapture,
  resolveImageSrc,
  syncVersion,
}: WysiwygMarkdownEditorProps) {
  const crepeRef = useRef<Crepe | null>(null)
  const onChangeRef = useRef(onChange)
  const onImageUploadRef = useRef(onImageUpload)
  const resolveImageSrcRef = useRef(resolveImageSrc)
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

  useEffect(
    () => () => {
      if (flushFrameRef.current !== null) {
        cancelAnimationFrame(flushFrameRef.current)
      }
    },
    [],
  )

  useEditor(
    (root) => {
      const crepe = new Crepe({
        featureConfigs: {
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

    suppressChangeRef.current = true
    crepe.editor.action(replaceAll(nextMarkdown, true))
    requestAnimationFrame(() => {
      suppressChangeRef.current = false
    })
  }, [syncVersion])

  useEffect(() => {
    crepeRef.current?.setReadonly(!editable)
  }, [editable])

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

  useEffect(() => {
    onApiChange({
      applyToolbarAction,
      copy: () => runDocumentCommand('copy'),
      cut: () => runDocumentCommand('cut'),
      findImagePosFromTarget,
      insertMarkdown: insertMarkdownSnippet,
      insertPlainText,
      pasteWithFormatting: () => runDocumentCommand('paste'),
      resizeImageByPos,
      selectAll: () => runDocumentCommand('selectAll'),
    })

    return () => {
      onApiChange(null)
    }
  }, [applyToolbarAction, findImagePosFromTarget, insertMarkdownSnippet, insertPlainText, onApiChange, resizeImageByPos, runDocumentCommand])

  return (
    <div
      className={`crepe-editor-shell h-full ${editable ? '' : 'crepe-editor-readonly'}`}
      onContextMenu={onContextMenu}
      onPasteCapture={onPasteCapture}
    >
      <Milkdown />
    </div>
  )
}
