# Avaris2 CS 开发指导手册（源码说明）

版本：2.1.0（2026-10-21） · 公司：OSEMTEC

这份手册面向接手 Avaris2 CS 源码的开发人员。内容包括：
- 软件的整体结构，以及每个文件是做什么的；
- 如何运行、测试，如何编译计算引擎；
- 如何封装 Windows 安装包，以及发布流程和常见陷阱。

版本变化记录在 `VERSIONS.md`。

---

## 1. 软件是什么

Avaris2 CS（曾用名 OsemCM V2.0、Avaris2）是 Windows 桌面软件，用于城市排水管网和雨污水系统的水力建模：
- 能打开和保存 **EPA SWMM / Avaris DS 的 `.inp` 模型**；
- 计算引擎是 **EPA SWMM 5.2.4 内核加 Avaris 收敛改进**（C 语言，`engine/src`）；
- 界面仿 Avaris DS / ArcGIS Pro 的 Ribbon，内置 GIS（底图、坐标系、shp/GeoJSON/KML/GDB/GeoTIFF）；
- 带 2D 地表淹没模块（1D-2D 耦合）；
- 结果分析包括 Theme 着色、Flag 报警、报告查看器、剖面、曲线、方案对比；
- 还有用户登录和修改记录（审计）。

技术栈：

| 层 | 技术 |
|---|---|
| 桌面外壳 | **Electron 33.2.1**（Chromium + Node.js），Windows x64 |
| 界面 | 原生 JavaScript（不使用框架、不需要编译打包），HTML + CSS，Canvas 2D 绘图 |
| 主进程 | `app/main.js`（Node.js）：文件读写、对话框、运行引擎、读取二进制结果 |
| 计算引擎 | C（EPA SWMM 5.2.4 + 修改），OpenMP 多线程，独立 exe，命令行调用 |
| GIS 工具 | 随软件附带 GDAL 的 `ogr2ogr.exe` / `ogrinfo.exe`，只用于 File Geodatabase |
| 安装包 | NSIS 3（`installer/avaris.nsi`） |

运行时的关系如下：

```
Avaris2CS.exe (Electron)
 ├─ main.js ──────────── IPC(preload.js 暴露的 window.host.*) ───── renderer/index.html + js/*.js（界面）
 │    ├─ 启动 resources/engine/avaris_engine.exe <inp> <rpt> <out>，读取 stdout 中的 PROGRESS / DONE 行
 │    ├─ outreader.js：随机读取 .out 二进制结果（按时间步、按对象）
 │    └─ resources/gdal/ogr2ogr.exe：读写 .gdb
 └─ 用户数据：%APPDATA%\OsemCM\（settings.json、用户、修改记录；改名后仍用这个文件夹）
```

---

## 2. 目录结构与每个文件

### 2.1 根目录

