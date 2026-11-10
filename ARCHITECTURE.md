# 学习画板架构

学习画板由 DSH 服务、React 界面和 Chrome 扩展组成。DSH 是持久化及模型调用的入口；Chrome 通过本机桥接服务同步笔记、截图与材料。新学习工具采用独立模块，共用模型、来源、任务和存储服务。

## 目录与职责

| 位置 | 职责 |
| --- | --- |
| `index.js` | DSH SDK 适配、服务生命周期、六个稳定 RPC 方法 |
| `server/service-actions.js` | 兼容原有笔记、总结、复习与清理操作，转发新模块操作 |
| `server/runtime.js` | 组合服务、注册模块、注入依赖，统一处理关闭功能、回收、永久删除和备份 |
| `shared/tag-filters.js`、`src/tag-filter.jsx` | 标签计数与匹配规则、可搜索多选列表、筛选条件栏；筛选仅改变视图 |
| `shared/features.js` | 功能编号、名称、说明及模型需求的唯一注册表 |
| `shared/version.js` | 运行时版本；构建时校验 npm 包与 Chrome manifest 版本一致 |
| `server/config.js` | 独立开关与每项功能的模型偏好，串行、原子保存 |
| `server/action-router.js` | 操作路由和服务端功能开关检查 |
| `server/task-manager.js` | 队列、并发上限、进度、30 分钟超时、取消和重启中断恢复 |
| `server/ai/` | 模型目录与通用文本 / JSON 调用，校验返回结构；兼容原总结与图谱生成 |
| `server/graph-structure.js`、`src/graph-layout.js` | 图谱主干 / 分支 Schema 与引用校验，以及独立的布局与视图投影 |
| `server/sources.js` | 统一来源片段、内容哈希、原位定位信息、输入预算及引文核对 |
| `server/reports.js` | 可追溯的整理结果及来源状态；失效来源不会继续当作有效依据显示 |
| `server/material-library.js` | 共用材料存储和去重；探索与预览互不调用对方的功能模块 |
| `server/modules/` | 专题、探索、搜索、材料预览、理解反馈的业务规则、提示词与输出 Schema |
| `server/system-study/`、`server/modules/system-study.js` | 系统学习的表达策划、来源及历史年代校验、报告与画布版本管理 |
| `src/system-study-*` | AI 总结中的系统学习入口、语义网格排版、可编辑白板、来源检查与独立草稿 |
| `shared/infographics.js`、`server/infographic-sources.js` | 按需配图提示词、声明式版面 Schema、规范化与生成时来源快照 |
| `server/modules/infographics.js`、`src/infographic-*` | 单独配图与版本管理、原生画布排版、阅读预览、编辑与统一导出 |
| `server/integrations/`、`native/` | 网页正文 / PDF 提取、macOS Vision 图片与手写识别 |
| `server/lib/` | 存储仓库、值校验和小型工具函数 |
| `docs/user-guide.html`、`scripts/build-guide.mjs` | 使用说明的单一来源，生成 DSH 内嵌文档及 Chrome 离线说明 |
| `src/features/` | 独立学习页面、配置上下文、模型选择、任务进度、引用弹窗、来源定位和手写导出 |
| `chrome-extension/preview-panel.js` | Chrome 材料预览界面及与笔记绑定的异步状态 |
| `chrome-extension/reader-entry.js` | 网页正文 / 可访问字幕提取及段落 / 视频时间定位，构建为 `page-reader.js` |
| `core.js`、`learning.js` | 原有笔记存储、并发版本、批注、FSRS 复习与知识关联 |

原有 API 保持兼容，白板、截图、分类、总结、批注及复习数据沿用现有格式。新工具的数据保存在 `modules/`，不需要重写旧笔记。

## 操作与任务约定

界面仍使用 `execute({action, ...})`。模块在 `register(router)` 中注册动作，并指定所属功能：

```js
router.register('topics.generate', request => this.generate(request), 'topics');
```

路由层在每次操作前检查开关。耗时工作交给 `tasks.start({feature, key, references, request, run})`，界面使用 `tasks.get` / `tasks.list` 轮询。`key` 用于复用同范围的正在运行的任务；引用中记录相关笔记、材料和总结编号，用于停止或清理任务。

`run(job)` 接收 `signal`、`progress` 和 `assertActive`。外部调用前后、落盘前检查取消状态，集成必须传递 `AbortSignal`。关闭功能后，已开始任务会停止，排队任务不再执行；数据继续保留。启动时将未完成任务标记为 `interrupted`，不会自动重放模型调用。

