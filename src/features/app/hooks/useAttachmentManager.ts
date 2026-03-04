import { useCallback, useEffect, useRef, useState } from 'react'
import type { MutableRefObject } from 'react'
import type { WebDAVClient } from 'webdav'

import {
  buildAttachmentTarget,
  normalizeAttachmentSettings,
  resolveMarkdownLinkToDavPath,
} from '@/lib/attachments'
import {
  extractMarkdownLinkTargets,
  isExternalResourceUrl,
  isManagedAttachmentFilePath,
  normalizeDavPath,
  resolveAttachmentLinkToDavPath,
  revokeAllObjectUrls,
  shouldFallbackCreateFileForAList,
  toBlobPayload,
  toClientDavPath,
  type DavConfig,
  type RemoteSnapshot,
  type UploadAttachmentResult,
} from '@/features/app/shared'
import { ensureDavDirectory, readRemoteBinaryFile, readRemoteTextFile } from '@/features/app/webdav-io'
import { toast } from 'sonner'

type UseAttachmentManagerOptions = {
  activeFilePath: string
  client: WebDAVClient | null
  config: DavConfig | null
  contentRef: MutableRefObject<string>
  listRemote: (targetClient: WebDAVClient, targetConfig: DavConfig) => Promise<RemoteSnapshot>
  notifyError: (message: string, error?: unknown) => void
  reloadRemoteState: (targetClient: WebDAVClient, targetConfig: DavConfig, preferredPath?: string) => Promise<void>
  setBusy: (busy: boolean) => void
  setStatus: (status: string) => void
}

type UseAttachmentManagerResult = {
  cleanupUnusedAttachments: () => Promise<void>
  clearImagePreviewCache: () => void
  isCleaningAttachments: boolean
  isUploadingAttachment: boolean
  resolveImageSrc: (url: string) => Promise<string>
  uploadAttachmentFile: (file: File) => Promise<UploadAttachmentResult>
}