| 路径 | 说明 |
|---|---|
| `VERSIONS.md` | 版本记录，每个版本一行，写明改了什么。发布前必须追加。 |
| `DEVELOPER_GUIDE.md` | 本手册。 |
| `CLAUDE.md` | 给 AI 编程助手（Claude）的项目说明，内容是本手册的精简版。 |
| `build.sh` | **一键封装安装包**（Linux）：组装 Electron 目录 → 修补 exe 图标 → 复制程序、引擎、样例、GDAL → 调用 NSIS。见第 5 节。 |
| `package.json` | 根目录占位文件，没有实际作用；程序的 package.json 在 `app/` 下。 |
| `.gitignore` | 排除 `dist/`、`node_modules/`、`app/gdal/`（体积大，单独附带）、`license-tools/private_key.pem`。 |
| `build/icon.png`, `build/icon.ico` | 程序和安装包图标（A² 标志），ico 内含多种尺寸。 |
| `docs/FEATURES-1D-2D.md` | 1D 和 2D 功能划分清单，供以后开启许可证分版本时查找对应代码。 |
| `tests/launch_dev.sh` | 在 Linux 无界面环境下从源码启动程序，并打开 CDP 调试端口 9333。 |
| `tests/e2e_smoke.py` | Playwright 冒烟测试：打开样例模型、属性表、Flag 面板，有 JS 报错即失败。 |
| `tools/peicon.py` | 把 PNG 图标写入 Windows exe 的图标资源（Linux 上没有 rcedit 时使用）。 |
| `tools/iconnorm.py` | Ribbon 图标视觉尺寸统一工具（裁边、按内容面积缩放、居中到画布）。用法：`python3 iconnorm.py 源文件夹 输出文件夹 0.86 96`。 |
| `tools/make_insights.py` | 旧版本用来生成 Insight Flag 主题 json 的脚本，已被 Flag 面板取代，仅作参考。 |
| `license-tools/keygen.js` | 命令行版许可证签发：`node keygen.js --request "<申请邮件全文或 AVREQ-…>" [--edition 1D\|2D] [--term 30d\|1y\|3y] [--start YYYY-MM-DD]`。日常签发和管理请用 `tools/licence-manager/Avaris2CS_Licence_Manager.html`（见第 9 节）。 |
| `license-tools/public_key.pem` | 公钥，已嵌入 `main.js` 用于离线验证。 |
| `license-tools/private_key.pem` | **私钥，务必保密，不能随软件发布**，也不进 git。源码包里如果附带，要单独妥善保管。 |
| `installer/avaris.nsi` | NSIS 安装脚本：安装目录、开始菜单和桌面快捷方式、可选的 .inp 关联、卸载；安装前会自动卸载旧名称 "Avaris2" 的版本。 |
| `installer/LICENSE.txt` | 安装时显示的许可协议，同时复制为 `LICENSE-Avaris2CS.txt`。 |
| `installer/THIRD-PARTY-NOTICES.txt` | 第三方组件声明。`build.sh` 会把 GDAL 和 PROJ 的许可全文接在后面，生成安装目录里的 `THIRD-PARTY-NOTICES.txt`；Help ▸ About ▸ Third-party notices 打开的就是这个文件。**新增任何开源库、字体或数据，都要把它补进这个文件。** |
| `dist/` | 构建输出（不进 git）。`dist/stage/` 是解压后的 Windows 版 Electron 和组装好的程序，`dist/*.exe` 是安装包。 |

### 2.2 `app/`：Electron 程序

| 文件 | 说明 |
|---|---|
| `app/package.json` | 程序名称和版本号。**版本号以这里为准**，`build.sh` 从这里读取版本。`productName` 为 "Avaris2 CS"。 |
| `app/main.js` | 主进程，主要做这些事：<br>• 创建窗口（隐藏菜单栏），堆内存上限设为 4 GB（大模型需要）；<br>• 用户数据固定放在 `%APPDATA%\OsemCM`；<br>• 通过 `ipcMain.handle` 提供文件读写、对话框、编码检测、zip 读取、GDAL 调用、运行引擎（单个或多方案并行，可取消）、`.out` 结果读取（`out:*`）、许可证验证（Ed25519）、用户和设置存储、样例模型复制到"文档\Avaris2 CS\Samples"。 |
| `app/preload.js` | 把 `main.js` 的 IPC 通道包装成 `window.host.*` 函数给界面调用（contextIsolation 安全桥）。界面里所有的文件和系统操作都经过这里。 |
| `app/outreader.js` | SWMM/Avaris 二进制结果 `.out` 读取器：读文件头（对象数、变量、时间步），按需随机读取某个时间步的全部对象（snapshot）、某个对象的时间序列（series）、统计值（最大值等）、2D 积水统计（pondStats）。不会把整个文件读进内存，可以处理大文件。 |
| `app/engine/win/avaris_engine.exe` + `libomp.dll` | Windows 版计算引擎（llvm-mingw / clang 编译，OpenMP 运行库是 libomp.dll）。 |
| `app/engine/linux/avaris_engine` | Linux 版引擎，只用于开发机上测试。 |
| `app/gdal/win/` | GDAL 命令行工具（ogr2ogr、ogrinfo 及其 DLL、proj 数据）。只用于 Esri File Geodatabase 的读写。不进 git，源码包里单独附带。 |
| `app/samples/Demo_Urban_Drainage.inp` | 样例模型，Help 菜单可以打开。 |

### 2.3 `app/renderer/`：界面

`index.html` 按固定顺序加载 `js/*.js`，所有模块都挂在全局对象 `window.AV` 上（例如 `AV.h`、`AV.modal`、`AV.app`）。没有构建步骤，改完 js 重新加载窗口即可生效。

| 文件 | 说明 |
|---|---|
| `index.html` | 页面骨架和脚本加载顺序：util, perf, …, map, locator, temporal, report, flags, …, app。**新增 js 文件必须在这里加 `<script>`**，并注意依赖顺序。 |
| `css/app.css` | 全部样式（Ribbon、面板、表格、对话框、报告、Flag 面板等）。 |
| `icon.png` | 窗口图标。 |
| `icons/*.png` | Ribbon 和工具按钮图标（多为 96–256 px 的高清图，经 `tools/iconnorm.py` 统一视觉尺寸）。在 `ribbon.js` 里按文件名（`img: 'flag'`）引用。 |

