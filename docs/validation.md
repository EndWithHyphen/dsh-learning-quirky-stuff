# 验证说明

自动测试使用临时资料库和隔离浏览器，不读取维护者的个人笔记。正式构建环境使用 Node.js 24+；CI 另外使用 Node.js 22 检查兼容性。本机验收记录 `QA.md` 不加入 Git、npm 包或源码 ZIP。

```sh
npm run check:registry
npm ci --legacy-peer-deps
npm test
npm run build
npm run test:browser
npm run test:system-study-browser
npm run test:infographics-browser
npm run test:diagram-dependencies
npm run test:install
npm audit --json --registry=https://registry.npmjs.org/
```

任务管理器的回归测试在初始状态落盘时主动阻塞，分别等待超时、用户取消和功能关闭，验证任务回调不会再启动，终止原因会落盘，后续排队任务能继续运行。

发布测试验证私有文件排除、同名 ZIP 重新生成时不残留旧条目，以及安装和发布示例引用的版本。macOS 正式打包还需要 `npm run build:native` 和 `npm run release:local`。

依赖审计需要结合实际打包文件及调用路径判断。公开评估见 [依赖安全说明](dependency-security.md)；原始审计 JSON、截图和测试日志放在忽略的 `dist/qa/` 下。
