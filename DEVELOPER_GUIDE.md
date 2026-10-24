# Avaris2 CS 开发指导手册（源码说明）

版本：2.2.3（2026-10-21） · 公司：OSEMTEC

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
| `docs/KNOWLEDGE_HANDOFF.md` | 经验与知识交接：合作方式、可复用模块、踩过的坑，以及给供水管网模型项目的建议。 |
| `docs/user-guide/` | 用户手册源文件（c1–c9.html、图片、视频），`python3 build.py` 生成网页版到 `build/`。 |
| `tests/launch_dev.sh` | 在 Linux 无界面环境下从源码启动程序，并打开 CDP 调试端口 9333。 |
| `tests/e2e_smoke.py` | Playwright 冒烟测试：打开样例模型、属性表、Flag 面板，有 JS 报错即失败。 |
| `tools/peicon.py` | 把 PNG 图标写入 Windows exe 的图标资源（Linux 上没有 rcedit 时使用）。 |
| `tools/iconnorm.py` | Ribbon 图标视觉尺寸统一工具（裁边、按内容面积缩放、居中到画布）。用法：`python3 iconnorm.py 源文件夹 输出文件夹 0.86 96`。 |
| `tools/make_insights.py` | 旧版本用来生成 Insight Flag 主题 json 的脚本，已被 Flag 面板取代，仅作参考。 |
| `license-tools/keygen.js` | 命令行版许可证签发：`node keygen.js --request "<申请邮件全文或 AVREQ-…>" [--edition 1D\|2D\|HPS] [--term 30d\|1y\|3y] [--start YYYY-MM-DD]`。日常签发和管理请用 `tools/licence-manager/Avaris2CS_Licence_Manager.html`（见第 9 节）。 |
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
| `partition.js` | **模型分区（算法与文件）**：`AV.partAnalyse`（基准结果：每根管有流量时长、反向流时长、峰值流量；1D 溢流点或 2D 积水区）、`AV.partGlue`（不能切的管：反向流、泵/孔口/堰/出口、分流井、积水区）、`AV.partCompute`（块→汇水树→自下而上切分→小区合并→搜索目标大小，精确得到指定分区数）、`AV.partRecut`、`AV.partChecks`、`AV.partBuild`（子模型 .inp：切口上游端点在上游分区变成 outfall（TIMESERIES 水位或 FIXED），下游分区的节点加 INFLOWS 入流；控制规则按对象过滤）、`AV.partBoundary`（基准结果的切口流量和水位序列）、`AV.partDefinition`（`<模型>.partition.json`：分配、耦合关系、层级、对象签名、文件哈希）、`AV.partSurface`（DEM：管网烧入 + 优先淹没法（等价于填洼后的 D8），在 2D 边界内，按分区追踪成多边形）、`AV.partWriteSurface`。 |
| `partpanel.js` | 分区面板（Tools ▸ Partition Model / Regenerate）：设置、结果表、手动移动支线、检查、生成；Regenerate 读取 partition.json，按连通关系分配新节点，列出改动并只重写变化的子模型。地图显示通过 `theme.style` 和 `map.drawOverlay` 的钩子（`app.partView`）。 |
| `licence.js` | 230 | **许可证**：<br>• 版本分 1D / 1D-2D / HPS（High Performance Simulation = 1D-2D 全部功能 + 模型分区 + 耦合并行计算；`AV.has2D` 对 2D 和 HPS 都为真，`AV.hasHPS`、`AV.needHPS`），期限 30 天、1 年或 N 年，许可证绑定机器码；<br>• 没有有效许可证时（未激活、过期、换了电脑、系统时间被回调）进入只读模式：`AV.licenceGate`，由 `canModify`、`save`、`sim.run` 和方案批量运行调用；<br>• Help ▸ Register 对话框：生成激活申请（发邮件 / 复制 / 保存 .avreq）、导入许可证（粘贴或 .avlic 文件）、释放本机；<br>• 申请只含 osemtec.com 账号、邮箱和机器码；发送方式：Gmail / Outlook.com / Microsoft 365 网页邮箱（`AV.mailUrl`，浏览器里已登录即可一键发送）、本机邮件程序、复制、保存；如果 `main.js` 里填了 `LIC_FORM_KEY`（Web3Forms），还会出现 *Send Request to OSEMTEC*，直接发到 info@osemtec.com。<br>• 软件里不再有签发功能，签发只在 Licence Manager 里做。 |
| `clip.js` | 95 | 复制粘贴对象（连同它们用到的曲线、时间序列等），可以跨模型、跨窗口。 |

### 2.4 `engine/src/`：计算引擎（C）

这是 EPA SWMM 5.2.4 的完整源码（约 55 个 .c 文件和 22 个 .h 文件，说明见 `Roadmap.txt`），再加上以下 Avaris 修改：

| 位置 | 修改 |
|---|---|
| `avaris_main.c` | 命令行入口：`avaris_engine <inp> <rpt> <out> [-nodetail]`；向 stdout 输出 `PROGRESS n`、`DONE err runoffErr flowErr qualErr seconds`、`ERROR msg`，供界面显示进度。 |
| `couple.c` | **耦合并行引擎**（2.4.0 起）：`avaris_engine -couple <run.cpl>` 是协调进程，为每个子模型启动一个 `avaris_engine -cplworker <run.cpl> <k>` 进程；进程间用共享内存文件 + 屏障（Linux futex，Windows 两个交替的 manual-reset event）同步。详见第 11 节。 |
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


