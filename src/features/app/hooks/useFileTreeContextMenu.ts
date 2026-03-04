import { type MouseEvent as ReactMouseEvent, useCallback, useMemo, useState } from 'react'

import {
  getContextMenuPosition,
  MENU_HEIGHT,
  MENU_WIDTH,
  normalizeDavPath,
  parentDavPath,
  toPreviewFileKind,
  type ContextKind,
  type ContextMenuState,
  type RemoteFile,
} from '@/features/app/shared'

type UseFileTreeContextMenuOptions = {
  fileMap: Map<string, RemoteFile>
  isConnected: boolean
  onOpen?: () => void
  rootPath: string
}

type UseFileTreeContextMenuResult = {
  contextMenu: ContextMenuState | null
  contextPosition: { left: number; top: number } | null
  createTargetPath: string
  menuPath: string
  openFileMenuLabel: string
  openFileTreeContextMenu: (event: ReactMouseEvent, path: string, kind: ContextKind) => void
  setContextMenu: (nextState: ContextMenuState | null) => void
}

export function useFileTreeContextMenu(options: UseFileTreeContextMenuOptions): UseFileTreeContextMenuResult {
  const { fileMap, isConnected, onOpen, rootPath } = options

  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)

  const openFileTreeContextMenu = useCallback(
    (event: ReactMouseEvent, path: string, kind: ContextKind) => {
      event.preventDefault()
      event.stopPropagation()

      if (!isConnected) {
        return
      }

      onOpen?.()
      setContextMenu({
        kind,
        path: normalizeDavPath(path),
        x: event.clientX,
        y: event.clientY,
      })
    },
    [isConnected, onOpen],
  )

  const contextPosition = useMemo(() => {
    if (!contextMenu) {
      return null
    }
    return getContextMenuPosition(contextMenu.x, contextMenu.y, MENU_WIDTH, MENU_HEIGHT)
  }, [contextMenu])

  const menuPath = contextMenu?.path ?? rootPath
  const contextFile = contextMenu?.kind === 'file' ? fileMap.get(menuPath) ?? null : null
  const openFileMenuLabel = contextFile
    ? contextFile.kind === 'markdown'
      ? '打开文件'
      : toPreviewFileKind(contextFile.kind)
        ? '预览文件'
        : '尝试打开'
    : '打开文件'
  const createTargetPath = contextMenu?.kind === 'file' ? parentDavPath(menuPath) : menuPath

  return {
    contextMenu,
    contextPosition,
    createTargetPath,
    menuPath,
    openFileMenuLabel,
    openFileTreeContextMenu,
    setContextMenu,
  }
}
