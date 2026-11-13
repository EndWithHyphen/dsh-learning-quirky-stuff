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

总结排版回归覆盖关系链在宽、窄阅读区的布局、文字与节点边界、可编辑画布导出、材料总结与系统学习切换时头部及 Tab 位置稳定，以及大屏正文使用完整内容列。Chrome 空白画布点击测试确保默认选择工具不会产生误触笔迹。

总结提示词的效果用真实模型对照评估，独立于上述代码测试。`tests/summary-evaluation-fixture.mjs` 提供实验报告、算法教程、观点评论、数据报告、虚构事件和图文笔记六类合成材料，后两类作为留出样本。评估要点随材料维护，关注信息保留、关键关系、表达效果和复习价值；字符数仅供比较，不能代替质量判断。

修改提示词前保存完整输入快照，修改后使用同一模型和推理等级生成对照：

```sh
node scripts/evaluate-summary.mjs --snapshot --output dist/summary-baseline
# 调整提示词后，先评估 development，再评估 holdout。
node scripts/evaluate-summary.mjs --baseline dist/summary-baseline --output dist/summary-evaluation --phase development --model YOUR_CODEX_MODEL --effort max
node scripts/evaluate-summary.mjs --baseline dist/summary-baseline --output dist/summary-evaluation --phase holdout --model YOUR_CODEX_MODEL --effort max
node scripts/render-summary-evaluation.mjs dist/summary-evaluation
```

生成命令会使用本机 Codex 登录并消耗模型额度；不纳入 `npm test`。结果、完整提示词、文字稿和图文对照页都写入已忽略的 `dist/`，不写入实际笔记。相同输入、图片、模型与推理等级的成功结果可复用；格式校验通过后仍需人工对照材料审阅，`report.html` 使用现有信息图导出与关系图布局展示结果。`preview-errors.json` 记录实际渲染失败。