## 10. 模型分区（Tools ▸ Partition Model，2.3.0 起）

用途：把大模型切成若干子模型，供耦合并行引擎计算（阶段 3）。原则来自 OSEMTEC 的分区方法和专利《A coupled parallel simulation technology…》。

- **输入**：分区数；当前加载的结果作为基准（流向、反向流、溢流/2D 积水）。没有结果时按管道定义方向，不检查反向流。
- **不能切**：往复流管（有流量 ≥ N 分钟且反向时间占 W1%–W2%，默认 5%–95%；反向 ≥ 95% 的管是单向倒流，可以切，子模型里把它掉头写出）、泵/孔口/堰/出口、分流井的出流管；可选：同一个积水区内的检查井（2D：深于阈值的相连网格；1D：溢流 ≥ X 分钟且相距 ≤ D 的节点）。往复流管组和积水区只在不超过一个分区大小时保持完整，超出的在往复最少处切开、超大积水区不作约束，检查栏给出警告。
- **切口处理**：管道留在上游分区，下游端点在上游子模型里变成 outfall（有基准结果时用 TIMESERIES 水位，否则 FIXED）；下游子模型里该节点加入流（`CPL_Q_<节点>` 时间序列）。耦合引擎运行时会直接设置这两个值。
- **文件**：`<文件夹>/<模型>_Pnn.inp`（+ .prj）、`<模型>.partition.json`（模型旁边也存一份），可选 `<模型>_Pnn_2d_boundary.shp` 和 `<模型>_partitions.shp`（DEM 分区面）。
- **Regenerate**：老节点保持原分区，新节点沿下游（否则上游、否则最近）归入分区；列出变化的对象和要重写的文件；检测子模型是否被直接改过（文件哈希）。分区面不重新计算（重新分区时才算）。
- **验证（Riverside 示例，12 区）**：子模型单独运行（带基准边界）时，排口峰值流量和总水量与大模型相差 < 1%；节点最高水位中位数差 0，95% 分位 0.10 m。切口上游的 outfall 在退水段可能偏高（SWMM 的 outfall 水深取设定水位和临界/正常水深中的较大值），耦合引擎直接设置节点水头即可消除。
- **性能**：8.9 万节点的模型分 40 区约 1.7 s，写出子模型约 1.3 s。

## 11. 耦合并行计算（Run ▸ Coupled parallel，2.4.0 起）

目标：和不分区的整体模型结果尽可能一致，同时多核并行。

**算法（dynwave）**
- 每个子模型一个进程。每个演算步开始时各子模型提出自己的变步长，**所有子模型取最小值**，所以步长序列和整体模型一样。
- 交换发生在**每一次 Picard 迭代**里，位置和整体模型完全对应：
  - 链路流量算完后（`findLinkFlows` 之后，钩子 `CplAfterLinks`）：上游子模型把切口管的流量、对下游节点的水面面积贡献（`surfArea2 × barrels`）、`dqdh` 发给下游子模型；下游节点把它们当作一根真实管道加入节点的 inflow/outflow、水面面积和 `sumdqdh`（`dynwave.c` 的 `addCoupledLinks`）。
  - 节点水深算完后（`findNodeDepths` 之后，钩子 `CplAfterNodes`）：下游子模型把切口节点水头发回；上游的边界 outfall（`Node.cplBnd`）直接取这个水头（`outfall_setOutletDepth` 不再套用临界/正常水深规则；`dwflow.c` 里把它当普通节点，不做 outfall 的偏移和 Froude 处理）。
  - 收敛判断是**全局的**：所有子模型的节点都收敛才结束这一步，所以各子模型迭代次数一致。
- 因此耦合计算解的是和整体模型相同的方程组。剩下的差别只来自：浮点求和顺序；切口管在整体模型里两端都收敛时可以跳过计算（bypass），子模型里不跳过。
- 其他演算方法（KW/稳态）：每步交换一次，下游接收的水量和上游送出的水量做体积校正（不丢水、不造水）。
- 水量平衡：下游收到的切口水量记作外部入流，上游 outfall 记作外部出流；合并报告时按引擎输出的 `CPLVOL` 扣除。

**文件和流程**
- 界面：Run 对话框里有 *Coupled parallel* 选项（模型旁有 `<模型>.partition.json` 时才出现）。主模型在分区后改过（对象签名不同）时不能选，提示先 Regenerate。对话框按核数和模型规模给出速度提示。
- `main.js` 的 `engine:runCoupled`：在 `<结果文件夹>/<运行名>_parts/` 写 `run.cpl`（制表符分隔：SHM、MODE、THREADS、PART k level inp rpt out、CPL up outfall link down node），启动协调进程，读 `PROGRESS / PART / CPLVOL / DONE`。
- `app/cplmerge.js`：把各子模型的 .out 合并成一个**主模型 ID** 的 .out（节点取所属分区，边界 outfall 不要；切口管取上游子模型，掉头写出的管道把流量和流速取反、偏移量对调；系统变量：流量类求和、降雨/入渗按汇水面积加权、温度/蒸发取第一个子模型，系统出流扣掉切口流量），并合并 .rpt（连续性表求和后重算误差，对象表按主模型顺序合并，去掉边界 outfall 和 System 行）。前端和网页数字孪生只读这一个 .out/.rpt。
- 运行记录（`<运行名>.json`）里 `type: "1D coupled"`、`seconds`、`coupled.subModels`。Scenario Comparison 的 KPI 卡片里有 *Run time*，可直接比较整体模型和耦合计算的结果和耗时。
- 取消：协调进程被结束时，Windows 的 job object / Linux 的 `PR_SET_PDEATHSIG` 会一起结束所有子模型进程。

