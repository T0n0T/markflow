import {
  type MouseEvent as ReactMouseEvent,
  type ReactElement,
  type ChangeEvent,
  type ClipboardEvent as ReactClipboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { Crepe } from '@milkdown/crepe'
import { commandsCtx } from '@milkdown/kit/core'
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
import {
  Bold,
  Calculator,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Code2,
  Download,
  Eye,
  EyeOff,
  File as FileIcon,
  FilePenLine,
  FileText,
  Folder,
  FolderOpen,
  FolderX,
  Heading1,
  Heading2,
  Image as ImageIcon,
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
  Video as VideoIcon,
} from 'lucide-react'
import { createClient, type WebDAVClient } from 'webdav'

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
  buildAttachmentTarget,
  type AttachmentSettings,
  type AttachmentStorageMode,
  type AttachmentLinkFormat,
  DEFAULT_ATTACHMENT_SETTINGS,
  normalizeAttachmentSettings,
  resolveMarkdownLinkToDavPath,
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
import '@milkdown/crepe/theme/common/style.css'
import '@milkdown/crepe/theme/frame.css'

type DavConfig = {
  attachments: AttachmentSettings
  url: string
  username: string
  password: string
  rootPath: string
}

type DavListItem = {
  basename?: string
  filename: string
  type: 'file' | 'directory'
}

type RemoteFileKind = 'markdown' | 'text' | 'image' | 'video' | 'audio' | 'pdf' | 'other'

type RemoteFile = {
  kind: RemoteFileKind
  name: string
  path: string
}

type FolderNode = {
  folders: FolderNode[]
  fullPath: string
  name: string
  files: RemoteFile[]
}

type RemoteSnapshot = {
  directories: string[]
  files: RemoteFile[]
}

type PreviewFileKind = 'text' | 'image' | 'video' | 'audio' | 'pdf'

type PreviewDialogState = {
  error: string
  file: RemoteFile
  kind: PreviewFileKind
  loading: boolean
  objectUrl: string
  textContent: string
}

type EditorMode = 'wysiwyg' | 'source'
type ToolbarAction =
  | 'undo'
  | 'redo'
  | 'h1'
  | 'h2'
  | 'bold'
  | 'italic'
  | 'bullet'
  | 'ordered'
  | 'quote'
  | 'code'
  | 'table'
  | 'task'
  | 'math'

type UploadAttachmentResult = {
  davPath: string
  link: string
}

type WysiwygEditorApi = {
  applyToolbarAction: (action: ToolbarAction) => boolean
  insertMarkdown: (snippet: string) => boolean
}

type ContextKind = 'file' | 'directory' | 'root'

type ContextMenuState = {
  kind: ContextKind
  path: string
  x: number
  y: number
}

const CONFIG_KEY = 'markflow.webdav.config'
const DEFAULT_ROOT_PATH = '/'
const DEFAULT_MARKDOWN = '# 会议记录\n\n- WebDAV 已连接\n\n- 今日目标：编辑 markdown 文件并同步到云端\n'
const MENU_WIDTH = 220
const MENU_HEIGHT = 250
const THEME_PREFERENCE_ORDER: ThemePreference[] = ['system', 'light', 'dark']
const THEME_PREFERENCE_LABEL: Record<ThemePreference, string> = {
  dark: '深色',
  light: '浅色',
  system: '跟随系统',
}
const MARKDOWN_FILE_EXTENSIONS = new Set(['md', 'markdown'])
const TEXT_FILE_EXTENSIONS = new Set([
  'txt',
  'text',
  'log',
  'json',
  'yaml',
  'yml',
  'xml',
  'html',
  'htm',
  'css',
  'js',
  'jsx',
  'ts',
  'tsx',
  'csv',
  'ini',
  'conf',
  'sh',
  'py',
  'java',
  'c',
  'cpp',
  'h',
  'hpp',
  'sql',
  'toml',
  'env',
])
const IMAGE_FILE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif'])
const VIDEO_FILE_EXTENSIONS = new Set(['mp4', 'webm', 'ogv', 'mov', 'm4v', 'mkv'])
const AUDIO_FILE_EXTENSIONS = new Set(['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac'])
const MIME_TYPE_BY_EXTENSION: Record<string, string> = {
  aac: 'audio/aac',
  avif: 'image/avif',
  bmp: 'image/bmp',
  flac: 'audio/flac',
  gif: 'image/gif',
  ico: 'image/x-icon',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  m4v: 'video/mp4',
  m4a: 'audio/mp4',
  mkv: 'video/x-matroska',
  mov: 'video/quicktime',
  mp3: 'audio/mpeg',
  mp4: 'video/mp4',
  ogg: 'audio/ogg',
  ogv: 'video/ogg',
  pdf: 'application/pdf',
  png: 'image/png',
  svg: 'image/svg+xml',
  wav: 'audio/wav',
  webm: 'video/webm',
  webp: 'image/webp',
}

const EMPTY_CONFIG: DavConfig = {
  attachments: DEFAULT_ATTACHMENT_SETTINGS,
  rootPath: DEFAULT_ROOT_PATH,
  url: '',
  username: '',
  password: '',
}

function normalizeUrl(url: string) {
  return url.trim().replace(/\/+$/, '')
}

function ensureDavBaseUrl(url: string) {
  const normalized = normalizeUrl(url)
  if (!normalized) {
    return normalized
  }
  return normalized.endsWith('/') ? normalized : `${normalized}/`
}

function normalizeRootPath(path: string) {
  const trimmed = path.trim()
  if (!trimmed || trimmed === '/') {
    return '/'
  }
  return `/${trimmed.replace(/^\/+/, '').replace(/\/+$/, '')}`
}

function normalizeDavPath(path: string) {
  const trimmed = path.trim()
  if (!trimmed || trimmed === '/') {
    return '/'
  }
  return `/${trimmed.replace(/^\/+/, '').replace(/\/+$/, '')}`
}

function toClientDavPath(path: string) {
  const normalizedPath = normalizeDavPath(path)
  if (normalizedPath === '/') {
    return ''
  }
  return normalizedPath.replace(/^\/+/, '')
}

function toDavPathname(value: string) {
  const trimmed = value.trim()
  if (!trimmed) {
    return '/'
  }

  const decoded = (() => {
    try {
      return decodeURIComponent(trimmed)
    } catch {
      return trimmed
    }
  })()

  try {
    return new URL(decoded, 'http://localhost').pathname || '/'
  } catch {
    return decoded
  }
}

function getRemoteBasePath(url: string) {
  try {
    return normalizeDavPath(new URL(url).pathname || '/')
  } catch {
    return '/'
  }
}

function toAppDavPath(remotePath: string, remoteBasePath: string) {
  const normalizedPath = normalizeDavPath(toDavPathname(remotePath))
  const normalizedBasePath = normalizeDavPath(remoteBasePath)

  if (normalizedBasePath === '/') {
    return normalizedPath
  }

  if (normalizedPath === normalizedBasePath) {
    return '/'
  }

  if (normalizedPath.startsWith(`${normalizedBasePath}/`)) {
    return normalizeDavPath(normalizedPath.slice(normalizedBasePath.length))
  }

  return normalizedPath
}

function joinDavPath(basePath: string, segment: string) {
  const base = normalizeDavPath(basePath)
  const part = segment.trim().replace(/^\/+/, '')

  if (!part) {
    return base
  }

  if (base === '/') {
    return `/${part}`
  }

  return `${base}/${part}`
}

function parentDavPath(path: string) {
  const normalized = normalizeDavPath(path)
  if (normalized === '/') {
    return '/'
  }
  const next = normalized.split('/').slice(0, -1).join('/')
  return next ? normalizeDavPath(next) : '/'
}

function getBaseName(path: string) {
  return normalizeDavPath(path).split('/').filter(Boolean).pop() ?? '/'
}

function getFileExtension(path: string) {
  const baseName = getBaseName(path).toLowerCase()
  const dotIndex = baseName.lastIndexOf('.')
  if (dotIndex <= 0 || dotIndex >= baseName.length - 1) {
    return ''
  }
  return baseName.slice(dotIndex + 1)
}

function inferRemoteFileKind(path: string): RemoteFileKind {
  const extension = getFileExtension(path)

  if (MARKDOWN_FILE_EXTENSIONS.has(extension)) {
    return 'markdown'
  }
  if (TEXT_FILE_EXTENSIONS.has(extension)) {
    return 'text'
  }
  if (IMAGE_FILE_EXTENSIONS.has(extension)) {
    return 'image'
  }
  if (VIDEO_FILE_EXTENSIONS.has(extension)) {
    return 'video'
  }
  if (AUDIO_FILE_EXTENSIONS.has(extension)) {
    return 'audio'
  }
  if (extension === 'pdf') {
    return 'pdf'
  }

  return 'other'
}

function toPreviewFileKind(kind: RemoteFileKind): PreviewFileKind | null {
  if (kind === 'text' || kind === 'image' || kind === 'video' || kind === 'audio' || kind === 'pdf') {
    return kind
  }
  return null
}

function getMimeTypeForFile(path: string, kind: PreviewFileKind) {
  const extension = getFileExtension(path)
  const byExtension = MIME_TYPE_BY_EXTENSION[extension]
  if (byExtension) {
    return byExtension
  }

  if (kind === 'image') {
    return 'image/*'
  }
  if (kind === 'video') {
    return 'video/*'
  }
  if (kind === 'audio') {
    return 'audio/*'
  }
  if (kind === 'pdf') {
    return 'application/pdf'
  }
  return 'text/plain'
}

function getPreviewTypeLabel(kind: PreviewFileKind) {
  if (kind === 'text') {
    return '文本'
  }
  if (kind === 'image') {
    return '图片'
  }
  if (kind === 'video') {
    return '视频'
  }
  if (kind === 'audio') {
    return '音频'
  }
  return 'PDF'
}

function getNextThemePreference(preference: ThemePreference): ThemePreference {
  const currentIndex = THEME_PREFERENCE_ORDER.indexOf(preference)
  if (currentIndex < 0) {
    return THEME_PREFERENCE_ORDER[0]
  }
  return THEME_PREFERENCE_ORDER[(currentIndex + 1) % THEME_PREFERENCE_ORDER.length]
}

function extractMarkdownLinkTargets(markdown: string) {
  const targets: string[] = []
  const inlineLinkPattern = /!?\[[^\]]*]\(([^)\n]+)\)/g

  for (const match of markdown.matchAll(inlineLinkPattern)) {
    const rawValue = match[1]?.trim()
    if (!rawValue) {
      continue
    }

    let target = rawValue
    if (target.startsWith('<')) {
      const closingIndex = target.indexOf('>')
      if (closingIndex > 0) {
        target = target.slice(1, closingIndex).trim()
      }
    } else {
      const firstSpace = target.search(/\s/)
      if (firstSpace > 0) {
        target = target.slice(0, firstSpace)
      }
    }

    if (target) {
      targets.push(target)
    }
  }

  return targets
}

