import { type MouseEvent as ReactMouseEvent, type ReactElement } from 'react'
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  File as FileIcon,
  FileText,
  Folder,
  FolderOpen,
  FolderX,
  Image as ImageIcon,
  LogOut,
  Paperclip,
  RefreshCw,
  Settings2,
  Video as VideoIcon,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { type ContextKind, type FolderNode, type RemoteFile } from '@/features/app/shared'

type FileTreeSidebarProps = {
  busy: boolean
  folderTree: FolderNode
  isConnected: boolean
  isFolderOpen: (fullPath: string) => boolean
  onOpenAttachmentSettings: () => void
  onOpenConnectionSettings: () => void
  onOpenContextMenu: (event: ReactMouseEvent, path: string, kind: ContextKind) => void
  onRefresh: () => void
  onSelectFile: (path: string) => Promise<void>
  onToggleFolder: (fullPath: string) => void
  onToggleSidebar: () => void
  onLogout: () => void
  rootPath: string
  selectedFilePath: string
  sidebarCollapsed: boolean
  sidebarStatusDotClass: string
  sidebarStatusLabel: string
  sidebarStatusTextClass: string
}

function fileIcon(file: RemoteFile) {
  if (file.kind === 'image') {
    return <ImageIcon className="h-3.5 w-3.5 shrink-0" />
  }
  if (file.kind === 'video') {
    return <VideoIcon className="h-3.5 w-3.5 shrink-0" />
  }
  if (file.kind === 'audio' || file.kind === 'pdf' || file.kind === 'other') {
    return <FileIcon className="h-3.5 w-3.5 shrink-0" />
  }
  return <FileText className="h-3.5 w-3.5 shrink-0" />
}

