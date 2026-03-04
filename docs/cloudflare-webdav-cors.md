# Cloudflare WebDAV CORS 配置手册

本文用于 `markflow` 前端在浏览器中访问 WebDAV 时的 Cloudflare 侧配置，目标是让 `OPTIONS` 预检和实际 WebDAV 请求都稳定返回一致的 CORS 头。

## 1. 问题背景与根因

- 现象：
  - 系统层挂载 WebDAV 可用
  - 浏览器从 `http://localhost:5173` 访问 `https://test.webdav/dav` 失败
- 根因：
  - Cloudflare Access 应用仅匹配 `/dav/`，没覆盖 `/dav`
  - Response Header Transform 规则也只匹配 `/dav/`，导致 `/dav` 和 `/dav/...` 响应头不一致

## 2. Cloudflare 应用跨域资源配置步骤

以下步骤只改 Cloudflare，不改源站 WebDAV 配置。

### 步骤 A：修正 Access 应用路径匹配

- 进入 `Zero Trust Dashboard -> Access -> Applications`
- 打开 WebDAV 对应应用（例如 `webdav`）
- 将应用路径从 `test.webdav/dav/` 改为 `test.webdav/dav*`
- 在策略中确认：
  - 策略类型：`bypass`
  - Subject：`everyone`
- 在应用设置中启用 `options_preflight_bypass = true`

目的：让 `/dav` 和 `/dav/...` 的 `OPTIONS` 与实际请求都不会被 Access 额外拦截。

### 步骤 B：配置 Transform Rule 注入 CORS 响应头

- 进入 `Cloudflare Dashboard -> Rules -> Transform Rules`
- 选择 `Response Header Transform`（phase: `http_response_headers_transform`）
- 新建或编辑规则（示例名：`webdav-cors`）
- 匹配表达式：
  - `http.host eq "test.webdav" and starts_with(http.request.uri.path, "/dav")`
- 动作选择 `rewrite`，并统一使用 `set` 操作写入以下响应头：

- `Access-Control-Allow-Origin: *`
- `Access-Control-Allow-Methods: OPTIONS, GET, HEAD, PUT, DELETE, PROPFIND, PROPPATCH, MKCOL, COPY, MOVE, LOCK, UNLOCK`
- `Access-Control-Allow-Headers: Authorization, Content-Type, Depth, Destination, Overwrite, If, If-Match, If-None-Match, Lock-Token, Timeout, Range`
- `Access-Control-Expose-Headers: DAV, Allow, ETag, Content-Length, Content-Range, WWW-Authenticate`
- `Access-Control-Max-Age: 86400`
- `Vary: Origin`

说明：
- 当前配置使用 `Access-Control-Allow-Origin: *`，适合不依赖 Cookie 的前端请求。
- 如果后续改为 `credentials: include`（Cookie/会话鉴权），需改为明确 Origin，且补 `Access-Control-Allow-Credentials: true`，不能再用 `*`。

## 3. 验证步骤（必须执行）

```bash
curl -si -X OPTIONS 'https://test.webdav/dav' \
  -H 'Origin: http://localhost:5173' \
  -H 'Access-Control-Request-Method: PROPFIND' \
  -H 'Access-Control-Request-Headers: authorization,depth,content-type'

curl -si -X OPTIONS 'https://test.webdav/dav/projects/markflow' \
  -H 'Origin: http://localhost:5173' \
  -H 'Access-Control-Request-Method: PROPFIND' \
  -H 'Access-Control-Request-Headers: authorization,depth,content-type'
```

预期结果：

- `OPTIONS` 返回 `204`（或源站定义的可接受成功码）
- `/dav` 与 `/dav/...` 的 CORS 头一致
- 即使 `GET/PROPFIND` 返回 `401`，也应带 `Access-Control-*` 响应头（否则浏览器会报 CORS，而不是把真实 401 暴露给前端）

## 4. 本次 WebDAV 需要重点注意的配置项

- 路径匹配：
  - Access 应用与 Transform Rule 都要覆盖 `/dav` + `/dav/...`
  - 推荐统一使用 `starts_with(path, "/dav")` 或 `dav*` 语义，避免尾斜杠差异
- 方法白名单：
  - 除 `GET/PUT/DELETE` 外，必须包含 `PROPFIND/PROPPATCH/MKCOL/COPY/MOVE/LOCK/UNLOCK`
- 请求头白名单：
  - 至少包含 `Authorization`, `Depth`, `Destination`, `Overwrite`, `If*`, `Lock-Token`, `Timeout`
- 暴露响应头：
  - 建议暴露 `DAV`, `Allow`, `ETag`, `WWW-Authenticate`，便于前端处理协议能力和鉴权异常
- 预检缓存：
  - `Access-Control-Max-Age` 建议保留（例如 `86400`），减少重复预检压力
- 鉴权模型一致性：
  - Basic/Auth Header 模式下可用 `Allow-Origin: *`
  - Cookie 会话模式必须使用明确 Origin + `Allow-Credentials: true`
- 规则优先级：
  - 若同域还有其他 Transform/Access 规则，确保 WebDAV 规则优先匹配，不被后续规则覆盖

## 5. 我当前可用的 Cloudflare 相关 Skill

- Skill 名称：`cloudflare-troubleshooting`
- 作用：通过 Cloudflare API 做证据化排障（重定向、SSL、DNS、源站 5xx、规则冲突等）
- 工作方式：
  - 先查 zone 与当前配置，再诊断，不基于猜测
  - 优先 `GET` 拉取现状，确认后再做 `PATCH/POST` 变更
  - 变更后复验（API + curl/dig）
- 适用场景：
  - `ERR_TOO_MANY_REDIRECTS`
  - SSL 证书/握手错误
  - DNS 解析异常
  - Cloudflare 规则互相覆盖导致的行为异常

## 6. 安全说明

- 不在仓库、日志、截图中保存 Cloudflare Token/API Key
- 令牌疑似泄露时，立即在 Cloudflare 执行 `Roll` 或删除重建
