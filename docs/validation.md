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
npm run test:pdf-browser
npm run test:diagram-dependencies
npm run test:install
npm audit --json --registry=https://registry.npmjs.org/
```

任务管理器的回归测试在初始状态落盘时主动阻塞，分别等待超时、用户取消和功能关闭，验证任务回调不会再启动，终止原因会落盘，后续排队任务能继续运行。

发布测试验证私有文件排除、同名 ZIP 重新生成时不残留旧条目，以及安装和发布示例引用的版本。macOS 正式打包还需要 `npm run build:native` 和 `npm run release:local`。

依赖审计需要结合实际打包文件及调用路径判断。公开评估见 [依赖安全说明](dependency-security.md)；原始审计 JSON、截图和测试日志放在忽略的 `dist/qa/` 下。


PDF 回归样例由项目生成，包含双栏、可选中文、公式、矢量图表、旋转页、扫描页和密码文件。`scripts/test-pdf-browser.mjs` 使用实际 PDF.js 及 Excalidraw，验证导入、批注、文字 / 图像摘录、共用原件、提问来源、回页、搜索与表单草稿恢复；macOS 识别程序可用时执行真实扫描 OCR。问题回答使用固定测试模型，不验证外部模型的回答质量。`tests/pdf.test.mjs` 检查分块重试、版本冲突、来源引用、去重备份与删除生命周期。测试 PDF 的生成脚本是 `scripts/make-pdf-fixture.py`（开发工具：reportlab、Pillow），正常构建不需要 Python。

PDF 横版回归还模拟 16:9 报告在视口高度临界处的加载、缩放与滚动条变化，测量加载提示出现时的页面位置，以及静置后的画布重绘次数，确保进度提示不会推移页面或触发持续重绘。

PDF 交互回归模拟 DSH 的原生窗口拖动样式，确保画布的透明 SVG 轨迹层不覆盖标题栏拖动区域，画布继续接收绘制输入；同时检查阅读区左右键翻页、首尾页边界和输入框按键隔离。

网页笔记回归检查同 URL 新标签页的复用请求、已有标签页绑定优先级、并发打开只创建一篇、已有内容保留、查询参数区分和回收站条目排除。

翻页回归还阻塞索引写入来验证页面仍能显示，并检查相邻页预读与位图复用。缓存单元测试覆盖内存预算、取消、迟到结果释放及失败重试。Chrome 浏览器测试通过真实扩展 API 的用户点击打开指定标签页侧栏，校验默认全局侧栏与未打开标签页均为禁用状态。
