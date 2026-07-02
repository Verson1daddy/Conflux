<div align="center">
  <img src="conflux-app/app-icon.png" alt="Conflux logo" width="104" height="104" />

# Conflux

### The Windows-first control plane for AI coding agents.

Run Claude Code, Codex, Aider, OpenCode, and future agent CLIs in one local visual workspace — with real PTY sessions, attention surfaces, discussions, artifacts, and session timelines.

[English](#english) · [中文](#中文)

</div>

---

<a id="english"></a>

## Why this matters

AI coding agents are no longer just chat boxes. They run in terminals, wait for approvals, edit files, spawn sub-agents, produce artifacts, and ask humans to jump back at exactly the right moment.

Conflux is built for that moment: **a local desktop workbench that lets you stop babysitting every terminal while still staying in control of every agent.**

Instead of another chat UI, Conflux treats agent work as a set of real sessions, cards, events, permissions, discussions, and reviews.

## What Conflux does

- **One visual workspace for many agent CLIs** — manage real Claude Code, Codex, Aider, OpenCode, and future adapters from one Windows desktop app.
- **Real terminal sessions, not mock cards** — sessions are backed by PTY processes and rendered through xterm.js.
- **Attention surfaces for background agents** — Top Island, Sidebar, tray, notifications, and permission UI help surface what needs you now.
- **Canvas-first agent workbench** — draggable cards, compact previews, expanded terminals, search, settings, status bar, and session history.
- **Broadcast discussions (user → agents)** — send one message into every participating agent's session at once, with per-agent delivery status, review flow, and artifacts tied to the session lifecycle. Agents do not talk to each other: their replies stay in their own terminals and are not routed back into the chatroom.
- **Artifacts and review flow** — extract code blocks, pin or draft important outputs, and close discussions with an explicit review state.
- **Event timeline** — inspect session events from SQLite-backed persistence. V1 calls this an event timeline, not full terminal replay.
- **Framework-neutral architecture** — adapters are modeled as definitions, installations, real sessions, visual cards, and orchestration targets.

## Current status

Conflux is in **active V1 hardening**.

The runtime skeleton is implemented and covered by automated validation, including frontend typecheck/tests/build and Rust checks/tests. It is not yet a V1 release candidate: Windows smoke evidence, compact-mode recording, final visual-contract validation, and performance baselines are still being closed.

Use it as an early project, reference implementation, or development workbench — not as polished production software yet.

## Product model

Conflux keeps the core model separated so it can grow beyond one or two hardcoded CLIs:

```text
AdapterDefinition
  -> AdapterInstallation
  -> AgentSession
  -> CardView
  -> WorkspaceOrchestration
```

| Layer | What it means |
|---|---|
| `AdapterDefinition` | What an agent CLI framework is: command, args, parser profile, capabilities. |
| `AdapterInstallation` | Whether it is installed, authenticated, runnable, and session-capable on this machine. |
| `AgentSession` | A real running CLI process/session with cwd, status, events, timestamps, and lifecycle. |
| `CardView` | The visual projection of a session on the canvas. |
| `WorkspaceOrchestration` | Discussions, notifications, permissions, pinned targets, artifacts, and reviews across sessions. |

## Tech stack

| Area | Stack |
|---|---|
| Desktop runtime | Tauri 2 |
| Backend | Rust 2021, Tokio, rusqlite, portable-pty |
| Frontend | React 18, TypeScript, Vite |
| State | Zustand + local storage where appropriate |
| Terminal | xterm.js with fit, web-links, and WebGL addons |
| Styling | Tailwind CSS, custom CSS tokens, design token files |
| Tests | Vitest, React Test Renderer, Rust tests |

## Repository map

```text
conflux-app/
  src/                  React + TypeScript frontend
    components/         Workspace, island, card, discussion, session UI
    hooks/              Runtime and layout hooks
    lib/                IPC bridge, compact mode, event utilities, view models
    stores/             Zustand stores for workspace/agent/island state
    types/              Shared frontend contracts
  src-tauri/            Rust + Tauri backend
    src/adapter/        Builtin and TOML adapter registry
    src/commands/       Tauri IPC commands
    src/core/           Shared Rust types, events, errors
    src/orchestration/  Discussion and coordinator logic
    src/persistence/    SQLite schema, session/events/workspace persistence
    src/pty/            PTY process management and output parsing
    src/tray.rs         System tray integration

design/                 Icons, design handoffs, design tokens, Pencil source
.workbench/coordination/  Project workflow, reports, research, handoffs (relocated)
docs/                   Specs, plans, and roadmap notes
```

## Quick start

### Prerequisites

- Windows 11 is the primary target.
- Node.js and npm.
- Rust toolchain compatible with Rust 1.77+.
- Tauri 2 prerequisites for Windows.
- At least one supported agent CLI installed if you want to create real sessions:
  - Claude Code: `claude`
  - Codex: `codex`
  - Aider: `aider`
  - OpenCode: `opencode`

### Install

```bash
cd conflux-app
npm install
```

### Run

```bash
npm run tauri:dev
```

Frontend-only iteration:

```bash
npm run dev
```

### Build

```bash
npm run tauri:build
```

## Verification

From `conflux-app/`:

```bash
npm run typecheck
npm test -- --run
npm run build
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml --lib -- --nocapture
```

## Roadmap

### V1 — Trustworthy local workbench

- Real session creation and terminal input semantics.
- No ghost cards or ghost sessions after failures.
- Unified runtime state across cards, TopBar, Island, Sidebar, timeline, and persistence.
- Discussion artifacts, end-discussion review, and event timeline lifecycle.
- Windows compact-mode smoke tests and performance baseline.

### V1.5 — Adapter Manifest

- Local adapter manifest import/export.
- Compatibility validation.
- Capability profiles for framework behavior.
- Configurable healthcheck and auth probes.

### V2 — Workflow Review

- Review summaries generated from local session events, discussions, and artifacts.
- Optional API enhancement without making cloud services a requirement.
- Review surfaces inside cards, discussion flows, and session timeline.

### V2.5 — Workflow / Persona / Policy Library

- Reusable workflow presets.
- Persona and policy presets.
- Budget and quality gate presets.
- Capability-profile-driven role suggestions.

### V3+ — Lightweight ecosystem

- File-first and GitHub-first sharing of adapters, workflows, layouts, and notification rules.
- No account system as a prerequisite.
- Compatibility checks and risk warnings before any heavier marketplace/community layer.

## Non-goals for V1

Conflux V1 intentionally does not include marketplace/community, accounts, comments/ratings, cloud template distribution, full multi-framework auto-routing, or full terminal replay.

The goal is to make the local agent workbench reliable first.

---

<a id="中文"></a>

## 中文

## Conflux 是什么？

Conflux 是一个 **Windows 优先的 AI Coding Agent 控制面**。

它不是另一个聊天窗口，而是一个本地桌面工作台：把 Claude Code、Codex、Aider、OpenCode 以及未来更多 agent CLI 放到同一个可视化空间里，用真实终端会话、画布卡片、灵动岛/侧边栏注意力层、讨论面板、产物抽屉和事件时间线组织起来。

核心目标是：**让你不用一直盯着每个终端，但关键时刻仍然能准确接管。**

## 它解决什么问题？

当 AI coding agent 从“问答工具”变成“后台执行体”后，开发者会遇到新问题：

- 多个 agent 分散在不同终端、IDE、窗口里；
- 权限请求、错误、完成状态很容易被错过；
- 产物、讨论、复盘和真实 session 生命周期割裂；
- 多框架协作很难被人类理解和管理；
- 纯终端缺少总览，纯聊天 UI 又丢失了真实运行态。

Conflux 的方向是把这些 agent 工作变成一个可观察、可接管、可复盘的本地控制面。

## 当前已经实现的能力

- **Tauri 2 桌面壳层**：Rust 后端 + React/TypeScript 前端。
- **真实 PTY 会话**：通过 Windows ConPTY / `portable-pty` 启动和管理 CLI。
- **内置适配器**：Claude Code、Codex、Aider、OpenCode。
- **可视化工作台画布**：Agent 卡片、终端预览、展开态终端、搜索、设置、状态栏。
- **注意力层**：Top Island、Sidebar、通知、权限 UI、系统托盘。
- **广播式讨论（用户 → agents）**：一条消息同时注入全部参与 agent 的会话（含逐 agent 送达状态）、隐藏 sandbox 实例、结束讨论 review。agent 之间**不**互相对话——各自的回复留在各自终端，不回流聊天室。
- **Artifacts 生命周期**：代码块提取、pin/draft、review snapshot。
- **Session Event Timeline**：基于 SQLite 的事件时间线；V1 明确不是完整终端录像回放。
- **自动化验证**：前端 typecheck/test/build、Rust check/lib tests 已形成基线。

## 当前状态

Conflux 目前处于 **V1 hardening / 预发布收口阶段**。

代码骨架和主路径已经接起来，但还不能宣称是正式 V1 RC。剩余重点包括 Windows 实机 smoke、compact mode 录屏证据、视觉契约复核和性能基线。

如果你对多 agent CLI 工作台、Windows 桌面 agent 控制面、AI coding workflow 可视化感兴趣，现在是很适合关注和参与的阶段。

## 架构模型

Conflux 使用五层模型，避免把产品写死成某一个 CLI 的外壳：

```text
AdapterDefinition
  -> AdapterInstallation
  -> AgentSession
  -> CardView
  -> WorkspaceOrchestration
```

- `AdapterDefinition`：一个 agent CLI 框架是什么。
- `AdapterInstallation`：它在当前机器上是否安装、登录、可运行。
- `AgentSession`：一次真实运行中的 CLI 会话。
- `CardView`：这个 session 在画布上的视觉投影。
- `WorkspaceOrchestration`：跨 session 的讨论、通知、权限、产物和复盘。

## 开发启动

```bash
cd conflux-app
npm install
npm run tauri:dev
```

前端单独调试：

```bash
npm run dev
```

构建：

```bash
npm run tauri:build
```

验证：

```bash
npm run typecheck
npm test -- --run
npm run build
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml --lib -- --nocapture
```

## 路线图

- **V1**：稳定本地多 agent CLI 工作台，收口真实 session、终端输入、失败语义、compact mode、discussion/artifacts、事件时间线。
- **V1.5**：Adapter Manifest，让更多 CLI 能以本地 manifest 方式接入。
- **V2**：Workflow Review，基于本地事件、讨论、产物生成复盘。
- **V2.5**：Workflow / Persona / Policy Library，把多 agent 协作纪律沉淀成可复用预设。
- **V3+**：轻量生态，文件优先、GitHub 优先地分享 adapter、workflow、layout、notification rules。

## V1 暂不做什么？

V1 不做 marketplace、账号系统、云端社区、评分评论、重度 workflow 商店、完整自动路由，也不承诺完整终端录像回放。

Conflux 会先把本地运行态做可信，再逐步进入更大的协作和生态层。

---

## License

No root license file is currently present in this repository. Add a license before distributing binaries or accepting external contributions.
