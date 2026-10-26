# dsh-workspace-running-dot — 修改日志

> 同一项目共用这一份，**倒序**（最新在上）。每条记录：修改时间 / 修改内容 / 备份位置。

## 2026-10-26 17:35 — 本机 profile 的 link 源切到本仓库，旧目录删除

**修改内容**

| 文件 | 改动 |
| --- | --- |
| `C:/Users/赵文卓/.dsh/profiles/desktop/package.json` | 改第 28 行 `dsh-workspace-running-dot` 的依赖值：`link:D:/AIDeepseek/src/dsh-workspace-running-dot` → `link:D:/git/dsh-workspace-running-dot` |
| `C:/Users/赵文卓/.dsh/profiles/desktop/node_modules/dsh-workspace-running-dot` | 删旧 junction，重建为 `[D:\git\dsh-workspace-running-dot]` |
| `D:/AIDeepseek/scripts/20261025-test-dot.mjs` | 改第 19 行 `PLUGIN` 路径：`join(HERE,'..','src','dsh-workspace-running-dot','client.js')` → `join(HERE,'..','..','git','dsh-workspace-running-dot','client.js')` |
| `D:/AIDeepseek/src/dsh-workspace-running-dot/` | **删除**（整个目录，6 文件） |

**备份位置**

- profile package.json → `C:/Users/赵文卓/.dsh/profiles/desktop/package.json_backup_20261026-173000`
- 旧插件目录 → `D:/git/_repo-backups/AIDeepseek-src-dsh-workspace-running-dot-20261026-173500.tar.gz`（14092 B，6 文件）
- 测试脚本 → `D:/AIDeepseek/scripts/20261025-test-dot.mjs.bak-20261026-173600`

**验证**

- `cmd //c "dir node_modules"` → `<JUNCTION> dsh-workspace-running-dot [D:\git\dsh-workspace-running-dot]`
- 经 junction 跑 `node node_modules/dsh-workspace-running-dot/scripts/20261025-test-dot.mjs` → ALL PASS
- `D:/AIDeepseek/scripts/20261025-test-dot.mjs` 指向新路径后 → ALL PASS
- 删旧目录后 `ls ~/.dsh/profiles/desktop/node_modules/dsh-workspace-running-dot/` 仍能列出文件，链接未断

**为何合并**：此前线上仓库与 profile 里的 live 安装源是两份代码，改插件必须改两处，否则发布的和跑的不一致。切换前三处核心文件（`client.js` / `index.js` / `cordis.patch.yml`）`diff` 完全一致，只 `package.json`（元信息）、`README.md`、`CHANGELOG.md` 有差，属低风险切换。

**遗留**：当前运行的 DSH 实例内存里仍是旧路径加载的插件，需重启才走新路径。因 `client.js` 一字未改，行为不会变化。

## 2026-10-26 17:25 — 建独立仓库并上传 GitHub

**修改内容**

| 文件 | 改动 |
| --- | --- |
| `D:/git/dsh-workspace-running-dot/` | 新建：从 `D:/AIDeepseek/src/dsh-workspace-running-dot` 抽出插件源码，独立成 Git 仓库 |
| `package.json` | 改：补 `repository` / `bugs` / `homepage` / `author`；`files` 加 `CHANGELOG.md` |
| `LICENSE` | 新建：MIT |
| `.gitignore` | 新建：忽略 `node_modules/`、`*.log`、`.DS_Store`、`Thumbs.db` |
| `README.md` | 改：顶部补折叠态截图；补「改圆点颜色」章节与设置页截图；安装章节由「本机绝对路径」改为「克隆后 link」；验证章节列出 17 条断言实测输出；已知限制里点明要调的两个函数名 |
| `scripts/20261025-test-dot.mjs` | 改：`PLUGIN` 路径由 `../src/dsh-workspace-running-dot/client.js` 改为 `../client.js`（仓库根即包根） |
| `docs/*.png` | 新建：三张实测截图（折叠态圆点、单会话显示 1、颜色设置页） |

**备份位置**

- 源目录当时未改动：`D:/AIDeepseek/src/dsh-workspace-running-dot/` 保持原样，本仓库是副本。（**该目录已于 17:35 删除**，见上一条记录）
- 本仓库自身即版本库，回溯用 git 历史。