`js/` 下的每个模块：

| 模块 | 行数 | 职责 |
|---|---|---|
| `util.js` | 250 | 公共工具：`AV.h`（DOM 构造）、`AV.modal / alert / confirm / formDialog`（对话框）、`AV.toast`、数字和日期格式化、颜色、CSV、防抖、`AV.floatPanel`（可拖动浮动面板）。 |
| `perf.js` | 33 | 性能计时 `AV.perf.rec()`，在 Help ▸ Diagnostics 显示（读取、解析、绘图、结果等耗时和内存）。 |
| `model.js` | 720 | **模型核心**：`.inp` 解析和写出（所有 SWMM 段落），对象结构（节点、管段、汇水区、雨量计、曲线、时间序列、模式……），对象字段定义 `AV.SCHEMA`，ID 改名，边界计算。Avaris 扩展（检查井面积、不透水径流系数、2D 设置）以注释行 `;;@OSEM …` 写入 .inp，EPA SWMM 和 Avaris DS 会忽略这些行。 |
| `app.js` | 830 | **应用主体 `AV.App`**：启动、登录、打开和保存模型、选择集、撤销/重做（`exec` 命令模式）、视图标签（地图 / 属性表 / 报告…）、状态栏、右键菜单、标题栏、About、属性表菜单。各模块在这里实例化（theme、flags、map、panels、sim……）。 |
| `ribbon.js` | 165 | Ribbon 功能区：Project / Operation / Tools / Simulation / Help 选项卡，分组和按钮（大图标、小图标、hero 按钮），按钮状态刷新。新增功能入口在这里加。 |
| `map.js` | 880 | **地图视图 `MapView`**：Canvas 绘制网络、标签、选择、编辑交互（拖动、加点、画管线、框选、测量），外部图层绘制（`drawExt`），属性表选中要素的高亮。**大模型 LOD**：对象数 ≥ 60000 且缩小时用 4096 px 概览位图分块渲染，缩放和平移约 10 ms。样式按帧缓存。 |
| `locator.js` | 81 | 地图角的"眼睛"按钮（T 键，隐藏/显示 Theme 着色）和 Locator 鹰眼图。 |
| `basemap.js` | 150 | 在线底图（XYZ 瓦片，OpenStreetMap / OpenTopoMap 等），按模型坐标系重投影显示；模型坐标系 `app.crs`。瓦片通过主进程的 `avtile://` 协议加载：<br>• 缓存目录是 `<userData>/tiles/<源>/<z>/<x>/<y>.png`，30 天后刷新，离线时直接用缓存；<br>• `AV.downloadTiles` 对应 Basemap 右键菜单的 Download for Offline Use。 |
| `proj.js` | 144 | 自写的地图投影引擎：经纬度、横轴墨卡托（UTM、State Plane TM）、兰伯特（含 Michigan）、Hotine 斜轴墨卡托 A/B、墨卡托、Web Mercator；解析 WKT1 和 WKT2。 |
| `panels.js` | 450 | 左侧模型树（Parameter View）、属性面板（Property Browser，可折叠分组，点击属性名按变量筛选修改记录）、多选编辑、Model Summary。 |
| `props.js` | 383 | 属性面板的字段布局（`AV.propLayout`，Avaris DS 风格分组）和每个字段的输入控件（`AV.propInput`），以及 Direct Inflows、DWF、地下水、LID Usage 编辑器。 |
| `params.js` | 665 | 参数编辑器：Climatology、Aquifers、Snow Packs、Unit Hydrographs、LID Controls、Transects、Controls、Pollutants、Land Uses、曲线、时间序列、模式、Simulation Options 等表单。 |
| `editors.js` | 315 | 段落文本编辑器、曲线和时间序列编辑器、**设计暴雨（Design Storm / Hyetograph）生成器**。 |
| `xsect.js` | 128 | 断面编辑器（图库选择形状，输入尺寸）。 |
| `lidsketch.js` | 33 | LID 类型示意剖面图。 |
| `sym.js` | 348 | Layer View 图层树（网络图层、外部图层、底图，右键菜单），右侧停靠栏标签（Properties / Catalog / Symbology），符号化面板（每类对象的颜色、大小、线宽、标签）。 |
| `theme.js` | 347 | **Theme（专题着色）**，参考 InfoWorks ICM Layer Theme Editor：每个图层有一个有序的子主题列表，可以是连续分级或按值，设置颜色和大小，可用 Where 条件，图例；动态主题只在播放时显示。`subsOf(layer)`：Flag 打开时返回 Flag 项。 |
| `flags.js` | 260 | **Flag 面板**：12 个内置报警规则加用户自定义规则；每个图层可选一条；算法说明里的参数可直接编辑；单位跟随 Flow Units；▶ / Σ 两种模式；颜色设置；新建向导和条件编辑器；导入导出；设置保存在 `<model>.flags.json`。<br>• 内置规则也用条件文本（`cond`，每级一条，`$参数`，`$eps`/`$tol` 由程序提供）定义，在面板里点 *Edit…* 可改名称、说明、算法文字、条件、Where 和参数默认值（US/SI）；修改存在程序设置 `prefs.flagEdits`（对所有模型生效），*Reset* 恢复原定义；*Paste Conditions…* 粘贴 "High: … / Warning: … / Where: …" 文本；Export 会带上这些修改，Import 时写回。<br>• Σ 模式统一为 `peak(等级表达式)`；`temporal.js` 会把用到 totdur 等整场函数的表达式推迟到下一遍计算。`AV.flagsForReport` 供报告 Insights 页使用。 |
| `expr.js` | 366 | **表达式语言**：Select by Attribute、Theme、Flag 共用。可以用字段、计算值、模拟结果（`rpt…` 当前时间步、`max…` 最大值），上下游前缀 `us_` / `ds_`，`iif`、`abs`、`like`，以及时间函数。`AV.compileExpr(src, AV.exprFields(app, layer))` 返回 `{fn, used, temporals}`。 |
| `temporal.js` | 137 | 时间函数（单位：分钟）：`dur / run / win`（到当前时间步为止），`totdur / maxrun / maxwin / first / peak`（全程）。对结果所有时间步只扫一遍，按对象保存区间，播放时可以直接取值。另含 `crownElev`、`maxVolume` 等计算字段。 |
| `units.js` | 88 | Flow Units 切换（状态栏），可选择同时换算全模型的数值（US ↔ SI），切换后通知 Flag 换算参数。 |
| `sim.js` | 800 | **模拟**：Simulation Options 对话框（含 2D Flood 标签），运行引擎（进度、取消、多方案并行），加载结果，播放条（时间滑块），曲线图，`resultsCard`，结果导出。 |
| `database.js` | 95 | Database 面板：基础模型和各次运行结果（`<模型>_Results/<运行名>.{inp,rpt,out,json}`）。 |
| `report.js` | 207 | **报告查看器**：把 `.rpt` 解析为页面，包括 Overview（KPI 卡片、水量平衡）、Continuity、Warnings、Insights（Flag 统计）、Convergence 和结果表格（可排序、过滤、导出 CSV），以及全文。 |
| `chart.js` | 177 | 轻量 Canvas 时间序列图（多序列、悬停读数、拖动缩放）。 |
| `profile.js` | 384 | 纵断面视图：地面、检查井、管道、当前水位线、最大 HGL、信息表。 |
| `compare.js` | 226 | 方案对比：KPI 卡片、差值表（新增积水、已解决、变差、变好）、散点图、差值地图。 |
| `table.js` | 305 | **属性表**：虚拟滚动表格，支持网络对象、2D 网格和导入图层（shp 等）；排序、过滤、编辑（可撤销）、Select by Attribute、字段计算器、统计、复制粘贴到 Excel、导出 CSV。 |
| `tools.js` | 495 | 网络工具：上下游追踪、路径、重算长度和面积、设计管底、孔口转管道、导入网络（从 shp 生成节点和管段）、模型校验（Validate Model）。 |
| `features.js` | 930 | 杂项功能：浮动工具窗、分组（Groups）、汇水区分割合并、Assign Outlet、绘制新图层、导出 shp、方案（Scenarios）、汇总报表、坐标转换、栅格重投影等。 |
| `formats.js` | 322 | GIS 读取：Shapefile（含 zip）、GeoJSON、KML/KMZ、GPX、CSV/TXT（XY）、DXF、GeoTIFF（含 world 文件）、ESRI ASCII Grid；按 .prj 自动重投影到模型坐标系。 |
| `shp.js` | 153 | Shapefile 和 DBF 读写、GeoJSON 读取。 |
| `gdb.js` | 53 | 通过附带的 GDAL 工具读写 Esri File Geodatabase。 |
| `catalog.js` | 122 | Catalog 面板（类似 ArcGIS Pro）：浏览文件夹，双击或拖拽数据加到地图。 |
| `export.js` | 186 | Export Wizard：网络对象连同属性和结果导出为 Shapefile / GDB / CSV。 |
| `mesh2d.js` | 346 | **2D 地表淹没模块**：在边界多边形内生成方格网（按 DEM 取高程），2D 网格写入 .inp（`AV.mesh2DToINP`），导入 Avaris DS 的 `.ini [2D]` 设置，2D 结果（水深、最大水深、积水时长、退水时间）计算、绘制和图例。 |
| `history.js` | 485 | 用户登录和角色（Administrator 管理员、Modeler 建模员、Viewer 只读），**修改记录**（谁在什么时候改了哪个对象的哪个变量，旧值和新值），保存在 `<模型>.osemhist.json`。 |
| `licence.js` | 230 | **许可证**：<br>• 版本分 1D / 1D-2D，期限 30 天、1 年或 N 年，许可证绑定机器码；<br>• 没有有效许可证时（未激活、过期、换了电脑、系统时间被回调）进入只读模式：`AV.licenceGate`，由 `canModify`、`save`、`sim.run` 和方案批量运行调用；<br>• Help ▸ Register 对话框：生成激活申请（发邮件 / 复制 / 保存 .avreq）、导入许可证（粘贴或 .avlic 文件）、释放本机；<br>• 申请只含 osemtec.com 账号、邮箱和机器码；发送方式：Gmail / Outlook.com / Microsoft 365 网页邮箱（`AV.mailUrl`，浏览器里已登录即可一键发送）、本机邮件程序、复制、保存；如果 `main.js` 里填了 `LIC_FORM_KEY`（Web3Forms），还会出现 *Send Request to OSEMTEC*，直接发到 info@osemtec.com。<br>• 软件里不再有签发功能，签发只在 Licence Manager 里做。 |
| `clip.js` | 95 | 复制粘贴对象（连同它们用到的曲线、时间序列等），可以跨模型、跨窗口。 |

