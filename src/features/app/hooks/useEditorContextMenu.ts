import { type MutableRefObject, type MouseEvent as ReactMouseEvent, useCallback, useMemo, useState } from 'react'

import {
  applyMarkdownImageRatio,
  EDITOR_MENU_BASE_HEIGHT,
  EDITOR_MENU_WIDTH,
  EDITOR_MENU_WITH_IMAGE_HEIGHT,
  findMarkdownImageTargetAtOffset,
  getContextMenuPosition,
  getPasteShortcutLabel,
  type EditorContextMenuState,
  type EditorImageTarget,
  type EditorMode,
  type WysiwygEditorApi,
} from '@/features/app/shared'
import { toast } from 'sonner'

type UseEditorContextMenuOptions = {
  canEditDocument: boolean
  canUseEditorActions: boolean
  contentRef: MutableRefObject<string>
  editorMode: EditorMode
  onOpen?: () => void
  setContentWithHistory: (nextContent: string, options?: { resetHistory?: boolean; trackHistory?: boolean }) => void
  sourceEditorRef: MutableRefObject<HTMLTextAreaElement | null>
  wysiwygApiRef: MutableRefObject<WysiwygEditorApi | null>
}

type UseEditorContextMenuResult = {
  applyEditorImageRatio: (percent: number) => void
  canUseEditorActions: boolean
  closeEditorContextMenu: () => void
  editorContextMenu: EditorContextMenuState | null
  editorContextPosition: { left: number; top: number } | null
  editorMenuActionClass: string
  editorMenuActionDisabledClass: string
  hasEditorImageTarget: boolean
  onApplyCustomImageRatio: () => void
  onCopyFromEditor: () => void
  onCutFromEditor: () => void
  onPastePlainTextInEditor: () => Promise<void>
  onPasteWithFormattingInEditor: () => void
  onSelectAllInEditor: () => void
  onSourceEditorContextMenu: (event: ReactMouseEvent<HTMLTextAreaElement>) => void
  onWysiwygEditorContextMenu: (event: ReactMouseEvent<HTMLDivElement>) => void
}

