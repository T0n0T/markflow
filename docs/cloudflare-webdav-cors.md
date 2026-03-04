# Cloudflare WebDAV 跨域配置记录（`pan.718294.xyz/dav`）

> 记录时间：2026-03-04

本文仅记录 Cloudflare 层（Access + Transform Rules）的配置与验证结果，不包含项目内实现细节。

## 1. 现象与根因

- 现象：
  - 系统级 WebDAV 挂载可用
  - 浏览器前端请求 `https://pan.718294.xyz/dav` 失败
- 根因：
  - Access 应用路径只匹配 `/dav/`，未覆盖 `/dav`
  - CORS 规则也只匹配 `/dav/`，导致 `/dav` 与 `/dav/...` 返回头不一致

## 2. Access 应用配置（Zero Trust）

- 应用：`webdav`
- 域匹配从：
  - `pan.718294.xyz/dav/`
- 调整为：
  - `pan.718294.xyz/dav*`
- 策略：`bypass`（`everyone`）
- 选项：`options_preflight_bypass = true`

目的：确保 `/dav` 与 `/dav/...` 都不被上层受保护应用拦截。

## 3. Transform Rule（响应头）

- Phase：`http_response_headers_transform`
- 表达式：
  - `http.host eq "pan.718294.xyz" and starts_with(http.request.uri.path, "/dav")`
- 动作：`rewrite`
- 规则 ID：`c27d9f76480549c984451137c2d444d8`
- 描述：`webdav-cors`

统一设置（全部 `operation: set`）：

- `Access-Control-Allow-Origin: *`
- `Access-Control-Allow-Methods: OPTIONS, GET, HEAD, PUT, DELETE, PROPFIND, PROPPATCH, MKCOL, COPY, MOVE, LOCK, UNLOCK`
- `Access-Control-Allow-Headers: Authorization, Content-Type, Depth, Destination, Overwrite, If, If-Match, If-None-Match, Lock-Token, Timeout, Range`
- `Access-Control-Expose-Headers: DAV, Allow, ETag, Content-Length, Content-Range, WWW-Authenticate`
- `Access-Control-Max-Age: 86400`
- `Vary: Origin`

## 4. 验证命令

```bash
curl -si -X OPTIONS 'https://pan.718294.xyz/dav' \
  -H 'Origin: http://localhost:5173' \
  -H 'Access-Control-Request-Method: PROPFIND' \
  -H 'Access-Control-Request-Headers: authorization,depth,content-type'

curl -si -X OPTIONS 'https://pan.718294.xyz/dav/projects/markflow' \
  -H 'Origin: http://localhost:5173' \
  -H 'Access-Control-Request-Method: PROPFIND' \
  -H 'Access-Control-Request-Headers: authorization,depth,content-type'
```

期望结果：

- 预检返回 `204`
- `/dav` 与 `/dav/...` CORS 头一致
- `GET/PROPFIND` 即使返回 `401` 也包含 `Access-Control-*` 头

## 5. 安全说明

- 不在仓库或日志中保存 Cloudflare token
- token 若已暴露，需立刻在 Cloudflare 执行 `Roll` 或删除重建
