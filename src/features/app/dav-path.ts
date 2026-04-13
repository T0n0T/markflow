function decodeDavPathSegment(segment: string) {
  try {
    return decodeURIComponent(segment)
  } catch {
    return segment
  }
}

export function normalizeDavPath(path: string) {
  const trimmed = path.trim()
  if (!trimmed || trimmed === '/') {
    return '/'
  }
  return `/${trimmed.replace(/^\/+/, '').replace(/\/+$/, '')}`
}

export function toClientDavPath(path: string) {
  const normalizedPath = normalizeDavPath(path)
  if (normalizedPath === '/') {
    return ''
  }

  return normalizedPath
    .split('/')
    .filter(Boolean)
    .map((segment) => decodeDavPathSegment(segment))
    .join('/')
}

export function toDavPathname(value: string) {
  const trimmed = value.trim()
  if (!trimmed) {
    return '/'
  }

  const rawPathname = (() => {
    try {
      return new URL(trimmed, 'http://localhost').pathname || '/'
    } catch {
      return trimmed
    }
  })()

  const normalizedPath = normalizeDavPath(rawPathname)
  if (normalizedPath === '/') {
    return '/'
  }

  return `/${normalizedPath
    .split('/')
    .filter(Boolean)
    .map((segment) => decodeDavPathSegment(segment))
    .join('/')}`
}

export function getRemoteBasePath(url: string) {
  try {
    return normalizeDavPath(new URL(url).pathname || '/')
  } catch {
    return '/'
  }
}

export function toAppDavPath(remotePath: string, remoteBasePath: string) {
  const normalizedPath = normalizeDavPath(toDavPathname(remotePath))
  const normalizedBasePath = normalizeDavPath(toDavPathname(remoteBasePath))

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

export function joinDavPath(basePath: string, segment: string) {
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

export function parentDavPath(path: string) {
  const normalized = normalizeDavPath(path)
  if (normalized === '/') {
    return '/'
  }
  const next = normalized.split('/').slice(0, -1).join('/')
  return next ? normalizeDavPath(next) : '/'
}

export function getBaseName(path: string) {
  return normalizeDavPath(path).split('/').filter(Boolean).pop() ?? '/'
}

export function getFileExtension(path: string) {
  const baseName = getBaseName(path).toLowerCase()
  const dotIndex = baseName.lastIndexOf('.')
  if (dotIndex <= 0 || dotIndex >= baseName.length - 1) {
    return ''
  }
  return baseName.slice(dotIndex + 1)
}
