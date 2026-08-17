# Agent Note: 面向 TUI 消费者的平台无关 presentation exports

Status: implemented

[English](2026-08-16-tui-platform-neutral-presentation-exports.md) | 中文

## 问题

外部 TUI 消费者需要使用 DSH 的 conversation、tool、workflow、trajectory 和 Markdown 投影 owner，但不能挂载浏览器 client object layer，也不能导入私有 `src/*` 路径。现有 package face 面向浏览器，未提供可安装、可在纯 Node 中加载的投影入口。

## 决策

由现有 owner package 发布面向 TUI 组合的 platform-neutral 子路径：

- `@deepseek-ai/dsh-client-runtime/presentation`
- `@deepseek-ai/dsh-client-ui-conversation/presentation`
- `@deepseek-ai/dsh-client-ui-primitives/markdown`
- `@deepseek-ai/dsh-client-ui-tool/presentation`
- `@deepseek-ai/dsh-client-ui-workflow-run/presentation`
- `@deepseek-ai/dsh-client-ui-trajectory/presentation`

这些 face 只重新导出现有 owner 实现，不创建第二套 Session 投影，不复制浏览器定义，不修改 Session truth，也不从投影值派生控制状态。浏览器 bundle 中，Runtime presentation face 映射到已加载的 Runtime client 实例，保持浏览器中只有一个 registry identity；纯 Node 消费者加载 neutral artifact。

每个 face 都有明确的 package export、声明入口、bundle runtime 入口和 `files` payload。TUI presentation export map 校验 package manifest、构建后的声明符号、runtime 符号、打包后的相对导入闭包、纯 Node 加载，以及整个打包闭包（而非仅入口工件）内的禁止浏览器导入。map 和 gate 已接入仓库构建路径。

Typert host face 排除 `./presentation` 导出子路径：这些 face 仅为纯 Node 重新导出客户端业务投影，不注册 host 服务；若在 host 程序中分析它们，会把 client face 的 `agent` TypertContextMap 声明（与 host face 同 wire id、同 wire type）撞进同一个 program。client face 分析仍归它们所有。

## 替代方案

**由 TUI host 挂载浏览器 client runtime。** 不采用：TUI 不得依赖 React、DOM 生命周期或浏览器 object-layer 注册。

**导入 checkout-relative 的 `src/*` 路径。** 不采用：这会绕过 package ownership，registry consumer 无法运行，并使设计依赖未发布的 checkout。

**把 Web 投影定义复制到 TUI plugin。** 不采用：这会产生第二个业务投影 owner，允许 Web/TUI 发生语义分叉。

**由 TUI plugin 新建通用 presentation package。** 不采用：定义和 parser 已由 DSH package 持有；新 package 会重复 ownership，而不是发布已有 owner face。

## 后果

TUI 可以通过 package exports 消费与 WebUI 相同的投影定义和 Markdown grammar。DSH release family 的 registry publication 仍是独立 release 步骤；在匹配的 RC artifact 发布并从 clean install 验证前，TUI implementation admission 继续阻塞。
