# DeepSeek Harness Desktop

[English](README.md) | 中文

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的原生 macOS 客户端。在专注的 AppKit 窗口中使用 DSH，同时继续由现有 Cordis Host 管理 Session、工具、权限和持久化。

[下载 macOS 版本](https://github.com/deepseek-ai/deepseek-harness-desktop/releases/latest/download/DeepSeek-Harness-Desktop.dmg) · [产品网站](https://deepseek-ai.github.io/deepseek-harness-desktop/) · [架构设计](docs/architecture.zh.md)

## 普通用户安装

正式发行版本推荐使用这种方式。

1. 安装 22.19 或更高版本的 [Node.js](https://nodejs.org/)。
2. 从产品网站下载 DeepSeek Harness Desktop。
3. 把 Desktop 插件安装到 DSH `web` profile：

```sh
npx @deepseek-ai/dsh plugin --profile web add @deepseek-ai/dsh-macos-surface
```

启动 DSH：

```sh
npx @deepseek-ai/dsh --profile web
```

Profile 会启动现有 DSH Host，并打开 `/Applications/DeepSeek Harness Desktop.app`。Session 和权限继续由 DSH 管理；关闭窗口不会终止由 profile 启动的 Host。

## 开发者安装

让 Desktop 和 Harness 仓库保持同级：

```text
workspace/
├── deepseek-harness/
└── deepseek-harness-desktop/
```

准备已经验证的 Harness revision：

```sh
git clone https://github.com/deepseek-ai/deepseek-harness.git
cd deepseek-harness
git checkout 47f943859bef60e4160492346772ded9b24f765a
pnpm install
pnpm run build
```

构建并验证 Desktop：

```sh
cd ../deepseek-harness-desktop
npm run check
```

应用会组装到：

```text
dist/DeepSeek Harness Desktop.app
```

安装本地插件，并让 profile 启动本地构建的 App：

```sh
cd ../deepseek-harness
pnpm dsh plugin --profile web add "file:../deepseek-harness-desktop/packages/cordis-plugin"

DSH_DESKTOP_APP_PATH="$(cd ../deepseek-harness-desktop && pwd)/dist/DeepSeek Harness Desktop.app" \
  pnpm dsh --profile web
```

测试 owner 模式时，可以直接打开开发版 App：

```sh
open "dist/DeepSeek Harness Desktop.app"
```

## 实现方式

本仓库交付两个产物：

- `@deepseek-ai/dsh-macos-surface` 是标准 Cordis 插件和 `dsh.bundle` profile 配置层。
- `DeepSeek Harness Desktop.app` 是 Swift/AppKit 客户端，通过受限的 `WKWebView` 展示现有 Web Client。

Cordis 导入 JavaScript 插件，而不是 `.app`。插件等待现有 Loader 和 `webServer`，再把原生窗口连接到分配的 loopback URL。直接打开 App 时，它会启动并拥有现有 Harness `web` profile。两种入口都只保留一个 Host 作为权威来源。

Web 页面没有原生 Shell 桥接。Shell 命令、文件系统访问、沙箱和审批继续经过 DSH capability 与权限插件。

## 配置

| 配置项 | 默认值 | 用途 |
| --- | --- | --- |
| `applicationPath` | `DSH_DESKTOP_APP_PATH`，发行 profile 中回退到 `/Applications/DeepSeek Harness Desktop.app` | 选择配套 App。 |
| `launchMode` | `launch-if-needed` | 启动 App；`attach-only` 只发布解析后的 URL。 |
| `launchTimeoutMs` | `30000` | 原生启动和清理超时时间。 |
| `DSH_HARNESS_ROOT` | 同级 `../deepseek-harness` | owner 模式开发时选择 Harness 源码目录。 |
| `DSH_NODE_BINARY` | 常见 Homebrew 路径，然后是 `PATH` | owner 模式开发时选择 Node。 |

## 开发命令

```sh
npm run test:plugin
npm run test:swift
npm run test:integration
npm run build:app
npm run smoke
npm run smoke:native
npm run smoke:assembled
npm run check
```

当前源码构建会生成构建机器对应的架构。公开 macOS Release 应提供经过验证的 Universal 2 应用。源码发布不要求签名和公证；如果希望二进制安装体验更顺畅，则推荐完成签名和公证。

## 文档与许可证

- [架构设计](docs/architecture.zh.md)
- [交付约定](docs/delivery-contracts.md)
- [贡献者说明](AGENTS.zh.md)

DeepSeek Harness Desktop 使用 [MIT License](LICENSE)。