function resolveAttachmentLinkToDavPath(link: string, activeMarkdownPath: string, baseUrl: string) {
  const resolved = resolveMarkdownLinkToDavPath(link, activeMarkdownPath)
  if (resolved) {
    return normalizeDavPath(resolved)
  }

  const raw = link.trim()
  if (!raw || raw.startsWith('#')) {
    return null
  }

  try {
    const linkUrl = new URL(raw)
    const base = new URL(ensureDavBaseUrl(baseUrl))
    if (linkUrl.origin !== base.origin) {
      return null
    }

    const remoteBasePath = getRemoteBasePath(baseUrl)
    return normalizeDavPath(toAppDavPath(linkUrl.pathname, remoteBasePath))
  } catch {
    return null
  }
}

function isManagedAttachmentFilePath(path: string, settings: AttachmentSettings, rootPath: string) {
  const normalizedPath = normalizeDavPath(path)
  const normalizedRoot = normalizeRootPath(rootPath)
  if (!isPathInsideRoot(normalizedPath, normalizedRoot)) {
    return false
  }

  const folderName = sanitizeAttachmentFolderName(settings.folderName)
  const segments = getRelativePath(normalizedPath, normalizedRoot).split('/').filter(Boolean)
  if (segments.length === 0) {
    return false
  }

  if (settings.storageMode === 'root_attachments') {
    return segments.length >= 2 && segments[0] === folderName
  }

  if (settings.storageMode === 'same_dir_assets') {
    for (let i = 0; i < segments.length; i += 1) {
      if (segments[i] === folderName && i <= segments.length - 3) {
        return true
      }
    }
    return false
  }

  for (let i = 0; i < segments.length - 1; i += 1) {
    if (segments[i].endsWith('.assets')) {
      return true
    }
  }
  return false
}