export function useAttachmentManager(options: UseAttachmentManagerOptions): UseAttachmentManagerResult {
  const {
    activeFilePath,
    client,
    config,
    contentRef,
    listRemote,
    notifyError,
    reloadRemoteState,
    setBusy,
    setStatus,
  } = options

  const [isUploadingAttachment, setIsUploadingAttachment] = useState(false)
  const [isCleaningAttachments, setIsCleaningAttachments] = useState(false)

  const imagePreviewUrlMapRef = useRef(new Map<string, string>())
  const imagePreviewPendingRef = useRef(new Map<string, Promise<string>>())

  const clearImagePreviewCache = useCallback(() => {
    revokeAllObjectUrls(imagePreviewUrlMapRef.current)
    imagePreviewPendingRef.current.clear()
  }, [])

  useEffect(
    () => () => {
      clearImagePreviewCache()
    },
    [clearImagePreviewCache],
  )

  useEffect(() => {
    clearImagePreviewCache()
  }, [activeFilePath, clearImagePreviewCache])

  const uploadAttachmentFile = useCallback(
    async (file: File): Promise<UploadAttachmentResult> => {
      if (!client || !config || !activeFilePath) {
        throw new Error('请先连接 WebDAV 并选择文件')
      }

      const settings = normalizeAttachmentSettings(config.attachments)
      const maxBytes = settings.maxSizeMB * 1024 * 1024
      if (file.size > maxBytes) {
        throw new Error(`文件过大，当前上限 ${settings.maxSizeMB}MB`)
      }

      setIsUploadingAttachment(true)
      setStatus(`上传附件中：${file.name}`)

      try {
        const uploadTarget = buildAttachmentTarget({
          activeFilePath,
          baseUrl: config.url,
          originalFileName: file.name,
          rootPath: config.rootPath,
          settings,
        })

        await ensureDavDirectory(client, uploadTarget.directoryPath)

        const payload = await file.arrayBuffer()
        try {
          const created = await client.putFileContents(toClientDavPath(uploadTarget.remotePath), payload, { overwrite: false })
          if (created === false) {
            throw new Error(`附件已存在：${uploadTarget.remotePath}`)
          }
        } catch (error) {
          if (!shouldFallbackCreateFileForAList(error)) {
            throw error
          }

          const exists = await client.exists(toClientDavPath(uploadTarget.remotePath))
          if (exists) {
            throw new Error(`附件已存在：${uploadTarget.remotePath}`)
          }

          await client.putFileContents(toClientDavPath(uploadTarget.remotePath), payload, { overwrite: true })
        }

        setStatus(`附件已上传：${uploadTarget.remotePath}`)
        return {
          davPath: uploadTarget.remotePath,
          link: uploadTarget.markdownLink,
        }
      } catch (error) {
        notifyError('附件上传失败', error)
        throw error
      } finally {
        setIsUploadingAttachment(false)
      }
    },
    [activeFilePath, client, config, notifyError, setStatus],
  )

  const cleanupUnusedAttachments = useCallback(async () => {
    if (!client || !config) {
      notifyError('请先连接 WebDAV')
      return
    }

    const targetClient = client as WebDAVClient & { deleteFile?: (path: string) => Promise<void> }
    if (!targetClient.deleteFile) {
      notifyError('当前 WebDAV 客户端不支持删除')
      return
    }

    const attachmentSettings = normalizeAttachmentSettings(config.attachments)

    setIsCleaningAttachments(true)
    setBusy(true)
    setStatus('扫描未引用附件中...')

    try {
      const snapshot = await listRemote(client, config)
      const markdownFiles = snapshot.files.filter((item) => item.kind === 'markdown')
      const referencedAttachmentPaths = new Set<string>()
      let unreadableMarkdownCount = 0

      for (const markdownFile of markdownFiles) {
        try {
          const markdownContent =
            markdownFile.path === activeFilePath
              ? contentRef.current
              : (await readRemoteTextFile(client, markdownFile.path)).text

          const linkTargets = extractMarkdownLinkTargets(markdownContent)
          for (const link of linkTargets) {
            const resolvedPath = resolveAttachmentLinkToDavPath(link, markdownFile.path, config.url)
            if (!resolvedPath) {
              continue
            }
            if (!isManagedAttachmentFilePath(resolvedPath, attachmentSettings, config.rootPath)) {
              continue
            }
            referencedAttachmentPaths.add(normalizeDavPath(resolvedPath))
          }
        } catch {
          unreadableMarkdownCount += 1
        }
      }

      const cleanupCandidates = [
        ...new Set(
          snapshot.files
            .filter((item) => item.kind !== 'markdown')
            .filter((item) => isManagedAttachmentFilePath(item.path, attachmentSettings, config.rootPath))
            .map((item) => normalizeDavPath(item.path)),
        ),
      ]
      const stalePaths = cleanupCandidates.filter((path) => !referencedAttachmentPaths.has(path))

      if (stalePaths.length === 0) {
        const message = unreadableMarkdownCount > 0 ? '未发现可清理附件（部分 Markdown 读取失败）' : '未发现未引用附件'
        setStatus(message)
        toast.success(message)
        return
      }

      const confirmed = window.confirm(`检测到 ${stalePaths.length} 个未引用附件，确认删除吗？`)
      if (!confirmed) {
        setStatus('已取消附件清理')
        return
      }

      let deletedCount = 0
      let failedCount = 0

      for (const path of stalePaths) {
        try {
          await targetClient.deleteFile(toClientDavPath(path))
          deletedCount += 1
        } catch {
          failedCount += 1
        }
      }

      await reloadRemoteState(client, config, activeFilePath)

      if (failedCount === 0) {
        const message = `已清理 ${deletedCount} 个未引用附件`
        setStatus(message)
        toast.success(message)
      } else {
        const message = `已清理 ${deletedCount} 个附件，${failedCount} 个删除失败`
        setStatus(message)
        toast.warning(message)
      }

      if (unreadableMarkdownCount > 0) {
        toast.warning(`有 ${unreadableMarkdownCount} 个 Markdown 文件读取失败，结果可能不完整`)
      }
    } catch (error) {
      notifyError('清理未引用附件失败', error)
    } finally {
      setBusy(false)
      setIsCleaningAttachments(false)
    }
  }, [activeFilePath, client, config, contentRef, listRemote, notifyError, reloadRemoteState, setBusy, setStatus])

  const resolveImageSrc = useCallback(
    async (url: string) => {
      if (!url || isExternalResourceUrl(url)) {
        return url
      }

      if (!client || !activeFilePath) {
        return url
      }

      const davPath = resolveMarkdownLinkToDavPath(url, activeFilePath)
      if (!davPath) {
        return url
      }

      const cached = imagePreviewUrlMapRef.current.get(davPath)
      if (cached) {
        return cached
      }

      const pending = imagePreviewPendingRef.current.get(davPath)
      if (pending) {
        return pending
      }

      const task = (async () => {
        try {
          const { payload } = await readRemoteBinaryFile(client, davPath)
          const blobPayload = toBlobPayload(payload)
          if (!blobPayload) {
            return url
          }

          const objectUrl = URL.createObjectURL(new Blob([blobPayload]))
          imagePreviewUrlMapRef.current.set(davPath, objectUrl)
          return objectUrl
        } catch {
          return url
        } finally {
          imagePreviewPendingRef.current.delete(davPath)
        }
      })()

      imagePreviewPendingRef.current.set(davPath, task)
      return task
    },
    [activeFilePath, client],
  )

  return {
    cleanupUnusedAttachments,
    clearImagePreviewCache,
    isCleaningAttachments,
    isUploadingAttachment,
    resolveImageSrc,
    uploadAttachmentFile,
  }
}
