# Contributing

欢迎提交复现步骤、修复、文档与功能改进。提交前先阅读 README 和 ARCHITECTURE.md。

## Local workflow

1. 安装 Node.js 22+，运行 `npm ci --legacy-peer-deps`。
2. macOS 上运行 `npm run build:native`；其他平台可验证通用逻辑。
3. 修改源码后运行 `npm run build`、`npm test`。涉及画布或浏览器交互时运行 `npm run test:browser`。
4. 涉及依赖、包元数据或发布目录时，运行 `npm run test:install` 和 `npm run release:local`。

测试使用临时目录与虚构材料。不要提交真实笔记、截图、API 密钥、浏览器令牌、`release.local.json` 或运行时日志。使用说明的源文件是 `docs/user-guide.html`；生成的客户端、字体、文档副本和安装包不作为手工编辑对象。

## Changes

保持变更范围清楚，说明触发条件、预期行为和验证方式。新增功能优先注册到 `server/modules/`，共用任务、来源校验与存储机制。RPC / 浏览器协议改变时同步检查新旧版本行为。数据格式改变需要迁移与旧数据兼容测试。

## License

提交者应有权贡献所提交内容。项目自有代码的贡献按 MIT 许可提供；第三方代码必须保留其许可和版权说明，并说明来源。贡献无需转让版权。