**验证（Riverside，12 个子模型，8 个切口，1 分钟报告步长）**
- 节点最高水深与整体模型之差：90% 分位 0.009 m、95% 分位 0.14 m、最大 5.3 m；管道峰值流量相对差 90% 分位 0.1%；排口总水量差 0.01%；耦合计算的连续性误差 -0.005%（整体模型 -0.005%）。
- 对照：这个模型对数值扰动很敏感，只把整体模型的 ROUTING_STEP 从 5 s 改成 4.9 s 或 4.95 s，节点最高水深之差就有 90% 分位 0.009–0.020 m、95% 分位 0.17–0.35 m、最大 4.6–6.8 m。所以耦合结果和整体模型的差别不大于模型本身的数值敏感度。
- 普通（整体）运行：引擎改动后 Riverside 的 .out 与旧引擎逐字节相同。

**1D-2D 耦合（2.6.2 起）**
- 模型启用 2D 且已建网格时，耦合运行自动做 1D-2D：`partition.js` 的 `AV.partition2DJob` 在运行时把网格分给各子模型（网格改了不用重新生成子模型）：单元中心落在某分区 D8 面积内 → 该分区；含耦合检查井的单元 → 这些检查井（多数）所在分区；其余单元沿 2D 链接广度优先取最近已分配单元的分区；仍未分配的取最近检查井的分区。
- 两端在不同子模型的 2D 链接和耦合孔口按切口管处理：留在起点所在子模型，终点换成边界 outfall `CB_<链接ID>`（outfall 只能接一根链接，所以每根切口链接一个），另一侧的单元接收流量并把水位传回，每次迭代交换（`couple.c` 不需要改动）。
- 子模型写成 `<运行名>_parts/Pnn.finp`（`AV.mesh2DToINP` 加了第 4 个参数：整个网格用于查单元高程/糙率，边界 outfall 列表）；合并结果为 `<运行名>.fout / .frpt`，`job.order` 加入单元、2D 链接、孔口、水岸 outfall，`nodeOwner` 加入单元归属。运行记录 `type: "1D-2D coupled"`。
- 验证（Riverside 1D-2D，1578 个单元，开发机 2 核）：整体 133 s；12 个子模型 108 s（413 根切口 2D 链接），节点最高水深最大差 0.010 m、单元最大差 0.003 m；2 个子模型 95 s（96 根切口），节点最大差 0.001 m、单元 0.002 m；水深 > 0.05 m 的单元两者都是 791 个。

**速度**
- 每次 Picard 迭代有两次进程同步。2.6.2 起同步方式按核数选择（`couple.c` `barrier`）：子模型数 ≤ 逻辑处理器数时等待方自旋约 1–2 ms（`pause` 指令）再睡眠；子模型多于处理器时立即让出处理器（`sched_yield` / `SwitchToThread`），再睡眠。
- 实测（Riverside 1D，593 个节点，2 核）：整体 12.9 s；2 个子模型 旧 13.5 s → 新 8.6 s；12 个子模型 旧 33.3 s → 新 14.1 s。
- 加速需要子模型数 ≤ 核数、每个子模型有足够的计算量。Run 对话框和分区检查会提示：子模型多于物理核数、每个子模型对象太少（< 约 200 个对象 / 100 个节点）。分区工具的建议上限从 1.5 × 核数改为核数。

## 12. 出图排版、旱流污水、数据推断与清理、CSO 统计（2.5.0 起）