**验证**

- `node scripts/20261025-test-dot.mjs` → ALL PASS（17 条）

**为何单独建仓**：插件功能已稳定（计数、折叠可见、颜色可配），与 `AIDeepseek` 工作区解耦后，别的机器可以直接 clone 后 link 进 profile，不必复制整个工作区。

**遗留**：无。（原本遗留的「两份代码」问题已于 17:35 解决：profile 的 link 源已切到本仓库，旧目录删除，现在只有一份。）

**发布**

- 远程：https://github.com/VisualStudioXu/dsh-workspace-running-dot （public）
- 推送后 `git ls-remote` 校验通过，本地与远程 `main` 指向同一提交。

## 2026-10-25 21:40 — 单会话也显示数字「1」

**修改内容**

| 文件 | 改动 |
| --- | --- |
| `dsh-workspace-running-dot/client.js` | 改：`paintRow` 的 `wanted` 由 `count > 1 ? String(count) : ''` 改为 `String(count)`，`aria-label` 同步去掉分支 —— 只有 1 个会话在跑时也显示「1」 |
| `scripts/20261025-test-dot.mjs` | 改：断言从「单会话圆点无数字」改为「单会话圆点显示 1」，未分组桶断言同步改为 `'1'` |
| `dsh-workspace-running-dot/README.md` | 改：「它做了什么」里删掉「1 个在跑 → 纯圆点」这条，改为「圆点里始终显示数字」 |

**备份位置**

- 本次只改插件源码与脚本，未动 profile 层，无新增 profile 备份。
- 原文件已在版本库工作区内（`D:/AIDeepseek/src/dsh-workspace-running-dot/client.js`），改动前的版本见本条记录上方的 21:20 条目描述。

**验证**

- `node --check client.js` → 通过
- `node scripts/20261025-test-dot.mjs` → ALL PASS（17 条，含 `ws-a 单会话：圆点显示 1`、`未分组桶：…（显示 1）`）
- 真浏览器（临时 profile 实例 64020）：发 `sleep 50` 长任务 → AIDeepseek 分组行 `count:"1" text:"1"`；折叠后 `expanded:"false"` 仍 `count:"1" text:"1"`，圆点宽 15px。
- 证据图 `docs/20261025-dot-count-1.png`

**清理**：删除临时探针 `tmp-single-dot.py` / `tmp-single2.py`；删除临时 profile `~/.dsh/profiles/tmpdotcheck`（先改名 node_modules 再删，`desktop/node_modules` 校验仍有 273 项）。

**遗留**：仍需重启 DeepSeek Harness 生效。

## 2026-10-25 21:20 — 圆点颜色可配置

**修改内容**

| 文件 | 改动 |
| --- | --- |
| `dsh-workspace-running-dot/client.js` | 改：圆点背景由硬编码 `var(--dsw-alias-state-business-primary,#3f7ff5)` 改为 `var(--dsrwd-dot-color, var(--dsw-alias-state-business-primary,#3f7ff5))`，颜色可被 CSS 变量覆盖 |
| `dsh-workspace-running-dot/client.js` | 新增：`normalizeHex` / `readColor` / `writeColor` / `applyColor` / `subscribeColor` 与 `COLOR_KEY='dsrwd.color'`、`FALLBACK_HEX='#3f7ff5'`、`PRESETS` 六色 |
| `dsh-workspace-running-dot/client.js` | 新增：`DotColorSettings` 组件（6 预设 + `input[type=color]` + 恢复默认），注册到官方 `plugins.bundle.config` 插槽，`key` 为包名 |
| `dsh-workspace-running-dot/client.js` | 改：新增模块级 `dictionariesRegistered` 开关 —— locale 是全局服务，HMR 二次 apply 会抛 `locale namespace "workspace-running-dot" already has locale "zh"`；整段设置页注册包 `try/catch`，坏也只坏设置页 |
| `dsh-workspace-running-dot/README.md` | 改：新增「改圆点颜色」章节；实现要点表补颜色/设置页两行；验证章节更新为 17 条断言 + 真浏览器脚本 |
| `scripts/20261025-test-dot.mjs` | 改：补 `document.documentElement` / `localStorage` / `ctx.get` 桩，新增 7 条颜色断言（共 17 条） |
| `scripts/20261025-verify-dot-color.py` | 新建：真浏览器验颜色链路（设置页存在 → 预设 → 自定义 → 恢复默认 → 刷新持久化） |

