import {
  type AttachmentSettings,
  DEFAULT_ATTACHMENT_SETTINGS,
  normalizeAttachmentSettings,
  resolveMarkdownLinkToDavPath,
  sanitizeAttachmentFolderName,
} from '@/lib/attachments'
import type { ThemePreference } from '@/lib/theme'
import {
  getFileExtension,
  getRemoteBasePath,
  normalizeDavPath,
  parentDavPath,
  toAppDavPath,
} from '@/features/app/dav-path'
export {
  getBaseName,
  getFileExtension,
  getRemoteBasePath,
  joinDavPath,
  normalizeDavPath,
  parentDavPath,
  toAppDavPath,
  toClientDavPath,
  toDavPathname,
} from '@/features/app/dav-path'

export type DavConfig = {
  attachments: AttachmentSettings
  url: string
  username: string
  password: string
  rootPath: string
}

export type DavListItem = {
  basename?: string
  filename: string
  type: 'file' | 'directory'
}

export type RemoteFileKind = 'markdown' | 'text' | 'image' | 'video' | 'audio' | 'pdf' | 'other'

export type RemoteFile = {
  kind: RemoteFileKind
  name: string
  path: string
}

export type FolderNode = {
  folders: FolderNode[]
  fullPath: string
  name: string
  files: RemoteFile[]
}

export type RemoteSnapshot = {
  directories: string[]
  files: RemoteFile[]
}

export type PreviewFileKind = 'text' | 'image' | 'video' | 'audio' | 'pdf'

export type PreviewDialogState = {
  error: string
  file: RemoteFile
  kind: PreviewFileKind
  loading: boolean
  objectUrl: string
  textDirty: boolean
  textSaving: boolean
  textContent: string
  textDraft: string
}

export type EditorMode = 'wysiwyg' | 'source'
export type ToolbarAction =
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

export type UploadAttachmentResult = {
  davPath: string
  link: string
}

export type WysiwygEditorApi = {
  applyToolbarAction: (action: ToolbarAction) => boolean
  insertMarkdown: (snippet: string) => boolean
  copy: () => boolean
  cut: () => boolean
  findImagePosFromTarget: (target: EventTarget | null) => number | null
  getMarkdownSelection: () => null | { end: number; start: number }
  pasteWithFormatting: () => boolean
  resizeImageByPos: (pos: number, ratio: number) => boolean
  selectAll: () => boolean
  insertPlainText: (text: string) => boolean
}

export type ContextKind = 'file' | 'directory' | 'root'

export type ContextMenuState = {
  kind: ContextKind
  path: string
  x: number
  y: number
}

export type SourceImageTarget = {
  end: number
  start: number
}

export type EditorImageTarget =
  | {
      kind: 'source'
      target: SourceImageTarget
    }
  | {
      kind: 'wysiwyg'
      target: {
        pos: number
      }
    }

export type EditorContextMenuState = {
  imageTarget: EditorImageTarget | null
  mode: EditorMode
  x: number
  y: number
}