export function useEditorContextMenu(options: UseEditorContextMenuOptions): UseEditorContextMenuResult {
  const {
    canEditDocument,
    canUseEditorActions,
    contentRef,
    editorMode,
    onOpen,
    setContentWithHistory,
    sourceEditorRef,
    wysiwygApiRef,
  } = options

  const [editorContextMenu, setEditorContextMenu] = useState<EditorContextMenuState | null>(null)

  const closeEditorContextMenu = useCallback(() => {
    setEditorContextMenu(null)
  }, [])

  const runSourceEditorCommand = useCallback(
    (command: 'copy' | 'cut' | 'paste' | 'selectAll') => {
      const textarea = sourceEditorRef.current
      if (!textarea) {
        return false
      }
      textarea.focus()
      return document.execCommand(command)
    },
    [sourceEditorRef],
  )

  const openEditorContextMenu = useCallback(
    (event: ReactMouseEvent<HTMLElement>, mode: EditorMode) => {
      event.preventDefault()
      event.stopPropagation()

      if (!canEditDocument) {
        return
      }

      let imageTarget: EditorImageTarget | null = null
      if (mode === 'source') {
        const textarea = sourceEditorRef.current
        if (textarea) {
          textarea.focus()
          const offset = Math.min(textarea.selectionStart, textarea.selectionEnd)
          const target = findMarkdownImageTargetAtOffset(textarea.value, offset)
          if (target) {
            imageTarget = {
              kind: 'source',
              target,
            }
          }
        }
      } else {
        const pos = wysiwygApiRef.current?.findImagePosFromTarget(event.target) ?? null
        if (typeof pos === 'number') {
          imageTarget = {
            kind: 'wysiwyg',
            target: { pos },
          }
        }
      }

      onOpen?.()
      setEditorContextMenu({
        imageTarget,
        mode,
        x: event.clientX,
        y: event.clientY,
      })
    },
    [canEditDocument, onOpen, sourceEditorRef, wysiwygApiRef],
  )

  const onSourceEditorContextMenu = useCallback(
    (event: ReactMouseEvent<HTMLTextAreaElement>) => {
      openEditorContextMenu(event as ReactMouseEvent<HTMLElement>, 'source')
    },
    [openEditorContextMenu],
  )

  const onWysiwygEditorContextMenu = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      openEditorContextMenu(event as ReactMouseEvent<HTMLElement>, 'wysiwyg')
    },
    [openEditorContextMenu],
  )

  const onCopyFromEditor = useCallback(() => {
    const mode = editorContextMenu?.mode ?? editorMode
    if (mode === 'source') {
      runSourceEditorCommand('copy')
    } else {
      wysiwygApiRef.current?.copy()
    }
    setEditorContextMenu(null)
  }, [editorContextMenu?.mode, editorMode, runSourceEditorCommand, wysiwygApiRef])

  const onCutFromEditor = useCallback(() => {
    if (!canUseEditorActions) {
      return
    }

    const mode = editorContextMenu?.mode ?? editorMode
    if (mode === 'source') {
      runSourceEditorCommand('cut')
    } else {
      wysiwygApiRef.current?.cut()
    }
    setEditorContextMenu(null)
  }, [canUseEditorActions, editorContextMenu?.mode, editorMode, runSourceEditorCommand, wysiwygApiRef])

  const onPasteWithFormattingInEditor = useCallback(() => {
    if (!canUseEditorActions) {
      return
    }

    const mode = editorContextMenu?.mode ?? editorMode
    const allowed = mode === 'source' ? runSourceEditorCommand('paste') : (wysiwygApiRef.current?.pasteWithFormatting() ?? false)
    if (!allowed) {
      toast.info(`浏览器阻止了“保留格式粘贴”，请使用 ${getPasteShortcutLabel()}`)
    }
    setEditorContextMenu(null)
  }, [canUseEditorActions, editorContextMenu?.mode, editorMode, runSourceEditorCommand, wysiwygApiRef])

  const onPastePlainTextInEditor = useCallback(async () => {
    if (!canUseEditorActions) {
      return
    }

    if (!navigator.clipboard?.readText) {
      toast.info('当前浏览器不支持读取剪贴板文本，请手动使用粘贴快捷键。')
      setEditorContextMenu(null)
      return
    }

    try {
      const text = await navigator.clipboard.readText()
      const mode = editorContextMenu?.mode ?? editorMode
      if (mode === 'source') {
        const textarea = sourceEditorRef.current
        if (!textarea) {
          setEditorContextMenu(null)
          return
        }

        const { selectionEnd, selectionStart, value } = textarea
        const nextValue = `${value.slice(0, selectionStart)}${text}${value.slice(selectionEnd)}`
        setContentWithHistory(nextValue)
        requestAnimationFrame(() => {
          textarea.focus()
          const cursor = selectionStart + text.length
          textarea.setSelectionRange(cursor, cursor)
        })
      } else {
        wysiwygApiRef.current?.insertPlainText(text)
      }
    } catch {
      toast.info('读取剪贴板失败，请确认浏览器已授权后重试。')
    } finally {
      setEditorContextMenu(null)
    }
  }, [canUseEditorActions, editorContextMenu?.mode, editorMode, setContentWithHistory, sourceEditorRef, wysiwygApiRef])

  const onSelectAllInEditor = useCallback(() => {
    const mode = editorContextMenu?.mode ?? editorMode
    if (mode === 'source') {
      runSourceEditorCommand('selectAll')
    } else {
      wysiwygApiRef.current?.selectAll()
    }
    setEditorContextMenu(null)
  }, [editorContextMenu?.mode, editorMode, runSourceEditorCommand, wysiwygApiRef])

  const applyEditorImageRatio = useCallback(
    (percent: number) => {
      if (!canUseEditorActions || !editorContextMenu?.imageTarget) {
        return
      }

      const ratio = percent / 100
      if (!Number.isFinite(ratio) || ratio <= 0) {
        toast.error('请输入大于 0 的缩放百分比')
        return
      }

      const imageTarget = editorContextMenu.imageTarget
      if (imageTarget.kind === 'source') {
        const current = sourceEditorRef.current?.value ?? contentRef.current
        const next = applyMarkdownImageRatio(current, imageTarget.target, ratio)
        if (next === current) {
          toast.error('未找到可调整的图片语法')
          setEditorContextMenu(null)
          return
        }
        setContentWithHistory(next)
        requestAnimationFrame(() => sourceEditorRef.current?.focus())
      } else {
        const ok = wysiwygApiRef.current?.resizeImageByPos(imageTarget.target.pos, ratio) ?? false
        if (!ok) {
          toast.error('未找到可调整的图片')
          setEditorContextMenu(null)
          return
        }
      }

      setEditorContextMenu(null)
      toast.success(`图片缩放已设置为 ${percent}%`)
    },
    [canUseEditorActions, contentRef, editorContextMenu, setContentWithHistory, sourceEditorRef, wysiwygApiRef],
  )

  const onApplyCustomImageRatio = useCallback(() => {
    if (!editorContextMenu?.imageTarget || !canUseEditorActions) {
      return
    }
    const input = window.prompt('输入缩放百分比（仅支持数字，如 75）', '100')
    if (input === null) {
      return
    }
    const percent = Number(input.trim())
    if (!Number.isFinite(percent) || percent <= 0) {
      toast.error('请输入大于 0 的数字')
      return
    }
    applyEditorImageRatio(percent)
  }, [applyEditorImageRatio, canUseEditorActions, editorContextMenu?.imageTarget])

  const editorContextPosition = useMemo(() => {
    if (!editorContextMenu) {
      return null
    }
    const menuHeight = editorContextMenu.imageTarget ? EDITOR_MENU_WITH_IMAGE_HEIGHT : EDITOR_MENU_BASE_HEIGHT
    return getContextMenuPosition(editorContextMenu.x, editorContextMenu.y, EDITOR_MENU_WIDTH, menuHeight)
  }, [editorContextMenu])

  const hasEditorImageTarget = Boolean(editorContextMenu?.imageTarget)
  const editorMenuActionClass = 'w-full rounded-[6px] px-3 py-2 text-left text-sm text-[var(--mf-muted-strong)] hover:bg-[var(--mf-surface-muted)]'
  const editorMenuActionDisabledClass =
    'w-full cursor-not-allowed rounded-[6px] px-3 py-2 text-left text-sm text-[var(--mf-muted-soft)] opacity-70'

  return {
    applyEditorImageRatio,
    canUseEditorActions,
    closeEditorContextMenu,
    editorContextMenu,
    editorContextPosition,
    editorMenuActionClass,
    editorMenuActionDisabledClass,
    hasEditorImageTarget,
    onApplyCustomImageRatio,
    onCopyFromEditor,
    onCutFromEditor,
    onPastePlainTextInEditor,
    onPasteWithFormattingInEditor,
    onSelectAllInEditor,
    onSourceEditorContextMenu,
    onWysiwygEditorContextMenu,
  }
}