**备份位置**

- `~/.dsh/profiles/desktop/package.json_backup_20261025`
- 本次未改 profile 层（插件已在 bundles 里），故无新增 profile 备份。

**验证**

- `node scripts/20261025-test-dot.mjs` → ALL PASS（17 条）
- `py -3.13 scripts/20261025-verify-dot-color.py` → RESULT PASS
  - 默认 `#3f7ff5` → 圆点 `rgb(63,127,245)`
  - 点紫 `#a855f7` → 变量/背景同步、`aria-pressed` 标记、`localStorage` 写入
  - 自定义 `#00c2a8` → 变 `rgb(0,194,168)`，无预设被标记
  - 恢复默认 → 回 `#3f7ff5`
  - 刷新后 `#ef4444` 仍在，样式标签仍为 1 个
- 证据图 `docs/20261025-dot-color-settings.png`（插件页「圆点颜色」单元）

**清理**：删除临时探针 13 个（`tmp-color-*.py`、`tmp-open-plugin*.py`、`tmp-err*.py`、`tmp-settings-probe.py`、`tmp-pick-color.py`、`tmp-collect-err.py`）。

**已知问题（非本插件）**：`dsh-connect-workbuddy-client` 抢 `conversation.input.model.label` single slot，页面每次加载抛 `single slot ... already has a registration at priority 0`。未处理。

**遗留**：颜色设置需重启 DeepSeek Harness 后才能在正式实例里看到（插件代码已改，运行中的实例还在跑旧版）。

## 2026-10-25 01:05 — 首版交付

**修改内容**

| 文件 | 改动 |
| --- | --- |
| `dsh-workspace-running-dot/package.json` | 新建 |
| `dsh-workspace-running-dot/client.js` | 新建：核心实现（DOM 观察 + 快照统计 + 圆点绘制） |
| `dsh-workspace-running-dot/index.js` | 新建：Host 空壳，必须带 `apply()` 否则 cordis 判为非法插件 |
| `dsh-workspace-running-dot/cordis.patch.yml` | 新建：把插件插进 Loader |
| `dsh-workspace-running-dot/README.md` | 新建 |
| `dsh-workspace-running-dot/client.js` | 改：`computeByWorkspace` 增加「未分组桶」统计；新增 `collectSubagentIds()` 排除子代理重复计数 |
| `dsh-workspace-running-dot/client.js` | 改：删除验证期临时挂的 `window.__dsrwdDebug` 调试段 |
| `~/.dsh/profiles/desktop/package.json` | 改：`dependencies` 加 `link:D:/AIDeepseek/src/dsh-workspace-running-dot`；`dsh.profile.bundles` 在 `dsh-word-writing-spec` 之后插入该包 |
| `~/.dsh/profiles/desktop/node_modules/dsh-workspace-running-dot` | 新建 junction → `D:\AIDeepseek\src\dsh-workspace-running-dot`（`ln -s` 在 Git Bash 下会退化成复制，必须 `mklink /J`） |

**备份位置**

- `~/.dsh/profiles/desktop/package.json_backup_20261025`
- `~/.dsh/profiles/desktop/cordis.patch.yml_backup_20261025`（本次最终没有改这一层，备份是为安全留的）

**验证**

- `node scripts/20261025-test-dot.mjs` → ALL PASS（10 条断言）
- `py -3.13 scripts/20261025-verify-dot.py` → RESULT PASS（样式已注入、无插件报错）
- `py -3.13 scripts/20261025-verify-layout.py` → PASS（hover 前后圆点与标题间距恒为 12px，不重叠）
- `py -3.13 scripts/20261025-verify-e2e.py` → PASS（真会话：running → 折叠后圆点仍在 → 结束熄灭）
- 证据图 `docs/20261025-running-dot-collapsed.png`

**清理**：删除临时探针脚本 7 个、中间截图 6 张、临时 profile `~/.dsh/profiles/tmpdotcheck`、临时验证实例 63994/63995。

**遗留**：需重启 DeepSeek Harness 后才在正式实例里生效。
