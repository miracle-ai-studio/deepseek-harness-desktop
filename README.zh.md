# DeepSeek Harness Desktop

[English](README.md) | 中文

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的原生 macOS 桌面端。它在专注的 AppKit 窗口中打开现有 DSH Web Host；Session、工具、权限、审批和持久化仍由该 Host 管理。

[产品网站](https://miracle-ai-studio.github.io/deepseek-harness-desktop/) · [架构设计](docs/architecture.zh.md) · [交付约定](docs/delivery-contracts.md)

## 从源码运行

将本仓库与兼容的 DeepSeek Harness checkout 保持同级：

```text
workspace/
├── deepseek-harness/
└── deepseek-harness-desktop/
```

准备已验证的 Harness revision：

```sh
git clone https://github.com/deepseek-ai/deepseek-harness.git
cd deepseek-harness
git checkout 47f943859bef60e4160492346772ded9b24f765a
pnpm install
pnpm run build
```

在本仓库构建配套应用：

```sh
cd ../deepseek-harness-desktop
npm run build:app
open "dist/DeepSeek Harness Desktop.app"
```

直接打开 App 会进入 owner 模式：它会定位同级 Harness checkout、启动既有 `web` profile，并且只拥有该子 Host。

## 连接已有 profile

先构建插件，将本地包安装到 DSH `web` profile，再向 profile 提供配套 App 的路径：

```sh
cd ../deepseek-harness-desktop
npm run build:plugin

cd ../deepseek-harness
pnpm dsh plugin --profile web add "file:../deepseek-harness-desktop/packages/cordis-plugin"

DSH_DESKTOP_APP_PATH="$(cd ../deepseek-harness-desktop && pwd)/dist/DeepSeek Harness Desktop.app" \
  pnpm dsh --profile web
```

Profile 会先启动现有 Host。Loader 就绪后，插件将原生窗口连接到分配的 loopback URL。关闭已连接的应用绝不会终止该 Host。

## 架构

本项目交付两个独立产物：

- `@deepseek-ai/dsh-macos-surface`：标准 Cordis 插件与 `dsh.bundle` profile 层。
- `DeepSeek Harness Desktop.app`：使用受限 `WKWebView` 的 Swift/AppKit 配套应用。

两种入口都只保留一个 Host 作为权威来源。原生层只负责展示，以及它自行启动的进程；它不会增加第二个 Agent runtime、Session store、审批路径、Shell bridge 或不受限的文件系统 API。

## 配置

| 配置项 | 默认值 | 用途 |
| --- | --- | --- |
| `applicationPath` | `DSH_DESKTOP_APP_PATH`，发行 profile 中回退到 `/Applications/DeepSeek Harness Desktop.app` | 选择配套 App。 |
| `launchMode` | `launch-if-needed` | 启动 App；`attach-only` 只打印解析后的 URL。 |
| `launchTimeoutMs` | `30000` | 原生启动与自有进程清理的超时时间。 |
| `DSH_HARNESS_ROOT` | 同级 `../deepseek-harness` | 为 owner 模式选择 Harness 源码 checkout。 |
| `DSH_NODE_BINARY` | 常见 Homebrew 路径，然后是 `PATH` | 为 owner 模式选择 Node。 |

## 开发

为改动的表面运行最小检查，或使用完整本地 gate：

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

插件检查需要同级 Harness checkout。若 checkout 位于其他位置，运行时与集成工具也接受 `DSH_HARNESS_ROOT`。

## 文档与许可证

- [架构设计](docs/architecture.zh.md)
- [交付约定](docs/delivery-contracts.md)
- [贡献者说明](AGENTS.zh.md)

DeepSeek Harness Desktop 使用 [MIT License](LICENSE)。
