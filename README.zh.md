---
description: "为 DSH Web 和 Desktop profile 提供下一句话建议，通过有界后台生成填入可编辑草稿。"
kind: "package-bundle"
---

# @aaroncarry/dsh-prompt-suggestions

[English](README.md) | 中文

## Summary

这个可选 profile 层会在成功回复后建议一条用户可能输入的下一句话。建议显示在空输入框中；点击、Tab 或右方向键可填入草稿，Enter 通过原有输入框发送。开始输入或按 Escape 会关闭建议。建议使用独立且有上限的模型请求，不阻塞主回合。

## Table of Contents

- [使用此包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

### 兼容性与安装

这个独立插件使用 DSH `0.2.0-rc.2` 至 `0.2.1-rc.2` 已有的 Connection、Storage Domain、Session 和 LLM 服务。DSH 只依据它的 `engines.dsh` 范围（`>=0.2.0-rc.2 <0.3.0`）判定兼容性，peer 范围重复该声明供安装器读取。不需要修改 DSH 源码或安装版运行时。开发依赖链接到同级 `deepseek-harness` 仓库；安装后的包只使用生产依赖和应用提供的 peer。使用 Desktop 自带的 `dsh` 命令管理 Desktop profile 前，需要完全退出 Desktop。

从 npm 将已发布的包安装到使用的 profile：

```text
dsh plugin --profile desktop add @aaroncarry/dsh-prompt-suggestions@0.1.5
```

浏览器 profile 可将 `desktop` 替换为 `web`。执行 `dsh plugin --profile desktop remove @aaroncarry/dsh-prompt-suggestions` 可移除。若要测试尚未发布的本地构建，可执行 `pnpm install && pnpm pack`，再将生成的 tarball 路径传给同样的 `dsh plugin ... add` 命令。

### 操作与配置

建议只在包含新用户消息和 assistant 文本回复的顶层回合成功结束后出现。Agent 运行中、输入框已有文字或附件、指令接管输入框时，建议保持隐藏。接受建议只修改草稿，不发送消息。输入法组合输入和带修饰键的操作保留原有行为。

profile 层提供下面的完整配置。覆盖 `prompt-suggestions` 行时，需要提供完整的 `config` 对象；DSH 会替换整行配置，而不是逐项合并。

| 设置 | 安装值 | 含义 |
| --- | --- | --- |
| `enabled` | `true` | 启用后续自动请求。 |
| `maxContextMessages` | `12` | 最近用户和 assistant 文本消息的数量上限。 |
| `maxInputBytes` | `16384` | 预测指令与完整 JSON 对话文本的 UTF-8 字节上限。 |
| `maxOutputTokens` | `128` | 辅助输出的 token 预算。 |
| `maxResponseBytes` | `32768` | 流式块经 JSON 编码后的累计字节上限。 |
| `maxSuggestionChars` | `160` | 建议的 Unicode 码点数量上限。 |
| `timeoutMs` | `8000` | 辅助调用的超时；适配器必须响应取消。 |
| `temperature` | `0.3` | 辅助请求的采样温度。 |
| `provider`、`model` | 省略 | 使用已结束回合的模型路由；显式覆盖时必须同时填写。 |
| `reasoningEffort` | 省略 | 可选的适配器支持力度，例如 `off`；未指定时使用适配器的辅助调用默认值。 |

如果模型的默认推理会耗尽较短的输出预算，应使用快速模型，或通过该模型支持的推理力度关闭推理。空白、多行、超长、被截断、含工具调用和失败的输出保持隐藏。失败记录在插件存储中，不中断主回合。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节 — 点击展开</summary>

[cordis.patch.yml](cordis.patch.yml) 添加一条 Host 插件配置。包的 `dsh.client` 元数据在 Web 和 Desktop 中加载浏览器端。Host 与 Client 程序分别编译，公共 Cordis 和 React 模块保持为外部依赖。

Host 观察已提交的 `session/event` 通知，不向主会话追加新事件。符合条件的 `turn/end` 发生后，先将精确辅助输入持久化到自己的 `prompt_suggestions` 存储 domain，再启动生成。每次调用包含使用现有 `system/message`、`request/header` 和 `user/message` 事件构成的独立审计快照，以及调用结果和已报告用量。经过认证的 `/api/prompt-suggestions/watch` Connection 通道提供可取消的长轮询读取。新回合或收件箱变化使建议失效；晚到调用保留自己的审计记录，不替换较新的建议。卸载会中止生成、释放读取请求、等待提供方清理并关闭存储。

Client 注册 `conversation.input.overlay`，通过公开的、带草稿版本校验的 `InputActions.insertText` 插入文本。局部 DOM 绑定使用 `[data-composer-card]`、`[data-composer-placeholder]` 和卡片内的 contenteditable 元素，隐藏普通占位文本并处理接受按键。它不导入 Lexical，也不访问私有的 composer keyboard 接口。字典、样式、slot 和 DOM 监听器都有清理操作。

建议读取会根据当前主会话日志核对存储的触发事件；插入有效性由现有输入框的版本校验负责。移除插件后，审计记录保留在插件自己的存储中，不影响主会话重建。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [配置层](cordis.patch.yml)
- [Host 生命周期](src/engine.ts)、[流式组装](src/generate.ts)和 [Client 输入建议](src/client/SuggestionOverlay.tsx)
- [DSH 架构](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/architecture.md)

-----

<a id="model-experience"></a>
## 模型体验

**主对话：**不添加提示词、工具或 assistant 消息。建议文本只有在用户发送编辑后的草稿时，才进入主对话。

**辅助请求：**每次符合条件的回复增加一次调用，以 JSON 包装最近的用户和 assistant 文本。主对话的系统指令、工具结果、推理和二进制附件不进入此请求。精确辅助输入、独立审计日志、调用结果和已报告用量保存在插件自己的存储中；主 Session 日志不包含插件事件。

**预测指令：**[内置提示词](src/prompt.ts) 用于预测用户自然会输入的下一句话，要求匹配用户风格并使用 2–12 个词，没有合适建议时允许空输出。空输出不显示建议。

**Token 与 KV cache：**生成建议在配置上限内增加输入和输出费用。此请求单独包装对话，不保留主对话的消息前缀，因此不保证复用主对话前缀的 KV cache。本地输入会隐藏建议，但不会通知 Host 取消已经开始的请求。

-----

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与后续工作

本包目前通过现有插件 API 支持 DSH `0.2.0-rc.2` 至 `0.2.1-rc.2`。在 DSH 提供公开的占位文本和键盘扩展 API 前，composer 的 DOM 选择器是兼容性依赖。仅实现空草稿建议，尚无部分文本续写、多候选、每会话偏好开关或反馈排序。主调用统计不汇总辅助用量；插件存储的调用记录保留了这些数据供检查。适配器忽略取消时，插件卸载可能需要等待适配器自行结束。

### Dev Note

<details>
<summary>开发与验证 — 点击展开</summary>

执行 `pnpm run typecheck`、`pnpm test` 和 `pnpm run build`。`pnpm run test:profile` 通过源码 CLI 启动真实且隔离的 DSH Web profile，仅将外部模型替换为确定性适配器。它检查生成、接受、显式发送、关闭、输入隐藏、浏览器重载、两种主题，以及未加载插件时的持久化事件重建。此检查需要同级 DSH 仓库位于本包 `engines.dsh` 范围覆盖的版本、已完成构建并安装 Playwright Chromium；可用 `DSH_REPO` 选择其他仓库。`pnpm run test:install` 改为通过 CLI 驱动一个隔离 profile，`DSH_INSTALLED_ROOT` 可让它使用已安装 Desktop 自带的 CLI。截图和日志写入 `.test-output`，临时 home 保留用于检查。单元测试包含记录模型输入与建议的快照。确定性检查不声称测量了真实提供方的质量或延迟。

</details>