function pickMarkdownTargetPath(files: RemoteFile[], preferredPath?: string, currentPath?: string) {
  const markdownPaths = files.filter((item) => item.kind === 'markdown').map((item) => item.path)
  if (markdownPaths.length === 0) {
    return ''
  }

  if (preferredPath) {
    const normalizedPreferred = normalizeDavPath(preferredPath)
    if (markdownPaths.includes(normalizedPreferred)) {
      return normalizedPreferred
    }
  }

  if (currentPath) {
    const normalizedCurrent = normalizeDavPath(currentPath)
    if (markdownPaths.includes(normalizedCurrent)) {
      return normalizedCurrent
    }
  }

  return markdownPaths[0]
}

function isPathInsideRoot(path: string, rootPath: string) {
  const normalizedPath = normalizeDavPath(path)
  const normalizedRoot = normalizeRootPath(rootPath)

  if (normalizedRoot === '/') {
    return true
  }

  return normalizedPath === normalizedRoot || normalizedPath.startsWith(`${normalizedRoot}/`)
}

function getRelativePath(fullPath: string, rootPath: string) {
  const normalizedPath = normalizeDavPath(fullPath)
  const normalizedRoot = normalizeRootPath(rootPath)

  if (normalizedRoot === '/') {
    return normalizedPath.replace(/^\//, '')
  }

  if (normalizedPath === normalizedRoot) {
    return ''
  }

  if (normalizedPath.startsWith(`${normalizedRoot}/`)) {
    return normalizedPath.slice(normalizedRoot.length + 1)
  }

  return normalizedPath.replace(/^\//, '')
}

function buildFolderTree(files: RemoteFile[], directories: string[], rootPath: string): FolderNode {
  const normalizedRoot = normalizeRootPath(rootPath)
  const root: FolderNode = {
    folders: [],
    fullPath: normalizedRoot,
    name: '/',
    files: [],
  }

  const ensureFolder = (absolutePath: string) => {
    const normalizedPath = normalizeDavPath(absolutePath)
    if (!isPathInsideRoot(normalizedPath, normalizedRoot) || normalizedPath === normalizedRoot) {
      return root
    }

    const relative = getRelativePath(normalizedPath, normalizedRoot)
    const segments = relative.split('/').filter(Boolean)

    let current = root
    let currentPath = normalizedRoot === '/' ? '' : normalizedRoot
    for (const segment of segments) {
      currentPath = `${currentPath}/${segment}`.replace(/\/+/g, '/')
      const fullPath = normalizeDavPath(currentPath)
      let found = current.folders.find((item) => item.fullPath === fullPath)
      if (!found) {
        found = {
          folders: [],
          fullPath,
          name: segment,
          files: [],
        }
        current.folders.push(found)
      }
      current = found
    }
    return current
  }

  ensureFolder(normalizedRoot)
  directories.forEach((item) => ensureFolder(item))

  for (const file of files) {
    const folderPath = parentDavPath(file.path)
    const target = ensureFolder(folderPath)
    target.files.push({
      kind: file.kind,
      name: file.name,
      path: normalizeDavPath(file.path),
    })
  }

  const sortTree = (node: FolderNode) => {
    node.folders.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
    node.files.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
    node.folders.forEach(sortTree)
  }

  sortTree(root)
  return root
}

function parseErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message
  }
  return '未知错误'
}