### 2.4 `engine/src/`：计算引擎（C）

这是 EPA SWMM 5.2.4 的完整源码（约 55 个 .c 文件和 22 个 .h 文件，说明见 `Roadmap.txt`），再加上以下 Avaris 修改：

| 位置 | 修改 |
|---|---|
| `avaris_main.c` | 命令行入口：`avaris_engine <inp> <rpt> <out> [-nodetail]`；向 stdout 输出 `PROGRESS n`、`DONE err runoffErr flowErr qualErr seconds`、`ERROR msg`，供界面显示进度。 |
| `osem_ext.c` | 读取 .inp 里的扩展注释行 `;;@OSEM CHAMBER`（检查井面积）、`;;@OSEM IMPCOEF`（不透水径流系数）。 |
| `dynwave.c` | 动力波迭代的欠松弛系数可配置（`UnderRelaxation`）；出水口不参与节点水深迭代。 |
| `project.c` | 新选项 `UNDER_RELAXATION`（0.1–1.0，默认 0.5）和 `NONCONV_REPORT_COUNT`（默认 100）。 |
| `report.c` | `-nodetail` 参数：报告中不写逐时间步的时间序列表（大模型的 rpt 文件会小很多）。 |
| `stats.c`, `consts.h` | 不收敛节点统计扩展（最多列出 500 个）。 |
| `input.c` | 遇到引擎不用的段落（如 Avaris DS 写的 `[GROUPS]`）时跳过，不报错。 |
| `subcatch.c`, `objects.h` | 不透水径流系数（impLoss）和检查井面积（chamberArea）。 |
| `text.h` | 版本标识 "Build 5.2.4-A2"。 |

