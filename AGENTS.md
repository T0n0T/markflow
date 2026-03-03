# Repository Guidelines

## Project Structure & Module Organization
This repository is a Vite + React + TypeScript frontend.

- `src/main.tsx`: application entry point.
- `src/App.tsx`: main editor and WebDAV integration flow.
- `src/components/ui/`: reusable UI primitives (shadcn/Radix-based).
- `src/lib/`: shared utilities (`utils.ts` with `cn()` helper).
- `public/`: static assets served as-is.
- Root config: `vite.config.ts`, `eslint.config.js`, `tsconfig*.json`, `components.json`.

Use the `@` alias for imports from `src` (example: `@/components/ui/button`).

## Build, Test, and Development Commands
Use `pnpm` (lockfile is `pnpm-lock.yaml`).

- `pnpm install`: install dependencies.
- `pnpm dev`: start local dev server with HMR.
- `pnpm build`: run TypeScript project build (`tsc -b`) and produce production bundle.
- `pnpm lint`: run ESLint across the repo.
- `pnpm preview`: serve the production build locally.

Before opening a PR, run at least: `pnpm lint && pnpm build`.

## Coding Style & Naming Conventions
- Language: TypeScript (`.ts`/`.tsx`) with React function components and hooks.
- Indentation: 2 spaces; keep existing semicolon-free style.
- Components/types: `PascalCase` (for example, `DialogContent`, `DavConfig`).
- Variables/functions: `camelCase`; constants: `UPPER_SNAKE_CASE`.
- Prefer small, composable UI components under `src/components/ui/`.
- Styling uses Tailwind utility classes in JSX plus shared base styles in `src/index.css`.

## Testing Guidelines
There is currently no automated test framework or `test` script configured.

- For now, treat `pnpm lint` and `pnpm build` as required quality gates.
- Manually verify core flows in `pnpm dev` (connect WebDAV, open file, edit, save, refresh).
- When adding tests, prefer co-located names like `ComponentName.test.tsx` near the source file.

## Commit & Pull Request Guidelines
Git history is not available in this workspace snapshot, so no existing commit convention could be inferred. Use Conventional Commits going forward (for example, `feat: add WebDAV reconnect state`).

PRs should include:
- Clear summary of user-visible changes.
- Linked issue/task ID when applicable.
- Verification steps (commands run + manual checks).
- Screenshots or short recordings for UI changes.

## Security & Configuration Tips
- WebDAV credentials are stored in browser `localStorage` (`markflow.webdav.config`); never commit real credentials.
- Keep URLs, usernames, and passwords out of source code and docs.