任务日志记录状态、耗时与引用编号；大图片和用户作答不重复写入任务元数据。默认最多同时执行两个新模块任务，每个任务最长 30 分钟。原总结、图谱任务保留自己的历史任务格式。

主要操作：

| 功能 | 操作 |
| --- | --- |
| 配置 | `features.get` / `features.update` / `features.models` |
| 专题 | `topics.list` / `topics.save` / `topics.get` / `topics.generate` / `topics.enroll` |
| 探索 | `explore.start` / `explore.history` / `explore.report` / `explore.queue` / `explore.add` / `explore.update` |
| 搜索 | `search.query` / `search.plan` / `search.index` / `search.ocrRecords` / `search.correct` |
| 材料 | `materials.list` / `materials.capture` / `materials.fetch` / `materials.get` / `materials.preview` / `materials.delete` |
| 反馈 | `feedback.context` / `feedback.start` / `feedback.history` / `feedback.get` / `feedback.resolve` / `feedback.enroll` |
| 系统学习 | `systemStudy.start` / `systemStudy.list` / `systemStudy.get` / `systemStudy.saveCanvas` / `systemStudy.deleted` / `systemStudy.enroll` |
| 信息图 | `infographics.list` / `infographics.get` / `infographics.start` / `infographics.saveCanvas` / `infographics.visibility` |
| 周报 | `weekly.overview` / `weekly.generate` / `weekly.list` / `weekly.get` / `weekly.deleted` / `weekly.reviewSession` / `weekly.enroll` / `weekly.grade` |
| 共用 | `tasks.get` / `tasks.list` / `tasks.cancel` / `sources.catalog` / `sources.get` / `reports.get` |

Chrome `/module` 只开放所需的配置读取、材料读取 / 分析及任务状态 / 取消动作，沿用本机随机令牌和来源校验。

## 来源与模型约定

所有分析先取得统一来源片段。来源包括笔记、材料或整理结果编号，内容哈希，以及画布元素、总结段落、材料段落和视频时间等定位信息。输入按来源轮流选取并控制总量，避免首篇长文吃掉整个预算。

模型只看到短引用编号 `R001` 等；模型返回的 `evidence` 必须包含合法 `sourceId` 和原文连续短句。服务端先校验 JSON 结构，再验证引文确实存在，最后替换成可定位的完整引用。界面用文本及原生 SVG 展示内容，不执行模型给出的脚本或 HTML。

新模块共享 `ANALYSIS_RULES`，各模块负责自己的提示词、Schema 和业务校验。原白板总结仍使用 `summary-prompt.js`；知识图谱使用 `graph-ai.js`。模型传输统一走 `ModelGateway`，显式保留实际模型和推理强度。

联网探索先用本机 Codex 搜索主题，再读取候选网页正文，最后根据已读材料及笔记生成建议。搜索阶段只使用用户输入的主题 / 方向。普通整理任务关闭联网；联网任务只额外开放搜索所需能力。公开网页读取限制 HTTP(S)、地址、重定向、体积和耗时，不运行网页脚本。

OCR 用 Apple Vision，在本机处理图片。手写由客户端按空间分组导出 PNG，服务端校验当前笔迹签名后建立索引；手动修正与自动识别结果一起保存。代码中的 `NativeReader` 和 `WebReader` 都可通过 Runtime 注入替代实现，不影响业务模块。

## 数据生命周期

- 新模块仓库采用按编号的 JSON 文件，原子写入、上次版本备份和串行更新；读取缓存根据文件修改时间和大小失效。
- `modules/settings.json` 保存开关与模型偏好；配置损坏时保留原文件并停用新模块，原始白板继续可用。
- 整理结果保留输入来源快照及哈希。内容变化时显示过期提示；来源删除后隐藏相关结果。搜索 / 复习引用打开当时引用的版本。
- 专题可删除 / 恢复；原笔记不随专题删除。对应整理和复习在专题恢复后重新可用。
- 移入回收站会停止相关新任务，来源失效会暂停展示相关复习和整理。永久删除先等待任务停止，再清理相关材料、整理、索引、任务、清单及复习数据；旧来源不会被迟到结果写回。
- 完整备份包含模块设置、专题、材料、整理结果、待学清单及索引。模型凭据和桥接令牌不导出。
- Chrome 材料状态按笔记编号保存，异步操作记录当前上下文代次；切换标签页后旧请求不能覆盖新笔记的界面。