---

## 3. 开发环境与运行

**Windows 开发机：**
1. 安装 Node.js 18 或更高版本。
2. 在 `app/` 目录运行 `npm i -D electron@33.2.1`，然后 `npx electron .`，即可直接从源码运行。
3. `app/engine/win/` 里需要有引擎 exe 和 libomp.dll；`app/gdal/win/` 里需要有 GDAL。
4. 按 `Ctrl+Shift+I` 打开开发者工具，`Ctrl+R` 重新加载界面。改 js 或 css 后不需要编译。

**Linux 开发机（无界面，自动测试用）：**
- 解压 `electron-v33.2.1-linux-x64.zip`，设置 `ELECTRON=…/electron`，运行 `tests/launch_dev.sh`（需要 Xvfb）。
- 安装 Playwright（`pip install playwright`，不需要下载浏览器，通过 CDP 连接 Electron），运行 `python3 tests/e2e_smoke.py`。

**首次启动：** 程序要求创建管理员账户。测试环境里使用的密码是 `pass1`（只在测试数据中使用）。

**调试技巧：**
- 在控制台用 `AV.app` 访问整个应用，例如：
  - `AV.app.model.nodes.size`
  - `AV.app.openFile(path)`
  - `AV.app.sim.loadResults(out, rpt)`
  - `AV.openTable(AV.app,'CONDUIT')`