export function FileTreeSidebar(props: FileTreeSidebarProps) {
  const {
    busy,
    folderTree,
    isConnected,
    isFolderOpen,
    onOpenAttachmentSettings,
    onOpenConnectionSettings,
    onOpenContextMenu,
    onRefresh,
    onSelectFile,
    onToggleFolder,
    onToggleSidebar,
    onLogout,
    rootPath,
    selectedFilePath,
    sidebarCollapsed,
    sidebarStatusDotClass,
    sidebarStatusLabel,
    sidebarStatusTextClass,
  } = props

  function renderTree(node: FolderNode, depth: number): ReactElement[] {
    const items: ReactElement[] = []

    for (const folder of node.folders) {
      const open = isFolderOpen(folder.fullPath)

      items.push(
        <div key={`folder-${folder.fullPath}`} className="space-y-1">
          <div
            className="flex h-8 items-center gap-1 rounded-[var(--mf-radius-md)] px-1 py-1 text-[13px] text-[var(--mf-muted-strong)] transition-colors hover:bg-[var(--mf-surface-muted)]"
            onContextMenu={(event) => onOpenContextMenu(event, folder.fullPath, 'directory')}
            style={{ paddingLeft: `${8 + depth * 12}px` }}
          >
            <button
              type="button"
              className="inline-flex h-5 w-5 items-center justify-center rounded text-[var(--mf-muted)] hover:bg-[var(--mf-surface-hover)]"
              onClick={() => onToggleFolder(folder.fullPath)}
            >
              {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            </button>
            {open ? (
              <FolderOpen className="h-3.5 w-3.5 text-[var(--mf-muted)]" />
            ) : (
              <Folder className="h-3.5 w-3.5 text-[var(--mf-muted)]" />
            )}
            <span className="truncate">{folder.name}</span>
          </div>
          {open ? renderTree(folder, depth + 1) : null}
        </div>,
      )
    }

    for (const file of node.files) {
      const active = file.path === selectedFilePath

      items.push(
        <button
          key={file.path}
          type="button"
          onClick={() => void onSelectFile(file.path)}
          onDoubleClick={() => void onSelectFile(file.path)}
          onContextMenu={(event) => onOpenContextMenu(event, file.path, 'file')}
          className={`flex h-8 w-full items-center gap-2 rounded-[var(--mf-radius-md)] px-2 py-1 text-left text-[13px] transition-colors ${
            active
              ? 'bg-[var(--mf-accent-soft)] text-[var(--mf-accent)]'
              : 'text-[var(--mf-muted-strong)] hover:bg-[var(--mf-surface-muted)]'
          }`}
          style={{ paddingLeft: `${28 + depth * 12}px` }}
        >
          {fileIcon(file)}
          <span className="truncate">{file.name}</span>
        </button>,
      )
    }

    return items
  }

  return (
    <aside
      className={`h-full border-r border-[var(--mf-border)] transition-[width] duration-200 ${sidebarCollapsed ? 'w-16' : 'w-64'}`}
    >
      <div className="flex h-full flex-col">
        <div className="px-3 pb-2 pt-4">
          <div className={`flex h-8 items-center ${sidebarCollapsed ? 'justify-center' : 'justify-between'} gap-2`}>
            {sidebarCollapsed ? null : (
              <div className="flex min-w-0 items-center gap-1.5">
                <span className={`text-[11px] font-semibold ${sidebarStatusDotClass}`}>●</span>
                <span className={`truncate text-xs ${sidebarStatusTextClass}`}>{sidebarStatusLabel}</span>
              </div>
            )}
            <Button
              variant="toolbar"
              size={sidebarCollapsed ? 'icon' : 'iconCompact'}
              onClick={onToggleSidebar}
              aria-label={sidebarCollapsed ? '展开侧栏' : '收起侧栏'}
            >
              {sidebarCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
            </Button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
          {sidebarCollapsed ? (
            <div className="flex flex-col items-center gap-2 pt-2">
              <Button variant="toolbar" size="icon" onClick={onOpenConnectionSettings} title="WebDAV 设定" aria-label="WebDAV 设定">
                <Settings2 className="h-4 w-4" />
              </Button>
              <Button
                variant="toolbar"
                size="icon"
                onClick={onRefresh}
                disabled={busy || !isConnected}
                title="刷新目录"
                aria-label="刷新目录"
              >
                <RefreshCw className="h-4 w-4" />
              </Button>
              <Button
                variant="toolbar"
                size="icon"
                onClick={onOpenAttachmentSettings}
                disabled={!isConnected}
                title="附件设置"
                aria-label="附件设置"
              >
                <Paperclip className="h-4 w-4" />
              </Button>
              <Button variant="toolbar" size="icon" onClick={onLogout} disabled={!isConnected} title="登出" aria-label="登出">
                <LogOut className="h-4 w-4" />
              </Button>
            </div>
          ) : isConnected ? (
            <div
              className="h-full rounded-[10px] border border-[var(--mf-panel-border)] bg-[var(--mf-panel-bg)] p-2 shadow-[var(--mf-shadow-soft)]"
              onContextMenu={(event) => onOpenContextMenu(event, rootPath, 'root')}
            >
              <div className="rounded-[var(--mf-radius-md)] px-2 py-1.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-1.5 text-xs text-[var(--mf-muted)]">
                    <Folder className="h-3.5 w-3.5 text-[var(--mf-muted)]" />
                    <span className="truncate">根目录：{rootPath}</span>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      variant="toolbar"
                      size="iconCompact"
                      onClick={onOpenAttachmentSettings}
                      disabled={!isConnected}
                      title="附件设置"
                      aria-label="附件设置"
                    >
                      <Paperclip className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="toolbar"
                      size="iconCompact"
                      onClick={onRefresh}
                      disabled={busy || !isConnected}
                      title="刷新目录"
                      aria-label="刷新目录"
                    >
                      <RefreshCw className={`h-3.5 w-3.5 ${busy ? 'animate-spin' : ''}`} />
                    </Button>
                  </div>
                </div>
              </div>
              <div className="mt-1 space-y-1">{renderTree(folderTree, 0)}</div>
            </div>
          ) : (
            <div className="h-full rounded-[10px] border border-[var(--mf-panel-border)] bg-[var(--mf-panel-bg)] p-3 shadow-[var(--mf-shadow-soft)]">
              <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
                <FolderX className="h-5 w-5 text-[var(--mf-warning)]" />
                <p className="text-[13px] font-medium text-[var(--mf-warning-strong)]">未连接，无法读取文件</p>
                <p className="text-xs text-[var(--mf-muted-soft)]">连接 WebDAV 后显示文件树</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </aside>
  )
}
