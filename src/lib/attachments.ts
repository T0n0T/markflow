export type AttachmentStorageMode = 'same_dir_assets' | 'root_attachments' | 'doc_assets'

export type AttachmentLinkFormat = 'relative' | 'root_relative' | 'absolute_url'

export type AttachmentSettings = {
  storageMode: AttachmentStorageMode
  linkFormat: AttachmentLinkFormat
  folderName: string
  maxSizeMB: number
}

export type BuildAttachmentTargetOptions = {
  activeFilePath: string
  baseUrl: string
  originalFileName: string
  rootPath: string
  settings: AttachmentSettings
}

export type AttachmentTarget = {
  directoryPath: string
  markdownLink: string
  remotePath: string
  storedFileName: string
}

export const DEFAULT_ATTACHMENT_SETTINGS: AttachmentSettings = {
  storageMode: 'same_dir_assets',
  linkFormat: 'relative',
  folderName: '_assets',
  maxSizeMB: 20,
}

function normalizePath(path: string) {
  const trimmed = path.trim()
  if (!trimmed || trimmed === '/') {
    return '/'
  }
  return `/${trimmed.replace(/^\/+/, '').replace(/\/+$/, '')}`
}

function splitPath(path: string) {
  return normalizePath(path).split('/').filter(Boolean)
}

function joinPath(basePath: string, segment: string) {
  const base = normalizePath(basePath)
  const part = segment.trim().replace(/^\/+/, '')

  if (!part) {
    return base
  }

  if (base === '/') {
    return `/${part}`
  }

  return `${base}/${part}`
}

function parentPath(path: string) {
  const normalized = normalizePath(path)
  if (normalized === '/') {
    return '/'
  }

  const segments = normalized.split('/').filter(Boolean)
  if (segments.length <= 1) {
    return '/'
  }
  return `/${segments.slice(0, -1).join('/')}`
}

function getFileStem(path: string) {
  const normalized = normalizePath(path)
  const baseName = normalized.split('/').filter(Boolean).pop() ?? 'document'
  return baseName.replace(/\.[^.]+$/, '') || 'document'
}