- Help ▸ Diagnostics 可以查看耗时和内存。

---

## 4. 编译计算引擎

**Linux（开发和测试用）：**
```bash
cd engine/src
gcc -O2 -fopenmp -DNDEBUG -Iinclude *.c -o ../../app/engine/linux/avaris_engine -lm
```

**Windows exe（交叉编译，当前发布版本使用的方法）：**
1. 下载 [llvm-mingw](https://github.com/mstorsjo/llvm-mingw/releases)（ucrt x86_64 版本）。
2. 编译：
   ```bash
   cd engine/src
   x86_64-w64-mingw32-clang -O2 -fopenmp -DNDEBUG -Iinclude *.c -o ../../app/engine/win/avaris_engine.exe -static-libgcc
   ```
3. 把 llvm-mingw 里的 `x86_64-w64-mingw32/bin/libomp.dll` 复制到 `app/engine/win/`。

**在 Windows 上用 Visual Studio 编译：**
- 新建控制台项目，加入 `engine/src` 下全部 .c 文件，包含目录设为 `include`；
- 开启 OpenMP（/openmp），使用 Release x64；
- 这样编译不需要 libomp.dll，但需要 VC 运行库。

**改完引擎后的验证：** 用样例模型和至少一个大模型对比修改前后的 `.rpt`，重点核对连续性误差、最大流量和积水量。

---

## 5. 封装安装包

### 5.1 当前流程（Linux，`build.sh`）

只需准备一次：
1. 解压 `electron-v33.2.1-win32-x64.zip` 到 `dist/stage/`（`electron.exe` 会被自动改名为 `Avaris2CS.exe`）。
2. 准备 NSIS 3 的 Linux 版 makensis，并设置环境变量 `NSIS=<nsis 目录>`（该目录下需要有 `linux/makensis` 和 `Stubs`、`Plugins`、`Include`、`Contrib`）。另外需要 Python 3 和 Pillow（`peicon.py` 用到）。

每次发布：
```bash
# 1) 改版本号：app/package.json 的 "version"（安装包名和版本信息都从这里取）
# 2) 在 VERSIONS.md 追加一行说明
./build.sh                 # 输出 dist/Avaris2CS-Setup-<版本>.exe
git add -A && git commit -m "vX.Y.Z: …" && git tag vX.Y.Z
```

`build.sh` 依次做这些事：
1. 清理 stage；
2. 把 exe 改名为 Avaris2CS.exe；
3. `peicon.py` 写入图标；
4. 复制 `main.js / preload.js / outreader.js / package.json / renderer/` 到 `resources/app/`；
5. 复制引擎到 `resources/engine/`，样例到 `resources/samples/`，GDAL 到 `resources/gdal/`，以及许可协议；
6. 运行 makensis。

### 5.2 在 Windows 上封装（备选）

1. 解压 Electron win32-x64 到一个文件夹，把 `electron.exe` 改名为 `Avaris2CS.exe`。
2. 用 [rcedit](https://github.com/electron/rcedit) 写入图标和版本信息：
   ```
   rcedit Avaris2CS.exe --set-icon build\icon.ico --set-version-string ProductName "Avaris2 CS"
   ```
3. 按 5.1 第 4–5 步手工复制文件到 `resources\`。
4. 安装 NSIS 3（Windows 版），运行：
   ```
   makensis -DVER=2.1.0 -DSTAGE=<stage 目录> -DICON=<仓库>\build\icon.ico -DOUTFILE=<输出>\Avaris2CS-Setup-2.1.0.exe installer\avaris.nsi
   ```

### 5.3 安装包行为（`installer/avaris.nsi`）

- **安装位置**：默认 `C:\Program Files\Avaris2 CS`，需要管理员权限，只支持 64 位 Windows 10/11。
- **旧版本处理**：如果检测到旧名称 "Avaris2" 的安装，会先静默卸载并删除它的快捷方式；用户数据在 `%APPDATA%\OsemCM`，会保留。
- **组件**：程序（必选）、桌面快捷方式、.inp "打开方式"关联（可选，不会替换 EPA SWMM 作为默认程序）。
- **覆盖安装**：会先结束正在运行的 Avaris2CS.exe 和 avaris_engine.exe。

### 5.4 代码签名（SmartScreen 弹窗）

目前安装包和程序都**没有签名**，所以 Windows 会显示 "Windows protected your PC"。签名的办法：
- 申请 Azure Artifact Signing，或者购买 OV 证书。
- 在 `build.sh` 中，peicon 之后签 `Avaris2CS.exe` 和 `avaris_engine.exe`，makensis 之后签安装包（Windows 上用 `signtool sign /fd SHA256 /tr <时间戳> …`，Linux 上可以用 `osslsigncode`）。
- 注意：`peicon.py` 修改 exe 会让已有签名失效，所以**一定要先改图标、后签名**。

---

## 6. 关键设计和约定

- **无框架**：DOM 用 `AV.h(tag, attrs, ...children)` 构造，对话框用 `AV.modal` 和 `AV.formDialog`。
- **撤销/重做**：所有改动模型的操作都通过 `app.exec({label, do, undo, changes})` 执行；`changes` 会写入修改记录，修改属性用 `app.setProps(objs, key, values)`。
- **单位**：模型单位由 Flow Units 决定（CFS/GPM/MGD 为 US，长度 ft；CMS/LPS/MLD 为 SI，长度 m）。界面不另行换算显示值。
- **.inp 兼容**：不能写出 EPA SWMM / Avaris DS 不认识的段落。扩展数据一律用 `;;@OSEM …` 注释行，或者放在旁边的文件里：
  - `<model>.ini`：Avaris DS 坐标系、2D 设置；
  - `<model>.prj`：坐标系，优先级高于 .ini；
  - `<model>.flags.json`：Flag 设置；
  - `<model>.mesh2d.json`：2D 网格；
  - `<model>.osemhist.json`：修改记录；
  - `<model>_Results/`：各次运行结果。
- **大模型**：
  - 渲染用 LOD 概览位图（`map.js`：`AV.OV_MAX`、`_ovStart/_ovTile/_drawOverview`）；
  - 主题样式按帧缓存（`AV._drawing`、`AV.frameId`）；
  - 结果按需随机读取（`outreader.js`）；
  - 时间函数一遍扫描（`temporal.js`）。
  - 测试用的大模型：36 万节点和 100 万节点的合成模型。
- **坐标系**：读取 WKT1 和 WKT2；`AV.crsCheck` 会在模型中心离投影原点过远时提示坐标系可能设错；预设了 Michigan 常用坐标系（EPSG 2253 / 26990 / 3078）。
- **Theme 和 Flag 的关系**：Flag 打开且有选中项时，`theme.subsOf(layer)` 只返回 Flag 项，原有 Theme 暂停显示；关闭面板后恢复。

---

## 7. 测试清单（全面测试阶段建议）

1. **打开和保存**：Avaris DS 和 EPA SWMM 的各种 .inp（含 [GROUPS]、LID、RDII、控制规则、2D 设置）。保存后用 EPA SWMM 5.2 再打开并运行，结果应一致。
2. **运行**：样例、大模型、多方案并行、取消运行；检查连续性误差和与 Avaris DS 结果的一致性。
3. **GIS**：底图、各坐标系、shp/GeoJSON/KML/GDB/GeoTIFF 导入、属性表、导出。
4. **编辑**：增删改、拆分合并、Assign Outlet、批量编辑、撤销重做、修改记录。
5. **结果**：播放、Theme、Flag（12 条内置规则加自定义）、报告各页、剖面、曲线、方案对比。
6. **2D**：建网格、1D-2D 运行、结果显示。
7. **安装**：全新安装、覆盖安装、从旧 Avaris2 升级（设置保留）、卸载。
8. **性能**：100 万节点模型的打开、缩放、平移、播放（Help ▸ Diagnostics 记录耗时）。

---

## 8. 版本与仓库

- **Git 分支**：`main` 为当前开发线，`v1` 为 OsemCM V1.0；每个版本都打了标签（`v2.0.x`、`v2.1.0`）。
- **远程仓库**：`https://github.com/jdaiosemtec/Avaris2-CS.git`
  ```
  git remote add origin https://github.com/jdaiosemtec/Avaris2-CS.git
  git push -u origin main --tags
  ```
- **不在 git 里的大文件**：`app/gdal/`（约 76 MB）、`dist/`、私钥。源码包会单独附带 GDAL。

---

## 9. 许可证（第一阶段：邮件申请、人工签发）

**流程**
1. 用户在 Help ▸ Register 里只填 osemtec.com 账号和邮箱（机器码自动生成），选择发送方式后点 *Send by E-mail*：
   - Gmail / Outlook.com / Microsoft 365：浏览器打开用户的网页邮箱，收件人、标题、正文都已填好，用户点"发送"即可（需要浏览器里已登录该邮箱）；
   - E-mail program：打开本机默认邮件程序（mailto）；
   - 也可以 *Copy Request* 或 *Save Request File*（.avreq）。
   - 真正的"一键直发"：在 web3forms.com 用 info@osemtec.com 注册，拿到 access key，填进 `main.js` 的 `LIC_FORM_KEY`，Register 里就会多一个 *Send Request to OSEMTEC* 按钮，由主进程直接 POST，不经过用户的邮箱。
2. OSEMTEC 在网站后台核对账号和付款（版本、期限由 OSEMTEC 决定），然后在 **Licence Manager** 里签发并发给客户。
3. 用户把收到的许可证粘贴到 Register 里，点 Activate。之后全程离线验证。

**Licence Manager（`tools/licence-manager/`）**
- `Avaris2CS_Licence_Manager.html` 是一个独立的网页文件（用 Edge 或 Chrome 打开），由 `make.py` 把 `manager.src.html` 和 TweetNaCl.js（公有领域）合成。改了源文件后运行 `python3 make.py`。
- 第一次使用：选择一个放有 `private_key.pem` 的文件夹。所有许可证记录在该文件夹的 `licences.json`；每天的副本在 `backups/`，每个发出的 key 在 `keys/`。私钥只在本机浏览器里使用，不会上传。
- 功能：列出所有许可证（状态：有效 / 30 天内到期 / 已过期 / 作废 / 已释放，可搜索、排序、按状态筛选）；粘贴申请邮件签发新许可证（选版本、期限 30 天 / 1 年 / N 年 / 指定日期、序列号 A2-年份-编号、备注）；打开任一许可证可修改到期日（+30 天 / +1 年 / +2 年 / +3 年或任意日期）、版本、姓名公司邮箱，保存后自动重新签发（rev. 1、2…，历史全部保留），再一键邮件发给客户；核对释放码并标记"已释放"；标记作废；导出 CSV；导入旧的 `licence_ledger.csv`（2.2.0 软件内签发的记录）。
- 同一台机器已有有效许可证、或同一账号已在别的机器上有许可证时，签发前会提示。
- **限制**：许可证离线验证，已经发出的 key 无法远程收回。延长有效期没问题（客户激活新 key）；缩短或作废只记录在台账里，客户手里的旧 key 仍可用到原到期日。要做到远程收回需要第二阶段的在线校验。

**许可证格式**
- 格式为 `AV2L-<base64url JSON>.<base64url Ed25519 签名>`。
- JSON 字段：`{v:2, ed, term, user, name, company, email, iss, exp, ser, mc, hw:{g, v, m[]}}`。

**机器码**
- 由 Windows MachineGuid（g）、系统盘卷序列号（v）、物理网卡 MAC（m）三部分分别哈希组成。
- 三部分中至少两项一致才算同一台机器。所以换扩展坞、VPN、Wi‑Fi 不会让许可证失效。

**只读模式**
- 触发条件：没有许可证、许可证过期、换了电脑、系统时间被往回调（`<userData>/licstate.json` 记录最后使用日期）。
- 只读时可以打开和查看模型与结果，不能编辑、保存或运行。

**换电脑**
用户点 *Release this Computer*，得到释放码，发给 OSEMTEC。在 Licence Manager 里打开该许可证 ▸ Release，输入释放码核对后标记为已释放，再为新电脑签发。

**私钥**
- `license-tools/private_key.pem` 绝不能随软件发布，也不能进 git。Licence Manager 文件夹里的私钥同样要妥善保管，并另存一份备份。
- 公钥写在 `main.js` 的 `LIC_PUB` 里。如果更换密钥对，已发出的许可证会全部失效。

**第二阶段**
服务器用同一私钥、同一格式自动签发，替代"邮件 + 人工"这一步。已发出的许可证继续有效。
