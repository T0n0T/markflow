import { IMAGE_RESIZE_PRESETS, type EditorContextMenuState } from '@/features/app/shared'

type EditorContextMenuProps = {
  canUseEditorActions: boolean
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
  onResizeImage: (percent: number) => void
  onSelectAllInEditor: () => void
}

export function EditorContextMenu(props: EditorContextMenuProps) {
  const {
    canUseEditorActions,
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
    onResizeImage,
    onSelectAllInEditor,
  } = props

  if (!editorContextMenu || !editorContextPosition) {
    return null
  }

  return (
    <div
      className="fixed z-[110] min-w-[240px] rounded-[var(--mf-radius-md)] border border-[var(--mf-border)] bg-[var(--mf-surface)] p-1 shadow-[var(--mf-shadow-menu)]"
      style={{ left: editorContextPosition.left, top: editorContextPosition.top }}
      role="menu"
    >
      <button
        className={canUseEditorActions ? editorMenuActionClass : editorMenuActionDisabledClass}
        onClick={onCutFromEditor}
        disabled={!canUseEditorActions}
      >
        剪切
      </button>
      <button className={editorMenuActionClass} onClick={onCopyFromEditor}>
        复制
      </button>
      <button
        className={canUseEditorActions ? editorMenuActionClass : editorMenuActionDisabledClass}
        onClick={onPasteWithFormattingInEditor}
        disabled={!canUseEditorActions}
      >
        保留格式粘贴
      </button>
      <button
        className={canUseEditorActions ? editorMenuActionClass : editorMenuActionDisabledClass}
        onClick={() => {
          void onPastePlainTextInEditor()
        }}
        disabled={!canUseEditorActions}
      >
        仅粘贴文本
      </button>
      <button className={editorMenuActionClass} onClick={onSelectAllInEditor}>
        全选
      </button>

      {hasEditorImageTarget ? (
        <>
          <div className="my-1 h-px bg-[var(--mf-border)]" />
          <p className="px-3 py-1 text-[11px] font-medium tracking-wide text-[var(--mf-muted-soft)]">图片缩放</p>
          {IMAGE_RESIZE_PRESETS.map((percent) => (
            <button
              key={`resize-${percent}`}
              className={canUseEditorActions ? editorMenuActionClass : editorMenuActionDisabledClass}
              onClick={() => onResizeImage(percent)}
              disabled={!canUseEditorActions}
            >
              缩放到 {percent}%
            </button>
          ))}
          <button
            className={canUseEditorActions ? editorMenuActionClass : editorMenuActionDisabledClass}
            onClick={onApplyCustomImageRatio}
            disabled={!canUseEditorActions}
          >
            自定义百分比...
          </button>
        </>
      ) : null}
    </div>
  )
}