| 功能 | 入口 | 文件 | 要点 |
|---|---|---|---|
| 出图打印排版 | Project ▸ Print ▸ Print Layout | `layout.js`；`main.js` 的 `layout:output`、`fs:readDataURL` | 视图标签页：左侧设置，右侧页面预览。纸张 A4–A0 / Letter / Tabloid / ANSI，横竖向，两个模板（底部图签 / 右侧面板），地图范围 = 当前视图或固定比例 1:N（地图单位为英尺或米时）。`AV.renderMapCanvas` 临时改变地图的大小、比例和 dpr，把底图 + 管网 + 主题画进离屏画布（底图瓦片会等加载完再画一次）。页面是 mm 单位的 HTML（图例 = 图层符号 + 当前主题图例，比例尺 / 指北针为 SVG）；主进程在隐藏窗口里加载后 `printToPDF`（PDF）、离屏 `capturePage`（PNG，最大 8000 像素）或 `print`（打印对话框）。 |
| 旱流污水生成 | Tools ▸ Model Data ▸ Dry Weather Flow | `dwf.js` | 负荷来源：汇水区（面积 × 单位流量，或人口密度 × 人均排放），或 GIS 点 / 面图层（人口、户数或流量字段）。负荷进入汇水区出口节点（沿汇水区出口链追到节点）；图层要素先找包含它的汇水区，否则最近的检查井。可加入渗入量（%）。日变化模式：住宅 / 商业 / 工业 / 平稳模板，可编辑，可加周末模式，写出时归一化到平均 1。写 `[DWF] FLOW` 和 `[PATTERNS]`（`<名称>_HR` HOURLY、`<名称>_WE` WEEKEND），一步可撤销。验证：Riverside 预览 9421 m³/d，引擎报告 Dry Weather Inflow 9.420 ×10⁶ L/d。 |
| 数据推断与清理 | Tools ▸ Model Data ▸ Infer & Clean | `infer.js` | 视图标签页。缺失值：0（可选）或 ≤ 给定值。推断：管长（按绘制长度）、管径（上游最大，否则下游最小，沿链重复）、糙率（相邻管最常见值，否则默认值）、井底标高（有 DEM：地面 − 记录井深，或地面 − 上下游井深插值；没有 DEM：沿管道按长度在上下游已知井底之间插值，单侧按最小坡度外推；用多源 Dijkstra 找最近的已知点）、井深（DEM 地面 − 井底，仅缺失时）。检查（只列出）：逆坡、重复管、孤立节点、管顶高于井口、不连到排口/调蓄池的管网、汇水区出口无效、无法推断的缺失值。勾选后一次写入（`tools.bulk`，可撤销），可给改过的对象加 Tag；CSV 导出。验证（Riverside，40 个井底置 0）：有 DEM 时误差中位数 0.004 m、90% 分位 0.16 m；没有 DEM 时中位数约 1 m（地形起伏大）。30 根管径置 0，24 根推断值与原值相同。 |
| CSO 统计 | Simulation ▸ Results ▸ CSO Statistics | `cso.js`；`map.js` 通用叠加层 `AV.mapOverlays` | 溢流点：排口（总入流）和 / 或堰、孔口、出流口（管流），可只算选中对象或名称 / Tag 包含某文字的对象。阈值以上为溢流；间隔小于分隔时间（默认 12 h）的溢流属于同一事件；另给出 12/24 h 计数（英国环境署方法）。每个溢流点：事件数、溢流量（m³ 或百万加仑）、溢流小时、最长事件、峰值、首次溢流；事件表；CSV 导出（汇总 / 事件）；地图圆圈（大小 = 溢流量，数字 = 事件数）。精度为报告步长。 |

## 13. 2D 结果深化（2.6.0 起，属于 1D-2D 许可；HPS 也包含）

| 内容 | 入口 | 文件 | 要点 |
|---|---|---|---|
| 一次扫描的 2D 统计 | 载入 1D-2D 结果时自动计算 | `outreader.js` `mesh2d()` / `cellSeries()`（IPC `out:mesh2d`、`out:cellSeries`），`mesh2d.js` `AV.computeMeshResults` | 对每个网格单元一次读完全部时间步：最大水深、最大流速及其 x/y 分量、最大危险度、最大 水深×流速、淹没到达时间（水深首次超过 Options → 2D Flood 的 Flood Depth 阈值）、最大水深出现时间、积水时间、退水时间。单元流速 = 其 x 向、y 向各面（2D 链接 `2DL_*`）的流速 Q/(w·y) 分别平均后合成，w 为链接宽度（与引擎写出的链接流速一致，已逐值核对）。`MR.faces` 保存 [链接号, 单元 a, 单元 b, 轴, 符号] 与宽度。 |
| 危险度 | — | `mesh2d.js` `AV.HAZARD_DF`、`AV.hazardClass` | Defra/EA FD2320：HR = d·(v+0.5)+DF，d 用 m、v 用 m/s（美制单位先换算）。DF 三种：保守（≤0.25 m 取 0.5，以上 1.0，默认）、草地/耕地（>0.25 m 取 0.5）、不计。只对超过 Flood Depth 阈值的单元评级。分级 <0.75 低、0.75–1.25 对部分人危险、1.25–2.0 对多数人危险、>2.0 对所有人危险。DF 设置存在 `prefs.mesh2d.df`，改后重新计算。 |
| 新的网格变量 | Symbology ▸ 2D Meshes、属性表、单元属性 | `mesh2d.js` `FIELDS`、`AV.MESH_GROUPS`、`AV.meshUnit`；`sym.js`；`table.js` | 当前时刻（播放模式）：水深、水面、流速、危险度（`AV.meshDynamic` 由当前时刻的链接快照算出，按快照缓存）。统计：最大水深、最大水面、最大流速、最大危险度、最大 水深×流速、到达时间、最大水深时间、积水时间、退水时间、与对比方案的最大水深差。默认分级与色带：危险度 4 级固定色、流速 m/s 或 ft/s、时间按模拟时长 6 等分、水深差为发散色带（低于第一级取第一级颜色）。流向箭头 `prefs.mesh2d.arrows`（单元 ≥ 12 像素时画）。网格 Shapefile 导出含全部统计字段和危险等级。 |
| 单元时程图 | 单元属性 ▸ 2D Cell Graph | `mesh2d.js` `AV.cellGraph` | 浮动面板三张联动图：水深（含阈值线）、流速、危险度（含 0.75/1.25/2.0 参考线）。 |
| 2D Flood Analysis | Simulation ▸ Results ▸ 2D Flood Analysis（`lic: '2D'`） | `flood.js` | 视图标签页。顶部：淹没判定水深（默认 = Flood Depth 阈值，0 时取第一级水深）、DF、Cross Section、Compare、Export。指标卡：淹没面积（ha / ac）与比例、淹没单元数、最大水深、最大流速、最大危险度、HR≥0.75 面积、最早到达。按最大水深分级面积（用 Symbology 的水深分级）与按危险度分级面积。按区域 / 点统计：任选面图层（单元中心在面内）或点图层（点所在单元），名称字段可选，CSV 导出，双击缩放。对比：选同一网格的另一个 1D-2D 方案（`AV.listRuns` 或任意 .fout），按单元 ID 匹配，给出新增淹没、不再淹没、两者都淹没、加深 / 变浅超过阈值的面积、最大增减，并可在地图上显示水深差。 |
| 导出 | 2D Flood Analysis ▸ Export | `flood.js` `AV.cellsToRings`、`AV.meshGrid` | 淹没范围 / 水深分级 / 危险分级面 Shapefile：单元四条边逆时针，共享边相互抵消，剩余边连成环再反向（外环顺时针、内环逆时针），面积与单元面积之和一致；ESRI ASCII 栅格（.asc + .prj），像元 = 最小单元尺寸，干单元 -9999；单元结果 CSV。 |
| 2D 横断面 | 2D Flood Analysis ▸ Cross Section | `flood.js` `AV.crossSection2D`；`features.js` `onDrawHook` | 在地图上画折线（双击或 Enter 结束），按最小单元尺寸的 1/4 采样：地面、最大水面、当前时刻水面（播放模式，随时间步更新，`app.emit('period')`）、对比方案最大水面。线保留在地图上直到关闭面板。 |

