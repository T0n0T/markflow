import {
  type ChangeEvent,
  type ClipboardEvent as ReactClipboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  Bold,
  Calculator,
  Code2,
  Download,
  Eye,
  EyeOff,
  FilePenLine,
  Heading1,
  Heading2,
  Italic,
  List,
  ListChecks,
  ListOrdered,
  LogIn,
  LogOut,
  Monitor,
  Moon,
  Quote,
  Redo2,
  RefreshCw,
  Save,
  Settings2,
  Sun,
  Table2,
  Undo2,
  Paperclip,
} from 'lucide-react'
import { createClient, type WebDAVClient } from 'webdav'

import { EditorContextMenu } from '@/features/app/components/EditorContextMenu'
import { FileTreeSidebar } from '@/features/app/components/FileTreeSidebar'
import { FileTreeContextMenu } from '@/features/app/components/FileTreeContextMenu'
import { useAttachmentManager } from '@/features/app/hooks/useAttachmentManager'
import { useEditorContextMenu } from '@/features/app/hooks/useEditorContextMenu'
import { useFileTreeContextMenu } from '@/features/app/hooks/useFileTreeContextMenu'
import { WysiwygMarkdownEditor } from '@/features/app/WysiwygMarkdownEditor'
import {
  CONFIG_KEY,
  DEFAULT_MARKDOWN,
  DEFAULT_ROOT_PATH,
  EMPTY_CONFIG,
  THEME_PREFERENCE_LABEL,
  buildFolderTree,
  downloadBlob,
  downloadObjectUrl,
  ensureDavBaseUrl,
  getBaseName,
  getClipboardImageFiles,
  getMimeTypeForFile,
  getNextThemePreference,
  getPreviewTypeLabel,
  joinDavPath,
  loadStoredConfig,
  normalizeDavPath,
  normalizeRootPath,
  normalizeUrl,
  parentDavPath,
  parseErrorMessage,
  pickMarkdownTargetPath,
  toBlobPayload,
  toClientDavPath,
  toPreviewFileKind,
  type ContextKind,
  type DavConfig,
  type EditorMode,
  type PreviewDialogState,
  type RemoteFile,
  type ToolbarAction,
  type WysiwygEditorApi,
} from '@/features/app/shared'
import {
  createMarkdownFile as createRemoteMarkdownFile,
  listRemoteSnapshot,
  readRemoteBinaryFile,
  readRemoteTextFile,
  writeRemoteTextFile,
} from '@/features/app/webdav-io'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import {
  buildAttachmentMarkdown,
  type AttachmentSettings,
  type AttachmentStorageMode,
  type AttachmentLinkFormat,
  normalizeAttachmentSettings,
  DEFAULT_ATTACHMENT_SETTINGS,
  sanitizeAttachmentFolderName,
} from '@/lib/attachments'
import {
  readThemePreference,
  resolveTheme,
  setThemePreference as persistThemePreference,
  type ResolvedTheme,
  type ThemePreference,
} from '@/lib/theme'
import { toast } from 'sonner'