export const CONFIG_KEY = 'markflow.webdav.config'
export const DEFAULT_ROOT_PATH = '/'
export const DEFAULT_MARKDOWN = '# 会议记录\n\n- WebDAV 已连接\n\n- 今日目标：编辑 markdown 文件并同步到云端\n'
export const MENU_WIDTH = 220
export const MENU_HEIGHT = 250
export const EDITOR_MENU_WIDTH = 240
export const EDITOR_MENU_BASE_HEIGHT = 258
export const EDITOR_MENU_WITH_IMAGE_HEIGHT = 442
export const IMAGE_RESIZE_PRESETS = [25, 50, 75, 100]
export const SOURCE_MARKDOWN_IMAGE_PATTERN = /!\[[^\]]*]\(([^)\n]+)\)/g
export const THEME_PREFERENCE_ORDER: ThemePreference[] = ['system', 'light', 'dark']
export const THEME_PREFERENCE_LABEL: Record<ThemePreference, string> = {
  dark: '深色',
  light: '浅色',
  system: '跟随系统',
}
export const MARKDOWN_FILE_EXTENSIONS = new Set(['md', 'markdown'])
export const TEXT_FILE_EXTENSIONS = new Set([
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
export const CREATABLE_TEXT_FILE_EXTENSIONS = new Set([...MARKDOWN_FILE_EXTENSIONS, ...TEXT_FILE_EXTENSIONS])
export const IMAGE_FILE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif'])
export const VIDEO_FILE_EXTENSIONS = new Set(['mp4', 'webm', 'ogv', 'mov', 'm4v', 'mkv'])
export const AUDIO_FILE_EXTENSIONS = new Set(['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac'])
export const MIME_TYPE_BY_EXTENSION: Record<string, string> = {
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

export const EMPTY_CONFIG: DavConfig = {
  attachments: DEFAULT_ATTACHMENT_SETTINGS,
  rootPath: DEFAULT_ROOT_PATH,
  url: '',
  username: '',
  password: '',
}

export function normalizeUrl(url: string) {
  return url.trim().replace(/\/+$/, '')
}

export function ensureDavBaseUrl(url: string) {
  const normalized = normalizeUrl(url)
  if (!normalized) {
    return normalized
  }
  return normalized.endsWith('/') ? normalized : `${normalized}/`
}

export function normalizeRootPath(path: string) {
  const trimmed = path.trim()
  if (!trimmed || trimmed === '/') {
    return '/'
  }
  return `/${trimmed.replace(/^\/+/, '').replace(/\/+$/, '')}`
}

export function isCreatableTextFileName(name: string) {
  const extension = getFileExtension(name)
  if (!extension) {
    return false
  }
  return CREATABLE_TEXT_FILE_EXTENSIONS.has(extension)
}

export function inferRemoteFileKind(path: string): RemoteFileKind {
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

export function toPreviewFileKind(kind: RemoteFileKind): PreviewFileKind | null {
  if (kind === 'text' || kind === 'image' || kind === 'video' || kind === 'audio' || kind === 'pdf') {
    return kind
  }
  return null
}

export function getMimeTypeForFile(path: string, kind: PreviewFileKind) {
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

export function getPreviewTypeLabel(kind: PreviewFileKind) {
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

export function getNextThemePreference(preference: ThemePreference): ThemePreference {
  const currentIndex = THEME_PREFERENCE_ORDER.indexOf(preference)
  if (currentIndex < 0) {
    return THEME_PREFERENCE_ORDER[0]
  }
  return THEME_PREFERENCE_ORDER[(currentIndex + 1) % THEME_PREFERENCE_ORDER.length]
}

export function getContextMenuPosition(x: number, y: number, width: number, height: number) {
  const viewportWidth = typeof window === 'undefined' ? x : window.innerWidth
  const viewportHeight = typeof window === 'undefined' ? y : window.innerHeight

  return {
    left: Math.max(10, Math.min(x + 6, viewportWidth - width - 10)),
    top: Math.max(10, Math.min(y + 6, viewportHeight - height - 10)),
  }
}

export function findMarkdownImageTargetAtOffset(markdown: string, offset: number): SourceImageTarget | null {
  const matcher = new RegExp(SOURCE_MARKDOWN_IMAGE_PATTERN.source, SOURCE_MARKDOWN_IMAGE_PATTERN.flags)

  for (const match of markdown.matchAll(matcher)) {
    const snippet = match[0]
    if (!snippet || typeof match.index !== 'number') {
      continue
    }

    const start = match.index
    const end = start + snippet.length
    if (offset >= start && offset <= end) {
      return { end, start }
    }
  }

  return null
}

export function applyMarkdownImageRatio(markdown: string, target: SourceImageTarget, ratio: number) {
  const prefix = markdown.slice(0, target.start)
  const snippet = markdown.slice(target.start, target.end)
  const suffix = markdown.slice(target.end)
  const ratioLabel = Number.parseFloat(ratio.toFixed(2)).toString()
  const nextSnippet = snippet.replace(/^!\[[^\]]*]\(/, `![${ratioLabel}](`)

  if (nextSnippet === snippet) {
    return markdown
  }

  return `${prefix}${nextSnippet}${suffix}`
}

export function getPasteShortcutLabel() {
  if (typeof navigator === 'undefined') {
    return 'Ctrl+V'
  }
  return navigator.platform.toLowerCase().includes('mac') ? '⌘+V' : 'Ctrl+V'
}

export function extractMarkdownLinkTargets(markdown: string) {
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

export function resolveAttachmentLinkToDavPath(link: string, activeMarkdownPath: string, baseUrl: string) {
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

export function isManagedAttachmentFilePath(path: string, settings: AttachmentSettings, rootPath: string) {
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

export function pickMarkdownTargetPath(files: RemoteFile[], preferredPath?: string, currentPath?: string) {
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

export function isPathInsideRoot(path: string, rootPath: string) {
  const normalizedPath = normalizeDavPath(path)
  const normalizedRoot = normalizeRootPath(rootPath)

  if (normalizedRoot === '/') {
    return true
  }

  return normalizedPath === normalizedRoot || normalizedPath.startsWith(`${normalizedRoot}/`)
}

export function getRelativePath(fullPath: string, rootPath: string) {
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

export function buildFolderTree(files: RemoteFile[], directories: string[], rootPath: string): FolderNode {
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

export function parseErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message
  }
  return '未知错误'
}

export function getErrorStatus(error: unknown): number | null {
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

export function isMethodUnsupported(error: unknown) {
  const status = getErrorStatus(error)
  if (status === 405 || status === 501) {
    return true
  }

  const message = parseErrorMessage(error)
  return /\b(405|501)\b/.test(message) || /method not allowed|not supported/i.test(message)
}

export function shouldFallbackCreateFileForAList(error: unknown) {
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

export function isExternalResourceUrl(url: string) {
  return /^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(url) || url.startsWith('//')
}

export function getImageExtensionFromMimeType(mimeType: string) {
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

export function formatPasteImageTimestamp(date = new Date()) {
  const yyyy = date.getFullYear().toString().padStart(4, '0')
  const mm = `${date.getMonth() + 1}`.padStart(2, '0')
  const dd = `${date.getDate()}`.padStart(2, '0')
  const hh = `${date.getHours()}`.padStart(2, '0')
  const min = `${date.getMinutes()}`.padStart(2, '0')
  const ss = `${date.getSeconds()}`.padStart(2, '0')
  return `${yyyy}${mm}${dd}${hh}${min}${ss}`
}

export function normalizePastedImageFile(file: File, index: number) {
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

function parseDataUrlImage(dataUrl: string) {
  const trimmed = dataUrl.trim()
  const match = /^data:(image\/[a-z0-9.+-]+);base64,([\s\S]+)$/i.exec(trimmed)
  if (!match) {
    return null
  }

  const mimeType = match[1].toLowerCase()
  const encoded = match[2].replace(/\s+/g, '')
  if (!encoded) {
    return null
  }

  try {
    const binary = atob(encoded)
    const bytes = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index)
    }
    return { bytes, mimeType }
  } catch {
    return null
  }
}

function collectImageDataUrlsFromString(input: string) {
  if (!input) {
    return [] as string[]
  }

  const found: string[] = []
  const seen = new Set<string>()
  const pushDataUrl = (candidate: string) => {
    const normalized = candidate.trim()
    if (!normalized || seen.has(normalized)) {
      return
    }
    seen.add(normalized)
    found.push(normalized)
  }

  if (typeof DOMParser !== 'undefined' && /<[^>]+>/.test(input)) {
    try {
      const doc = new DOMParser().parseFromString(input, 'text/html')
      for (const image of Array.from(doc.querySelectorAll('img'))) {
        const src = image.getAttribute('src')?.trim() ?? ''
        if (src.toLowerCase().startsWith('data:image/')) {
          pushDataUrl(src)
        }
      }
    } catch {
      // Ignore parser failures and fallback to regex extraction.
    }
  }

  const dataUrlPattern = /data:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=\s]+/gi
  let result: RegExpExecArray | null = dataUrlPattern.exec(input)
  while (result) {
    pushDataUrl(result[0])
    result = dataUrlPattern.exec(input)
  }

  return found
}

function getClipboardDataUrlImageFiles(clipboardData: DataTransfer) {
  const rawHtml = clipboardData.getData('text/html')
  const rawText = clipboardData.getData('text/plain')
  const candidates = [...collectImageDataUrlsFromString(rawHtml), ...collectImageDataUrlsFromString(rawText)]
  if (!candidates.length) {
    return [] as File[]
  }

  const files: File[] = []
  for (const candidate of candidates) {
    const parsed = parseDataUrlImage(candidate)
    if (!parsed) {
      continue
    }

    const ext = getImageExtensionFromMimeType(parsed.mimeType)
    const fileName = `pasted-image-${formatPasteImageTimestamp()}-${files.length + 1}.${ext}`

    try {
      files.push(
        new File([parsed.bytes], fileName, {
          lastModified: Date.now(),
          type: parsed.mimeType,
        }),
      )
    } catch {
      continue
    }
  }

  return files
}

export function getClipboardImageFiles(clipboardData: DataTransfer | null) {
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
  if (fromFiles.length > 0) {
    return fromFiles
  }

  return getClipboardDataUrlImageFiles(clipboardData)
}

export function toBlobPayload(data: unknown): BlobPart | null {
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

export function revokeAllObjectUrls(urlMap: Map<string, string>) {
  for (const url of urlMap.values()) {
    URL.revokeObjectURL(url)
  }
  urlMap.clear()
}

export function downloadBlob(blob: Blob, fileName: string) {
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

export function downloadObjectUrl(objectUrl: string, fileName: string) {
  const anchor = document.createElement('a')
  anchor.href = objectUrl
  anchor.download = fileName
  anchor.rel = 'noopener'
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
}

export function loadStoredConfig() {
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
