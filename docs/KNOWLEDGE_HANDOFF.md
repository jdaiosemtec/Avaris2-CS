# Avaris2 CS → 供水管网模型：经验与知识交接

给接手新项目（供水管网模型，对标 InfoWater Pro）的 Claude 会话和开发人员。
先读本文件，再读 `CLAUDE.md` 和 `DEVELOPER_GUIDE.md`（文件逐个说明）。Avaris2 CS 截至 v2.2.3。

---

## 1. 和用户合作的方式（最重要）

- **用中文回复**。界面、用户手册、代码注释用英文。
- **诚实说明验证范围**：开发环境是 Linux + Electron + Playwright，看不到 Windows 上的真实界面。每次都要说清楚哪些测过、怎么测的、哪些需要用户在 Windows 上确认。
- **大的界面改动先做 HTML 原型**给用户确认，再写进软件。
- 界面风格：**ArcGIS Pro 式 Ribbon**（Project / Operation / Tools / Simulation / Help），功能参考 InfoWorks ICM（主题、曲线图、剖面、编辑、显示）。对话框要简洁，不要堆砌选项。
- 工具（曲线图、剖面等）要能**在地图上点选对象**，工具窗口跟随选择同步。
- 每一轮的固定流程：实现 → Playwright 测试 → 版本号 +1 → 在 `VERSIONS.md` 加一行 → `./build.sh` 出安装包 → 发安装包 → `git commit` + `git tag` → 中文回复。
- **用户手册（HTML）只有用户要求时才更新**。手册里不提计算引擎的来源（只说兼容 .inp）。
- **源代码只在用户要求时才发**。私钥 `license-tools/private_key.pem` 绝不能进安装包、git 或任何发出去的源码包。
- 用户不熟悉引擎（C 语言）修改；引擎改动通常交给一位水力工程同事（他用自己的 Claude），回来后再集成。
- 讨论型的问题（例如报警规则怎么定义合理）先讨论、给出对比和建议，用户确认后再改。

## 2. 可以直接复用的架构

Electron 33 桌面程序，主进程 `app/main.js`，渲染进程是不打包的纯 JS（全局对象 `window.AV`，`index.html` 按依赖顺序引入），没有构建步骤。

| 模块 | 文件 | 供水项目里怎么用 |
|---|---|---|
| 程序外壳、Ribbon、面板布局、撤销/审计历史 | `app.js`、`ribbon.js`、`panels.js`、`history.js` | 原样复用；所有模型修改都走 `app.exec({label, do, undo, changes})` |
| 地图（自绘 Canvas）、底图瓦片缓存、坐标系 | `map.js`、`basemap.js`、`proj.js`、`locator.js` | 原样复用；`avtile://` 协议 + `<userData>/tiles` 离线缓存 |
| GIS：Shapefile/GeoPackage/KMZ 导入导出、属性表 | `shp.js`、`gdb.js`、`formats.js`、`table.js`、`export.js` | 原样复用 |
| 符号化、主题、表达式语言、时间函数 | `sym.js`、`theme.js`、`expr.js`、`temporal.js` | 原样复用；字段名换成供水结果（压力、水头、流速、水龄…） |
| Insight Flags（报警规则，可在软件里编辑） | `flags.js` | 复用框架，换一套供水规则（见第 4 节） |
| 方案、对比、报告查看器、曲线图、剖面 | `features.js`、`compare.js`、`report.js`、`chart.js`、`profile.js` | 复用框架，报告解析要按新引擎重写 |
| 用户登录、许可证（机器绑定、只读模式、申请/激活） | `main.js` 许可证段、`licence.js`、`tools/licence-manager/` | 整套复用。**新产品要换一对新密钥**，key 前缀改成别的（如 `AVWL-`），以免两个产品的许可证互通 |
| 安装包、图标、第三方声明 | `build.sh`、`installer/avaris.nsi`、`tools/peicon.py` | 复用，改产品名和 GUID |
| 测试 | `tests/launch_dev.sh`、`tests/e2e_smoke.py` | 复用：Playwright 通过 CDP 9333 端口连 Electron |
| 用户手册生成器 | `docs/user-guide/`（`build.py`） | 复用：单页 HTML，有目录、搜索、视频，可直接放到 osemtec.com |