验证（Riverside Demo，Design 10yr，1578 个单元、3036 个 2D 链接）：单元流速与引擎链接流速逐值一致（-0.28349 vs -0.28346 m/s）；淹没范围面积 = 1179 个湿单元面积之和；按区域统计两个半区的淹没面积之和等于全区。

## 14. 文件夹选择（2.6.2 起）
- `folderdlg.js` `AV.folderDialog({ title, defaultPath, modelFolder })`：程序内的文件夹选择框（Windows 系统对话框不能加按钮）。左侧位置（模型文件夹、桌面、文档、下载、主目录、盘符，`main.js` IPC `fs:places`），右侧子文件夹（单击选中、双击进入），路径栏可输入，↑ 上一级；底部左侧 **New Folder**（在列表里直接输入名称，Enter 创建），右侧 Cancel / Select Folder。用于分区子模型文件夹。
- 子模型文件夹按模型记住（`prefs.partition.folderBy[模型路径]`），不再把上一个模型的文件夹带到另一个模型。

## 15. 2.6.3 的界面调整
- 2D 对比 → Scenario Comparison：2D Flood Analysis 的 Compare… 选好另一个 1D-2D 方案后，把它作为方案载入（`sim.loadScenario`），直接打开 Scenario Comparison（`AV.openCompare2D`：基准 = 选的方案，对比 = 当前结果，对象 = 2D Cells）。`compare.js` 新增对象类型 `cell`（最大水深、最大流速、最大危险度、最大 水深×流速、到达时间、积水时间，数据来自 `AV.meshStatsFor`，按方案缓存在 `res._m2d`），顶部蓝框突出 2D 关键指标（淹没面积、淹没单元、最大水深、最大流速、HR ≥ 0.75 / ≥ 2 面积、最早到达）；Difference on Map 对 2D 单元把差值写进 `meshResults.cmp.diff` 并让 2D Meshes 显示 `ddepth`（图例写明变量和方案）。
- 分区统计：图层变化时（`refreshLayers` 发出 `layers` 事件）视图自动刷新；面板内 Add Layer…；没有图层时显示用途和步骤；有结果时显示区域数、淹没数、HR ≥ 0.75 / ≥ 2 的数量。
- CSO 统计：两张表上下排列（全宽），水量取整加千分位。旱流对话框：Pattern name 下写明会写出什么、在哪里看到、重名会替换。Help 页签 Quick Start / Shortcuts / Diagnostics 换成与其他按钮同风格的图标（`quickstart.png`、`shortcuts.png`、`diagnostics.png`）。

## 16. 2.6.4
- 往复流判定统一（2.6.7 起分区有自己的参数 revRel / revMin / revPct / revMax，只是算法与 Flag `rev` 相同）：`partAnalyse` 的 `totdur(|Q| > max(eps, r% × rptMaxFlow))`、`totdur(Q < −阈值)` 与 Flag 条件（Σ 取全程）一致。验证：Riverside（r 5%、n 30 min、w 5%、h 95%）Flag 报警（不含 High）94 根 = 分区往复流 94 根，逐根相同。
- 载入结果后不进入播放模式（`loadResults` 只建播放条）；点 Play 进入；没有结果时点 Play 先载入最近结果再进入播放。
- 分区叠加层（不切的管道虚线、积水区圆圈）跟随图层可见性（`AV.symOf(app, type).visible`）。
- 2.6.5：分区状态下地图左上角眼睛按钮（T 键）隐藏 / 显示分区标记（切口 ⊗、不切管道虚线、积水区蓝圈，`partOverlay` 检查 `app.themeHidden`），分区配色不变。
- 2.6.6：分区标记（⊗ 切口、紫色虚线不切管道、蓝色虚线圈积水区）不再跟随图层开关，只由眼睛按钮统一隐藏 / 显示；`AV.partLegend` 图例（地图右下角 `#legend`，分区面板打开 / 关闭和眼睛切换时 `theme.updateLegend()` 更新）。