function sanitizeSegment(input: string, fallback: string) {
  const noControlChars = Array.from(input)
    .map((char) => (char.charCodeAt(0) < 32 ? '-' : char))
    .join('')

  const sanitized = noControlChars
    .trim()
    .replace(/[\\/]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
  return sanitized || fallback
}

function ensureExtension(originalFileName: string) {
  const trimmed = originalFileName.trim()
  const ext = trimmed.match(/\.([a-zA-Z0-9]{1,16})$/)?.[1]
  return ext ? ext.toLowerCase() : 'bin'
}

function formatTimestamp(date = new Date()) {
  const yyyy = date.getFullYear().toString().padStart(4, '0')
  const mm = `${date.getMonth() + 1}`.padStart(2, '0')
  const dd = `${date.getDate()}`.padStart(2, '0')
  const hh = `${date.getHours()}`.padStart(2, '0')
  const min = `${date.getMinutes()}`.padStart(2, '0')
  const ss = `${date.getSeconds()}`.padStart(2, '0')
  return `${yyyy}${mm}${dd}${hh}${min}${ss}`
}

function randomSuffix() {
  return Math.random().toString(36).slice(2, 8)
}

function relativePath(fromDir: string, targetPath: string) {
  const fromSegments = splitPath(fromDir)
  const targetSegments = splitPath(targetPath)

  let index = 0
  while (index < fromSegments.length && index < targetSegments.length && fromSegments[index] === targetSegments[index]) {
    index += 1
  }

  const upSegments = Array.from({ length: fromSegments.length - index }).map(() => '..')
  const downSegments = targetSegments.slice(index)
  const merged = [...upSegments, ...downSegments].join('/')

  if (!merged) {
    return '.'
  }
  return merged
}

function isExternalLink(link: string) {
  return /^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(link) || link.startsWith('//')
}

export function normalizeAttachmentStorageMode(value: string | undefined | null): AttachmentStorageMode {
  if (value === 'root_attachments' || value === 'doc_assets' || value === 'same_dir_assets') {
    return value
  }
  return DEFAULT_ATTACHMENT_SETTINGS.storageMode
}

export function normalizeAttachmentLinkFormat(value: string | undefined | null): AttachmentLinkFormat {
  if (value === 'root_relative' || value === 'absolute_url' || value === 'relative') {
    return value
  }
  return DEFAULT_ATTACHMENT_SETTINGS.linkFormat
}

export function sanitizeAttachmentFolderName(folderName: string) {
  return sanitizeSegment(folderName, DEFAULT_ATTACHMENT_SETTINGS.folderName)
}

export function normalizeAttachmentSettings(input: Partial<AttachmentSettings> | undefined | null): AttachmentSettings {
  const maxSizeRaw = Number(input?.maxSizeMB)
  const maxSizeMB = Number.isFinite(maxSizeRaw) && maxSizeRaw > 0 ? Math.min(1024, Math.round(maxSizeRaw)) : DEFAULT_ATTACHMENT_SETTINGS.maxSizeMB

  return {
    storageMode: normalizeAttachmentStorageMode(input?.storageMode),
    linkFormat: normalizeAttachmentLinkFormat(input?.linkFormat),
    folderName: sanitizeAttachmentFolderName(input?.folderName ?? DEFAULT_ATTACHMENT_SETTINGS.folderName),
    maxSizeMB,
  }
}

export function buildAttachmentTarget(options: BuildAttachmentTargetOptions): AttachmentTarget {
  const activeFilePath = normalizePath(options.activeFilePath)
  const rootPath = normalizePath(options.rootPath)
  const docFolderPath = parentPath(activeFilePath)
  const docStem = sanitizeSegment(getFileStem(activeFilePath), 'document')
  const baseName = sanitizeSegment(options.originalFileName.replace(/\.[^.]+$/, ''), 'attachment')
  const ext = ensureExtension(options.originalFileName)
  const storedFileName = `${baseName}-${formatTimestamp()}-${randomSuffix()}.${ext}`
  const folderName = sanitizeAttachmentFolderName(options.settings.folderName)

  let directoryPath = rootPath
  if (options.settings.storageMode === 'same_dir_assets') {
    directoryPath = joinPath(joinPath(docFolderPath, folderName), docStem)
  } else if (options.settings.storageMode === 'root_attachments') {
    directoryPath = joinPath(rootPath, folderName)
  } else if (options.settings.storageMode === 'doc_assets') {
    directoryPath = joinPath(docFolderPath, `${docStem}.assets`)
  }

  const remotePath = joinPath(directoryPath, storedFileName)

  let markdownLink = remotePath
  if (options.settings.linkFormat === 'relative') {
    const relative = relativePath(docFolderPath, remotePath)
    markdownLink = relative.startsWith('../') ? relative : `./${relative}`
  } else if (options.settings.linkFormat === 'absolute_url') {
    try {
      const normalizedBase = options.baseUrl.trim().replace(/\/+$/, '')
      const base = normalizedBase.endsWith('/') ? normalizedBase : `${normalizedBase}/`
      const relativePathname = remotePath.replace(/^\/+/, '')
      markdownLink = new URL(relativePathname, base).toString()
    } catch {
      markdownLink = remotePath
    }
  }

  return {
    directoryPath,
    remotePath,
    storedFileName,
    markdownLink,
  }
}

export function resolveMarkdownLinkToDavPath(link: string, activeFilePath: string): string | null {
  const raw = link.trim()
  if (!raw || raw.startsWith('#') || isExternalLink(raw)) {
    return null
  }

  const clean = raw.split('#')[0]?.split('?')[0] ?? ''
  if (!clean) {
    return null
  }

  if (clean.startsWith('/')) {
    return normalizePath(clean)
  }

  const baseDir = parentPath(activeFilePath)
  const segments = splitPath(baseDir)
  for (const segment of clean.split('/')) {
    if (!segment || segment === '.') {
      continue
    }
    if (segment === '..') {
      segments.pop()
      continue
    }
    segments.push(segment)
  }

  return normalizePath(`/${segments.join('/')}`)
}

export function isImageLikeFile(file: File) {
  if (file.type.startsWith('image/')) {
    return true
  }
  return /\.(png|jpe?g|gif|webp|bmp|svg|avif|ico)$/i.test(file.name)
}

export function buildAttachmentMarkdown(file: File, link: string) {
  const escapedName = file.name.replace(/\[/g, '\\[').replace(/\]/g, '\\]')
  if (isImageLikeFile(file)) {
    return `![${escapedName}](${link})`
  }
  return `[${escapedName}](${link})`
}
