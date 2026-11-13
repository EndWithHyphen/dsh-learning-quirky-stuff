# 安装、配置与迁移

## DSH 插件

源码开发与独立命令行环境使用 Node.js 24+，与复习库 `ts-fsrs 6` 的运行要求一致。桌面版使用 DSH 提供的运行时。Node.js 22 仍在 CI 中执行兼容性回归，但不作为正式构建环境。

已验证宿主版本为 0.2.2-rc.1。桌面版：将发布包解压，在 DSH「插件」页面添加本地插件，选择解压后的 `package` 目录。桌面版的 `desktop` profile 由 Electron 应用独占管理，不应通过 CLI 修改。

命令行版可在独立的 `studyboard` profile 安装：

```sh
dsh plugin --profile studyboard add ./dsh-learning-quirky-stuff-4.5.3.tgz
```

也可通过 DSH 的添加插件入口选择安装来源。安装后启用学习画板，打开主面板。当前源码为 4.5.3 开发版，上面的路径指向本机构建产物。已公开的 npm 版本为 `dsh-learning-quirky-stuff@4.4.2`；以 npm 和 Releases 的实际记录为准。

## 从旧本机版本迁移

1. 等待正在生成的总结、图谱和学习任务结束，并保存 Chrome 草稿。
2. 下载笔记备份；关闭 DSH 后再复制整个 `DSH_HOME/storages/studyboard-v1/` 目录，保留文件恢复副本。
3. 桌面版在插件页面移除旧 `@local/dsh-studyboard` 组合包，再添加新包；命令行版在对应 profile 操作。不要同时启用两个版本。
4. 默认数据目录沿用 `studyboard-v1`，已有笔记、分类、总结、复习记录与模块结果继续读取。
5. Chrome 扩展更新后，已经建立的旧连接尝试自动迁移。迁移失败时在扩展设置重新连接，不会清空浏览器草稿。

DSH CLI 示例（仅用于命令行 profile；桌面版请在插件页面移除旧包、添加新包）：

```sh
dsh plugin --profile studyboard remove @local/dsh-studyboard
dsh plugin --profile studyboard add ./dsh-learning-quirky-stuff-4.5.3.tgz
```

数据目录不在 npm 包或扩展目录内。卸载和升级只更换程序，不主动删除笔记。需要回滚时关闭 DSH，恢复之前保留的程序包和数据目录副本。不要将新版本产生的数据直接覆盖到无法识别它的旧版本上。

## Chrome 配套

解压 Chrome ZIP，在 `chrome://extensions` 启用开发者模式并加载解压目录。首次安装会打开连接设置。

1. 启动 DSH，启用学习画板。
2. 扩展设置中点击「连接本机 DSH」。
3. 在 DSH「学习画板 → 浏览器快捷笔记」核对扩展 ID 并点「允许连接」。
4. 之后凭据保存在浏览器存储中，重开后自动连接；无需输入连接码。

在 DSH 中可断开某个浏览器连接，撤销立即生效。同一浏览器重新安装到不同目录后，扩展 ID 可能改变，需要重新绑定。笔记数据仍保留在 DSH。

## 可配置项

在 DSH 插件配置编辑器中设置以下字段；这些值由插件导出的配置 Schema 校验。自定义配置对象示例：

```json
{
  "dataDir": "",
  "captureEnabled": true,
  "capturePort": 43127,
  "nativeReaderPath": "",
  "allowNativeCompile": false
}
```

如果通过 profile 的 patch 配置，请使用当前 DSH 支持的覆盖语法；覆盖整个 config 时，需要保留所有希望继续生效的自定义字段。

- `dataDir`：空值使用 DSH 用户数据目录；自定义时填绝对路径。
- `captureEnabled`：关闭浏览器服务，不影响本机白板与学习功能。
- `capturePort`：1024～65535，默认 43127。端口冲突时可调整，并在扩展设置中使用同一端口；扩展会为自定义本机端口请求权限。
- `nativeReaderPath`：自定义本机 OCR/PDF 程序的绝对路径，通常留空。
- `allowNativeCompile`：仅源码开发使用。正式包提供预编译组件，默认不在用户机器编译。

## 平台与模型

macOS 13+ 的 Apple Silicon 和 Intel 发布包包含本机识别程序。Windows/Linux 可使用通用界面、文字和模型功能，但未进行完整平台验收；本机 OCR / 材料 URL 的 PDF 提取不可用时会在功能设置中说明。笔记中的 PDF.js 阅读、选文与摘录不依赖 macOS 识别组件。

Codex 是可选的外部工具。自行从官方渠道安装并登录后，在模型选择器选择具体模型。插件从 PATH 和常见安装目录查找程序，也可设置 `STUDYBOARD_CODEX_BIN` 指定路径。CLI 版本必须支持 `exec`、结构化输出和隔离用户配置的参数；版本不兼容时保留原笔记并报告错误。

## 备份恢复

应用内备份导出保留笔记和学习数据；目前没有一键导入完整备份的界面。最直接的完整恢复方式是在 DSH 关闭时恢复你自行保留的数据目录副本，再启动 DSH 检查笔记。只有导出备份时，请先保留原文件，在独立数据目录中完成格式校验与恢复，避免手工覆盖现有文件。包含 PDF 的备份为 ZIP：`backup.json` 的 `modules.pdf.documents[].assetFile` 指向 `pdfs/<文件哈希>.pdf`，恢复时需校验文件哈希并保留笔记关联、批注和页面索引。请同时备份整个数据目录，以便直接恢复。