## 17. 2.6.7
- Scenario Comparison（`compare.js`）：`listRuns()` 列出模型 Database 里的全部运行（加上已载入但不在结果文件夹的结果），标明 1D / 1D-2D；Compare 只列与 Base 同类的运行（`fixPair`）；选中时才载入（`loadPair` → `sim.loadScenario`）。选中的一对写入 `app.sim.pick`，比较窗口打开时 `sim.sources()` 只返回这一对，图表窗口（Graph 的 Scenarios 勾选）随之更新；关闭比较窗口后恢复。整个视图可滚动，下方表格 + 散点图区域高度 max(560 px, 视窗 − 330 px)。
- Licence Manager：许可证对话框左下角 Delete…，可删这一条或该账户全部许可证（`S.ledger.deleted` 留简要记录，当天备份在 backups/）。许可证离线验证：已激活的 key 在那台电脑上仍可用到到期或用户 Release。

## 18. 2.7.0：Simulation Options ▸ Files 与 Auto Calibration（HPS）

- `sim.js`：`AV.filesTab(app)` 生成 Files 页（列表 + / − / Clear All，File Type / Usage / File Path）；`AV.parseFilesSection`、`AV.filesLine`；OK 时 `filesUI.apply()` 以一个撤销步骤写 `m.raw.FILES`，注释行保留。
- `app/obsread.js`（主进程，IPC `obs:read` / `obs:table` / `obs:findFiles`）：流式读取任意大小的 CSV/TXT/DAT，以及 .xlsx（自带解压 + XML 解析）。自动识别：分隔符、表头/单位行、日期列（ISO、dd/MM 与 MM/dd 按哪个字段变化更频繁判断、Excel 日期、AM/PM、SWMM 雨量站格式）、布局（wide / single / long / gage）、监测点 ID（已知 ID 优先，其次表头、文件名、文件开头说明行）、变量（Flow/Depth/Velocity/Rainfall）与单位。时间统一用 SWMM 日期数（1899-12-30 起的天数）。可以直接用 node 测试，不需要 Electron。
- `renderer/js/calib.js`：`AV.Calib`，`AV.openCalibration(app)`（无 HPS 时 `AV.needHPS`）。项目文件 `<model>_Calibration/<name>.avcal`（JSON：mapping、files、monitors、events、cleaning）+ `<name>.avobs`（二进制：'AVOBS1' + JSON 头 + 每条序列 Float64 时间 / Float32 值）。原始数据不改；清洗结果是一层（idx + 新值，Accept/Reject），`series(key)` 按已接受的结果生成清洗后数据（模型单位）。
- 第 3–5 步（参数、准则与运行、结果）在 2.7.x 继续；按 v3.1 原型做，不删原型里的功能。
- 测试数据：Riverside 改成 2025-05-01–07-01、5 分钟雨量后运行，用结果加噪声、比例、尖峰、缺测、平线生成的测流文件（见会话 scratchpad/survey）。

## 19. 2.8.0：Auto Calibration 第 3–5 步（calib2.js）

- `calib2.js` 给 `AV.Calib.prototype` 加方法：`renderParams` / `renderCriteria` / `renderResults`，参数表 `AV.CALIB_PARAMS`（get / put，factor 或 set），标准 `AV.CALIB_STD`。
- 一次事件运行：`eventInp(ev, x)` 临时修改模型（参数组的值、[OPTIONS] 日期 = 雨前 12 h 到雨后 12 h、THREADS 1、[REPORT] 只报监测对象、映射的雨量站改为观测雨量 CAL_<gage> 时间序列、去掉 USE/SAVE HOTSTART），`m.toINP()` 后在 finally 里全部恢复；`runEvent` 在 `<model>_Calibration/runs` 运行、读出监测序列后删除（`fs:rmRun` 允许 `_Calibration/runs`）。
- `pool(n)` 控制并行引擎进程数；`evaluate(xs, events)` 每个候选跑全部事件并 `scoreRuns` 评分（每项检查 1 = 在容差内，到 2 倍容差线性降到 0；监测点权重；"满足标准" = 2/3 事件全部检查通过）。
- 搜索：`nsga2`（分数↑、改变量↓）、`sceua`、`dds`；`finalOptions` 从前沿选 A/B/C 并在全部事件（含验证）上重跑，序列存 `<name>.avres`。
- 应用：`app.exec({ asUser: { user: 'System', role: 'system' }, ... })`，`history.js` 的 `record` 支持 `cmd.asUser`。

## 20. 2.9.0：非结构网格（三角形）与建筑物类型

