# 架构设计

[English](architecture.md) | 中文

DeepSeek Harness Desktop 为现有 DeepSeek Harness Web Host 增加 macOS 展示层。架构始终保留一个 Host 作为权威来源，并支持两个等价入口：用户可以双击 `.app`，DSH profile 也可以加载 Cordis 插件。

## 目标与边界

本设计有四项不变量：

1. 现有 Node/Cordis Host 负责 Session、工具、Provider、权限策略、审批、凭据和持久化。
2. 原生应用负责 macOS 展示，以及仅由它亲自启动的子进程。
3. Cordis 导入 JavaScript 插件，绝不直接导入 macOS Application Bundle。
4. Web 内容不会获得通用原生 Shell 或文件系统桥接。

本项目不会 fork Web Client，不会用 Swift 实现第二套 Agent Host，也不会建立独立的 Desktop Session Store。

## 组件

| 组件 | 负责内容 | 明确不负责的内容 |
| --- | --- | --- |
| DeepSeek Harness Host | Cordis 组合、Web Server、Agent Loop、Session、工具、Capability、权限、审批、持久化 | macOS 窗口和应用生命周期 |
| `@deepseek-ai/dsh-macos-surface` | DSH bundle 配置层、Loader/Web Host attach、配套 App 启动、自有资源清理 | 创建 Host、产品数据、Shell 执行、权限决策 |
| `DeepSeek Harness Desktop.app` | AppKit 生命周期、原生菜单、受限 WebKit View、文件面板、下载位置、启动和错误展示 | Agent 运行时、产品存储、原生审批策略 |
| 构建与 smoke 工具 | SwiftPM 构建、`.app` 组装、包检查、跨进程所有权验证 | 运行时行为或用户数据修改 |

JavaScript 包和原生应用使用不同的 Loader 与发行格式，因此它们是独立产物。两者通过很小的进程和 URL 接口协作，而不是共享一套进程内实现。

## 运行拓扑

```text
直接启动应用                                  DSH profile 启动
     |                                               |
     v                                               v
macOS 应用                                     现有 Cordis Host
     | 启动并拥有                                    |
     v                                               v
现有 Web Host  <-------- loopback HTTP ------- macOS surface 插件
     |                                               |
     +---------------------+-------------------------+
                           v
                    受限的 WKWebView
```

两个入口最终都会形成一个 Web Host 和一个原生客户端，区别只有进程所有权。

## 启动与生命周期

### Owner 模式

不带 `--url` 打开 `.app` 时进入 owner 模式。应用依次通过 `--harness-root`、`DSH_HARNESS_ROOT` 或同级目录解析 Harness 源码位置；通过 `DSH_NODE_BINARY`、常见 Homebrew 路径或继承的 `PATH` 解析 Node；然后以端口 `0` 启动现有 Harness `web` profile。

子进程会收到 `DSH_DESKTOP_APP_OWNS_HOST=1`。如果该 profile 中安装了 Desktop Cordis 插件，这个递归保护会阻止它再次启动第二个 App。

应用读取合并后的子进程输出，只接受规定的 readiness 日志 `dsh web: http://127.0.0.1:<port>`。默认超时时间是 60 秒，因为冷启动包含 Node、模块加载、Cordis 组合和 Web 应用 settle。readiness 之前的输出会保留并用于可见诊断。

用户退出时，AppKit 会延迟应用终止，让确定由本应用拥有的子进程先尝试优雅退出。经过有限等待后，应用可以强制终止同一个子进程。它不会查找或关闭无关的 Host 进程。

### Attach 模式

由 profile 加载时，插件注入现有 `loader` 和 `webServer` 服务。Loader settle 后，插件从 `webServer.port` 生成精确 attach URL，并使用 `--url` 启动 App 可执行文件。

应用会验证传入 URL 必须使用明文 HTTP、主机为 `127.0.0.1`，并包含明确端口。它不会启动、重启或终止 Host。Cordis effect dispose 时也只能终止由该 effect 创建的 App 进程。

`attach-only` 模式执行相同的 Host 和 URL 解析，但不会启动原生进程。它会输出 `dsh desktop: <url>`，供其他 Launcher 使用。

## DSH 插件集成