需要重写的部分：模型对象和 .inp 读写（`model.js`）、属性编辑器（`props.js`、`editors.js`、`params.js`）、结果文件读取（`app/outreader.js`）、模拟调用（`sim.js`）、单位（`units.js`）。

## 3. 供水模型和排水模型的差别

- **引擎**：用 EPANET 2.2（OWA-EPANET，MIT 许可证，可商用，需在第三方声明里列出）。它有工具包 API（DLL），也可以用命令行 `runepanet`。并行计算需要我们自己改（和 Avaris 引擎一样）。
- **.inp 格式**：节有 `[JUNCTIONS]`（含需水量）、`[RESERVOIRS]`、`[TANKS]`、`[PIPES]`、`[PUMPS]`、`[VALVES]`、`[PATTERNS]`、`[CURVES]`、`[CONTROLS]`、`[RULES]`、`[DEMANDS]`、`[EMITTERS]`、`[QUALITY]`、`[SOURCES]`、`[REACTIONS]`、`[ENERGY]`、`[TIMES]`、`[OPTIONS]`、`[COORDINATES]`、`[VERTICES]`。扩展信息仍用 `;;@OSEM …` 注释行或旁路文件，不能写 EPANET 不认识的节。
- **结果文件**：EPANET 的二进制 .out 格式和 SWMM 不同，`outreader.js` 要重写（结构：序言、能耗、动态结果、尾部）。
- **分析类型**：延时模拟（EPS）、压力驱动需水（PDA，EPANET 2.2 支持）、水质（余氯、水龄、溯源）、消防流量、能耗与泵站费用、关键性/停水分析、校核（与监测数据对比）、需水分配。
- **单位**：流量单位决定单位制（GPM/CFS/MGD… 为美制，LPS/LPM/CMH… 为公制），沿用 Avaris2 CS 的规则。

## 4. 供水 Flags 的初步建议（待和用户讨论）

低压（< 最低服务压力）、高压（> 允许最大压力）、负压、管道流速过高或过低、单位水头损失过大、水池/水塔低水位或溢流、水泵频繁启停、阀门状态异常、水龄过长、余氯过低。
做法和 Avaris2 CS 一样：每条规则写成"每级一个条件 + 参数"，用户可在软件里改条件，也可以 Paste Conditions。

## 5. 踩过的坑

- **测试前先杀掉所有旧的 Electron 进程**：`pgrep -x electron | xargs -r kill`。旧实例会继续占着 9333 端口，测到的是旧代码。不要用 `pkill -f`（会把执行命令的 shell 一起杀掉）。
- 自定义协议（如 `avtile://`）要同时加到 CSP 的 `img-src` 和 `connect-src`。
- 时间函数嵌套：`peak(...)` 里用到 `totdur` 等整场函数时，要等内层算完再算外层（`temporal.js` 已处理，多算一遍）。
- 美制/公制：参数要分别给美制和公制默认值，切换流量单位时自动换算。
- 视频要同时生成 mp4 和 webm，**两个都要更新**（浏览器优先放 webm，曾经只更新了 mp4，网页上看到的还是旧视频）。
- 报警规则的分母要想清楚：例如"反向流占比"最后定为"反向流时长 ÷ 有流量时长，并且有流量时长 ≥ N 分钟才评价"。
- 离线许可证无法远程收回，只能延长或重签；要收回需要第二阶段做在线校验。
- 安装包没有代码签名，Windows 会弹 SmartScreen；买代码签名证书后，要**先改图标、再签名**（`DEVELOPER_GUIDE.md` 5.4）。
- 第三方声明：Electron/Chromium、GDAL、PROJ、LLVM OpenMP、底图数据，都要在 `THIRD-PARTY-NOTICES.txt` 和 About 对话框里列出。

## 6. 新项目建议的起步顺序

1. 复制 Avaris2 CS 仓库作为起点（保留外壳、地图、GIS、主题、许可证、安装、测试），改产品名、图标、GUID、许可证密钥。
2. 先做 EPANET .inp 的读写和地图显示，确保能打开并原样保存用户的现有模型。
3. 接入 EPANET 2.2 引擎和 .out 读取，做结果主题、曲线图。
4. 属性编辑器、模式/曲线编辑器、控制规则编辑器。
5. 供水专用功能：需水分配、消防流量、水质、能耗、关键性分析、校核。
6. 每个大的界面先做 HTML 原型给用户确认。
