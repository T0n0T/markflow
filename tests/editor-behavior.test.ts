import assert from 'node:assert/strict'
import test from 'node:test'

import { toAppDavPath, toClientDavPath } from '../src/features/app/dav-path.ts'
import {
  extractMarkdownSelectionMarkers,
  injectMarkdownSelectionMarkers,
} from '../src/features/app/editor-selection.ts'

test('toClientDavPath returns decoded path segments for the webdav client to encode once', () => {
  assert.equal(
    toClientDavPath('/会议记录/第 1 章.md'),
    '会议记录/第 1 章.md',
  )

  assert.equal(
    toClientDavPath('/%E4%BC%9A%E8%AE%AE%E8%AE%B0%E5%BD%95/%E7%AC%AC%201%20%E7%AB%A0.md'),
    '会议记录/第 1 章.md',
  )
})

test('toAppDavPath decodes remote WebDAV paths with Chinese filenames', () => {
  assert.equal(
    toAppDavPath('https://dav.example.com/remote.php/dav/files/demo/%E4%BC%9A%E8%AE%AE%E8%AE%B0%E5%BD%95.md', '/remote.php/dav/files/demo'),
    '/会议记录.md',
  )

  assert.equal(
    toAppDavPath('/remote.php/dav/files/demo/%E7%AC%94%E8%AE%B0/%E6%B5%8B%E8%AF%95.md', '/remote.php/dav/files/demo'),
    '/笔记/测试.md',
  )
})

test('selection markers round-trip a collapsed caret', () => {
  const markdown = '# 标题\n\n你好，世界\n'
  const marked = injectMarkdownSelectionMarkers(markdown, { start: 7, end: 7 })
  const restored = extractMarkdownSelectionMarkers(marked)

  assert.equal(restored.markdown, markdown)
  assert.deepEqual(restored.selection, { start: 7, end: 7 })
})

test('selection markers round-trip a non-empty selection', () => {
  const markdown = '第一段文字\n\n第二段文字'
  const marked = injectMarkdownSelectionMarkers(markdown, { start: 0, end: 4 })
  const restored = extractMarkdownSelectionMarkers(marked)

  assert.equal(restored.markdown, markdown)
  assert.deepEqual(restored.selection, { start: 0, end: 4 })
})
