import { type ContextMenuState } from '@/features/app/shared'

type FileTreeContextMenuProps = {
  contextMenu: ContextMenuState | null
  contextPosition: { left: number; top: number } | null
  createTargetPath: string
  menuPath: string
  openFileMenuLabel: string
  onClose: () => void
  onCreateFolder: (targetPath: string) => Promise<void>
  onCreateTextFile: (targetPath: string) => Promise<void>
  onDelete: (targetPath: string, kind: 'file' | 'directory') => Promise<void>
  onRefresh: () => Promise<void>
  onRename: (targetPath: string, kind: 'file' | 'directory') => Promise<void>
  onSelectFile: (targetPath: string) => Promise<void>
}

export function FileTreeContextMenu(props: FileTreeContextMenuProps) {
  const {
    contextMenu,
    contextPosition,
    createTargetPath,
    menuPath,
    openFileMenuLabel,
    onClose,
    onCreateFolder,
    onCreateTextFile,
    onDelete,
    onRefresh,
    onRename,
    onSelectFile,
  } = props

  if (!contextMenu || !contextPosition) {
    return null
  }

  return (
    <div
      className="fixed z-[100] min-w-[220px] rounded-[var(--mf-radius-md)] border border-[var(--mf-border)] bg-[var(--mf-surface)] p-1 shadow-[var(--mf-shadow-menu)]"
      style={{ left: contextPosition.left, top: contextPosition.top }}
      role="menu"
    >
      {contextMenu.kind === 'file' ? (
        <>
          <button
            className="w-full rounded-[6px] px-3 py-2 text-left text-sm text-[var(--mf-muted-strong)] hover:bg-[var(--mf-surface-muted)]"
            onClick={() => {
              onClose()
              void onSelectFile(menuPath)
            }}
          >
            {openFileMenuLabel}
          </button>
          <button
            className="w-full rounded-[6px] px-3 py-2 text-left text-sm text-[var(--mf-muted-strong)] hover:bg-[var(--mf-surface-muted)]"
            onClick={() => {
              onClose()
              void onRename(menuPath, 'file')
            }}
          >
            重命名
          </button>
          <button
            className="w-full rounded-[6px] px-3 py-2 text-left text-sm text-[var(--mf-danger)] hover:bg-[var(--mf-danger-soft)]"
            onClick={() => {
              onClose()
              void onDelete(menuPath, 'file')
            }}
          >
            删除
          </button>
          <div className="my-1 h-px bg-[var(--mf-border)]" />
          <button
            className="w-full rounded-[6px] px-3 py-2 text-left text-sm text-[var(--mf-muted-strong)] hover:bg-[var(--mf-surface-muted)]"
            onClick={() => {
              onClose()
              void onCreateTextFile(createTargetPath)
            }}
          >
            在当前目录新建文本文件
          </button>
        </>
      ) : (
        <>
          <button
            className="w-full rounded-[6px] px-3 py-2 text-left text-sm text-[var(--mf-muted-strong)] hover:bg-[var(--mf-surface-muted)]"
            onClick={() => {
              onClose()
              void onCreateTextFile(createTargetPath)
            }}
          >
            新建文本文件
          </button>
          <button
            className="w-full rounded-[6px] px-3 py-2 text-left text-sm text-[var(--mf-muted-strong)] hover:bg-[var(--mf-surface-muted)]"
            onClick={() => {
              onClose()
              void onCreateFolder(createTargetPath)
            }}
          >
            新建文件夹
          </button>
          <button
            className="w-full rounded-[6px] px-3 py-2 text-left text-sm text-[var(--mf-muted-strong)] hover:bg-[var(--mf-surface-muted)]"
            onClick={() => {
              onClose()
              void onRefresh()
            }}
          >
            刷新目录
          </button>
          {contextMenu.kind !== 'root' ? (
            <>
              <div className="my-1 h-px bg-[var(--mf-border)]" />
              <button
                className="w-full rounded-[6px] px-3 py-2 text-left text-sm text-[var(--mf-muted-strong)] hover:bg-[var(--mf-surface-muted)]"
                onClick={() => {
                  onClose()
                  void onRename(menuPath, 'directory')
                }}
              >
                重命名
              </button>
              <button
                className="w-full rounded-[6px] px-3 py-2 text-left text-sm text-[var(--mf-danger)] hover:bg-[var(--mf-danger-soft)]"
                onClick={() => {
                  onClose()
                  void onDelete(menuPath, 'directory')
                }}
              >
                删除
              </button>
            </>
          ) : null}
        </>
      )}
    </div>
  )
}
