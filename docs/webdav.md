# WebDAV 实现要点（MarkFlow）

本文记录 `markflow` 当前 WebDAV 连接与读写逻辑，便于后续维护和排障。

## 1. 连接输入与基地址规则

- 用户输入 URL 必须包含 WebDAV 路径，例如：`http://192.168.2.8:5244/dav`
- 连接时先做 URL 归一化：
  - `normalizeUrl(url)`: 去掉尾部多余 `/`
  - `ensureDavBaseUrl(url)`: 再强制补一个尾部 `/`
- 目的：确保客户端基地址稳定在 `/dav/`，避免请求落到站点根路径 `/`

## 2. 请求路径策略（关键）

- 所有 WebDAV API 调用都走 `toClientDavPath(path)` 转换
- 规则：
  - 应用内路径 `/` -> 客户端相对路径 `""`
  - 应用内路径 `/foo/bar.md` -> 客户端相对路径 `foo/bar.md`
- 目的：避免把前导 `/` 当成绝对路径，导致请求错误地打到 `http://host/` 而不是 `http://host/dav/`

## 3. 目录读取策略

- 目录扫描使用 `listRemote` 的 BFS 逐层遍历
- 每层调用：`getDirectoryContents(path, { deep: false })`
- 不再依赖一次性 `deep: true`（Depth: infinity）
- 目的：提升与 AList/不同 WebDAV 实现的兼容性

## 4. 远端返回路径映射

- 一些服务端返回的 `filename/href` 可能是：
  - 完整 URL
  - 带 `/dav` 前缀的绝对路径
  - 编码路径
- 当前处理链路：
  - `toDavPathname`: 提取 pathname 并解码
  - `getRemoteBasePath`: 从配置 URL 提取远端基路径（如 `/dav`）
  - `toAppDavPath`: 将远端路径映射为应用内部路径（统一为 `/...`）
- 目的：保证文件树、打开、保存、重命名等逻辑使用同一套应用内路径语义

## 5. 文件写入与 AList 兼容回退

- 新建文件默认尝试：
  - `putFileContents(path, content, { overwrite: false })`（等价于 If-None-Match）
- 若命中 AList 常见不兼容错误（如 `400/405/501` 或 precondition 类错误）：
  - 先 `exists(path)` 检查是否已存在
  - 再 `putFileContents(path, content, { overwrite: true })` 回退创建
- 该回退仅用于新建文件流程，避免误覆盖已有内容

## 6. 配置持久化

- 本地存储键：`markflow.webdav.config`
- 内容：`url / username / password / rootPath`
- 在“记住凭证”打开时持久化；关闭时清除

## 7. 常见故障排查

- `PROPFIND ... 405 Method Not Allowed`
  - 先检查请求 URL 是否误打到根路径 `/`
  - 再检查输入 URL 是否为 `.../dav`（而不是仅主机端口）
- `401/403`
  - 认证失败，检查用户名/密码
- 能连上但看不到文件
  - 检查 `rootPath` 与返回路径映射是否在同一目录层级
- 建议在浏览器 Network 里筛选 `PROPFIND/GET/PUT/MOVE/MKCOL/DELETE` 观察真实请求地址

## 8. 关键代码位置

- `src/App.tsx`
  - `ensureDavBaseUrl`
  - `toClientDavPath`
  - `toDavPathname`
  - `getRemoteBasePath`
  - `toAppDavPath`
  - `listRemote`
  - `connectWebdav`
  - `shouldFallbackCreateFileForAList`

## 9. 附件存储（图片/文件）

- 配置项并入 `markflow.webdav.config.attachments`，支持：
  - `storageMode`: `same_dir_assets | root_attachments | doc_assets`
  - `linkFormat`: `relative | root_relative | absolute_url`
  - `folderName`: 目录名（默认 `_assets`）
  - `maxSizeMB`: 上传体积上限（默认 `20`）
- 默认策略：
  - 存储：同目录 `_assets/<文档名>/`
  - 链接：相对路径（例如 `./_assets/note/demo.png`）
- 上传入口：
  - 顶部“上传附件”按钮（图片和普通文件）
  - Crepe 图片块上传（onUpload）会直接上传到 WebDAV
  - 编辑器内直接粘贴截图（Clipboard image）会拦截默认 base64 行为，改为上传后插入链接
- 上传流程：
  - 先创建目标目录（优先 `recursive`，失败则逐级回退）
  - 再 `putFileContents`
  - 若命中 AList 兼容问题，走存在性检查 + `overwrite: true` 回退