function getErrorStatus(error: unknown): number | null {
  if (typeof error !== 'object' || error === null) {
    return null
  }

  if ('status' in error && typeof (error as { status?: unknown }).status === 'number') {
    return (error as { status: number }).status
  }

  if ('response' in error) {
    const response = (error as { response?: unknown }).response
    if (typeof response === 'object' && response !== null && 'status' in response) {
      const value = (response as { status?: unknown }).status
      if (typeof value === 'number') {
        return value
      }
    }
  }

  return null
}

function isMethodUnsupported(error: unknown) {
  const status = getErrorStatus(error)
  if (status === 405 || status === 501) {
    return true
  }

  const message = parseErrorMessage(error)
  return /\b(405|501)\b/.test(message) || /method not allowed|not supported/i.test(message)
}

function shouldFallbackCreateFileForAList(error: unknown) {
  const status = getErrorStatus(error)
  if (status === 400) {
    return true
  }

  if (isMethodUnsupported(error)) {
    return true
  }

  const message = parseErrorMessage(error)
  return /if-none-match|precondition/i.test(message)
}

function isExternalResourceUrl(url: string) {
  return /^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(url) || url.startsWith('//')
}

function getImageExtensionFromMimeType(mimeType: string) {
  const normalized = mimeType.trim().toLowerCase()
  if (!normalized.startsWith('image/')) {
    return 'png'
  }

  const subtype = normalized.slice('image/'.length).split(';')[0]?.trim() ?? ''
  if (!subtype) {
    return 'png'
  }

  if (subtype === 'jpeg') {
    return 'jpg'
  }
  if (subtype === 'svg+xml') {
    return 'svg'
  }
  if (subtype === 'vnd.microsoft.icon' || subtype === 'x-icon') {
    return 'ico'
  }

  return subtype.replace(/[^a-z0-9.+-]/g, '') || 'png'
}

function formatPasteImageTimestamp(date = new Date()) {
  const yyyy = date.getFullYear().toString().padStart(4, '0')
  const mm = `${date.getMonth() + 1}`.padStart(2, '0')
  const dd = `${date.getDate()}`.padStart(2, '0')
  const hh = `${date.getHours()}`.padStart(2, '0')
  const min = `${date.getMinutes()}`.padStart(2, '0')
  const ss = `${date.getSeconds()}`.padStart(2, '0')
  return `${yyyy}${mm}${dd}${hh}${min}${ss}`
}

function normalizePastedImageFile(file: File, index: number) {
  const safeName = file.name.trim().replace(/[\\/\0]+/g, '-')
  const ext = getImageExtensionFromMimeType(file.type)
  const withExtension = safeName
    ? /\.[a-z0-9]{1,16}$/i.test(safeName)
      ? safeName
      : `${safeName}.${ext}`
    : `pasted-image-${formatPasteImageTimestamp()}-${index + 1}.${ext}`

  if (withExtension === file.name) {
    return file
  }

  try {
    return new File([file], withExtension, {
      lastModified: Date.now(),
      type: file.type || `image/${ext}`,
    })
  } catch {
    return file
  }
}

function getClipboardImageFiles(clipboardData: DataTransfer | null) {
  if (!clipboardData) {
    return [] as File[]
  }

  const fromItems: File[] = []
  for (const item of Array.from(clipboardData.items ?? [])) {
    if (item.kind !== 'file' || !item.type.startsWith('image/')) {
      continue
    }
    const file = item.getAsFile()
    if (!file) {
      continue
    }
    fromItems.push(normalizePastedImageFile(file, fromItems.length))
  }
  if (fromItems.length > 0) {
    return fromItems
  }

  const fromFiles: File[] = []
  for (const file of Array.from(clipboardData.files ?? [])) {
    if (!file.type.startsWith('image/')) {
      continue
    }
    fromFiles.push(normalizePastedImageFile(file, fromFiles.length))
  }
  return fromFiles
}

function toBlobPayload(data: unknown): BlobPart | null {
  if (data instanceof ArrayBuffer) {
    return data
  }
  if (typeof Blob !== 'undefined' && data instanceof Blob) {
    return data
  }

  const value = data as { buffer?: ArrayBufferLike; byteLength?: number; byteOffset?: number } | null
  if (value?.buffer && typeof value.byteLength === 'number') {
    const offset = value.byteOffset ?? 0
    const source = new Uint8Array(value.buffer, offset, value.byteLength)
    const copy = new Uint8Array(source.byteLength)
    copy.set(source)
    return copy.buffer
  }

  return null
}

