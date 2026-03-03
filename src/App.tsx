import {
  type ClipboardEvent as ReactClipboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  Bold,
  Calculator,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Code2,
  Eye,
  EyeOff,
  FilePenLine,
  FileText,
  Folder,
  FolderOpen,
  Heading1,
  Heading2,
  Italic,
  List,
  ListChecks,
  ListOrdered,
  LogIn,
  LogOut,
  PlugZap,
  Quote,
  Redo2,
  RefreshCw,
  Save,
  Settings2,
  SlidersHorizontal,
  Table2,
  Undo2,
} from 'lucide-react'
import { createClient, type WebDAVClient } from 'webdav'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { toast } from 'sonner'

type DavConfig = {
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

type MarkdownFile = {
  name: string
  path: string
}

type FolderNode = {
  folders: FolderNode[]
  fullPath: string
  name: string
  files: MarkdownFile[]
}

type RemoteSnapshot = {
  directories: string[]
  files: MarkdownFile[]
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

const EMPTY_CONFIG: DavConfig = {
  rootPath: DEFAULT_ROOT_PATH,
  url: '',
  username: '',
  password: '',
}

function normalizeUrl(url: string) {
  return url.trim().replace(/\/+$/, '')
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

function buildFolderTree(files: MarkdownFile[], directories: string[], rootPath: string): FolderNode {
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

function loadStoredConfig() {
  try {
    const raw = localStorage.getItem(CONFIG_KEY)
    if (!raw) {
      return null
    }
    const parsed = JSON.parse(raw) as Partial<DavConfig>
    const config = {
      rootPath: normalizeRootPath(parsed.rootPath ?? DEFAULT_ROOT_PATH),
      url: normalizeUrl(parsed.url ?? ''),
      username: (parsed.username ?? '').trim(),
      password: parsed.password ?? '',
    }
    if (!config.url || !config.username || !config.password) {
      return null
    }
    return config
  } catch {
    return null
  }
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function applyInlineMarkdown(value: string) {
  const escaped = escapeHtml(value)

  return escaped
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/\n/g, '<br />')
}

function markdownToHtml(markdown: string) {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n')
  const html: string[] = []

  const isSpecialLine = (line: string) =>
    /^(#{1,6}\s+|```|>|\d+\.\s+|- \[[ xX]\]\s+|[-*]\s+)/.test(line)

  let index = 0
  while (index < lines.length) {
    const line = lines[index]

    if (!line.trim()) {
      index += 1
      continue
    }

    if (/^```/.test(line)) {
      index += 1
      const codeLines: string[] = []
      while (index < lines.length && !/^```/.test(lines[index])) {
        codeLines.push(lines[index])
        index += 1
      }
      if (index < lines.length && /^```/.test(lines[index])) {
        index += 1
      }
      html.push(`<pre><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`)
      continue
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/)
    if (heading) {
      const level = heading[1].length
      html.push(`<h${level}>${applyInlineMarkdown(heading[2])}</h${level}>`)
      index += 1
      continue
    }

    if (/^>\s?/.test(line)) {
      const quoteLines: string[] = []
      while (index < lines.length && /^>\s?/.test(lines[index])) {
        quoteLines.push(lines[index].replace(/^>\s?/, ''))
        index += 1
      }
      html.push(`<blockquote><p>${applyInlineMarkdown(quoteLines.join('\n'))}</p></blockquote>`)
      continue
    }

    if (line.includes('|') && index + 1 < lines.length && /^\s*\|?[:\- ]+\|[:\-| ]+\s*$/.test(lines[index + 1])) {
      const headerCells = line
        .split('|')
        .map((item) => item.trim())
        .filter(Boolean)
      index += 2
      const bodyRows: string[][] = []
      while (index < lines.length && lines[index].includes('|') && lines[index].trim()) {
        const row = lines[index]
          .split('|')
          .map((item) => item.trim())
          .filter(Boolean)
        bodyRows.push(row)
        index += 1
      }

      const head = `<thead><tr>${headerCells.map((item) => `<th>${applyInlineMarkdown(item)}</th>`).join('')}</tr></thead>`
      const body = bodyRows.length
        ? `<tbody>${bodyRows
            .map((row) => `<tr>${row.map((item) => `<td>${applyInlineMarkdown(item)}</td>`).join('')}</tr>`)
            .join('')}</tbody>`
        : ''
      html.push(`<table>${head}${body}</table>`)
      continue
    }

    if (/^- \[[ xX]\]\s+/.test(line) || /^[-*]\s+/.test(line)) {
      const listItems: string[] = []
      while (index < lines.length && (/^- \[[ xX]\]\s+/.test(lines[index]) || /^[-*]\s+/.test(lines[index]))) {
        listItems.push(lines[index].replace(/^(- \[[ xX]\] |[-*] )/, ''))
        index += 1
      }
      html.push(`<ul>${listItems.map((item) => `<li>${applyInlineMarkdown(item)}</li>`).join('')}</ul>`)
      continue
    }

    if (/^\d+\.\s+/.test(line)) {
      const listItems: string[] = []
      while (index < lines.length && /^\d+\.\s+/.test(lines[index])) {
        listItems.push(lines[index].replace(/^\d+\.\s+/, ''))
        index += 1
      }
      html.push(`<ol>${listItems.map((item) => `<li>${applyInlineMarkdown(item)}</li>`).join('')}</ol>`)
      continue
    }

    const paragraph: string[] = []
    while (index < lines.length && lines[index].trim() && !isSpecialLine(lines[index])) {
      paragraph.push(lines[index])
      index += 1
    }
    html.push(`<p>${applyInlineMarkdown(paragraph.join('\n'))}</p>`)
  }

  return html.join('')
}

function inlineNodeToMarkdown(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent ?? ''
  }

  if (!(node instanceof HTMLElement)) {
    return ''
  }

  const children = Array.from(node.childNodes).map((child) => inlineNodeToMarkdown(child)).join('')

  switch (node.tagName) {
    case 'BR':
      return '\n'
    case 'STRONG':
    case 'B':
      return `**${children}**`
    case 'EM':
    case 'I':
      return `*${children}*`
    case 'CODE':
      return `\`${children}\``
    case 'A': {
      const href = node.getAttribute('href') ?? ''
      if (!href) {
        return children
      }
      return `[${children || href}](${href})`
    }
    default:
      return children
  }
}

function blockNodeToMarkdown(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return (node.textContent ?? '').trim()
  }

  if (!(node instanceof HTMLElement)) {
    return ''
  }

  const inline = () => Array.from(node.childNodes).map((child) => inlineNodeToMarkdown(child)).join('').trim()

  switch (node.tagName) {
    case 'H1':
      return `# ${inline()}`
    case 'H2':
      return `## ${inline()}`
    case 'H3':
      return `### ${inline()}`
    case 'H4':
      return `#### ${inline()}`
    case 'H5':
      return `##### ${inline()}`
    case 'H6':
      return `###### ${inline()}`
    case 'BLOCKQUOTE': {
      const value = Array.from(node.childNodes)
        .map((child) => blockNodeToMarkdown(child))
        .join('\n')
        .trim()
      return value
        .split('\n')
        .filter(Boolean)
        .map((line) => `> ${line}`)
        .join('\n')
    }
    case 'UL': {
      return Array.from(node.children)
        .filter((child) => child.tagName === 'LI')
        .map((child) => `- ${Array.from(child.childNodes).map((item) => inlineNodeToMarkdown(item)).join('').trim()}`)
        .join('\n')
    }
    case 'OL': {
      return Array.from(node.children)
        .filter((child) => child.tagName === 'LI')
        .map((child, index) => `${index + 1}. ${Array.from(child.childNodes).map((item) => inlineNodeToMarkdown(item)).join('').trim()}`)
        .join('\n')
    }
    case 'PRE': {
      const code = node.textContent?.replace(/\n$/, '') ?? ''
      return `\`\`\`\n${code}\n\`\`\``
    }
    case 'TABLE': {
      const rows = Array.from(node.querySelectorAll('tr')).map((row) =>
        Array.from(row.children).map((cell) => cell.textContent?.trim() ?? ''),
      )
      if (rows.length === 0) {
        return ''
      }
      const headers = rows[0]
      const divider = headers.map(() => '---')
      const body = rows.slice(1)

      const lines = [
        `| ${headers.join(' | ')} |`,
        `| ${divider.join(' | ')} |`,
        ...body.map((row) => `| ${row.join(' | ')} |`),
      ]
      return lines.join('\n')
    }
    case 'P':
    case 'DIV':
    case 'SECTION':
    case 'ARTICLE':
      return inline()
    default: {
      const blocks = Array.from(node.childNodes).map((child) => blockNodeToMarkdown(child)).filter(Boolean)
      if (blocks.length > 0) {
        return blocks.join('\n')
      }
      return inline()
    }
  }
}

function htmlToMarkdown(html: string) {
  if (typeof window === 'undefined') {
    return html
  }

  const parser = new DOMParser()
  const doc = parser.parseFromString(`<div id="editor-root">${html}</div>`, 'text/html')
  const root = doc.getElementById('editor-root')
  if (!root) {
    return ''
  }

  return Array.from(root.childNodes)
    .map((node) => blockNodeToMarkdown(node).trim())
    .filter(Boolean)
    .join('\n\n')
    .replace(/\n{3,}/g, '\n\n')
}

type WysiwygMarkdownEditorProps = {
  editable: boolean
  markdown: string
  onChange: (nextValue: string) => void
  onHostChange: (node: HTMLDivElement | null) => void
  syncVersion: number
}

function WysiwygMarkdownEditor({ editable, markdown, onChange, onHostChange, syncVersion }: WysiwygMarkdownEditorProps) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const ignoreInputRef = useRef(false)

  const setHost = useCallback(
    (node: HTMLDivElement | null) => {
      hostRef.current = node
      onHostChange(node)
    },
    [onHostChange],
  )

  useEffect(
    () => () => {
      onHostChange(null)
    },
    [onHostChange],
  )

  useEffect(() => {
    const host = hostRef.current
    if (!host) {
      return
    }
    ignoreInputRef.current = true
    host.innerHTML = markdownToHtml(markdown)
    requestAnimationFrame(() => {
      ignoreInputRef.current = false
    })
  }, [markdown, syncVersion])

  const onInput = useCallback(() => {
    if (!editable) {
      return
    }
    const host = hostRef.current
    if (!host || ignoreInputRef.current) {
      return
    }
    const nextMarkdown = htmlToMarkdown(host.innerHTML)
    onChange(nextMarkdown)
  }, [editable, onChange])

  const onPaste = useCallback((event: ReactClipboardEvent<HTMLDivElement>) => {
    if (!editable) {
      return
    }
    event.preventDefault()
    const plainText = event.clipboardData.getData('text/plain')
    document.execCommand('insertText', false, plainText)
  }, [editable])

  return (
    <div
      ref={setHost}
      className={`wysiwyg-editor h-full overflow-auto p-6 text-sm leading-7 text-[var(--mf-text)] outline-none ${
        editable ? '' : 'cursor-not-allowed bg-[var(--mf-surface-muted)] text-[var(--mf-muted)]'
      }`}
      contentEditable={editable}
      suppressContentEditableWarning
      onInput={onInput}
      onPaste={onPaste}
    />
  )
}

function App() {
  const initialStoredConfig = useMemo(() => loadStoredConfig(), [])
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [config, setConfig] = useState<DavConfig | null>(initialStoredConfig)
  const [draftConfig, setDraftConfig] = useState<DavConfig>(initialStoredConfig ?? EMPTY_CONFIG)
  const [showPassword, setShowPassword] = useState(false)
  const [rememberCredentials, setRememberCredentials] = useState(Boolean(initialStoredConfig))
  const [client, setClient] = useState<WebDAVClient | null>(null)
  const [files, setFiles] = useState<MarkdownFile[]>([])
  const [directories, setDirectories] = useState<string[]>([])
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({})
  const [activeFilePath, setActiveFilePath] = useState('')
  const [content, setContent] = useState(DEFAULT_MARKDOWN)
  const [status, setStatus] = useState('未连接 WebDAV')
  const [busy, setBusy] = useState(false)
  const [editorMode, setEditorMode] = useState<EditorMode>('wysiwyg')
  const [wysiwygSyncVersion, setWysiwygSyncVersion] = useState(0)
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)

  const sourceEditorRef = useRef<HTMLTextAreaElement>(null)
  const wysiwygEditorRef = useRef<HTMLDivElement | null>(null)
  const contentRef = useRef(DEFAULT_MARKDOWN)
  const historyRef = useRef([DEFAULT_MARKDOWN])
  const historyIndexRef = useRef(0)
  const warnedDepthFallbackRef = useRef(false)
  const warnedAListCreateFallbackRef = useRef(false)

  const isConnected = client !== null
  const canEditDocument = isConnected && Boolean(activeFilePath)
  const canUseEditorActions = canEditDocument && !busy
  const rootPath = normalizeRootPath(config?.rootPath ?? draftConfig.rootPath ?? DEFAULT_ROOT_PATH)
  const folderTree = useMemo(() => buildFolderTree(files, directories, rootPath), [files, directories, rootPath])

  const isFolderOpen = useCallback((fullPath: string) => expandedFolders[fullPath] ?? true, [expandedFolders])

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
    const markdownFileMap = new Map<string, MarkdownFile>()

    for (const item of list) {
      const normalizedPath = normalizeDavPath(item.filename)
      if (!isPathInsideRoot(normalizedPath, normalizedRoot)) {
        continue
      }

      if (item.type === 'directory') {
        directorySet.add(normalizedPath)
        continue
      }

      if (!/\.(md|markdown)$/i.test(normalizedPath)) {
        continue
      }

      markdownFileMap.set(normalizedPath, {
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

    const markdownFiles = [...markdownFileMap.values()].sort((a, b) => a.path.localeCompare(b.path, 'zh-CN'))

    return {
      directories: [...directorySet].sort((a, b) => a.localeCompare(b, 'zh-CN')),
      files: markdownFiles,
    }
  }, [])

  const listRemote = useCallback(
    async (targetClient: WebDAVClient, targetConfig: DavConfig): Promise<RemoteSnapshot> => {
      const normalizedRoot = normalizeRootPath(targetConfig.rootPath)

      try {
        const result = await targetClient.getDirectoryContents(normalizedRoot, { deep: true })
        const list = (Array.isArray(result) ? result : [result]) as DavListItem[]
        return buildRemoteSnapshot(list, normalizedRoot)
      } catch (error) {
        if (!isMethodUnsupported(error)) {
          throw error
        }

        if (!warnedDepthFallbackRef.current) {
          warnedDepthFallbackRef.current = true
          toast.warning('检测到服务器不支持深度遍历，已切换兼容模式')
        }

        const visited = new Set<string>()
        const queue: string[] = [normalizedRoot]
        const aggregate: DavListItem[] = []

        while (queue.length > 0) {
          const currentDirectory = queue.shift()
          if (!currentDirectory || visited.has(currentDirectory)) {
            continue
          }
          visited.add(currentDirectory)

          const partial = await targetClient.getDirectoryContents(currentDirectory)
          const items = (Array.isArray(partial) ? partial : [partial]) as DavListItem[]

          for (const item of items) {
            const normalizedPath = normalizeDavPath(item.filename)
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
    },
    [buildRemoteSnapshot],
  )

  const readFile = useCallback(
    async (targetClient: WebDAVClient, filePath: string) => {
      const normalizedPath = normalizeDavPath(filePath)
      const fileText = (await targetClient.getFileContents(normalizedPath, { format: 'text' })) as string
      setActiveFilePath(normalizedPath)
      setContentWithHistory(fileText, { resetHistory: true })
      setWysiwygSyncVersion((prev) => prev + 1)
    },
    [setContentWithHistory],
  )

  const reloadRemoteState = useCallback(
    async (targetClient: WebDAVClient, targetConfig: DavConfig, preferredPath?: string) => {
      const snapshot = await listRemote(targetClient, targetConfig)
      setFiles(snapshot.files)
      setDirectories(snapshot.directories)

      if (snapshot.files.length === 0) {
        setActiveFilePath('')
        setContentWithHistory('# 空目录\n\n当前目录没有 markdown 文件。', { resetHistory: true })
        setWysiwygSyncVersion((prev) => prev + 1)
        return
      }

      const preferred = preferredPath ? normalizeDavPath(preferredPath) : ''
      const current = normalizeDavPath(activeFilePath)
      const targetPath =
        (preferred && snapshot.files.some((item) => item.path === preferred) && preferred) ||
        (current && snapshot.files.some((item) => item.path === current) && current) ||
        snapshot.files[0].path

      await readFile(targetClient, targetPath)
    },
    [activeFilePath, listRemote, readFile, setContentWithHistory],
  )

  const connectWebdav = useCallback(
    async (inputConfig: DavConfig, options?: { persist?: boolean }) => {
      const nextConfig = {
        rootPath: normalizeRootPath(inputConfig.rootPath),
        url: normalizeUrl(inputConfig.url),
        username: inputConfig.username.trim(),
        password: inputConfig.password,
      }

      if (!nextConfig.url || !nextConfig.username || !nextConfig.password) {
        notifyError('请先填写 URL / 用户名 / 密码')
        return false
      }

      setBusy(true)
      try {
        const nextClient = createClient(nextConfig.url, {
          password: nextConfig.password,
          username: nextConfig.username,
        })

        const snapshot = await listRemote(nextClient, nextConfig)
        setClient(nextClient)
        setConfig(nextConfig)
        setDraftConfig(nextConfig)
        setFiles(snapshot.files)
        setDirectories(snapshot.directories)
        setExpandedFolders((prev) => ({ ...prev, [nextConfig.rootPath]: true }))

        if (options?.persist === false) {
          localStorage.removeItem(CONFIG_KEY)
        } else {
          localStorage.setItem(CONFIG_KEY, JSON.stringify(nextConfig))
        }

        if (snapshot.files.length > 0) {
          await readFile(nextClient, snapshot.files[0].path)
        } else {
          setActiveFilePath('')
          setContentWithHistory('# 空目录\n\n当前目录没有 markdown 文件。', { resetHistory: true })
          setWysiwygSyncVersion((prev) => prev + 1)
        }

        setStatus(`已连接：${nextConfig.url}`)
        return true
      } catch (error) {
        setClient(null)
        setFiles([])
        setDirectories([])
        setActiveFilePath('')
        notifyError('连接失败', error)
        return false
      } finally {
        setBusy(false)
      }
    },
    [listRemote, notifyError, readFile, setContentWithHistory],
  )

  useEffect(() => {
    if (!initialStoredConfig) {
      return
    }
    void connectWebdav(initialStoredConfig, { persist: true })
  }, [connectWebdav, initialStoredConfig])

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

      setBusy(true)
      try {
        await readFile(client, filePath)
        setStatus(`已载入：${filePath}`)
      } catch (error) {
        notifyError('读取失败', error)
      } finally {
        setBusy(false)
      }
    },
    [client, notifyError, readFile],
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

  const onSave = useCallback(async () => {
    if (!client || !activeFilePath) {
      notifyError('未选择可保存的文件')
      return
    }

    setBusy(true)
    try {
      await client.putFileContents(activeFilePath, contentRef.current, { overwrite: true })
      historyRef.current = [contentRef.current]
      historyIndexRef.current = 0
      setStatus(`已保存：${activeFilePath}`)
    } catch (error) {
      notifyError('保存失败', error)
    } finally {
      setBusy(false)
    }
  }, [activeFilePath, client, notifyError])

  const onLogout = useCallback(() => {
    localStorage.removeItem(CONFIG_KEY)
    setClient(null)
    setConfig(null)
    setFiles([])
    setDirectories([])
    setExpandedFolders({})
    setActiveFilePath('')
    setDraftConfig(EMPTY_CONFIG)
    setRememberCredentials(false)
    setShowPassword(false)
    setContentWithHistory(DEFAULT_MARKDOWN, { resetHistory: true })
    setWysiwygSyncVersion((prev) => prev + 1)
    setStatus('已登出，并清除本地连接记录')
  }, [setContentWithHistory])

  const onUndo = useCallback(() => {
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
    if (historyIndexRef.current >= historyRef.current.length - 1) {
      return
    }
    historyIndexRef.current += 1
    setContentWithHistory(historyRef.current[historyIndexRef.current], { trackHistory: false })
    if (editorMode === 'wysiwyg') {
      setWysiwygSyncVersion((prev) => prev + 1)
    }
  }, [editorMode, setContentWithHistory])

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

  const syncMarkdownFromWysiwyg = useCallback(() => {
    const host = wysiwygEditorRef.current
    if (!host) {
      return
    }
    setContentWithHistory(htmlToMarkdown(host.innerHTML))
  }, [setContentWithHistory])

  const runWysiwygCommand = useCallback(
    (command: string, value?: string) => {
      const host = wysiwygEditorRef.current
      if (!host) {
        return
      }
      host.focus()
      document.execCommand(command, false, value)
      syncMarkdownFromWysiwyg()
    },
    [syncMarkdownFromWysiwyg],
  )

  const onToolbarAction = useCallback(
    (action: ToolbarAction) => {
      if (!canUseEditorActions) {
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

      if (editorMode === 'source') {
        switch (action) {
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
      }

      switch (action) {
        case 'h1':
          runWysiwygCommand('formatBlock', 'H1')
          break
        case 'h2':
          runWysiwygCommand('formatBlock', 'H2')
          break
        case 'bold':
          runWysiwygCommand('bold')
          break
        case 'italic':
          runWysiwygCommand('italic')
          break
        case 'bullet':
          runWysiwygCommand('insertUnorderedList')
          break
        case 'ordered':
          runWysiwygCommand('insertOrderedList')
          break
        case 'quote':
          runWysiwygCommand('formatBlock', 'BLOCKQUOTE')
          break
        case 'code':
          runWysiwygCommand('formatBlock', 'PRE')
          break
        case 'table':
          runWysiwygCommand(
            'insertHTML',
            '<table><thead><tr><th>列 1</th><th>列 2</th></tr></thead><tbody><tr><td>内容</td><td>内容</td></tr></tbody></table><p><br></p>',
          )
          break
        case 'task':
          runWysiwygCommand('insertHTML', '<ul><li>[ ] 新任务</li></ul><p><br></p>')
          break
        case 'math':
          runWysiwygCommand('insertText', '$$\n\n$$')
          break
        default:
          break
      }
    },
    [canUseEditorActions, editorMode, insertAroundSelection, insertBlock, insertLinePrefix, onRedo, onUndo, runWysiwygCommand],
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
          const created = await client.putFileContents(nextPath, '# 新建文档\n', { overwrite: false })
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

          const exists = await client.exists(nextPath)
          if (exists) {
            throw new Error(`文件已存在：${nextPath}`)
          }

          await client.putFileContents(nextPath, '# 新建文档\n', { overwrite: true })
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
        await targetClient.createDirectory(nextPath)
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

      if (kind === 'file' && !/\.(md|markdown)$/i.test(nextName)) {
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
        await targetClient.moveFile(targetPath, destinationPath)
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
    [activeFilePath, client, config, notifyError, reloadRemoteState],
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
        await targetClient.deleteFile(targetPath)
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
        const active = file.path === activeFilePath
        items.push(
          <button
            key={file.path}
            type="button"
            onClick={() => void onSelectFile(file.path)}
            onContextMenu={(event) => openContextMenu(event, file.path, 'file')}
            className={`flex h-8 w-full items-center gap-2 rounded-[var(--mf-radius-md)] px-2 py-1 text-left text-[13px] transition-colors ${
              active
                ? 'bg-[var(--mf-accent-soft)] text-[var(--mf-accent)]'
                : 'text-[var(--mf-muted-strong)] hover:bg-[var(--mf-surface-muted)]'
            }`}
            style={{ paddingLeft: `${28 + depth * 12}px` }}
          >
            <FileText className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{file.name}</span>
          </button>,
        )
      }

      return items
    },
    [activeFilePath, isFolderOpen, onSelectFile, openContextMenu],
  )

  const menuPath = contextMenu?.path ?? rootPath
  const createTargetPath = contextMenu?.kind === 'file' ? parentDavPath(menuPath) : menuPath

  return (
    <div className="h-full w-full bg-[var(--mf-bg)] text-[var(--mf-text)]">
      <div className="flex h-full w-full overflow-hidden">
        <aside
          className={`h-full border-r border-[var(--mf-border)] bg-[var(--mf-sidebar-bg)] transition-[width] duration-200 ${
            sidebarCollapsed ? 'w-16' : 'w-64'
          }`}
        >
          <div className="flex h-full flex-col">
            <div className="px-3 pb-2 pt-4">
              <div className={`flex h-8 items-center ${sidebarCollapsed ? 'justify-center' : 'justify-between'} gap-2`}>
                {sidebarCollapsed ? null : (
                  <div className="flex min-w-0 items-center gap-1.5">
                    <span className="text-[11px] font-semibold text-[var(--mf-success)]">●</span>
                    <span className="truncate text-xs text-[var(--mf-muted-strong)]">{config?.url || 'WebDAV Files'}</span>
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
                  <Button variant="toolbar" size="icon" onClick={onLogout} disabled={!isConnected} title="登出" aria-label="登出">
                    <LogOut className="h-4 w-4" />
                  </Button>
                </div>
              ) : isConnected ? (
                <div className="rounded-[var(--mf-radius-lg)] border border-[var(--mf-border)] bg-[var(--mf-surface)] p-2 shadow-[var(--mf-shadow-soft)]">
                  <div
                    className="rounded-[var(--mf-radius-md)] px-2 py-1.5"
                    onContextMenu={(event) => openContextMenu(event, rootPath, 'root')}
                  >
                    <div className="flex items-center gap-1.5 text-xs text-[var(--mf-muted)]">
                      <Folder className="h-3.5 w-3.5 text-[var(--mf-muted)]" />
                      <span className="truncate">根目录：{rootPath}</span>
                    </div>
                    <p className="mt-1 text-[11px] text-[var(--mf-muted)]">右键可新建、重命名、删除、刷新</p>
                  </div>
                  <div className="mt-1 space-y-1" onContextMenu={(event) => openContextMenu(event, rootPath, 'directory')}>
                    {renderTree(folderTree, 0)}
                  </div>
                </div>
              ) : (
                <div className="flex h-full flex-col items-center justify-center gap-4 px-3 text-center">
                  <div className="rounded-full bg-[var(--mf-surface-muted)] p-2.5">
                    <PlugZap className="h-4 w-4 text-[var(--mf-muted)]" />
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs font-medium text-[var(--mf-muted-strong)]">尚未连接 WebDAV</p>
                    <p className="text-[11px] text-[var(--mf-muted)]">连接后将在这里显示 Markdown 文件列表</p>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => setDialogOpen(true)}>
                    <Settings2 className="h-3.5 w-3.5" />
                    去连接
                  </Button>
                </div>
              )}
            </div>
          </div>
        </aside>

        <main className="flex min-w-0 flex-1 flex-col bg-[var(--mf-surface)]">
          <header className="flex min-h-[52px] flex-wrap items-center justify-between gap-3 border-b border-[var(--mf-border)] px-4">
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
                disabled={!canUseEditorActions}
                onClick={() => onToolbarAction('h1')}
              >
                <Heading1 className="h-4 w-4" />
              </Button>
              <Button
                variant="toolbar"
                size="icon"
                title="标题 2"
                disabled={!canUseEditorActions}
                onClick={() => onToolbarAction('h2')}
              >
                <Heading2 className="h-4 w-4" />
              </Button>
              <Button
                variant="toolbar"
                size="icon"
                title="粗体"
                disabled={!canUseEditorActions}
                onClick={() => onToolbarAction('bold')}
              >
                <Bold className="h-4 w-4" />
              </Button>
              <Button
                variant="toolbar"
                size="icon"
                title="斜体"
                disabled={!canUseEditorActions}
                onClick={() => onToolbarAction('italic')}
              >
                <Italic className="h-4 w-4" />
              </Button>
              <Button
                variant="toolbar"
                size="icon"
                title="无序列表"
                disabled={!canUseEditorActions}
                onClick={() => onToolbarAction('bullet')}
              >
                <List className="h-4 w-4" />
              </Button>
              <Button
                variant="toolbar"
                size="icon"
                title="有序列表"
                disabled={!canUseEditorActions}
                onClick={() => onToolbarAction('ordered')}
              >
                <ListOrdered className="h-4 w-4" />
              </Button>
              <Button
                variant="toolbar"
                size="icon"
                title="引用"
                disabled={!canUseEditorActions}
                onClick={() => onToolbarAction('quote')}
              >
                <Quote className="h-4 w-4" />
              </Button>
              <Button
                variant="toolbar"
                size="icon"
                title="代码块"
                disabled={!canUseEditorActions}
                onClick={() => onToolbarAction('code')}
              >
                <Code2 className="h-4 w-4" />
              </Button>
              <Button
                variant="toolbar"
                size="icon"
                title="表格"
                disabled={!canUseEditorActions}
                onClick={() => onToolbarAction('table')}
              >
                <Table2 className="h-4 w-4" />
              </Button>
              <Button
                variant="toolbar"
                size="icon"
                title="任务列表"
                disabled={!canUseEditorActions}
                onClick={() => onToolbarAction('task')}
              >
                <ListChecks className="h-4 w-4" />
              </Button>
              <Button
                variant="toolbar"
                size="icon"
                title="数学公式"
                disabled={!canUseEditorActions}
                onClick={() => onToolbarAction('math')}
              >
                <Calculator className="h-4 w-4" />
              </Button>
            </div>

            <div className="flex items-center gap-2">
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
                variant="toolbarAccent"
                size="icon"
                title="保存"
                aria-label="保存"
                onClick={() => void onSave()}
                disabled={!activeFilePath || busy}
              >
                <Save className="h-4 w-4" />
              </Button>
              <Button
                variant="toolbar"
                size="icon"
                title="刷新目录"
                aria-label="刷新目录"
                onClick={() => void onRefresh()}
                disabled={busy || !isConnected}
              >
                <RefreshCw className={`h-4 w-4 ${busy ? 'animate-spin' : ''}`} />
              </Button>
              <Dialog
                open={dialogOpen}
                onOpenChange={(nextOpen) => {
                  setDialogOpen(nextOpen)
                  if (nextOpen) {
                    const remembered = loadStoredConfig()
                    const source = config ?? remembered ?? EMPTY_CONFIG
                    setDraftConfig(source)
                    setRememberCredentials(Boolean(config ?? remembered))
                    setShowPassword(false)
                  }
                }}
              >
                <DialogTrigger asChild>
                  <Button variant="toolbar" size="icon" title="WebDAV 设定" aria-label="WebDAV 设定">
                    <SlidersHorizontal className="h-4 w-4" />
                  </Button>
                </DialogTrigger>
                <DialogContent className="h-auto w-[calc(100vw-24px)] max-w-[900px] overflow-hidden rounded-[20px] border-[#E5E7EB] bg-[#FFFFFF] p-0 shadow-none md:h-[560px] [&>button:last-child]:hidden">
                  <button
                    type="button"
                    aria-label="关闭配置窗口"
                    title="关闭配置窗口"
                    onClick={() => setDialogOpen(false)}
                    className="absolute right-2 top-2 z-10 inline-flex h-8 w-8 items-center justify-center rounded-full bg-transparent text-[16px] font-semibold leading-none text-[#64748B] transition-colors hover:bg-[#F1F5F9]"
                  >
                    ×
                  </button>
                  <div className="grid md:h-full md:grid-cols-[520px_380px]">
                    <div className="hidden h-full flex-col justify-center gap-[18px] rounded-[20px] bg-[#1D4ED8] px-6 py-8 md:flex">
                      <p className="text-[42px] font-semibold leading-[1.06] tracking-[-0.01em] text-[#EAF1FF]">[WebDAV] Hello World!</p>
                      <p className="text-[16px] text-[#BFDBFE]">Secure sync for your markdown workspace</p>
                      <div className="w-fit overflow-hidden rounded-[16px] border border-[#93C5FD66]">
                        <img src="/heroCard1.png" alt="WebDAV hero card" className="h-[220px] w-[320px] object-cover" />
                      </div>
                    </div>

                    <div className="flex h-full min-h-[520px] flex-col items-center justify-center rounded-[20px] bg-[#F8FAFC] px-6 py-8 sm:px-9 md:min-h-0 md:px-9 md:py-12">
                      <div className="w-full max-w-[320px]">
                        <p className="text-center text-[32px] font-bold leading-none text-[#1F2937]">MarkFlow~</p>
                      </div>

                      <div className="mt-[14px] grid w-full max-w-[320px] gap-[10px]">
                        <div className="grid gap-[6px]">
                          <Label htmlFor="webdav-url" className="text-[11px] font-medium text-[#6B7280]">
                            URL
                          </Label>
                          <Input
                            id="webdav-url"
                            placeholder="https://dav.example.com"
                            className="h-[42px] rounded-[6px] border-[#D1D5DB] bg-[#FFFFFF] px-3 text-[13px] text-[#111827] placeholder:text-[#9CA3AF] focus-visible:border-[#3B82F6] focus-visible:ring-[#3B82F633]"
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
                          <Label htmlFor="webdav-username" className="text-[11px] font-medium text-[#6B7280]">
                            用户名
                          </Label>
                          <Input
                            id="webdav-username"
                            placeholder="admin"
                            className="h-[42px] rounded-[6px] border-[#D1D5DB] bg-[#FFFFFF] px-3 text-[13px] text-[#111827] placeholder:text-[#9CA3AF] focus-visible:border-[#3B82F6] focus-visible:ring-[#3B82F633]"
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
                          <Label htmlFor="webdav-password" className="text-[11px] font-medium text-[#6B7280]">
                            密码
                          </Label>
                          <div className="relative">
                            <Input
                              id="webdav-password"
                              type={showPassword ? 'text' : 'password'}
                              placeholder="••••••••"
                              className="h-[42px] rounded-[6px] border-[#D1D5DB] bg-[#FFFFFF] px-3 pr-9 text-[13px] text-[#111827] placeholder:text-[#9CA3AF] focus-visible:border-[#3B82F6] focus-visible:ring-[#3B82F633]"
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
                              className="absolute right-2 top-1/2 inline-flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-[4px] text-[#6B7280] hover:bg-[#E5E7EB]"
                              aria-label={showPassword ? '隐藏密码' : '显示密码'}
                              title={showPassword ? '隐藏密码' : '显示密码'}
                            >
                              <Eye className="h-3 w-3" />
                            </button>
                          </div>
                        </div>

                        <label className="inline-flex cursor-pointer items-center gap-2 pt-[2px] text-[13px] text-[#4B5563]">
                          <input
                            type="checkbox"
                            checked={rememberCredentials}
                            onChange={(event) => setRememberCredentials(event.target.checked)}
                            className="h-4 w-4 rounded-[4px] border border-[#CBD5E1] accent-[#3B82F6]"
                          />
                          记住连接凭证
                        </label>

                        <Button
                          className="h-[42px] rounded-[6px] bg-[#3B82F6] text-[16px] font-semibold text-[#FFFFFF] hover:bg-[#2563EB]"
                          onClick={() => {
                            const nextConfig = {
                              ...draftConfig,
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

          <section className="flex-1 overflow-hidden bg-[var(--mf-surface)] p-6">
            <div className="h-full border border-[var(--mf-border-soft)] bg-[var(--mf-surface)]">
              {!isConnected ? (
                <div className="flex h-full items-center justify-center px-6 text-sm text-[var(--mf-muted)]">
                  连接成功后才能编辑文档
                </div>
              ) : !activeFilePath ? (
                <div className="flex h-full items-center justify-center px-6 text-sm text-[var(--mf-muted)]">
                  请先在左侧文件树选择一个 Markdown 文件
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
                  placeholder="开始书写 Markdown..."
                />
              ) : (
                <WysiwygMarkdownEditor
                  editable={canUseEditorActions}
                  markdown={content}
                  syncVersion={wysiwygSyncVersion}
                  onChange={(nextValue) => setContentWithHistory(nextValue)}
                  onHostChange={(node) => {
                    wysiwygEditorRef.current = node
                  }}
                />
              )}
            </div>
          </section>

          <footer className="flex h-8 items-center justify-between border-t border-[var(--mf-border)] px-4 text-xs text-[var(--mf-muted)]">
            <div className="flex items-center gap-2">
              <FilePenLine className="h-3.5 w-3.5" />
              <span>{content.length} 字符</span>
            </div>
            <span title={status}>{busy ? '处理中...' : status}</span>
          </footer>
        </main>
      </div>

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
                打开文件
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
