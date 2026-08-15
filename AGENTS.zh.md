# AGENTS.md

[English](AGENTS.md) | 中文

这些说明适用于整个 `deepseek-harness-desktop` 仓库。

## 产品边界

修改行为前，先阅读[架构设计](docs/architecture.zh.md)和[交付约定](docs/delivery-contracts.md)。本仓库是现有 DeepSeek Harness 的 macOS 客户端和 Cordis 适配器，不得重新实现 Harness Host、Agent Loop、Session Store、工具运行时、权限策略、审批流程、凭据或持久化。

项目有两个交付产物，但只有一个运行时权威来源：

- `packages/cordis-plugin/` 是 Cordis 导入的 JavaScript 适配器，也是外部 DSH bundle 包。
- `apps/macos/` 是 Swift/AppKit 配套应用。
- 现有 Node/Cordis Host 在 attach 和 owner 两种模式下始终是运行时权威来源。

`.app` 永远不是 TypeScript 包。Cordis 加载适配器；现有 Web Host 就绪后，适配器可以启动配套应用的可执行文件。

## 仓库布局

```text
apps/macos/              SwiftPM AppKit/WebKit 应用
packages/cordis-plugin/  Cordis 插件和唯一的 dsh.bundle patch
scripts/                 构建、组装和 smoke 工具
tests/plugin/            聚焦 TypeScript 生命周期的测试
tests/integration/       产物和跨组件检查
tests/swift/             Swift 测试入口说明
docs/                    架构与交付接口
bundle/                  指向包内唯一 patch 的说明
```

不得把 patch 复制到第二个包。`packages/cordis-plugin/cordis.patch.yml` 是唯一的 bundle 配置层，由 `package.json` 的 `dsh.bundle` manifest 内部 `patch` 字段引用。

## 修改规则

- 不得修改同级 `deepseek-harness` 源码目录。它是外部开发依赖和运行时权威来源。
- 保持 ESM、严格 TypeScript 和显式包导入，不得添加 CommonJS 兼容路径。
- Cordis 注册属于 effect。插件拥有的每项资源都必须有 disposer。
- 明确进程所有权。组件只能终止自己启动并持有句柄的进程；attach 模式绝不能终止 Host。
- 不得向 `WKWebView` 添加通用 JavaScript message handler、原生 Shell 桥接、原生审批路径或不受限文件系统 API。
- 页面导航和下载必须限制在已验证的 attached origin。涉及权限的操作继续由 Harness capability 和 policy 插件处理。
- 使用 Swift Package Manager 和 Command Line Tools 构建 macOS App。开发检查不得依赖生成的 Xcode project。
- 随部署变化的配置必须位于已验证的插件配置或已记录的环境变量中。缺少产物和 URL 无效时必须明确失败。
- 保留工作区中无关的修改。不得使用破坏性 Git 清理命令修复生成产物。

参数、readiness 日志、环境变量、生命周期所有权、输出位置或安全行为发生跨组件变化时，必须先更新 `docs/delivery-contracts.md`，再修改依赖该接口的实现。

## 生成文件和本地文件

不得提交构建产物或机器状态。Swift `.build/`、JavaScript `lib/`、`dist/`、生成的 `AppIcon.icns`、生成的 `DeepSeekGlyph.svg`、环境文件、日志、编辑器状态和 `.DS_Store` 必须保持忽略。

必须提交 `scripts/lib/` 下的源文件；它们属于构建工具，不是包的编译产物。因此禁止使用宽泛的 `lib/` 忽略规则。

App 图标和黑白启动 glyph 从同级 Harness 源码中的官方 glyph 生成。不得另外提交一份会产生分歧的 Logo 副本。

## 文档

公开入口文档成对维护：

- `README.md` 和 `README.zh.md`
- `AGENTS.md` 和 `AGENTS.zh.md`
- `docs/architecture.md` 和 `docs/architecture.zh.md`

成对文档的标题、列表、表格、示例和链接结构必须一致。英文源文件链接英文页面；存在中文对应页面时，中文文件应链接中文页面。只描述当前行为，每个事实保留一个权威位置，其他位置通过链接引用，不要复制实现细节。

产品可见行为变化时，同步更新受影响的 README，以及架构或交付接口。在存在已验证产物之前，不得声称已经完成签名、公证、Universal 2、发布、运行时内嵌或传输认证。

## 验证

使用覆盖修改面的最小检查：

```sh
npm run test:plugin       # Cordis 配置和生命周期
npm run test:swift        # 原生解析、安全和所有权逻辑
npm run test:integration  # 构建脚本和跨组件接口
npm run build:app         # release .app 组装
npm run smoke             # 无需 Key 的组装产物检查
npm run smoke:native      # 原生源码和二进制接口检查
npm run smoke:assembled   # 显式执行真实 Host/App 所有权检查
npm run check             # 完整的默认本地 gate
```

当前 TypeScript 构建和插件测试配置要求同级 `../deepseek-harness` 源码目录；运行时和集成工具也支持 `DSH_HARNESS_ROOT`。只报告实际运行过的检查。源码检查不能证明已获得签名、公证、Universal 或面向最终用户发行的产物。