- **入口**：Create Meshes 先弹出二选一（Square grid / Unstructured mesh），选择存在 `;;@OSEM2D MESH_TYPE`（SQUARE / UNSTRUCTURED），Options → 2D Flood 里也能改；静默重建（打开模型时）按这个值。新键：`MESH_ZONES`（多边形，属性 `size`）、`BREAK_LINES`（线，可选 `size`）、`EXCL_TYPE` / `EXCL_HEIGHT` / `EXCL_POROSITY`（排除多边形没有 `type` / `height` / `porosity` 属性时的默认值）。
- **生成器** `renderer/js/umesh.js` `AV.buildUMesh(opt)`（纯函数，无 DOM）：
  1. 尺寸场：背景网格（分辨率 hmin/2，最多 400 万格）。"Cell size" s 指面积与 s×s 方格相同的等边三角形，边长 h = 1.52 s；网格区多边形直接设定 h（大的先，小的后覆盖，可加密也可放粗）；带 size 的断线和建筑轮廓只会加密（建筑轮廓 h ≤ 周长/4，至少 1/4 本地尺寸，保证角点）；两遍倒角扫描限制增长率 0.35。
  2. 布点：所有约束线（边界、VOID 建筑、cut-off、其他建筑、网格区边线、断线、水岸线）保留拐点（转角 > 25°）和开放线端点，拐点之间按本地 h 等分，0.3 h 内的点合并；然后从每个边界多边形内部一个种子点按六边形格子生长（每点 6 个候选，距离 h，离已有点 < 0.72 h 的不要），均匀区得到等边三角形。
  3. Delaunator（ISC，`js/lib/delaunator.min.js`）三角化；缺失的约束边在中点加点重来（最多 8 轮，conforming Delaunay）；自由点 Laplacian 平滑 3 次后再三角化。
  4. 质心在边界外或 VOID 建筑内的三角形删除；面积 < 0.2 × 目标面积或最小角 < 12° 的三角形并入最长自由边的邻居单元（邻居多边形插入第三个顶点，最多 6 边）。
- **单元和连接**（引擎不改，仍是"检查井 + 宽明渠"）：T_a = (单元 a 质心, 边端点 1, 端点 2) 三角形面积；每个单元按 f_a = A_a / Σ(有连接的 T_a) 放大（边界边、cut-off 边没有连接），连接平面面积 = T_a f_a + T_b f_b，宽 w = (T_a + T_b) / L（L = 两质心距离，质心连线垂直于边时 = 半个边长，与方格 w = s/2 一致），长 = 平面面积 / w（下限 0.25 L）。方格时这正好是 Avaris DS 的 len = s/2 (4/deg_a + 4/deg_b)。cut-off：约束边或质心连线与 cut-off 线相交的不连。
- **建筑物类型**（两种网格都支持）：VOID 不建单元；RAISED 单元地面 + height；POROUS 面积 × porosity、相关连接宽度 × porosity（方格只乘宽度）。单元字段 `bt`（1 raised / 2 porous）、`por`。
- **mesh2d.json v2**：`type: 'tri'`、`verts`（扁平坐标）、单元 `v`（顶点号，逆时针）、`a`（面积）、`s` = √a。`AV.prepMesh` 给单元加不保存的 `_p`（多边形）和 `_b`（外框）；`AV.cellPoly / cellBox / cellArea / meshCellAt` 统一方格和三角形，绘图、点选、热力图、导出 Shapefile / 栅格、淹没范围多边形、横断面、对比面积、分区积水区都改用这些函数。
- **流速**：面方向 = 质心 a→b 单位向量（方格为 ±x / ±y），单元流速 = 各面法向流速 Q/(w y) 的最小二乘向量（`AV.lsVel`，outreader `mesh2d` / `cellSeries` 新增 dirs 参数）；方格时与原来"x 面平均、y 面平均"完全相同。
- **2D 计算步长**：小单元需要小步长。`AV.meshRecStep` 取 5% 分位连接长度 L，建议步长 ≈ 0.5 L / √(g·1 m)（取整到 0.1…30 s 的档位）；Create Meshes 的结果里显示，当前 2D Routing Step 大于建议值 1.25 倍时询问是否改成建议值。实测：demo3 加网格区（40）和断线（25）后，5 s 步长不收敛（连续性 −916 %），1 s 正常（7.8 %，同模型方格 3.3 %、非结构不加密 8.5 %；这个模型本身有单元水深到 30 ft 上限、大量 Flooding Loss）。
- **验证**（Linux Electron）：平地点源（1 km²，20 m，1 m³/s 1 h）方格 2,500 单元 / 三角 2,460：淹没面积 222,800 / 223,600 m²，连续性 0.295 / 0.300 %，最大水深 0.110 / 0.103 m；斜坡（1600×800 m，坡 0.3 %）：淹没面积 0.640 / 0.592 km²，出流 1.012 / 1.133 ×10³ m³，连续性 1.20 / 0.89 %；加网格区（8 m）、断线（10 m）和三种建筑：5,201 单元，连续性 1.11 %，平均步长 0.63 s。Riverside（RD2 数据）三角网格整体运行 vs 2 个子模型耦合运行：单元最高水深最大差 0.002 ft。所有连接平面面积之和 = 单元面积之和（相对差 < 1e-6）。方格的单元流速与 2.8 算法逐值相同。

## 21. 2.9.1：Auto Calibration 大弹窗

- `calib.js` `open()`：不再用 `app.addView`，而是 `.calback`（z-index 900，低于 `.modal-back` 2000 和 `.fpanel` 1500）里的 `.calwin`（全窗口减 24 px）；`close()` 运行中只隐藏、有改动时问是否保存；`toMap(text, onPick)` 隐藏弹窗并在地图底部显示 `.calmapbar`，`onPick` 订阅 `app.on('selection')`，取第一个选中对象后恢复弹窗。
- `chart.js` 图例按文字宽度从左到右排列，宽度不够换行，底部留白按行数计算。
- `calib2.js` `drawResChart`：Current model 最后画（虚线在上）；方案与当前模型在该监测点的最大差 ≤ 0.5 % 时显示说明。