function App() {
  const initialStoredConfig = useMemo(() => loadStoredConfig(), [])
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [attachmentDialogOpen, setAttachmentDialogOpen] = useState(false)
  const [config, setConfig] = useState<DavConfig | null>(initialStoredConfig)
  const [draftConfig, setDraftConfig] = useState<DavConfig>(initialStoredConfig ?? { ...EMPTY_CONFIG })
  const [draftAttachmentSettings, setDraftAttachmentSettings] = useState<AttachmentSettings>(
    normalizeAttachmentSettings(initialStoredConfig?.attachments ?? EMPTY_CONFIG.attachments),
  )
  const [showPassword, setShowPassword] = useState(false)
  const [rememberCredentials, setRememberCredentials] = useState(Boolean(initialStoredConfig))
  const [client, setClient] = useState<WebDAVClient | null>(null)
  const [files, setFiles] = useState<RemoteFile[]>([])
  const [directories, setDirectories] = useState<string[]>([])
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({})
  const [activeFilePath, setActiveFilePath] = useState('')
  const [selectedFilePaths, setSelectedFilePaths] = useState<string[]>([])
  const [previewDialog, setPreviewDialog] = useState<PreviewDialogState | null>(null)
  const [content, setContent] = useState(DEFAULT_MARKDOWN)
  const [status, setStatus] = useState('未连接 WebDAV')
  const [busy, setBusy] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [saveIconFlash, setSaveIconFlash] = useState(false)
  const [editorMode, setEditorMode] = useState<EditorMode>('wysiwyg')
  const [wysiwygSyncVersion, setWysiwygSyncVersion] = useState(0)
  const [themePreference, setThemePreferenceState] = useState<ThemePreference>(() => readThemePreference())
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() => resolveTheme(readThemePreference()))

  const attachmentInputRef = useRef<HTMLInputElement>(null)
  const sourceEditorRef = useRef<HTMLTextAreaElement>(null)
  const wysiwygApiRef = useRef<WysiwygEditorApi | null>(null)
  const contentRef = useRef(DEFAULT_MARKDOWN)
  const historyRef = useRef([DEFAULT_MARKDOWN])
  const historyIndexRef = useRef(0)
  const warnedAListCreateFallbackRef = useRef(false)
  const previewObjectUrlRef = useRef<string | null>(null)
  const previewRequestRef = useRef(0)

  const isConnected = client !== null
  const canEditDocument = isConnected && Boolean(activeFilePath)
  const canUseEditorActions = canEditDocument && !busy
  const hasUnsavedChanges = Boolean(activeFilePath) && content !== historyRef.current[0]
  const fileMap = useMemo(() => new Map(files.map((item) => [item.path, item])), [files])
  const selectedFilePath = previewDialog?.file.path ?? activeFilePath
  const selectedFilePathSet = useMemo(() => new Set(selectedFilePaths), [selectedFilePaths])
  const rootPath = normalizeRootPath(config?.rootPath ?? draftConfig.rootPath ?? DEFAULT_ROOT_PATH)
  const folderTree = useMemo(() => buildFolderTree(files, directories, rootPath), [files, directories, rootPath])
  const sidebarStatusLabel = isConnected ? config?.url || '已连接 WebDAV' : busy ? '连接中...' : '未连接 WebDAV'
  const sidebarStatusDotClass = isConnected ? 'text-[#22c55e]' : busy ? 'text-[var(--mf-feedback)]' : 'text-[var(--mf-warning)]'
  const sidebarStatusTextClass = isConnected
    ? 'text-[var(--mf-muted-strong)]'
    : busy
      ? 'text-[var(--mf-feedback-strong)]'
      : 'text-[var(--mf-warning-strong)]'
  const nextThemePreference = getNextThemePreference(themePreference)
  const themeButtonTitle = `主题：${THEME_PREFERENCE_LABEL[themePreference]}（点击切换到${THEME_PREFERENCE_LABEL[nextThemePreference]}）`
  const ThemePreferenceIcon = themePreference === 'system' ? Monitor : resolvedTheme === 'dark' ? Moon : Sun
  const {
    contextMenu,
    contextPosition,
    createTargetPath,
    menuPath,
    openFileMenuLabel,
    openFileTreeContextMenu,
    setContextMenu,
  } = useFileTreeContextMenu({
    fileMap,
    isConnected,
    rootPath,
  })

  const isFolderOpen = useCallback((fullPath: string) => expandedFolders[fullPath] ?? true, [expandedFolders])
  const onToggleFolder = useCallback((fullPath: string) => {
    setExpandedFolders((prev) => ({
      ...prev,
      [fullPath]: !(prev[fullPath] ?? true),
    }))
  }, [])
  const onToggleThemePreference = useCallback(() => {
    const nextPreference = getNextThemePreference(themePreference)
    persistThemePreference(nextPreference)
    setThemePreferenceState(nextPreference)
  }, [themePreference])

  useEffect(() => {
    setResolvedTheme(resolveTheme(themePreference))

    if (themePreference !== 'system' || typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return
    }

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    const syncTheme = () => {
      setResolvedTheme(mediaQuery.matches ? 'dark' : 'light')
    }

    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', syncTheme)
      return () => mediaQuery.removeEventListener('change', syncTheme)
    }

    mediaQuery.addListener(syncTheme)
    return () => mediaQuery.removeListener(syncTheme)
  }, [themePreference])

  useEffect(() => {
    setSelectedFilePaths((prev) => {
      const next = prev.filter((path) => fileMap.has(path))
      return next.length === prev.length ? prev : next
    })
  }, [fileMap])

  const setContentWithHistory = useCallback((nextContent: string, options?: { resetHistory?: boolean; trackHistory?: boolean }) => {
    const normalized = nextContent.replace(/\r\n?/g, '\n')
    contentRef.current = normalized
    setContent(normalized)

    if (options?.resetHistory) {
      historyRef.current = [normalized]
      historyIndexRef.current = 0
      return
    }

    if (options?.trackHistory === false) {
      return
    }

    const history = historyRef.current
    const index = historyIndexRef.current
    if (history[index] === normalized) {
      return
    }

    const nextHistory = history.slice(0, index + 1)
    nextHistory.push(normalized)

    if (nextHistory.length > 200) {
      nextHistory.shift()
    }

    historyRef.current = nextHistory
    historyIndexRef.current = nextHistory.length - 1
  }, [])

  const notifyError = useCallback((message: string, error?: unknown) => {
    const detail = error ? parseErrorMessage(error) : ''
    const nextMessage = detail ? `${message}：${detail}` : message
    setStatus(nextMessage)
    toast.error(nextMessage)
  }, [])

  const {
    applyEditorImageRatio,
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
  } = useEditorContextMenu({
    canEditDocument,
    canUseEditorActions,
    contentRef,
    editorMode,
    onOpen: () => setContextMenu(null),
    setContentWithHistory,
    sourceEditorRef,
    wysiwygApiRef,
  })

  const listRemote = useCallback(
    async (targetClient: WebDAVClient, targetConfig: DavConfig) => listRemoteSnapshot(targetClient, targetConfig),
    [],
  )

  const readFile = useCallback(
    async (targetClient: WebDAVClient, filePath: string) => {
      const { path, text } = await readRemoteTextFile(targetClient, filePath)
      setActiveFilePath(path)
      setContentWithHistory(text, { resetHistory: true })
      setWysiwygSyncVersion((prev) => prev + 1)
    },
    [setContentWithHistory],
  )

  const revokePreviewObjectUrl = useCallback(() => {
    if (!previewObjectUrlRef.current) {
      return
    }
    URL.revokeObjectURL(previewObjectUrlRef.current)
    previewObjectUrlRef.current = null
  }, [])

  const closePreviewDialog = useCallback(() => {
    previewRequestRef.current += 1
    revokePreviewObjectUrl()
    setPreviewDialog(null)
  }, [revokePreviewObjectUrl])

  const openPreviewFile = useCallback(
    async (targetClient: WebDAVClient, file: RemoteFile) => {
      const previewKind = toPreviewFileKind(file.kind)
      if (!previewKind) {
        notifyError(`暂不支持预览该文件类型：${file.name}`)
        return
      }

      previewRequestRef.current += 1
      const requestId = previewRequestRef.current
      const normalizedPath = normalizeDavPath(file.path)
      revokePreviewObjectUrl()

      setPreviewDialog({
        error: '',
        file,
        kind: previewKind,
        loading: true,
        objectUrl: '',
        textContent: '',
      })

      try {
        if (previewKind === 'text') {
          const { text: textContent } = await readRemoteTextFile(targetClient, normalizedPath)
          if (previewRequestRef.current !== requestId) {
            return
          }
          setPreviewDialog({
            error: '',
            file,
            kind: previewKind,
            loading: false,
            objectUrl: '',
            textContent,
          })
          setStatus(`预览：${normalizedPath}`)
          return
        }

        const { payload } = await readRemoteBinaryFile(targetClient, normalizedPath)
        const blobPayload = toBlobPayload(payload)
        if (!blobPayload) {
          throw new Error('无法解析文件内容')
        }

        const objectUrl = URL.createObjectURL(new Blob([blobPayload], { type: getMimeTypeForFile(normalizedPath, previewKind) }))
        if (previewRequestRef.current !== requestId) {
          URL.revokeObjectURL(objectUrl)
          return
        }

        previewObjectUrlRef.current = objectUrl
        setPreviewDialog({
          error: '',
          file,
          kind: previewKind,
          loading: false,
          objectUrl,
          textContent: '',
        })
        setStatus(`预览：${normalizedPath}`)
      } catch (error) {
        if (previewRequestRef.current !== requestId) {
          return
        }
        setPreviewDialog({
          error: parseErrorMessage(error),
          file,
          kind: previewKind,
          loading: false,
          objectUrl: '',
          textContent: '',
        })
      }
    },
    [notifyError, revokePreviewObjectUrl],
  )

  const downloadPreviewFile = useCallback(async () => {
    if (!previewDialog) {
      return
    }

    try {
      if (previewDialog.kind === 'text') {
        const textBlob = new Blob([previewDialog.textContent], {
          type: 'text/plain;charset=utf-8',
        })
        downloadBlob(textBlob, previewDialog.file.name)
        setStatus(`已下载：${previewDialog.file.path}`)
        return
      }

      if (previewDialog.objectUrl) {
        downloadObjectUrl(previewDialog.objectUrl, previewDialog.file.name)
        setStatus(`已下载：${previewDialog.file.path}`)
        return
      }

      if (!client) {
        notifyError('请先连接 WebDAV')
        return
      }

      const { payload } = await readRemoteBinaryFile(client, previewDialog.file.path)
      const blobPayload = toBlobPayload(payload)
      if (!blobPayload) {
        throw new Error('无法解析文件内容')
      }
      downloadBlob(new Blob([blobPayload]), previewDialog.file.name)
      setStatus(`已下载：${previewDialog.file.path}`)
    } catch (error) {
      notifyError('下载失败', error)
    }
  }, [client, notifyError, previewDialog])

  const reloadRemoteState = useCallback(
    async (targetClient: WebDAVClient, targetConfig: DavConfig, preferredPath?: string) => {
      const snapshot = await listRemote(targetClient, targetConfig)
      setFiles(snapshot.files)
      setDirectories(snapshot.directories)

      if (previewDialog && !snapshot.files.some((item) => item.path === previewDialog.file.path)) {
        closePreviewDialog()
      }

      const targetPath = pickMarkdownTargetPath(snapshot.files, preferredPath, activeFilePath)
      if (!targetPath) {
        setActiveFilePath('')
        setSelectedFilePaths([])
        setContentWithHistory('# 空目录\n\n当前目录没有 Markdown 文件。\n\n你仍可点击文本、图片、视频、音频、PDF 文件进行预览。', {
          resetHistory: true,
        })
        setWysiwygSyncVersion((prev) => prev + 1)
        return
      }

      await readFile(targetClient, targetPath)
    },
    [activeFilePath, closePreviewDialog, listRemote, previewDialog, readFile, setContentWithHistory],
  )

  const refreshRemoteFileTree = useCallback(
    async (targetClient: WebDAVClient, targetConfig: DavConfig) => {
      const snapshot = await listRemote(targetClient, targetConfig)
      setFiles(snapshot.files)
      setDirectories(snapshot.directories)

      if (previewDialog && !snapshot.files.some((item) => item.path === previewDialog.file.path)) {
        closePreviewDialog()
      }
    },
    [closePreviewDialog, listRemote, previewDialog],
  )

  const refreshRemoteFileTreeAfterAttachmentUpload = useCallback(async () => {
    if (!client || !config) {
      return
    }

    try {
      await refreshRemoteFileTree(client, config)
    } catch {
      // Keep upload success flow unaffected when tree refresh fails.
    }
  }, [client, config, refreshRemoteFileTree])

  const connectWebdav = useCallback(
    async (inputConfig: DavConfig, options?: { persist?: boolean }) => {
      const nextConfig = {
        attachments: normalizeAttachmentSettings(inputConfig.attachments),
        rootPath: normalizeRootPath(inputConfig.rootPath),
        url: normalizeUrl(inputConfig.url),
        username: inputConfig.username.trim(),
        password: inputConfig.password,
      }

      if (!nextConfig.url) {
        notifyError('请先填写 URL')
        return false
      }

      setBusy(true)
      try {
        const hasCredentials = Boolean(nextConfig.username || nextConfig.password)
        const nextClient = createClient(
          ensureDavBaseUrl(nextConfig.url),
          hasCredentials
            ? {
                password: nextConfig.password,
                username: nextConfig.username,
              }
            : undefined,
        )

        const snapshot = await listRemote(nextClient, nextConfig)
        setClient(nextClient)
        setConfig(nextConfig)
        setDraftConfig(nextConfig)
        setFiles(snapshot.files)
        setDirectories(snapshot.directories)
        setExpandedFolders((prev) => ({ ...prev, [nextConfig.rootPath]: true }))
        closePreviewDialog()

        if (options?.persist === false) {
          localStorage.removeItem(CONFIG_KEY)
        } else {
          localStorage.setItem(CONFIG_KEY, JSON.stringify(nextConfig))
        }

        const targetPath = pickMarkdownTargetPath(snapshot.files)
        if (targetPath) {
          setSelectedFilePaths([targetPath])
          await readFile(nextClient, targetPath)
        } else {
          setActiveFilePath('')
          setSelectedFilePaths([])
          setContentWithHistory('# 空目录\n\n当前目录没有 Markdown 文件。\n\n你仍可点击文本、图片、视频、音频、PDF 文件进行预览。', {
            resetHistory: true,
          })
          setWysiwygSyncVersion((prev) => prev + 1)
        }

        setStatus(`已连接：${nextConfig.url}`)
        return true
      } catch (error) {
        setClient(null)
        setFiles([])
        setDirectories([])
        setActiveFilePath('')
        setSelectedFilePaths([])
        closePreviewDialog()
        notifyError('连接失败', error)
        return false
      } finally {
        setBusy(false)
      }
    },
    [closePreviewDialog, listRemote, notifyError, readFile, setContentWithHistory],
  )

  useEffect(() => {
    if (!initialStoredConfig) {
      return
    }
    void connectWebdav(initialStoredConfig, { persist: true })
  }, [connectWebdav, initialStoredConfig])

  useEffect(
    () => () => {
      previewRequestRef.current += 1
      revokePreviewObjectUrl()
    },
    [revokePreviewObjectUrl],
  )

  useEffect(() => {
    if (!contextMenu && !editorContextMenu) {
      return
    }

    const close = () => {
      setContextMenu(null)
      closeEditorContextMenu()
    }
    const closeByEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setContextMenu(null)
        closeEditorContextMenu()
      }
    }

    window.addEventListener('click', close)
    window.addEventListener('resize', close)
    window.addEventListener('scroll', close, true)
    window.addEventListener('keydown', closeByEscape)

    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('resize', close)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('keydown', closeByEscape)
    }
  }, [closeEditorContextMenu, contextMenu, editorContextMenu, setContextMenu])

  const onSave = useCallback(async () => {
    if (!client || !activeFilePath) {
      notifyError('未选择可保存的文件')
      return false
    }

    if (isSaving) {
      return false
    }

    setIsSaving(true)
    setSaveIconFlash(false)
    try {
      await writeRemoteTextFile(client, activeFilePath, contentRef.current)
      historyRef.current = [contentRef.current]
      historyIndexRef.current = 0
      setStatus(`已保存：${activeFilePath}`)
      return true
    } catch (error) {
      notifyError('保存失败', error)
      return false
    } finally {
      setIsSaving(false)
      requestAnimationFrame(() => {
        setSaveIconFlash(true)
      })
    }
  }, [activeFilePath, client, isSaving, notifyError])

  const onSelectFile = useCallback(
    async (filePath: string) => {
      if (!client) {
        notifyError('请先连接 WebDAV')
        return
      }

      const normalizedPath = normalizeDavPath(filePath)
      const selected = fileMap.get(normalizedPath)
      if (!selected) {
        notifyError(`文件不存在：${normalizedPath}`)
        return
      }

      if (normalizedPath !== activeFilePath && hasUnsavedChanges) {
        const shouldSave = window.confirm('当前文件有未保存修改，是否先保存再切换？\n点击“确定”保存并切换，点击“取消”保留当前编辑内容。')
        if (!shouldSave) {
          setStatus('已取消切换：当前文件有未保存修改')
          return
        }
        const saveSucceeded = await onSave()
        if (!saveSucceeded) {
          return
        }
      }

      if (selected.kind === 'markdown' && normalizedPath === activeFilePath) {
        closePreviewDialog()
        setSelectedFilePaths([normalizedPath])
        return
      }

      setSelectedFilePaths([normalizedPath])

      if (selected.kind !== 'markdown') {
        await openPreviewFile(client, selected)
        return
      }

      setBusy(true)
      try {
        closePreviewDialog()
        await readFile(client, normalizedPath)
        setStatus(`已载入：${normalizedPath}`)
      } catch (error) {
        notifyError('读取失败', error)
      } finally {
        setBusy(false)
      }
    },
    [activeFilePath, client, closePreviewDialog, fileMap, hasUnsavedChanges, notifyError, onSave, openPreviewFile, readFile],
  )

  const onToggleFileSelection = useCallback(
    (filePath: string) => {
      const normalizedPath = normalizeDavPath(filePath)
      if (!fileMap.has(normalizedPath)) {
        return
      }
      setSelectedFilePaths((prev) =>
        prev.includes(normalizedPath) ? prev.filter((path) => path !== normalizedPath) : [...prev, normalizedPath],
      )
    },
    [fileMap],
  )

  const onRefresh = useCallback(async () => {
    if (!client || !config) {
      notifyError('请先连接 WebDAV')
      return
    }

    setBusy(true)
    try {
      await reloadRemoteState(client, config)
      setStatus('目录已刷新')
    } catch (error) {
      notifyError('刷新失败', error)
    } finally {
      setBusy(false)
    }
  }, [client, config, notifyError, reloadRemoteState])

  const openAttachmentSettingsDialog = useCallback(() => {
    const sourceAttachments = normalizeAttachmentSettings(config?.attachments ?? draftConfig.attachments)
    setDraftAttachmentSettings(sourceAttachments)
    setAttachmentDialogOpen(true)
  }, [config, draftConfig.attachments])

  const onSaveAttachmentSettings = useCallback(() => {
    const nextAttachments = normalizeAttachmentSettings(draftAttachmentSettings)
    setDraftConfig((prev) => ({ ...prev, attachments: nextAttachments }))

    if (config) {
      const nextConfig = {
        ...config,
        attachments: nextAttachments,
      }
      setConfig(nextConfig)

      if (localStorage.getItem(CONFIG_KEY)) {
        localStorage.setItem(CONFIG_KEY, JSON.stringify(nextConfig))
      }
    }

    setStatus('附件设置已更新')
    setAttachmentDialogOpen(false)
    toast.success('附件设置已保存')
  }, [config, draftAttachmentSettings])

  const {
    cleanupUnusedAttachments: onCleanupUnusedAttachments,
    clearImagePreviewCache,
    isCleaningAttachments,
    isUploadingAttachment,
    resolveImageSrc,
    uploadAttachmentFile,
  } = useAttachmentManager({
    activeFilePath,
    client,
    config,
    contentRef,
    listRemote,
    notifyError,
    reloadRemoteState,
    setBusy,
    setStatus,
  })

  const insertSnippetToSourceEditor = useCallback(
    (snippet: string) => {
      const textarea = sourceEditorRef.current
      if (!textarea) {
        setContentWithHistory(`${contentRef.current}\n${snippet}`.trim())
        return
      }

      const { selectionEnd, selectionStart, value } = textarea
      const nextValue = `${value.slice(0, selectionStart)}${snippet}${value.slice(selectionEnd)}`
      setContentWithHistory(nextValue)

      requestAnimationFrame(() => {
        textarea.focus()
        const cursor = selectionStart + snippet.length
        textarea.setSelectionRange(cursor, cursor)
      })
    },
    [setContentWithHistory],
  )

  const insertMarkdownSnippet = useCallback(
    (snippet: string) => {
      if (editorMode === 'source') {
        insertSnippetToSourceEditor(snippet)
        return
      }

      if (wysiwygApiRef.current?.insertMarkdown(snippet)) {
        return
      }

      setContentWithHistory(`${contentRef.current}\n${snippet}`.trim())
    },
    [editorMode, insertSnippetToSourceEditor, setContentWithHistory],
  )

  const onAttachmentInputChange = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0]
      event.target.value = ''

      if (!file) {
        return
      }

      try {
        const result = await uploadAttachmentFile(file)
        const snippet = buildAttachmentMarkdown(file, result.link)
        insertMarkdownSnippet(snippet)
        toast.success(`附件已上传：${file.name}`)
        await refreshRemoteFileTreeAfterAttachmentUpload()
      } catch {
        // Errors are already handled in uploadAttachmentFile.
      }
    },
    [insertMarkdownSnippet, refreshRemoteFileTreeAfterAttachmentUpload, uploadAttachmentFile],
  )

  const onWysiwygImageUpload = useCallback(
    async (file: File) => {
      const result = await uploadAttachmentFile(file)
      await refreshRemoteFileTreeAfterAttachmentUpload()
      return result.link
    },
    [refreshRemoteFileTreeAfterAttachmentUpload, uploadAttachmentFile],
  )

  const uploadPastedImagesToDav = useCallback(
    (clipboardData: DataTransfer | null) => {
      if (!canUseEditorActions || isUploadingAttachment) {
        return false
      }

      const files = getClipboardImageFiles(clipboardData)
      if (files.length === 0) {
        return false
      }

      void (async () => {
        const snippets: string[] = []
        const uploadedNames: string[] = []

        for (const file of files) {
          try {
            const result = await uploadAttachmentFile(file)
            snippets.push(buildAttachmentMarkdown(file, result.link))
            uploadedNames.push(file.name)
          } catch {
            break
          }
        }

        if (!snippets.length) {
          return
        }

        insertMarkdownSnippet(snippets.join('\n'))
        if (uploadedNames.length === 1) {
          toast.success(`截图已上传：${uploadedNames[0]}`)
        } else {
          toast.success(`截图已上传：${uploadedNames.length} 张`)
        }
        await refreshRemoteFileTreeAfterAttachmentUpload()
      })()

      return true
    },
    [canUseEditorActions, insertMarkdownSnippet, isUploadingAttachment, refreshRemoteFileTreeAfterAttachmentUpload, uploadAttachmentFile],
  )

  const onSourcePasteCapture = useCallback(
    (event: ReactClipboardEvent<HTMLTextAreaElement>) => {
      if (!uploadPastedImagesToDav(event.clipboardData)) {
        return
      }
      event.preventDefault()
      event.stopPropagation()
    },
    [uploadPastedImagesToDav],
  )

  const onWysiwygPasteCapture = useCallback(
    (event: ReactClipboardEvent<HTMLDivElement>) => {
      if (!uploadPastedImagesToDav(event.clipboardData)) {
        return
      }
      event.preventDefault()
      event.stopPropagation()
    },
    [uploadPastedImagesToDav],
  )

  useEffect(() => {
    if (!saveIconFlash) {
      return
    }
    const timer = window.setTimeout(() => {
      setSaveIconFlash(false)
    }, 420)
    return () => {
      window.clearTimeout(timer)
    }
  }, [saveIconFlash])

  const onLogout = useCallback(() => {
    localStorage.removeItem(CONFIG_KEY)
    setClient(null)
    setConfig(null)
    setFiles([])
    setDirectories([])
    setExpandedFolders({})
    setActiveFilePath('')
    setSelectedFilePaths([])
    setDraftConfig({ ...EMPTY_CONFIG, attachments: { ...DEFAULT_ATTACHMENT_SETTINGS } })
    setRememberCredentials(false)
    setShowPassword(false)
    closePreviewDialog()
    clearImagePreviewCache()
    setContentWithHistory(DEFAULT_MARKDOWN, { resetHistory: true })
    setWysiwygSyncVersion((prev) => prev + 1)
    setStatus('已登出，并清除本地连接记录')
  }, [clearImagePreviewCache, closePreviewDialog, setContentWithHistory])

  const onUndo = useCallback(() => {
    if (editorMode === 'wysiwyg' && wysiwygApiRef.current?.applyToolbarAction('undo')) {
      return
    }

    if (historyIndexRef.current <= 0) {
      return
    }
    historyIndexRef.current -= 1
    setContentWithHistory(historyRef.current[historyIndexRef.current], { trackHistory: false })
    if (editorMode === 'wysiwyg') {
      setWysiwygSyncVersion((prev) => prev + 1)
    }
  }, [editorMode, setContentWithHistory])

  const onRedo = useCallback(() => {
    if (editorMode === 'wysiwyg' && wysiwygApiRef.current?.applyToolbarAction('redo')) {
      return
    }

    if (historyIndexRef.current >= historyRef.current.length - 1) {
      return
    }
    historyIndexRef.current += 1
    setContentWithHistory(historyRef.current[historyIndexRef.current], { trackHistory: false })
    if (editorMode === 'wysiwyg') {
      setWysiwygSyncVersion((prev) => prev + 1)
    }
  }, [editorMode, setContentWithHistory])

  useEffect(() => {
    const onKeydown = (event: KeyboardEvent) => {
      const hasModifier = event.ctrlKey || event.metaKey
      if (!hasModifier || event.altKey) {
        return
      }

      const key = event.key.toLowerCase()
      if (key === 's') {
        if (!canUseEditorActions) {
          return
        }
        event.preventDefault()
        void onSave()
        return
      }

      if (key === 'z' && !event.shiftKey) {
        if (!canUseEditorActions) {
          return
        }
        event.preventDefault()
        onUndo()
        return
      }

      if (key === 'y' || (key === 'z' && event.shiftKey)) {
        if (!canUseEditorActions) {
          return
        }
        event.preventDefault()
        onRedo()
      }
    }

    window.addEventListener('keydown', onKeydown)
    return () => {
      window.removeEventListener('keydown', onKeydown)
    }
  }, [canUseEditorActions, onRedo, onSave, onUndo])

  const insertAroundSelection = useCallback(
    (prefix: string, suffix: string, placeholder: string) => {
      const textarea = sourceEditorRef.current
      if (!textarea) {
        return
      }

      const { selectionEnd, selectionStart, value } = textarea
      const selected = value.slice(selectionStart, selectionEnd) || placeholder
      const nextValue = `${value.slice(0, selectionStart)}${prefix}${selected}${suffix}${value.slice(selectionEnd)}`

      setContentWithHistory(nextValue)

      requestAnimationFrame(() => {
        textarea.focus()
        const start = selectionStart + prefix.length
        const end = start + selected.length
        textarea.setSelectionRange(start, end)
      })
    },
    [setContentWithHistory],
  )

  const insertLinePrefix = useCallback(
    (prefix: string) => {
      const textarea = sourceEditorRef.current
      if (!textarea) {
        return
      }

      const { selectionStart, value } = textarea
      const lineStart = value.lastIndexOf('\n', selectionStart - 1) + 1
      const nextValue = `${value.slice(0, lineStart)}${prefix}${value.slice(lineStart)}`

      setContentWithHistory(nextValue)

      requestAnimationFrame(() => {
        const cursor = selectionStart + prefix.length
        textarea.focus()
        textarea.setSelectionRange(cursor, cursor)
      })
    },
    [setContentWithHistory],
  )

  const insertBlock = useCallback(
    (template: string) => {
      const textarea = sourceEditorRef.current
      if (!textarea) {
        return
      }

      const { selectionEnd, selectionStart, value } = textarea
      const nextValue = `${value.slice(0, selectionStart)}${template}${value.slice(selectionEnd)}`

      setContentWithHistory(nextValue)

      requestAnimationFrame(() => {
        textarea.focus()
        const cursor = selectionStart + template.length
        textarea.setSelectionRange(cursor, cursor)
      })
    },
    [setContentWithHistory],
  )

  const onToolbarAction = useCallback(
    (action: ToolbarAction) => {
      if (!canUseEditorActions) {
        return
      }

      if (editorMode === 'wysiwyg') {
        if (wysiwygApiRef.current?.applyToolbarAction(action)) {
          return
        }

        if (action === 'undo') {
          onUndo()
          return
        }

        if (action === 'redo') {
          onRedo()
          return
        }
        return
      }

      switch (action) {
        case 'undo':
          onUndo()
          return
        case 'redo':
          onRedo()
          return
        case 'h1':
          insertLinePrefix('# ')
          return
        case 'h2':
          insertLinePrefix('## ')
          return
        case 'bold':
          insertAroundSelection('**', '**', '粗体')
          return
        case 'italic':
          insertAroundSelection('*', '*', '斜体')
          return
        case 'bullet':
          insertLinePrefix('- ')
          return
        case 'ordered':
          insertLinePrefix('1. ')
          return
        case 'quote':
          insertLinePrefix('> ')
          return
        case 'code':
          insertBlock('```\n\n```')
          return
        case 'table':
          insertBlock('| 列 1 | 列 2 |\n| --- | --- |\n| 内容 | 内容 |')
          return
        case 'task':
          insertLinePrefix('- [ ] ')
          return
        case 'math':
          insertBlock('$$\n\n$$')
          return
        default:
          return
      }
    },
    [canUseEditorActions, editorMode, insertAroundSelection, insertBlock, insertLinePrefix, onRedo, onUndo],
  )

  const createMarkdownFile = useCallback(
    async (targetDirectory: string) => {
      if (!client || !config) {
        notifyError('请先连接 WebDAV')
        return
      }

      const rawName = window.prompt('输入新文件名（可不带 .md）：', 'untitled.md')
      if (!rawName) {
        return
      }

      const trimmed = rawName.trim()
      if (!trimmed) {
        return
      }

      const nextName = /\.(md|markdown)$/i.test(trimmed) ? trimmed : `${trimmed}.md`
      const nextPath = joinDavPath(targetDirectory, nextName)

      setBusy(true)
      try {
        await createRemoteMarkdownFile(client, {
          onFallbackMode: () => {
            if (warnedAListCreateFallbackRef.current) {
              return
            }
            warnedAListCreateFallbackRef.current = true
            toast.warning('检测到 AList 写入兼容模式，已自动降级文件创建策略')
          },
          path: nextPath,
        })

        await reloadRemoteState(client, config, nextPath)
        setStatus(`已创建：${nextPath}`)
      } catch (error) {
        notifyError('新建文件失败', error)
      } finally {
        setBusy(false)
      }
    },
    [client, config, notifyError, reloadRemoteState],
  )

  const createFolder = useCallback(
    async (targetDirectory: string) => {
      if (!client || !config) {
        notifyError('请先连接 WebDAV')
        return
      }

      const rawName = window.prompt('输入新文件夹名称：', 'new-folder')
      if (!rawName) {
        return
      }

      const trimmed = rawName.trim().replace(/\//g, '')
      if (!trimmed) {
        return
      }

      const nextPath = joinDavPath(targetDirectory, trimmed)
      const targetClient = client as WebDAVClient & { createDirectory?: (path: string) => Promise<void> }
      if (!targetClient.createDirectory) {
        notifyError('当前 WebDAV 客户端不支持创建目录')
        return
      }

      setBusy(true)
      try {
        await targetClient.createDirectory(toClientDavPath(nextPath))
        await reloadRemoteState(client, config)
        setExpandedFolders((prev) => ({ ...prev, [nextPath]: true }))
        setStatus(`已创建目录：${nextPath}`)
      } catch (error) {
        notifyError('创建目录失败', error)
      } finally {
        setBusy(false)
      }
    },
    [client, config, notifyError, reloadRemoteState],
  )

  const renameNode = useCallback(
    async (targetPath: string, kind: ContextKind) => {
      if (!client || !config || kind === 'root') {
        return
      }

      const currentName = getBaseName(targetPath)
      const rawName = window.prompt('输入新名称：', currentName)
      if (!rawName) {
        return
      }

      let nextName = rawName.trim()
      if (!nextName) {
        return
      }

      const sourceFile = kind === 'file' ? fileMap.get(normalizeDavPath(targetPath)) : null
      if (kind === 'file' && sourceFile?.kind === 'markdown' && !/\.(md|markdown)$/i.test(nextName)) {
        nextName = `${nextName}.md`
      }

      const destinationPath = joinDavPath(parentDavPath(targetPath), nextName)
      if (destinationPath === normalizeDavPath(targetPath)) {
        return
      }

      const targetClient = client as WebDAVClient & {
        moveFile?: (from: string, to: string) => Promise<void>
      }
      if (!targetClient.moveFile) {
        notifyError('当前 WebDAV 客户端不支持重命名')
        return
      }

      setBusy(true)
      try {
        await targetClient.moveFile(toClientDavPath(targetPath), toClientDavPath(destinationPath))
        const preferredPath = activeFilePath === targetPath ? destinationPath : activeFilePath
        await reloadRemoteState(client, config, preferredPath)
        if (activeFilePath === targetPath) {
          setActiveFilePath(destinationPath)
        }
        setStatus(`已重命名：${currentName} -> ${nextName}`)
      } catch (error) {
        notifyError('重命名失败', error)
      } finally {
        setBusy(false)
      }
    },
    [activeFilePath, client, config, fileMap, notifyError, reloadRemoteState],
  )

  const deleteNode = useCallback(
    async (targetPath: string, kind: ContextKind) => {
      if (!client || !config || kind === 'root') {
        return
      }

      const confirmed = window.confirm(`确认删除 ${getBaseName(targetPath)} 吗？该操作不可撤销。`)
      if (!confirmed) {
        return
      }

      const targetClient = client as WebDAVClient & { deleteFile?: (path: string) => Promise<void> }
      if (!targetClient.deleteFile) {
        notifyError('当前 WebDAV 客户端不支持删除')
        return
      }

      setBusy(true)
      try {
        await targetClient.deleteFile(toClientDavPath(targetPath))
        const activeRemoved =
          activeFilePath === targetPath || activeFilePath.startsWith(`${normalizeDavPath(targetPath)}/`)
        const preferredPath = activeRemoved ? undefined : activeFilePath
        await reloadRemoteState(client, config, preferredPath)
        setStatus(`已删除：${targetPath}`)
      } catch (error) {
        notifyError('删除失败', error)
      } finally {
        setBusy(false)
      }
    },
    [activeFilePath, client, config, notifyError, reloadRemoteState],
  )

  const previewTypeLabel = previewDialog ? getPreviewTypeLabel(previewDialog.kind) : ''
  const canDownloadPreview = Boolean(previewDialog) && !previewDialog?.loading && !previewDialog?.error
  const toolbarDisabled = !canUseEditorActions

  return (
    <div className="h-full w-full bg-[var(--mf-bg)] text-[var(--mf-text)]">
      <div className="flex h-full w-full overflow-hidden">
        <FileTreeSidebar
          busy={busy}
          folderTree={folderTree}
          isConnected={isConnected}
          isFolderOpen={isFolderOpen}
          onLogout={onLogout}
          onOpenAttachmentSettings={openAttachmentSettingsDialog}
          onOpenConnectionSettings={() => setDialogOpen(true)}
          onOpenContextMenu={(event, path, kind) => {
            closeEditorContextMenu()
            if (kind === 'file') {
              const normalizedPath = normalizeDavPath(path)
              setSelectedFilePaths((prev) => (prev.includes(normalizedPath) ? prev : [normalizedPath]))
            }
            openFileTreeContextMenu(event, path, kind)
          }}
          onRefresh={() => {
            void onRefresh()
          }}
          onSelectFile={onSelectFile}
          onToggleFileSelection={onToggleFileSelection}
          onToggleFolder={onToggleFolder}
          onToggleSidebar={() => setSidebarCollapsed((prev) => !prev)}
          rootPath={rootPath}
          selectedFilePath={selectedFilePath}
          selectedFilePaths={selectedFilePathSet}
          sidebarCollapsed={sidebarCollapsed}
          sidebarStatusDotClass={sidebarStatusDotClass}
          sidebarStatusLabel={sidebarStatusLabel}
          sidebarStatusTextClass={sidebarStatusTextClass}
        />

        <main className="flex min-w-0 flex-1 flex-col bg-[var(--mf-main-shell-bg)]">
          <header className="flex min-h-[52px] flex-wrap items-center justify-between gap-3 border-b border-[var(--mf-panel-border)] bg-[var(--mf-main-toolbar-bg)] px-4">
            <div className="flex flex-wrap items-center gap-1.5">
              <Button
                variant="toolbar"
                size="icon"
                title="撤销"
                disabled={!canUseEditorActions}
                onClick={() => onToolbarAction('undo')}
              >
                <Undo2 className="h-4 w-4" />
              </Button>
              <Button
                variant="toolbar"
                size="icon"
                title="重做"
                disabled={!canUseEditorActions}
                onClick={() => onToolbarAction('redo')}
              >
                <Redo2 className="h-4 w-4" />
              </Button>
              <Separator orientation="vertical" className="mx-1 h-4" />
              <Button
                variant="toolbar"
                size="icon"
                title="标题 1"
                disabled={toolbarDisabled}
                onClick={() => onToolbarAction('h1')}
              >
                <Heading1 className="h-4 w-4" />
              </Button>
              <Button
                variant="toolbar"
                size="icon"
                title="标题 2"
                disabled={toolbarDisabled}
                onClick={() => onToolbarAction('h2')}
              >
                <Heading2 className="h-4 w-4" />
              </Button>
              <Button
                variant="toolbar"
                size="icon"
                title="粗体"
                disabled={toolbarDisabled}
                onClick={() => onToolbarAction('bold')}
              >
                <Bold className="h-4 w-4" />
              </Button>
              <Button
                variant="toolbar"
                size="icon"
                title="斜体"
                disabled={toolbarDisabled}
                onClick={() => onToolbarAction('italic')}
              >
                <Italic className="h-4 w-4" />
              </Button>
              <Button
                variant="toolbar"
                size="icon"
                title="无序列表"
                disabled={toolbarDisabled}
                onClick={() => onToolbarAction('bullet')}
              >
                <List className="h-4 w-4" />
              </Button>
              <Button
                variant="toolbar"
                size="icon"
                title="有序列表"
                disabled={toolbarDisabled}
                onClick={() => onToolbarAction('ordered')}
              >
                <ListOrdered className="h-4 w-4" />
              </Button>
              <Button
                variant="toolbar"
                size="icon"
                title="引用"
                disabled={toolbarDisabled}
                onClick={() => onToolbarAction('quote')}
              >
                <Quote className="h-4 w-4" />
              </Button>
              <Button
                variant="toolbar"
                size="icon"
                title="代码块"
                disabled={toolbarDisabled}
                onClick={() => onToolbarAction('code')}
              >
                <Code2 className="h-4 w-4" />
              </Button>
              <Button
                variant="toolbar"
                size="icon"
                title="表格"
                disabled={toolbarDisabled}
                onClick={() => onToolbarAction('table')}
              >
                <Table2 className="h-4 w-4" />
              </Button>
              <Button
                variant="toolbar"
                size="icon"
                title="任务列表"
                disabled={toolbarDisabled}
                onClick={() => onToolbarAction('task')}
              >
                <ListChecks className="h-4 w-4" />
              </Button>
              <Button
                variant="toolbar"
                size="icon"
                title="数学公式"
                disabled={toolbarDisabled}
                onClick={() => onToolbarAction('math')}
              >
                <Calculator className="h-4 w-4" />
              </Button>
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant={themePreference === 'system' ? 'toolbar' : 'toolbarAccent'}
                size="icon"
                title={themeButtonTitle}
                aria-label={themeButtonTitle}
                onClick={onToggleThemePreference}
              >
                <ThemePreferenceIcon className="h-4 w-4" />
              </Button>
              <Button
                variant="toolbar"
                size="icon"
                title={editorMode === 'wysiwyg' ? '切换到原文' : '切换到所见即所得'}
                aria-label={editorMode === 'wysiwyg' ? '切换到原文' : '切换到所见即所得'}
                disabled={!canEditDocument}
                onClick={() => {
                  if (editorMode === 'wysiwyg') {
                    setEditorMode('source')
                    requestAnimationFrame(() => sourceEditorRef.current?.focus())
                    return
                  }
                  setEditorMode('wysiwyg')
                  setWysiwygSyncVersion((prev) => prev + 1)
                }}
              >
                {editorMode === 'wysiwyg' ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </Button>
              <Button
                variant="toolbar"
                size="icon"
                title={isUploadingAttachment ? '附件上传中...' : '上传附件'}
                aria-label="上传附件"
                onClick={() => attachmentInputRef.current?.click()}
                disabled={!canUseEditorActions || isUploadingAttachment}
              >
                <Paperclip className={`h-4 w-4 ${isUploadingAttachment ? 'animate-pulse' : ''}`} />
              </Button>
              <input
                ref={attachmentInputRef}
                type="file"
                className="hidden"
                onChange={(event) => {
                  void onAttachmentInputChange(event)
                }}
              />
              <Button
                variant="toolbar"
                size="icon"
                className={`relative overflow-hidden text-[var(--mf-feedback)] hover:bg-[var(--mf-feedback-soft)] hover:text-[var(--mf-feedback-strong)] active:bg-[var(--mf-feedback-soft)] active:text-[var(--mf-feedback-strong)] ${
                  isSaving ? 'bg-[var(--mf-feedback-soft)] text-[var(--mf-feedback-strong)]' : ''
                }`}
                title={isSaving ? '保存中...' : '保存'}
                aria-label="保存"
                onClick={() => void onSave()}
                aria-busy={isSaving}
                disabled={!activeFilePath || busy || isSaving}
              >
                <Save className={`h-4 w-4 ${saveIconFlash ? 'mf-save-icon-flash' : ''}`} />
                {isSaving ? <span className="absolute bottom-0 left-1 right-1 h-[2px] rounded-full bg-[var(--mf-feedback)]" /> : null}
              </Button>
              <Dialog
                open={dialogOpen}
                onOpenChange={(nextOpen) => {
                  setDialogOpen(nextOpen)
                  if (nextOpen) {
                    const remembered = loadStoredConfig()
                    const source = config ?? remembered ?? EMPTY_CONFIG
                    setDraftConfig({
                      ...source,
                      attachments: normalizeAttachmentSettings(source.attachments),
                    })
                    setRememberCredentials(Boolean(config ?? remembered))
                    setShowPassword(false)
                  }
                }}
              >
                <DialogTrigger asChild>
                  <Button variant="toolbar" size="icon" title="WebDAV 设定" aria-label="WebDAV 设定">
                    <Settings2 className="h-4 w-4" />
                  </Button>
                </DialogTrigger>
                <DialogContent className="h-auto w-[calc(100vw-24px)] max-w-[900px] overflow-hidden rounded-[20px] border-[var(--mf-panel-border)] bg-[var(--mf-config-shell-bg)] p-0 shadow-none md:h-[560px] [&>button:last-child]:hidden">
                  <DialogTitle className="sr-only">WebDAV 连接设置</DialogTitle>
                  <DialogDescription className="sr-only">填写 URL、用户名和密码以连接远程 WebDAV 目录。</DialogDescription>
                  <button
                    type="button"
                    aria-label="关闭配置窗口"
                    title="关闭配置窗口"
                    onClick={() => setDialogOpen(false)}
                    className="absolute right-2 top-2 z-10 inline-flex h-8 w-8 items-center justify-center rounded-full bg-transparent text-[16px] font-semibold leading-none text-[var(--mf-muted-soft)] transition-colors hover:bg-[var(--mf-panel-hover)]"
                  >
                    ×
                  </button>
                  <div className="grid md:h-full md:grid-cols-[520px_380px]">
                    <div className="hidden h-full flex-col items-center justify-center gap-[18px] rounded-[20px] bg-[var(--mf-config-hero-bg)] px-6 py-8 md:flex">
                      <p className="text-[42px] font-semibold leading-[1.06] tracking-[-0.01em] text-[var(--mf-brand-title)]">[WebDAV] Hello World!</p>
                      <p className="text-[16px] text-[var(--mf-brand-subtitle)]">Secure sync for your markdown workspace</p>
                      <div className="w-fit overflow-hidden rounded-[16px] border border-[var(--mf-brand-soft-border)]">
                        <img src="/heroCard1.png" alt="WebDAV hero card" className="h-[220px] w-[320px] object-cover" />
                      </div>
                    </div>

                    <div className="flex h-full min-h-[520px] flex-col items-center justify-center rounded-[20px] bg-[var(--mf-config-form-bg)] px-6 py-8 sm:px-9 md:min-h-0 md:px-9 md:py-12">
                      <div className="w-full max-w-[320px]">
                        <p className="text-center text-[32px] font-bold leading-none text-[var(--mf-field-text)]">MarkFlow~</p>
                      </div>

                      <div className="mt-[14px] grid w-full max-w-[320px] gap-[10px]">
                        <div className="grid gap-[6px]">
                          <Label htmlFor="webdav-url" className="text-[11px] font-medium text-[var(--mf-muted)]">
                            URL
                          </Label>
                          <Input
                            id="webdav-url"
                            placeholder="https://dav.example.com"
                            className="h-[42px] rounded-[6px] border-[var(--mf-field-border)] bg-[var(--mf-field-bg)] px-3 text-[13px] text-[var(--mf-field-text)] placeholder:text-[var(--mf-field-placeholder)] focus-visible:border-[var(--mf-field-focus)] focus-visible:ring-[var(--mf-field-focus-ring)]"
                            value={draftConfig.url}
                            onChange={(event) =>
                              setDraftConfig((prev) => ({
                                ...prev,
                                url: event.target.value,
                              }))
                            }
                          />
                        </div>

                        <div className="grid gap-[6px]">
                          <Label htmlFor="webdav-username" className="text-[11px] font-medium text-[var(--mf-muted)]">
                            用户名（可选）
                          </Label>
                          <Input
                            id="webdav-username"
                            placeholder="admin"
                            className="h-[42px] rounded-[6px] border-[var(--mf-field-border)] bg-[var(--mf-field-bg)] px-3 text-[13px] text-[var(--mf-field-text)] placeholder:text-[var(--mf-field-placeholder)] focus-visible:border-[var(--mf-field-focus)] focus-visible:ring-[var(--mf-field-focus-ring)]"
                            value={draftConfig.username}
                            onChange={(event) =>
                              setDraftConfig((prev) => ({
                                ...prev,
                                username: event.target.value,
                              }))
                            }
                          />
                        </div>

                        <div className="grid gap-[6px]">
                          <Label htmlFor="webdav-password" className="text-[11px] font-medium text-[var(--mf-muted)]">
                            密码（可选）
                          </Label>
                          <div className="relative">
                            <Input
                              id="webdav-password"
                              type={showPassword ? 'text' : 'password'}
                              placeholder="••••••••"
                              className="h-[42px] rounded-[6px] border-[var(--mf-field-border)] bg-[var(--mf-field-bg)] px-3 pr-9 text-[13px] text-[var(--mf-field-text)] placeholder:text-[var(--mf-field-placeholder)] focus-visible:border-[var(--mf-field-focus)] focus-visible:ring-[var(--mf-field-focus-ring)]"
                              value={draftConfig.password}
                              onChange={(event) =>
                                setDraftConfig((prev) => ({
                                  ...prev,
                                  password: event.target.value,
                                }))
                              }
                            />
                            <button
                              type="button"
                              onClick={() => setShowPassword((prev) => !prev)}
                              className="absolute right-2 top-1/2 inline-flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-[4px] text-[var(--mf-muted)] hover:bg-[var(--mf-panel-border)]"
                              aria-label={showPassword ? '隐藏密码' : '显示密码'}
                              title={showPassword ? '隐藏密码' : '显示密码'}
                            >
                              <Eye className="h-3 w-3" />
                            </button>
                          </div>
                        </div>

                        <label className="inline-flex cursor-pointer items-center gap-2 pt-[2px] text-[13px] text-[var(--mf-muted-strong)]">
                          <input
                            type="checkbox"
                            checked={rememberCredentials}
                            onChange={(event) => setRememberCredentials(event.target.checked)}
                            className="h-4 w-4 rounded-[4px] border border-[var(--mf-preview-border)] accent-[var(--mf-brand)]"
                          />
                          记住连接凭证
                        </label>

                        <Button
                          className="h-[42px] rounded-[6px] border border-[var(--mf-feedback-soft-border)] bg-[var(--mf-feedback)] text-[16px] font-semibold text-[var(--mf-feedback-contrast)] hover:bg-[var(--mf-feedback-strong)]"
                          onClick={() => {
                            const nextConfig = {
                              ...draftConfig,
                              attachments: normalizeAttachmentSettings(draftConfig.attachments),
                              rootPath: normalizeRootPath(draftConfig.rootPath),
                              url: normalizeUrl(draftConfig.url),
                            }
                            void connectWebdav(nextConfig, { persist: rememberCredentials }).then((ok) => {
                              if (ok) {
                                setDialogOpen(false)
                              }
                            })
                          }}
                          disabled={busy}
                        >
                          登录
                        </Button>
                      </div>
                    </div>
                  </div>
                </DialogContent>
              </Dialog>
              <Button
                variant="toolbar"
                size="icon"
                title={isConnected ? '登出' : '登录'}
                aria-label={isConnected ? '登出' : '登录'}
                onClick={isConnected ? onLogout : () => setDialogOpen(true)}
              >
                {isConnected ? <LogOut className="h-4 w-4" /> : <LogIn className="h-4 w-4" />}
              </Button>
            </div>
          </header>

          <section className="flex-1 overflow-hidden bg-[var(--mf-main-content-bg)] p-6">
            <div
              className="h-full rounded-[10px] border border-[var(--mf-panel-border)] bg-[var(--mf-panel-bg)] p-3 shadow-[var(--mf-shadow-soft)]"
            >
              <div className="h-full overflow-hidden rounded-[8px] bg-[var(--mf-surface)]">
                {!isConnected ? (
                  <div className="flex h-full items-center justify-center px-6 text-sm text-[var(--mf-muted)]">
                    连接成功后才能编辑文档
                  </div>
                ) : !activeFilePath ? (
                  <div className="flex h-full items-center justify-center px-6 text-sm text-[var(--mf-muted)]">
                    请选择一个 Markdown 文件进行编辑，或点击文本/图片/视频/音频/PDF 文件进行预览
                  </div>
                ) : editorMode === 'source' ? (
                  <textarea
                    ref={sourceEditorRef}
                    className={`h-full w-full resize-none border-none p-6 font-mono text-sm leading-7 outline-none ${
                      canUseEditorActions
                        ? 'bg-transparent text-[var(--mf-text)]'
                        : 'bg-[var(--mf-surface-muted)] text-[var(--mf-muted)]'
                    }`}
                    value={content}
                    readOnly={!canUseEditorActions}
                    spellCheck={false}
                    autoCorrect="off"
                    autoCapitalize="off"
                    onChange={(event) => setContentWithHistory(event.target.value)}
                    onContextMenu={onSourceEditorContextMenu}
                    onPasteCapture={onSourcePasteCapture}
                    placeholder="开始书写 Markdown..."
                  />
                ) : (
                  <WysiwygMarkdownEditor
                    editable={canUseEditorActions}
                    markdown={content}
                    onApiChange={(api) => {
                      wysiwygApiRef.current = api
                    }}
                    syncVersion={wysiwygSyncVersion}
                    onChange={(nextValue) => setContentWithHistory(nextValue)}
                    onContextMenu={onWysiwygEditorContextMenu}
                    onImageUpload={onWysiwygImageUpload}
                    onPasteCapture={onWysiwygPasteCapture}
                    resolveImageSrc={resolveImageSrc}
                  />
                )}
              </div>
            </div>
          </section>

          <footer className="flex h-8 items-center justify-between border-t border-[var(--mf-border)] px-4 text-xs text-[var(--mf-muted)]">
            <div className="flex items-center gap-2">
              <FilePenLine className="h-3.5 w-3.5" />
              <span>{content.length} 字符</span>
            </div>
            <span title={status}>{busy ? '处理中...' : isSaving ? '保存中...' : isUploadingAttachment ? '上传附件中...' : status}</span>
          </footer>
        </main>
      </div>

      <Dialog open={attachmentDialogOpen} onOpenChange={setAttachmentDialogOpen}>
        <DialogContent className="w-[calc(100vw-24px)] max-w-[420px] rounded-[16px] border-[var(--mf-panel-border)] bg-[var(--mf-panel-bg)] p-5">
          <DialogTitle className="text-[18px] font-semibold text-[var(--mf-field-text)]">附件存储设置</DialogTitle>
          <DialogDescription className="text-[13px] text-[var(--mf-muted)]">
            配置截图和附件上传到 WebDAV 的目录与链接格式。
          </DialogDescription>

          <div className="mt-3 grid gap-3">
            <div className="grid gap-[6px]">
              <Label htmlFor="sidebar-attachment-storage-mode" className="text-[12px] font-medium text-[var(--mf-muted)]">
                附件存储方式
              </Label>
              <select
                id="sidebar-attachment-storage-mode"
                className="h-[42px] rounded-[6px] border border-[var(--mf-field-border)] bg-[var(--mf-field-bg)] px-3 text-[13px] text-[var(--mf-field-text)] focus-visible:border-[var(--mf-field-focus)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--mf-field-focus-ring)]"
                value={draftAttachmentSettings.storageMode}
                onChange={(event) =>
                  setDraftAttachmentSettings((prev) => ({
                    ...prev,
                    storageMode: event.target.value as AttachmentStorageMode,
                  }))
                }
              >
                <option value="same_dir_assets">同目录 _assets（推荐）</option>
                <option value="root_attachments">统一 /_attachments</option>
                <option value="doc_assets">文档同名 .assets</option>
              </select>
            </div>

            <div className="grid gap-[6px]">
              <Label htmlFor="sidebar-attachment-link-format" className="text-[12px] font-medium text-[var(--mf-muted)]">
                附件链接格式
              </Label>
              <select
                id="sidebar-attachment-link-format"
                className="h-[42px] rounded-[6px] border border-[var(--mf-field-border)] bg-[var(--mf-field-bg)] px-3 text-[13px] text-[var(--mf-field-text)] focus-visible:border-[var(--mf-field-focus)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--mf-field-focus-ring)]"
                value={draftAttachmentSettings.linkFormat}
                onChange={(event) =>
                  setDraftAttachmentSettings((prev) => ({
                    ...prev,
                    linkFormat: event.target.value as AttachmentLinkFormat,
                  }))
                }
              >
                <option value="relative">相对路径（推荐）</option>
                <option value="root_relative">根相对路径</option>
                <option value="absolute_url">完整 URL</option>
              </select>
            </div>

            <div className="grid gap-[6px]">
              <Label htmlFor="sidebar-attachment-folder-name" className="text-[12px] font-medium text-[var(--mf-muted)]">
                附件目录名
              </Label>
              <Input
                id="sidebar-attachment-folder-name"
                placeholder="_assets"
                className="h-[42px] rounded-[6px] border-[var(--mf-field-border)] bg-[var(--mf-field-bg)] px-3 text-[13px] text-[var(--mf-field-text)] placeholder:text-[var(--mf-field-placeholder)] focus-visible:border-[var(--mf-field-focus)] focus-visible:ring-[var(--mf-field-focus-ring)]"
                value={draftAttachmentSettings.folderName}
                onChange={(event) =>
                  setDraftAttachmentSettings((prev) => ({
                    ...prev,
                    folderName: sanitizeAttachmentFolderName(event.target.value),
                  }))
                }
              />
            </div>

            <div className="grid gap-[6px]">
              <Label htmlFor="sidebar-attachment-max-size" className="text-[12px] font-medium text-[var(--mf-muted)]">
                附件大小上限（MB）
              </Label>
              <Input
                id="sidebar-attachment-max-size"
                type="number"
                min={1}
                max={1024}
                className="h-[42px] rounded-[6px] border-[var(--mf-field-border)] bg-[var(--mf-field-bg)] px-3 text-[13px] text-[var(--mf-field-text)] placeholder:text-[var(--mf-field-placeholder)] focus-visible:border-[var(--mf-field-focus)] focus-visible:ring-[var(--mf-field-focus-ring)]"
                value={draftAttachmentSettings.maxSizeMB}
                onChange={(event) =>
                  setDraftAttachmentSettings((prev) => ({
                    ...prev,
                    maxSizeMB: Math.max(1, Math.min(1024, Number(event.target.value) || 1)),
                  }))
                }
              />
            </div>
          </div>

          <p className="mt-4 text-[12px] text-[var(--mf-warning-strong)]">
            可清理当前附件目录下未被任何 Markdown 引用的附件文件。
          </p>

          <div className="mt-3 flex items-center justify-between gap-2">
            <Button
              variant="outline"
              className="border-[var(--mf-danger-soft-border)] text-[var(--mf-danger-strong)] hover:bg-[var(--mf-danger-surface)]"
              onClick={() => {
                void onCleanupUnusedAttachments()
              }}
              disabled={!isConnected || isCleaningAttachments || busy}
            >
              {isCleaningAttachments ? '清理中...' : '清理未引用附件'}
            </Button>
            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={() => setAttachmentDialogOpen(false)}>
                取消
              </Button>
              <Button
                className="border border-[var(--mf-feedback-soft-border)] bg-[var(--mf-feedback)] text-[var(--mf-feedback-contrast)] hover:bg-[var(--mf-feedback-strong)]"
                onClick={onSaveAttachmentSettings}
              >
                保存
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(previewDialog)}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) {
            closePreviewDialog()
          }
        }}
      >
        <DialogContent className="h-[min(78vh,640px)] w-[calc(100vw-24px)] max-w-[760px] overflow-hidden rounded-[16px] border-[var(--mf-panel-border)] bg-[var(--mf-panel-bg)] p-0">
          <DialogTitle className="sr-only">文件预览</DialogTitle>
          <DialogDescription className="sr-only">预览文本、图片、视频、音频和 PDF 文件。</DialogDescription>

          {previewDialog ? (
            <div className="flex h-full flex-col">
              <div className="flex items-center gap-3 border-b border-[var(--mf-panel-border)] px-4 py-3 pr-14">
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <p className="truncate text-sm font-semibold text-[var(--mf-field-text)]">{previewDialog.file.name}</p>
                    <span className="shrink-0 rounded-full bg-[var(--mf-brand-soft)] px-2 py-1 text-[11px] font-medium text-[var(--mf-brand-deep)]">
                      {previewTypeLabel}
                    </span>
                  </div>
                  <p className="truncate text-xs text-[var(--mf-muted)]">{previewDialog.file.path}</p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 shrink-0"
                  onClick={() => {
                    void downloadPreviewFile()
                  }}
                  disabled={!canDownloadPreview}
                  title="下载原文件"
                >
                  <Download className="h-3.5 w-3.5" />
                  <span className="ml-1 text-xs">下载</span>
                </Button>
              </div>

              <div className="min-h-0 flex-1 overflow-auto bg-[var(--mf-panel-soft)] p-4">
                {previewDialog.loading ? (
                  <div className="flex h-full min-h-[220px] items-center justify-center gap-2 text-sm text-[var(--mf-muted-soft)]">
                    <RefreshCw className="h-4 w-4 animate-spin" />
                    <span>加载预览中...</span>
                  </div>
                ) : previewDialog.error ? (
                  <div className="flex h-full min-h-[220px] items-center justify-center">
                    <p className="rounded-[8px] border border-[var(--mf-danger-soft-border)] bg-[var(--mf-danger-surface)] px-3 py-2 text-sm text-[var(--mf-danger-strong)]">
                      预览失败：{previewDialog.error}
                    </p>
                  </div>
                ) : previewDialog.kind === 'text' ? (
                  <pre className="h-full min-h-[220px] whitespace-pre-wrap break-words rounded-[8px] border border-[var(--mf-preview-border)] bg-[var(--mf-panel-bg)] p-4 font-mono text-[13px] leading-6 text-[var(--mf-field-text)]">
                    {previewDialog.textContent || '（空文本文件）'}
                  </pre>
                ) : previewDialog.kind === 'image' ? (
                  <div className="flex h-full min-h-[220px] items-center justify-center">
                    <img
                      src={previewDialog.objectUrl}
                      alt={previewDialog.file.name}
                      className="max-h-full max-w-full rounded-[8px] border border-[var(--mf-preview-border)] bg-[var(--mf-panel-bg)] object-contain shadow-sm"
                    />
                  </div>
                ) : previewDialog.kind === 'audio' ? (
                  <div className="flex h-full min-h-[220px] items-center justify-center">
                    <audio src={previewDialog.objectUrl} controls className="w-full max-w-[560px]" />
                  </div>
                ) : previewDialog.kind === 'pdf' ? (
                  <iframe
                    src={previewDialog.objectUrl}
                    className="h-full min-h-[220px] w-full rounded-[8px] border border-[var(--mf-preview-border)] bg-[var(--mf-panel-bg)]"
                    title={previewDialog.file.name}
                  />
                ) : (
                  <div className="h-full min-h-[220px]">
                    <video
                      src={previewDialog.objectUrl}
                      controls
                      className="h-full w-full rounded-[8px] border border-[var(--mf-preview-border)] bg-[var(--mf-preview-video-bg)]"
                    />
                  </div>
                )}
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <EditorContextMenu
        canUseEditorActions={canUseEditorActions}
        editorContextMenu={editorContextMenu}
        editorContextPosition={editorContextPosition}
        editorMenuActionClass={editorMenuActionClass}
        editorMenuActionDisabledClass={editorMenuActionDisabledClass}
        hasEditorImageTarget={hasEditorImageTarget}
        onApplyCustomImageRatio={onApplyCustomImageRatio}
        onCopyFromEditor={onCopyFromEditor}
        onCutFromEditor={onCutFromEditor}
        onPastePlainTextInEditor={onPastePlainTextInEditor}
        onPasteWithFormattingInEditor={onPasteWithFormattingInEditor}
        onResizeImage={applyEditorImageRatio}
        onSelectAllInEditor={onSelectAllInEditor}
      />

      <FileTreeContextMenu
        contextMenu={contextMenu}
        contextPosition={contextPosition}
        createTargetPath={createTargetPath}
        menuPath={menuPath}
        onClose={() => setContextMenu(null)}
        onCreateFolder={createFolder}
        onCreateMarkdownFile={createMarkdownFile}
        onDelete={deleteNode}
        onRefresh={onRefresh}
        onRename={renameNode}
        onSelectFile={onSelectFile}
        openFileMenuLabel={openFileMenuLabel}
      />
    </div>
  )
}

export default App