## 新增功能的步骤

1. 在 `shared/features.js` 添加稳定编号、名称和说明，配置层自动提供独立开关。
2. 在 `server/modules/` 实现业务模块，注册带功能归属的动作。耗时逻辑复用 TaskManager；模型调用复用 ModelGateway；来源与输出复用 Sources / Reports。
3. 在 `server/runtime.js` 注入共用依赖并注册模块。新增数据仓库要同时接入备份与永久删除流程。
4. 在 `src/features/` 添加独立页面，并登记到 `module-page.jsx`。使用共用模型选择、任务状态、引用弹窗和配置上下文。
5. 如果需要 Chrome 能力，只开放确有需要的 `/module` 动作，并检查笔记 / 标签页绑定。不要把密钥放入客户端或发布 `connection.json`。
6. 添加覆盖真实业务边界的测试：开关、取消、引用有效性、并发更新和来源删除。通过临时数据目录及隔离浏览器验证界面。

## 开发与验证

```sh
npm ci --legacy-peer-deps
npm run format
npm run build
npm test
npm run check:format
```

`LearningRuntime(ctx, store, learning, overrides)` 可以注入测试模型、网页读取器和 OCR 服务。自动测试使用临时库，不连接用户笔记。公开验证步骤见 [验证说明](docs/validation.md)；本机验收记录保存在不参与发布的 `QA.md`。

构建产物是 DSH `client.js`、Chrome `canvas.js` / `page-reader.js` 和本地字体。源码修改后先完成构建，再更新本机链接目录及配套扩展目录。服务端更新需要重启 DSH；Chrome 扩展更新需要在扩展管理页刷新。

知识图谱的 schemaVersion 3 在实体和 SPO 上增加 maps（核心问题、带依据的主线判断、主干实体 / 关系、语义分组与分支）。版本 2 继续读取并显示明细；版本 3 的每个可见引用都须通过来源有效性过滤。布局只计算视图，不改写事实；展示层次的复核可记录 structureReview。

### 画布公共组件（3.3）

`CanvasTools` 在 DSH 与 Chrome 的画布区域外提供绘图工具与悬停说明；原生属性面板仍由 Excalidraw 管理。`learning-card-data.js` 负责卡片归属、旧格式读取、误绑定文字恢复与命中判断，`learning-layout.js` 负责纯布局，`LearningWidgets` 负责结构化编辑与场景写回。

`ImageText` 通过 `execute`、`flush`、`noteId` 接入两种宿主。选图 OCR 复用 `SearchModule` 和本机 `NativeReader`；识别与确认都校验原图及裁剪指纹，索引在仓库串行更新中合并，确认后才创建普通可编辑文字。异步请求以会话序号隔离，关闭窗口或切换笔记后不写入迟到结果。OCR 入口随全内容搜索开关启停。

### 图谱来源呈现（3.3.1）

`buildGraphInput` 为每段来源记录笔记、总结版本及关联材料信息；`currentGraph` 在内容指纹仍有效时动态补齐来源元数据，兼容已有报告。`graph-provenance.js` 按笔记与总结版本生成来源目录和关系编号，`GraphSourceCard` 负责一致展示引用层级、定位与网页入口。编号为当前图谱视图引用标记，原有持久化来源 ID 和引文仍用于验证。图谱 UI 明确表达来源观点与推断，出处不代表独立事实核查。

### 系统学习（4.1）

系统学习以单篇笔记为入口，在 AI 总结面板内切换，通过独立 `systemStudy` 功能开关控制。生成先做表达策划，再按选项检索与读取资料，最后生成带来源的语义结构。模型选择图形种类和节点网格位置，客户端只负责几何排版、换行和 Excalidraw 元素转换，不执行模型脚本。模型补充与材料观点、推断分开标记。

历史研究把当时的问题、知识和解释与后来修正分开。页面发布元数据参与截止年校验；日期未知时只能标为回溯重建。生成时仍需检查历史解释是否混入后见知识，日期校验不等于史实已独立核实。

报告保存在 `modules/reports`，用户编辑的白板保存在 `modules/study-canvases`，按 revision 拒绝覆盖其他窗口的新版本。客户端草稿键包含原笔记及报告编号，随笔记清理。新版本生成不会覆盖旧画布；删除报告可恢复，并暂停对应复习。画布仓库接入备份和永久删除。