function revokeAllObjectUrls(urlMap: Map<string, string>) {
  for (const url of urlMap.values()) {
    URL.revokeObjectURL(url)
  }
  urlMap.clear()
}

function downloadBlob(blob: Blob, fileName: string) {
  const objectUrl = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = objectUrl
  anchor.download = fileName
  anchor.rel = 'noopener'
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(objectUrl)
}

function downloadObjectUrl(objectUrl: string, fileName: string) {
  const anchor = document.createElement('a')
  anchor.href = objectUrl
  anchor.download = fileName
  anchor.rel = 'noopener'
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
}

function loadStoredConfig() {
  try {
    const raw = localStorage.getItem(CONFIG_KEY)
    if (!raw) {
      return null
    }
    const parsed = JSON.parse(raw) as Partial<DavConfig>
    const config = {
      attachments: normalizeAttachmentSettings(parsed.attachments as Partial<AttachmentSettings> | undefined),
      rootPath: normalizeRootPath(parsed.rootPath ?? DEFAULT_ROOT_PATH),
      url: normalizeUrl(parsed.url ?? ''),
      username: (parsed.username ?? '').trim(),
      password: parsed.password ?? '',
    }
    if (!config.url) {
      return null
    }
    return config
  } catch {
    return null
  }
}

type WysiwygMarkdownEditorProps = {
  editable: boolean
  markdown: string
  onApiChange: (api: WysiwygEditorApi | null) => void
  onChange: (nextValue: string) => void
  onImageUpload: (file: File) => Promise<string>
  onPasteCapture: (event: ReactClipboardEvent<HTMLDivElement>) => void
  resolveImageSrc: (url: string) => Promise<string> | string
  syncVersion: number
}

