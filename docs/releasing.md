# 发布与市场收录

维护者：Qiangsheng Liu。npm 包名：`dsh-learning-quirky-stuff`。本地构建流程不自动上传仓库、npm、Chrome Web Store 或插件市场。

## 构建可安装产物

在干净 checkout 中，使用 macOS 13+ 和 Node.js 24+：

```sh
npm run check:registry
npm ci --legacy-peer-deps
npm run build:native
npm run build
npm test
npm run test:browser
npm run test:install
npm run release:local
```

产物位于 `dist/releases/`，包含 DSH tarball、Chrome ZIP 和源码 ZIP。DSH 包不包含 Chrome 安装目录；Chrome ZIP 是独立配套。产物不含个人目录、笔记、连接令牌、`QA.md`、私有 QA 记录或开发日志。源码 ZIP 保留公开的 `docs/validation.md`；编译产物附带相应第三方通知。

`npm run release:local` 会校验两个 macOS 架构的识别组件与源码指纹，检查 npm 包的实际文件清单，生成 SHA-256 校验文件。构建缺少任何必需产物或版权通知时会失败。

依赖锁文件、项目 `.npmrc` 和发布配置统一使用 `https://registry.npmjs.org/`。CI 在安装前检查锁定的下载地址；打包检查也会拒绝私有镜像、本地依赖与仓库中的 npm 认证配置。只修改 `.npmrc` 不会清除锁文件已有的下载地址。更换下载源时应保留已锁定版本，并核对公共包的完整性校验值，再用空缓存验证 `npm ci`。

## 填写公开仓库信息

远程仓库创建后，执行：

```sh
npm run release:metadata -- --repository https://github.com/YOUR_ACCOUNT/YOUR_REPOSITORY
```

这会写入 package.json 的 repository / homepage / bugs，并在 `dist/market` 创建索引草稿。命令只写本地文件，不创建远程仓库，也不能把草稿当作已发布版本。请将示例地址替换为实际拥有并已公开的仓库地址。

首次公开时，还应在远程仓库开启私密漏洞报告，完善 SECURITY.md 中的报告渠道，并添加 `dsh-plugin` Topic。

## 发布 npm 与 DSH 索引

先确认 npm 账号拥有包名的发布权限，再手工发布已经验证的 tarball：

```sh
npm publish ./dist/releases/dsh-learning-quirky-stuff-4.4.2.tgz --access public --registry=https://registry.npmjs.org/
```

DSH 索引使用已发布的准确 npm 版本，包含作者、版本、兼容范围和来源。可交给选定的社区索引收录，也可将生成的索引放到 HTTPS 静态站点，让用户在 DSH 发现页添加索引源。实际 npm 发布完成前，不要发布宣称该版本已可安装的索引。

公开版本可读取后，运行 `npm run market:generate`。它会读取 npm 上的发布时间、仓库和兼容范围，并将 tarball 完整性值与本地验证过的安装包比对，成功后才生成 `market/index.json`。将该文件提交到公开仓库，即可使用 README 中的 HTTPS 索引地址；不要用会重定向的 Release 附件 URL 作为索引源。

社区收录与发布分开记录。`dsh-market/dsh-market` 的目录来自 `awesome-dsh-plugin/awesome-dsh-plugin`，投稿是 `data/plugins/<owner>__<repo>.yml` 的 PR，且新仓库需创建满一天。开放插件市场 `polang233/dsh-plugin-index` 使用插件收录 Issue。提交申请后仍需等待相应维护者审核，不能把“已提交”标成“已收录”。

当前版本范围为 `>=0.2.2-rc.1 <0.3.0`；更高版本仍需验证，不能仅通过放宽版本号宣称兼容。

## 从 Git 安装

推荐给用户提供已构建的 npm 包或 Release tarball。Git 源码 checkout 中不提交生成的客户端与本机二进制，直接安装默认分支不会自动得到完整可运行包。源码使用者应先 clone、安装开发依赖、构建，再将本地目录安装到独立 profile。

## Chrome 发布

ZIP 可供开发者模式安装。若发布到 Chrome Web Store，需在开发者后台另行提交名称、图标、截图、单一用途说明、权限用途、隐私政策 URL 与测试步骤。默认本机端口只访问 127.0.0.1:43127；自定义端口使用可选权限。桥接授权绑定实际扩展 ID，因此商店版与解压版分别首次连接即可。

## 版本与数据

同时更新 package.json、package-lock.json、shared/version.js 和 Chrome manifest 的版本。包名由构建脚本同步到客户端和 RPC 标识。桥接协议不兼容时必须给出明确升级提示。

发布前验证旧数据读取、默认存储目录延续、卸载后数据保留、重复实例保护、取消任务及失败恢复。不得把测试操作写入维护者或用户真实笔记。用户主动创建的备份文件不随软件更新删除。

桌面版 `desktop` profile 只能通过 DSH 应用管理；命令行安装测试使用独立临时 profile。发布说明应分别给出桌面应用和命令行安装方式。
