import type { WebDAVClient } from 'webdav'

import {
  getBaseName,
  getRemoteBasePath,
  inferRemoteFileKind,
  isMethodUnsupported,
  isPathInsideRoot,
  normalizeDavPath,
  normalizeRootPath,
  parentDavPath,
  shouldFallbackCreateFileForAList,
  toAppDavPath,
  toClientDavPath,
  type DavConfig,
  type DavListItem,
  type RemoteFile,
  type RemoteSnapshot,
} from '@/features/app/shared'

const NEW_MARKDOWN_TEMPLATE = '# 新建文档\n'

type CreateTextFileOptions = {
  content?: string
  onFallbackMode?: () => void
  path: string
}

export function buildRemoteSnapshot(list: DavListItem[], normalizedRoot: string): RemoteSnapshot {
  const directorySet = new Set<string>([normalizedRoot])
  const remoteFileMap = new Map<string, RemoteFile>()

  for (const item of list) {
    const normalizedPath = normalizeDavPath(item.filename)
    if (!isPathInsideRoot(normalizedPath, normalizedRoot)) {
      continue
    }

    if (item.type === 'directory') {
      directorySet.add(normalizedPath)
      continue
    }

    remoteFileMap.set(normalizedPath, {
      kind: inferRemoteFileKind(normalizedPath),
      name: getBaseName(normalizedPath),
      path: normalizedPath,
    })

    let cursor = parentDavPath(normalizedPath)
    while (isPathInsideRoot(cursor, normalizedRoot)) {
      directorySet.add(cursor)
      if (cursor === normalizedRoot) {
        break
      }
      cursor = parentDavPath(cursor)
    }
  }

  const sortedFiles = [...remoteFileMap.values()].sort((a, b) => a.path.localeCompare(b.path, 'zh-CN'))

  return {
    directories: [...directorySet].sort((a, b) => a.localeCompare(b, 'zh-CN')),
    files: sortedFiles,
  }
}

export async function listRemoteSnapshot(targetClient: WebDAVClient, targetConfig: DavConfig): Promise<RemoteSnapshot> {
  const normalizedRoot = normalizeRootPath(targetConfig.rootPath)
  const remoteBasePath = getRemoteBasePath(targetConfig.url)
  const visited = new Set<string>()
  const queue: string[] = [normalizedRoot]
  const aggregate: DavListItem[] = []

  while (queue.length > 0) {
    const currentDirectory = queue.shift()
    if (!currentDirectory || visited.has(currentDirectory)) {
      continue
    }
    visited.add(currentDirectory)

    const partial = await targetClient.getDirectoryContents(toClientDavPath(currentDirectory), { deep: false })
    const items = (Array.isArray(partial) ? partial : [partial]) as DavListItem[]

    for (const item of items) {
      const normalizedPath = toAppDavPath(item.filename, remoteBasePath)
      if (!isPathInsideRoot(normalizedPath, normalizedRoot)) {
        continue
      }

      aggregate.push({
        ...item,
        filename: normalizedPath,
      })

      if (item.type === 'directory' && normalizedPath !== currentDirectory && !visited.has(normalizedPath)) {
        queue.push(normalizedPath)
      }
    }
  }

  return buildRemoteSnapshot(aggregate, normalizedRoot)
}

export async function readRemoteTextFile(targetClient: WebDAVClient, filePath: string) {
  const normalizedPath = normalizeDavPath(filePath)
  const fileText = (await targetClient.getFileContents(toClientDavPath(normalizedPath), { format: 'text' })) as string
  return {
    path: normalizedPath,
    text: fileText,
  }
}

export async function readRemoteBinaryFile(targetClient: WebDAVClient, filePath: string) {
  const normalizedPath = normalizeDavPath(filePath)
  const payload = await targetClient.getFileContents(toClientDavPath(normalizedPath), { format: 'binary' })
  return {
    path: normalizedPath,
    payload,
  }
}

export async function writeRemoteTextFile(targetClient: WebDAVClient, filePath: string, content: string) {
  const normalizedPath = normalizeDavPath(filePath)
  await targetClient.putFileContents(toClientDavPath(normalizedPath), content, { overwrite: true })
  return normalizedPath
}

export async function ensureDavDirectory(targetClient: WebDAVClient, directoryPath: string) {
  const normalizedPath = normalizeDavPath(directoryPath)
  if (normalizedPath === '/') {
    return
  }

  const clientWithCreateDirectory = targetClient as WebDAVClient & {
    createDirectory?: (path: string, options?: { recursive?: boolean }) => Promise<void>
  }
  if (!clientWithCreateDirectory.createDirectory) {
    throw new Error('当前 WebDAV 客户端不支持创建目录')
  }

  const clientPath = toClientDavPath(normalizedPath)
  try {
    await clientWithCreateDirectory.createDirectory(clientPath, { recursive: true })
    return
  } catch (error) {
    if (!isMethodUnsupported(error)) {
      const exists = await targetClient.exists(clientPath)
      if (exists) {
        return
      }
    }
  }

  let cursor = ''
  for (const segment of normalizedPath.split('/').filter(Boolean)) {
    cursor = `${cursor}/${segment}`.replace(/\/+/g, '/')
    const next = normalizeDavPath(cursor)
    const nextClientPath = toClientDavPath(next)
    const exists = await targetClient.exists(nextClientPath)
    if (exists) {
      continue
    }

    try {
      await clientWithCreateDirectory.createDirectory(nextClientPath)
    } catch (error) {
      const existsAfterError = await targetClient.exists(nextClientPath)
      if (!existsAfterError) {
        throw error
      }
    }
  }
}

export async function createTextFile(targetClient: WebDAVClient, options: CreateTextFileOptions) {
  const normalizedPath = normalizeDavPath(options.path)
  const content = options.content ?? NEW_MARKDOWN_TEMPLATE

  try {
    const created = await targetClient.putFileContents(toClientDavPath(normalizedPath), content, { overwrite: false })
    if (created === false) {
      throw new Error(`文件已存在：${normalizedPath}`)
    }
    return normalizedPath
  } catch (error) {
    if (!shouldFallbackCreateFileForAList(error)) {
      throw error
    }

    options.onFallbackMode?.()

    const exists = await targetClient.exists(toClientDavPath(normalizedPath))
    if (exists) {
      throw new Error(`文件已存在：${normalizedPath}`)
    }

    await targetClient.putFileContents(toClientDavPath(normalizedPath), content, { overwrite: true })
    return normalizedPath
  }
}
