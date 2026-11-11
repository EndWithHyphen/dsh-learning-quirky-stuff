# 依赖安全评估

评估日期：2026-11-11。适用版本：4.4.2。审计使用完整依赖树，包含会进入前端构建的开发依赖；不以 `--omit=dev` 的结果代替客户端评估。

## 审计范围与结果

- 原项目锁文件：11 项告警（1 critical、5 high、4 moderate、1 low）。
- 更新后的项目锁文件：`npm audit` 返回 0 项已知告警。
- 在新的消费项目中安装发布包与 DSH 0.2.2-rc.1 SDK、未额外设置 overrides：仍有 4 项 high。它们是同一个 Zod 告警沿 `zod → @deepseek-ai/dsh-llm → @deepseek-ai/dsh-tools / 本插件` 传播的结果，并非四个独立漏洞。

项目根目录的 overrides 约束本项目的安装和构建，不会自动重写消费者或 DSH 桌面宿主的依赖树。上述两个审计结果需要分别保留。审计为零也不代表没有未知漏洞或应用逻辑漏洞。

## 已升级的客户端依赖

构建后的 `dist/client-metafile.json` 和 `dist/chrome-metafile.json` 确认以下库确实进入客户端，而非仅作为安装工具存在。

| 依赖 | 本次锁定版本 | 路径与处理 |
| --- | --- | --- |
| Excalidraw | 0.18.1 | 两个客户端的画布；升级至上游修复 Mermaid 标签 XSS 的版本。 |
| Mermaid 转换器 / Mermaid | 2.2.2 / 11.17.2 | 原生 Mermaid 转换路径；升级后保留转换功能并验证兼容性。AI 总结仍输出声明式图形数据。 |
| DOMPurify | 3.4.17 | 两个客户端的图表 HTML/SVG 清理路径；清除旧嵌套版本。 |
| Nanoid | 3.3.20、5.1.16 | 画布与转换器生成元素编号；覆盖上游固定的旧版本，验证浏览器构建及画布保存。 |
| KaTeX | 0.18.10 | Mermaid 数学标签；覆盖上游旧范围，选择未被撤回的修复版本。 |
| lodash-es | 4.18.1 | 图表解析器的辅助函数；覆盖固定旧版本，避免新增解析链带入已知告警。 |
| UUID | 14.0.3 | Mermaid 内部标识；随兼容依赖范围更新。 |
| jsPDF | 4.2.1 | DSH 客户端的 PDF 导出；升级并验证普通白板、系统学习与信息图导出。 |

Excalidraw 的上游公告说明了受影响的手工 Mermaid 导入路径与修复版本：[GHSA-39h7-pwv7-rc3x](https://github.com/excalidraw/excalidraw/security/advisories/GHSA-39h7-pwv7-rc3x)。KaTeX 的相关漏洞需要已有原型污染等前提，仍采用修复版本：[GHSA-238p-pmpm-9mq7](https://github.com/advisories/GHSA-238p-pmpm-9mq7)。lodash-es 的模板注入问题修复于 4.18.0，本项目采用 4.18.1：[GHSA-r5fr-rjxr-66jc](https://github.com/advisories/GHSA-r5fr-rjxr-66jc)。

## jsPDF：区分 Node 与浏览器调用

`src/export.js` 与 `src/infographic-render.js` 使用浏览器构建，输入为本机 canvas 输出的 PNG/JPEG data URL，最终调用 `output('blob')` 下载。

- 文件包含 / 路径遍历公告只影响 jsPDF 的 Node 构建。本插件的 PDF 导出不调用 Node 构建或文件路径读取，因此没有发现该公告所需的调用路径。[上游公告](https://github.com/parallax/jsPDF/security/advisories/GHSA-f8cm-6447-x5h2)
- 新窗口 HTML 注入属于浏览器问题，不能用“Node 专属”概括。受影响的是 `pdfobjectnewwindow`、`pdfjsnewwindow`、`dataurlnewwindow` 等输出方式；本插件使用 `blob`，没有调用这些方式。[上游公告](https://github.com/parallax/jsPDF/security/advisories/GHSA-wfv2-pwc8-crg5)
- 本插件没有调用 `addJS`、AcroForm、FreeText 注释、XMP 元数据或 `html()`，也不把 GIF/BMP 原文件直接传给 jsPDF；图片先通过 canvas 转成 PNG/JPEG。浏览器自身解码图片的风险需要独立评估。

这些是基于当前代码和构建产物的可达性判断；仍升级 jsPDF，以避免后续功能误触旧漏洞路径。

## 剩余宿主 SDK 风险

DSH 0.2.2-rc.1 的 `@deepseek-ai/dsh-llm` 固定依赖 Zod 4.4.3。相关公告涉及大型受约束集合校验造成内存资源耗尽，修复版本为 4.6.6：[GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5)。SDK 的 RPC schema 文件使用 Zod；本插件的浏览器构建中未发现 Zod。

本项目使用 override 将开发与独立构建环境的 Zod 更新到 4.6.7，测试和安装验证通过。默认消费者仍会按 SDK 的固定声明安装 4.4.3。宿主是否暴露可控的大型集合、以及请求限制是否覆盖该路径，需要由宿主维护者确认；插件的局部输入上限不能证明所有宿主入口安全。

处理方式是由宿主升级 SDK/Zod。自行管理命令行宿主根项目时，也可在完成兼容性验证后设置同样的 Zod override。桌面版 profile 由 DSH 管理，本插件不会擅自改写其依赖。固定宿主范围继续为 `>=0.2.2-rc.1 <0.3.0`，未将升级到未经验证的 SDK 作为消除告警的手段。

## 持续验证

CI 在 Node 22 和 Node 24 下运行回归，并对项目完整依赖树执行 `npm audit --audit-level=low`。正式构建要求 Node 24，符合 `ts-fsrs 6` 的 engines 声明。`test:install` 另外记录默认消费项目的审计结果，防止根目录 overrides 掩盖发布后的宿主依赖问题。

`test:diagram-dependencies` 在隔离浏览器中验证流程图、时序图、KaTeX 数学标签和含事件属性的非可信标签转换；验证没有执行测试脚本，并检查 PNG → PDF Blob 导出。该用例是升级回归，不代表覆盖所有 XSS 或图片解码攻击。

构建会重新收集第三方许可，清理过时的生成通知文件。原始审计 JSON、构建依赖分布和测试日志存于忽略的 `dist/qa/`；公开包仅包含本评估和可复现的验证步骤。