`packages/cordis-plugin/package.json` 声明标准 `dsh.bundle` manifest，其 `patch` 指向同目录的 `cordis.patch.yml`。使用 `dsh plugin --profile <name> add <package>` 安装时，包依赖和它的有序 bundle 配置层会一起加入 profile。

Patch 会在标准 Web 应用组合之后插入一个 `macos-surface` row。该 row 使用普通 Cordis 依赖注入和配置，不会再挂载一套 Web Server、Loader、Agent Loop 或 capability provider。

插件导出约定的 Cordis 接口：

```ts
export const name = 'macos-surface'
export const inject = ['webServer', 'loader']
export const Config = /* Schemastery schema */
export function apply(ctx, config) { /* owned effect */ }
```

因此适配器原生属于 DSH plugin 和 profile 生态。`.app` 仍是配套产物，因为 Node 模块解析不能把 macOS Application Bundle 当作 JavaScript 加载。

## WebKit 与原生交互

应用通过 AppKit 菜单和 Responder Chain 实现剪切、复制、粘贴和全选。撤销与重做继续由 Web Composer 负责，避免原生快捷键绕过它的 transaction state。查找使用 `WKWebView.find`；刷新和页面缩放使用 WebKit API，不会用脚本查询或修改产品 DOM。

HTML 文件输入通过 `WKOpenPanelParameters` 和 App 自有的 `NSOpenPanel` 适配。同源 Session 导出使用 `WKDownload` 和 `NSSavePanel`。用户取消时不写入任何文件。重定向、认证 challenge，以及允许的导出 endpoint 之外的下载都会关闭失败。

摄像头和麦克风请求会被拒绝。外部链接会在系统浏览器中打开。启动、加载、失败和重试页面由原生 AppKit 实现，存在于 WebView attach 之前。

Web content process 终止时，App 会使用一次自动恢复机会。继续失败后会显示原生诊断和重试操作。Attach 模式重试同一个已验证 origin；owner 模式只能替换自己拥有且已经退出的 Host。

## 安全模型

应用只允许顶层导航到收到的精确 loopback origin。其他 scheme、hostname 或本地端口都不等价。Subframe 只能使用同一 origin 和惰性的 `about:blank` 文档。文件 URL、任意新 WebKit Window、远程 frame 和 TLS challenge 会按场景拒绝或交给外部应用。

应用没有通过 `WKScriptMessageHandler` 暴露 Shell 命令、文件系统操作、审批、Token 或任意原生方法。Web UI 操作仍调用现有 Host API，因此 DSH capability provider 和权限插件仍是执行策略的位置。

导航隔离并不代表客户端通过了 Host 身份认证。同一用户下的其他进程可能访问未经认证的 loopback endpoint。经过认证的本地传输是发行加固要求，不是当前开发版本已经具备的属性。

## 产物与平台支持

构建脚本会编译 SwiftPM 可执行文件，从 Harness 官方 glyph 生成 App 图标和黑白启动 glyph，并在 `dist/DeepSeek Harness Desktop.app` 组装标准 Application Bundle。生成资源和构建输出不会进入源码版本控制。

SwiftPM 当前会生成单一宿主架构产物。本版本已验证的产物未签名、未公证，并且只有 `x86_64`。它原生支持 Intel Mac，在 Apple Silicon 上通过 Rosetta 2 运行。Universal 2 发行版需要分别构建 `arm64` 和 `x86_64`、使用 `lipo` 组装、在两种架构上测试、配置签名和 Hardened Runtime，并完成公证。

应用当前会启动本地 Harness 源码目录和外部 Node 运行时。未来的独立消费者发行版可以内嵌或安装带版本的运行时，但必须继续保持单一 Host 所有权和相同的 DSH 插件接口。

## 演进方式

本设计支持渐进式原生替换。未来某个原生页面可以调用类型化 Host API，其余页面继续使用 WebKit。展示层变化本身不会转移 Session 和权限的所有权。

Universal 2、签名、公证、更新、运行时打包和经过认证的 loopback 传输都可以围绕现有拓扑逐步加入，不需要第二套 Host 或新的插件模型。

跨组件接口详情和验收检查见[交付约定](delivery-contracts.md)。
