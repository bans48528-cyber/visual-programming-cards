# 第三方与用户资源说明

本仓库是本地项目交接，`package.json` 为 `private: true`、`license: UNLICENSED`。该设置不替代各上游资源自己的许可证，也没有为用户自定义模型或图标授予公开再分发许可。

| 内容 | 来源与版本 | 保留位置 |
| --- | --- | --- |
| buildinginstructions.js | [LasseD/buildinginstructions.js](https://github.com/LasseD/buildinginstructions.js)，提交 `ee002f534c03c479bbd03f879d3d49aa01a6eade`；顶层为 Unlicense 文本 | `vendor/upstream/LICENSE`、`vendor/upstream.lock.json` |
| Three.js 与相关上游脚本 | 上游打包的 Three.js r139；其文件头声明 MIT | 原文件头；`public/licenses/three-r139-LICENSE.txt`，取自 [r139 原文](https://github.com/mrdoob/three.js/blob/r139/LICENSE) |
| jQuery | 上游打包的 3.3.1 | 原文件头；`public/licenses/jquery-3.3.1-LICENSE.txt`，取自 [3.3.1 原文](https://github.com/jquery/jquery/blob/3.3.1/LICENSE.txt) |
| zip.js | 2.23.0，BSD 3-Clause | `public/app/zip-LICENSE.txt` |
| LDraw 零件 | Studio 2.26.7_1 标准/UnOfficial 库及官方 2026-09-30 补充；按各文件头的作者、LICENSE、HISTORY 记录 | `public/library/CAlicense.txt`、`CAlicense4.txt`、`CAreadme.txt` 及每个零件的原始头信息 |
| 套装清单 | [Rebrickable 数据下载](https://rebrickable.com/downloads/) | `public/library/manifest.json` 的来源、套装与映射，`data/library-report.json` |
| 小白主机与接头 | 用户提供 `小白主机.io`、`小白接线头.io` | `public/custom-library/manifest.json` 的来源与哈希；运行几何和测试夹具 |
| 8 个 SVG 图标 | 用户提供 `应用图标.ai`，提取原矢量路径 | `public/app/icons/source.json` 的源哈希及各图标哈希 |

LDraw 库存在不同代际的许可头，不能只用顶层引擎的 Unlicense 概括全部资产。相关作者/历史信息保持在零件文件内，原有纹理与脚本头信息也随文件保留。本说明记录现有来源，不宣称对所有来源做过完整法律审查。

`public/examples` 的合成 `.io` 由 `scripts/make_fixtures.mjs` 生成，用于测试，不是整套 LEGO 官方搭建说明。自定义预览使用用户零件。原始桌面 `.io` 和 AI 不进入交付包。

开发依赖（Playwright 等）通过 `npm ci` 安装，版本锁定在 `package-lock.json`，未打入网页运行包；各包的许可证随依赖安装保留。静态构建复制此说明、上游 LICENSE、锁定来源与运行库的许可证到网页包，App 集成时需一并保留。