function WysiwygMarkdownEditor({
  editable,
  markdown,
  onApiChange,
  onChange,
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

  useEffect(() => {
    onApiChange({
      applyToolbarAction,
      insertMarkdown: insertMarkdownSnippet,
    })

    return () => {
      onApiChange(null)
    }
  }, [applyToolbarAction, insertMarkdownSnippet, onApiChange])

  return (
    <div className={`crepe-editor-shell h-full ${editable ? '' : 'crepe-editor-readonly'}`} onPasteCapture={onPasteCapture}>
      <Milkdown />
    </div>
  )
}

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
  const [previewDialog, setPreviewDialog] = useState<PreviewDialogState | null>(null)
  const [content, setContent] = useState(DEFAULT_MARKDOWN)
  const [status, setStatus] = useState('未连接 WebDAV')
  const [busy, setBusy] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [isUploadingAttachment, setIsUploadingAttachment] = useState(false)
  const [isCleaningAttachments, setIsCleaningAttachments] = useState(false)
  const [saveIconFlash, setSaveIconFlash] = useState(false)
  const [editorMode, setEditorMode] = useState<EditorMode>('wysiwyg')
  const [wysiwygSyncVersion, setWysiwygSyncVersion] = useState(0)
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [themePreference, setThemePreferenceState] = useState<ThemePreference>(() => readThemePreference())
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() => resolveTheme(readThemePreference()))

  const attachmentInputRef = useRef<HTMLInputElement>(null)
  const sourceEditorRef = useRef<HTMLTextAreaElement>(null)
  const wysiwygApiRef = useRef<WysiwygEditorApi | null>(null)
  const contentRef = useRef(DEFAULT_MARKDOWN)
  const historyRef = useRef([DEFAULT_MARKDOWN])
  const historyIndexRef = useRef(0)
  const warnedAListCreateFallbackRef = useRef(false)
  const imagePreviewUrlMapRef = useRef(new Map<string, string>())
  const imagePreviewPendingRef = useRef(new Map<string, Promise<string>>())
  const previewObjectUrlRef = useRef<string | null>(null)
  const previewRequestRef = useRef(0)

  const isConnected = client !== null
  const canEditDocument = isConnected && Boolean(activeFilePath)
  const canUseEditorActions = canEditDocument && !busy
  const fileMap = useMemo(() => new Map(files.map((item) => [item.path, item])), [files])
  const selectedFilePath = previewDialog?.file.path ?? activeFilePath
  const rootPath = normalizeRootPath(config?.rootPath ?? draftConfig.rootPath ?? DEFAULT_ROOT_PATH)
  const folderTree = useMemo(() => buildFolderTree(files, directories, rootPath), [files, directories, rootPath])
  const sidebarStatusLabel = isConnected ? config?.url || '已连接 WebDAV' : busy ? '连接中...' : '未连接 WebDAV'
  const sidebarStatusDotClass = isConnected ? 'text-[var(--mf-success)]' : busy ? 'text-[var(--mf-feedback)]' : 'text-[var(--mf-warning)]'
  const sidebarStatusTextClass = isConnected
    ? 'text-[var(--mf-muted-strong)]'
    : busy
      ? 'text-[var(--mf-feedback-strong)]'
      : 'text-[var(--mf-warning-strong)]'
  const nextThemePreference = getNextThemePreference(themePreference)
  const themeButtonTitle = `主题：${THEME_PREFERENCE_LABEL[themePreference]}（点击切换到${THEME_PREFERENCE_LABEL[nextThemePreference]}）`
  const ThemePreferenceIcon = themePreference === 'system' ? Monitor : resolvedTheme === 'dark' ? Moon : Sun

  const isFolderOpen = useCallback((fullPath: string) => expandedFolders[fullPath] ?? true, [expandedFolders])
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

  const buildRemoteSnapshot = useCallback((list: DavListItem[], normalizedRoot: string): RemoteSnapshot => {
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
        name: item.basename ?? getBaseName(normalizedPath),
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
  }, [])

  const listRemote = useCallback(
    async (targetClient: WebDAVClient, targetConfig: DavConfig): Promise<RemoteSnapshot> => {
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
    },
    [buildRemoteSnapshot],
  )

  const readFile = useCallback(
    async (targetClient: WebDAVClient, filePath: string) => {
      const normalizedPath = normalizeDavPath(filePath)
      const fileText = (await targetClient.getFileContents(toClientDavPath(normalizedPath), { format: 'text' })) as string
      revokeAllObjectUrls(imagePreviewUrlMapRef.current)
      imagePreviewPendingRef.current.clear()
      setActiveFilePath(normalizedPath)
      setContentWithHistory(fileText, { resetHistory: true })
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
          const textContent = (await targetClient.getFileContents(toClientDavPath(normalizedPath), { format: 'text' })) as string
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

        const payload = await targetClient.getFileContents(toClientDavPath(normalizedPath), { format: 'binary' })
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

      const payload = await client.getFileContents(toClientDavPath(previewDialog.file.path), { format: 'binary' })
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
        revokeAllObjectUrls(imagePreviewUrlMapRef.current)
        imagePreviewPendingRef.current.clear()
        closePreviewDialog()

        if (options?.persist === false) {
          localStorage.removeItem(CONFIG_KEY)
        } else {
          localStorage.setItem(CONFIG_KEY, JSON.stringify(nextConfig))
        }

        const targetPath = pickMarkdownTargetPath(snapshot.files)
        if (targetPath) {
          await readFile(nextClient, targetPath)
        } else {
          setActiveFilePath('')
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
      revokeAllObjectUrls(imagePreviewUrlMapRef.current)
      imagePreviewPendingRef.current.clear()
    },
    [revokePreviewObjectUrl],
  )

  useEffect(() => {
    if (!contextMenu) {
      return
    }

    const close = () => setContextMenu(null)
    const closeByEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setContextMenu(null)
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
  }, [contextMenu])

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
    [client, closePreviewDialog, fileMap, notifyError, openPreviewFile, readFile],
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

  const onCleanupUnusedAttachments = useCallback(async () => {
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
              : ((await client.getFileContents(toClientDavPath(markdownFile.path), { format: 'text' })) as string)
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

      const cleanupCandidates = [...new Set(
        snapshot.files
          .filter((item) => item.kind !== 'markdown')
          .filter((item) => isManagedAttachmentFilePath(item.path, attachmentSettings, config.rootPath))
          .map((item) => normalizeDavPath(item.path)),
      )]
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
  }, [activeFilePath, client, config, listRemote, notifyError, reloadRemoteState])

  const ensureDavDirectory = useCallback(async (targetClient: WebDAVClient, directoryPath: string) => {
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
  }, [])

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
    [activeFilePath, client, config, ensureDavDirectory, notifyError],
  )

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
          const payload = await client.getFileContents(toClientDavPath(davPath), { format: 'binary' })
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
      } catch {
        // Errors are already handled in uploadAttachmentFile.
      }
    },
    [insertMarkdownSnippet, uploadAttachmentFile],
  )

  const onWysiwygImageUpload = useCallback(
    async (file: File) => {
      const result = await uploadAttachmentFile(file)
      return result.link
    },
    [uploadAttachmentFile],
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
          return
        }
        toast.success(`截图已上传：${uploadedNames.length} 张`)
      })()

      return true
    },
    [canUseEditorActions, insertMarkdownSnippet, isUploadingAttachment, uploadAttachmentFile],
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

  const onSave = useCallback(async () => {
    if (!client || !activeFilePath) {
      notifyError('未选择可保存的文件')
      return
    }

    if (isSaving) {
      return
    }

    setIsSaving(true)
    setSaveIconFlash(false)
    try {
      await client.putFileContents(toClientDavPath(activeFilePath), contentRef.current, { overwrite: true })
      historyRef.current = [contentRef.current]
      historyIndexRef.current = 0
      setStatus(`已保存：${activeFilePath}`)
    } catch (error) {
      notifyError('保存失败', error)
    } finally {
      setIsSaving(false)
      requestAnimationFrame(() => {
        setSaveIconFlash(true)
      })
    }
  }, [activeFilePath, client, isSaving, notifyError])

  const onLogout = useCallback(() => {
    localStorage.removeItem(CONFIG_KEY)
    setClient(null)
    setConfig(null)
    setFiles([])
    setDirectories([])
    setExpandedFolders({})
    setActiveFilePath('')
    setDraftConfig({ ...EMPTY_CONFIG, attachments: { ...DEFAULT_ATTACHMENT_SETTINGS } })
    setRememberCredentials(false)
    setShowPassword(false)
    setIsUploadingAttachment(false)
    closePreviewDialog()
    revokeAllObjectUrls(imagePreviewUrlMapRef.current)
    imagePreviewPendingRef.current.clear()
    setContentWithHistory(DEFAULT_MARKDOWN, { resetHistory: true })
    setWysiwygSyncVersion((prev) => prev + 1)
    setStatus('已登出，并清除本地连接记录')
  }, [closePreviewDialog, setContentWithHistory])

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

  const openContextMenu = useCallback(
    (event: ReactMouseEvent, path: string, kind: ContextKind) => {
      event.preventDefault()
      event.stopPropagation()

      if (!isConnected) {
        return
      }

      setContextMenu({
        kind,
        path: normalizeDavPath(path),
        x: event.clientX,
        y: event.clientY,
      })
    },
    [isConnected],
  )

  const contextPosition = useMemo(() => {
    if (!contextMenu) {
      return null
    }
    const viewportWidth = typeof window === 'undefined' ? contextMenu.x : window.innerWidth
    const viewportHeight = typeof window === 'undefined' ? contextMenu.y : window.innerHeight

    return {
      left: Math.max(10, Math.min(contextMenu.x + 6, viewportWidth - MENU_WIDTH - 10)),
      top: Math.max(10, Math.min(contextMenu.y + 6, viewportHeight - MENU_HEIGHT - 10)),
    }
  }, [contextMenu])

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
        try {
          const created = await client.putFileContents(toClientDavPath(nextPath), '# 新建文档\n', { overwrite: false })
          if (created === false) {
            throw new Error(`文件已存在：${nextPath}`)
          }
        } catch (error) {
          if (!shouldFallbackCreateFileForAList(error)) {
            throw error
          }

          if (!warnedAListCreateFallbackRef.current) {
            warnedAListCreateFallbackRef.current = true
            toast.warning('检测到 AList 写入兼容模式，已自动降级文件创建策略')
          }

          const exists = await client.exists(toClientDavPath(nextPath))
          if (exists) {
            throw new Error(`文件已存在：${nextPath}`)
          }

          await client.putFileContents(toClientDavPath(nextPath), '# 新建文档\n', { overwrite: true })
        }

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

  const renderTree = useCallback(
    (node: FolderNode, depth: number) => {
      const items: ReactElement[] = []

      for (const folder of node.folders) {
        const open = isFolderOpen(folder.fullPath)

        items.push(
          <div key={`folder-${folder.fullPath}`} className="space-y-1">
            <div
              className="flex h-8 items-center gap-1 rounded-[var(--mf-radius-md)] px-1 py-1 text-[13px] text-[var(--mf-muted-strong)] transition-colors hover:bg-[var(--mf-surface-muted)]"
              onContextMenu={(event) => openContextMenu(event, folder.fullPath, 'directory')}
              style={{ paddingLeft: `${8 + depth * 12}px` }}
            >
              <button
                type="button"
                className="inline-flex h-5 w-5 items-center justify-center rounded text-[var(--mf-muted)] hover:bg-[var(--mf-surface-hover)]"
                onClick={() =>
                  setExpandedFolders((prev) => ({
                    ...prev,
                    [folder.fullPath]: !isFolderOpen(folder.fullPath),
                  }))
                }
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
        const icon =
          file.kind === 'image' ? (
            <ImageIcon className="h-3.5 w-3.5 shrink-0" />
          ) : file.kind === 'video' ? (
            <VideoIcon className="h-3.5 w-3.5 shrink-0" />
          ) : file.kind === 'audio' || file.kind === 'pdf' || file.kind === 'other' ? (
            <FileIcon className="h-3.5 w-3.5 shrink-0" />
          ) : (
            <FileText className="h-3.5 w-3.5 shrink-0" />
          )

        items.push(
          <button
            key={file.path}
            type="button"
            onClick={() => void onSelectFile(file.path)}
            onDoubleClick={() => void onSelectFile(file.path)}
            onContextMenu={(event) => openContextMenu(event, file.path, 'file')}
            className={`flex h-8 w-full items-center gap-2 rounded-[var(--mf-radius-md)] px-2 py-1 text-left text-[13px] transition-colors ${
              active
                ? 'bg-[var(--mf-accent-soft)] text-[var(--mf-accent)]'
                : 'text-[var(--mf-muted-strong)] hover:bg-[var(--mf-surface-muted)]'
            }`}
            style={{ paddingLeft: `${28 + depth * 12}px` }}
          >
            {icon}
            <span className="truncate">{file.name}</span>
          </button>,
        )
      }

      return items
    },
    [isFolderOpen, onSelectFile, openContextMenu, selectedFilePath],
  )

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
  const previewTypeLabel = previewDialog ? getPreviewTypeLabel(previewDialog.kind) : ''
  const canDownloadPreview = Boolean(previewDialog) && !previewDialog?.loading && !previewDialog?.error
  const toolbarDisabled = !canUseEditorActions

  return (
    <div className="h-full w-full bg-[var(--mf-bg)] text-[var(--mf-text)]">
      <div className="flex h-full w-full overflow-hidden">
        <aside
          className={`h-full border-r border-[var(--mf-border)] transition-[width] duration-200 ${
            sidebarCollapsed ? 'w-16' : 'w-64'
          }`}
        >
          <div className="flex h-full flex-col">
            <div className="px-3 pb-2 pt-4">
              <div className={`flex h-8 items-center ${sidebarCollapsed ? 'justify-center' : 'justify-between'} gap-2`}>
                {sidebarCollapsed ? null : (
                  <div className="flex min-w-0 items-center gap-1.5">
                    <span className={`text-[11px] font-semibold ${sidebarStatusDotClass}`}>●</span>
                    <span className={`truncate text-xs ${sidebarStatusTextClass}`}>
                      {sidebarStatusLabel}
                    </span>
                  </div>
                )}
                <Button
                  variant="toolbar"
                  size={sidebarCollapsed ? 'icon' : 'iconCompact'}
                  onClick={() => setSidebarCollapsed((prev) => !prev)}
                  aria-label={sidebarCollapsed ? '展开侧栏' : '收起侧栏'}
                >
                  {sidebarCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
                </Button>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
              {sidebarCollapsed ? (
                <div className="flex flex-col items-center gap-2 pt-2">
                  <Button variant="toolbar" size="icon" onClick={() => setDialogOpen(true)} title="WebDAV 设定" aria-label="WebDAV 设定">
                    <Settings2 className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="toolbar"
                    size="icon"
                    onClick={() => void onRefresh()}
                    disabled={busy || !isConnected}
                    title="刷新目录"
                    aria-label="刷新目录"
                  >
                    <RefreshCw className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="toolbar"
                    size="icon"
                    onClick={openAttachmentSettingsDialog}
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
                  onContextMenu={(event) => openContextMenu(event, rootPath, 'root')}
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
                          onClick={openAttachmentSettingsDialog}
                          disabled={!isConnected}
                          title="附件设置"
                          aria-label="附件设置"
                        >
                          <Paperclip className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="toolbar"
                          size="iconCompact"
                          onClick={() => void onRefresh()}
                          disabled={busy || !isConnected}
                          title="刷新目录"
                          aria-label="刷新目录"
                        >
                          <RefreshCw className={`h-3.5 w-3.5 ${busy ? 'animate-spin' : ''}`} />
                        </Button>
                      </div>
                    </div>
                  </div>
                  <div className="mt-1 space-y-1">
                    {renderTree(folderTree, 0)}
                  </div>
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
                    onChange={(event) => setContentWithHistory(event.target.value)}
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

      {contextMenu && contextPosition ? (
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
                  setContextMenu(null)
                  void onSelectFile(menuPath)
                }}
              >
                {openFileMenuLabel}
              </button>
              <button
                className="w-full rounded-[6px] px-3 py-2 text-left text-sm text-[var(--mf-muted-strong)] hover:bg-[var(--mf-surface-muted)]"
                onClick={() => {
                  setContextMenu(null)
                  void renameNode(menuPath, 'file')
                }}
              >
                重命名
              </button>
              <button
                className="w-full rounded-[6px] px-3 py-2 text-left text-sm text-[var(--mf-danger)] hover:bg-[var(--mf-danger-soft)]"
                onClick={() => {
                  setContextMenu(null)
                  void deleteNode(menuPath, 'file')
                }}
              >
                删除
              </button>
              <div className="my-1 h-px bg-[var(--mf-border)]" />
              <button
                className="w-full rounded-[6px] px-3 py-2 text-left text-sm text-[var(--mf-muted-strong)] hover:bg-[var(--mf-surface-muted)]"
                onClick={() => {
                  setContextMenu(null)
                  void createMarkdownFile(createTargetPath)
                }}
              >
                在当前目录新建文件
              </button>
            </>
          ) : (
            <>
              <button
                className="w-full rounded-[6px] px-3 py-2 text-left text-sm text-[var(--mf-muted-strong)] hover:bg-[var(--mf-surface-muted)]"
                onClick={() => {
                  setContextMenu(null)
                  void createMarkdownFile(createTargetPath)
                }}
              >
                新建 Markdown 文件
              </button>
              <button
                className="w-full rounded-[6px] px-3 py-2 text-left text-sm text-[var(--mf-muted-strong)] hover:bg-[var(--mf-surface-muted)]"
                onClick={() => {
                  setContextMenu(null)
                  void createFolder(createTargetPath)
                }}
              >
                新建文件夹
              </button>
              <button
                className="w-full rounded-[6px] px-3 py-2 text-left text-sm text-[var(--mf-muted-strong)] hover:bg-[var(--mf-surface-muted)]"
                onClick={() => {
                  setContextMenu(null)
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
                      setContextMenu(null)
                      void renameNode(menuPath, 'directory')
                    }}
                  >
                    重命名
                  </button>
                  <button
                    className="w-full rounded-[6px] px-3 py-2 text-left text-sm text-[var(--mf-danger)] hover:bg-[var(--mf-danger-soft)]"
                    onClick={() => {
                      setContextMenu(null)
                      void deleteNode(menuPath, 'directory')
                    }}
                  >
                    删除
                  </button>
                </>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </div>
  )
}

export default App