## 22. 2.9.3

- 不要把大数组展开传参（`Math.min(...a)`、`push(...a)`）：超过约 10 万个元素就会 "Maximum call stack size exceeded"。用 `AV.amin / AV.amax / AV.pushAll`（util.js），主进程 cplmerge.js 有自己的 `pushAll`。
- umesh.js：面积 < 1/4 单元面积的建筑不作为约束，按质心找所在单元，累计遮挡面积，单元 `por` = 1 − 遮挡/面积（下限 0.1，`bt` = 3）；约束边恢复时短于 0.3 h 或中点附近已有点的不再细分。
- gdb.js：GeoJSONSeq 输出固定是 WGS 84 经纬度，`prjWKT` 设为 GEO（2.9.2 误设为图层坐标系，位置错）。`AV.loadDataFile(app, path, { box })` 对 2 万要素以上的 GDB 图层只读框内（Create Meshes 读排除多边形时用 2D 边界框）。

## 23. 2.9.4：外部图层编辑、多个排除图层

- `extedit.js`（`AV.extEdit`）：`app.editLayer` 为正在编辑的外部图层（同时只能一个）；选择存在 `L.sel`（与属性表共用）。map.js 选择工具在编辑图层时先测节点，再测图层要素（`E.hit`：最小的包含多边形，或 6 px 内的线 / 点），空白处拖框 `drag.ext`；Edit Geometry 时 `E.vertexHit` / `moveVertex` / `insertVertex` / `removeVertex`，叠加层画顶点。panels.showProps 无网络选择时调 `E.props`；app.deleteSelection、pickAddType('EXT')、onSelectionChanged、checkSave 有钩子；features.onDraw 对编辑图层走 `E.addFeature`。所有修改 `app.exec` 可撤销；`L.dirty` / `L.geomDirty`。保存：shp 只改属性时只写 .dbf；改了几何按 `L.srcWKT` 反投影写回（`finishVector` 记录 `srcWKT`、`reprojected`）；其他格式另存 shp（地图坐标系 + .prj）。
- 排除图层：`AV.exclusionLayers(m)` = [EXCLUSION/EXCL_* 一行] + `EXCL_MORE`（JSON）。Options 里 `AV.exclTable` 生成表格，返回伪 input（value getter）给对话框读取。Create Meshes 按顺序读取，每层自己的默认类型。
- `BLDG_MESH`（umesh.js `opt.buildings`）：LARGE 面积 < 1 个单元的建筑按遮挡面积处理，轮廓加密下限 h/2；ALL 为原来的做法（下限 h/4）；NONE 全部按遮挡面积。跨多个单元的建筑按 h/4 采样点分摊面积。

## 24. 2.9.8：分区耦合运行的热启动文件

- 热启动文件（SWMM5-HOTSTART4/5）头部存对象数量，记录按输入文件顺序排列；子模型对象不同 → 引擎 ERROR 333。
- `app/hssplit.js`：`engineOrder(text)` 从整体模型文本得到子汇水区 / 节点 / 管段顺序和记录长度（地下水 4、积雪 15、储存节点多 1 个 float、污染物项）；`split(hsBuf, masterTexts, subText)` 按 ID 拷贝记录到子模型顺序，整体模型没有的对象填 0，管段 setting 填 1（0 会让 link_getInflow 返回 0，2D 耦合连接被堵死），OFF 的水泵填 0。v5 文件自带名称。
- `main.js engine:runCoupled` 的 `fixInp`：USE HOTSTART → `<parts>/Pnn.hsf`；SAVE HOTSTART → `<parts>/Pnn_saved.hsf`；相对路径按 子模型文件目录（`job.srcDirs`，1D-2D 时子模型拷贝在别处）→ 整体模型目录 查找；出错时整次运行返回说明。
- `sim.js runCoupled`：模型有 USE HOTSTART 时把整体模型文本（1D，有网格时再加 1D-2D 文本）放进 `job.masterTexts`，按对象数量匹配热启动文件。

## 25. 2.9.9：删除结果

- `main.js fs:rmRun(files, partsDir)`：先关闭 `outFiles` 里指向这些文件的 OutReader（Windows 上打开的文件删不掉，以前错误被忽略），每个文件最多重试 5 次；`partsDir` 必须是 `…_Results/<名>_parts`，递归删除。返回 `{ failed }`。
- `database.js remove`：确认框列出 `_parts` 文件夹；`partsDir(r)` 取 run json 的 `coupled.partsFolder`，没有时用 `<名>_parts`；删除失败的文件弹框列出。

## 26. 2.9.10：子模型拷贝里的相对路径

- `hssplit.js absPaths(lines, baseDir, path)`：把 [RAINGAGES] FILE、[TIMESERIES] FILE、[FILES]、[TEMPERATURE] FILE 的相对路径改成以 baseDir 为基准的绝对路径（带空格的加引号）。
- `main.js fixInp`：子模型文件要拷贝到 `_parts`（修复 / 热启动）或本身就在 `_parts`（1D-2D 的 .finp）时调用，baseDir = `job.srcDirs[k]`（分区文件夹）。
