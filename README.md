# MarkFlow

MarkFlow 是一个基于 React + TypeScript + Vite 的 Markdown 编辑器，支持通过 WebDAV 连接远端目录并同步文档。

## 技术栈

- React 19
- TypeScript
- Vite
- Tailwind CSS
- shadcn/ui + Radix UI
- `webdav` 客户端库

## 主要功能

- WebDAV 连接、重连、登出
- 左侧目录树浏览与右键操作（新建、重命名、删除）
- Markdown 编辑与保存
- 所见即所得与原文模式切换
- 本地保存连接配置（可选记住凭证）

## 顶部工具栏行为

- 右侧不再显示“所见即所得 / 原文”文字切换区。
- 右侧不再显示“未选择文件”文本。
- “所见即所得 / 原文”切换统一通过眼睛图标按钮完成：
  - 当前为所见即所得时，点击切换到原文模式
  - 当前为原文时，点击切换到所见即所得模式
- WebDAV 按钮使用滑杆图标（`SlidersHorizontal`）。
- 最右侧按钮按连接状态显示：
  - 已连接：显示登出图标
  - 未连接：显示登录图标（点击打开 WebDAV 配置弹窗）

## WebDAV 配置弹窗

- 配置弹窗右上角提供可见的 `×` 关闭按钮。
- 支持输入 URL、用户名、密码并可切换密码可见性。
- 支持“记住连接凭证”复选框。

## 开发

```bash
pnpm install
pnpm dev
```

## 构建与校验

```bash
pnpm lint
pnpm build
```

建议在提交前至少执行一次 `pnpm lint && pnpm build`。

## Docker 部署

项目已提供多阶段构建 `Dockerfile`，会先执行 `pnpm build`，再用 Nginx 托管 `dist` 静态文件。

### 构建镜像

```bash
docker build -t markflow:latest .
```

### 运行容器

```bash
docker run -d --name markflow -p 8080:80 --restart unless-stopped markflow:latest
```

启动后访问：`http://localhost:8080`

### 健康检查

```bash
curl http://localhost:8080/healthz
```

更多说明见：`docs/docker-deploy.md`