白板图像来源使用服务端当前原始元素和图片数据的指纹；来源变更标记过期。传给模型的图像仅随显式生成请求发送，检索阶段只收到提炼的研究问题。正常总结和其他模块不自动加入这些图像来源。

### 学习周报（4.1）

学习周报复用报告仓库，不另造学习时长或掌握分数。`weekly-period.js` 按指定 IANA 时区计算周一至下周一的边界，处理夏令时；统计来自笔记创建、总结/报告生成与实际复习事件。`SourceRepository` 可引用其他报告、复习作答及系统学习白板的文字修订，报告依赖形成有向来源链。永久删除会迭代清理依赖已删除报告的周报；移动画布节点不会被当作理解变化。周报按需生成，无后台自动推送。

### 周报知识总结与复习（4.2）

周报的知识总结与复习使用兼容旧报告的可选持久化字段 `knowledgeSummary`、`reviewQuestions`；新生成强制包含 1～8 道有依据的题。`weekly-review.js` 将复习来源展开成原始来源与祖先周报的扁平引用，避免“周报引用复习、复习又引用周报”的递归依赖。卡片沿用 FSRS 与幂等复习事件；前端重试保留事件编号，停用状态不被重复加入覆盖。仅保存于复习卡的参考答案可作为新题的依据，用户作答与自评不能冒充参考答案。`enrollCustom` 返回规范 JSON，保留结构化题干、任务与核对要点。

### 图谱版本与显示校验（4.2.1）

图谱生成仍由 `buildGraphInput` 选择最新总结或显式历史范围，并限制输入预算。读取既有图谱时，`graphReferenceSources` 按保存的引用编号直接核对仍存在的原始版本，与下一次生成范围分离。新总结只使图谱提示待更新，并给旧版本引用标记；不会自动丢弃原来的关系。来源被删除或同一原文被改写时仍隐藏失效引用。验证过程只构造视图，不改写保存的图谱；同一段材料的不同关系保留各自引文。

### 自适应信息图（4.3）

普通总结在同一次模型调用中选择文字、原图、简单图解或信息图，空 `infographics` 是有效结果。按内容选择结构，没有固定图形或每节配图配额。`visualDecision` 记录编辑决策；功能关闭时服务端强制忽略新增信息图。旧总结结构继续读取。

信息图使用受约束的节点、位置、文字、色彩角色、原图引用和关系，不执行模型代码。`infographic-layout.js` 负责换行、可读字号与原生图形；`infographic-render.js` 负责原图可见区域、图像裁剪、Excalidraw 场景与 PNG/SVG/PDF 导出。阅读、编辑和导出共用同一场景。无法容纳的过密文字明确报错，保留重做入口。

自动图保存在所属总结中；单独重做的生成版本保存在 `modules/infographics`，用户编辑保存在 `modules/infographic-canvases`。重做保留旧版本及其手动编辑，按画布 revision 防止覆盖，网络重试复用请求编号。草稿键含笔记、总结和信息图编号；来源总结删除后禁止保存，恢复后仍能读取，永久删除笔记和完整备份均包含派生版本与画布。来源是生成时的材料/总结快照，不代表独立核验。

### 公开分发（4.0）

包名由 package.json 生成到 `shared/identity.js`，用于客户端注册与 RPC 描述。`plugin-config.js` 导出配置 Schema；运行数据保留在 DSH 用户目录中，不写入 npm 或扩展安装目录。数据目录使用进程间锁，在任务清理完成后释放。

`BrowserConnections` 维护待确认连接与每个扩展来源的独立令牌。只有 DSH 客户端的 `capturePairing` 方法能确认、拒绝或撤销，普通学习工具动作不开放授权入口。请求具有随机秘密、时限和协议版本；旧本机令牌通过迁移接口转换成绑定来源的连接。公开包不会包含任何连接文件。

本机能力通过 `system.capabilities` 读取。macOS 识别程序由 CI 预编译；发布检查验证源码哈希、程序哈希与架构。开发时编译需明确开启，其他平台会给出不可用原因。

`release:local` 分别输出 DSH tarball 与 Chrome ZIP。`third-party.mjs` 根据实际浏览器构建输入和运行依赖收集许可，补充许可按版本及哈希固定；升级依赖后需重新核对缺失项。生成代码、安装包、运行状态与个人发布配置在版本控制中排除。
