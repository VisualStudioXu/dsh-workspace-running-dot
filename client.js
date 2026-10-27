/**
 * dsh-workspace-running-dot — Client 半。
 *
 * 要解决的问题：左侧栏「按工作区」分组时，工作区那一行折叠起来以后，里面
 * 哪个会话还在跑就完全看不见了。要判断只能一层层展开。
 *
 * ── 为什么走 DOM 注入，而不是注册 slot ───────────────────────────
 * 查过 `@deepseek-ai/dsh-client-ui-workspace` 的 `lib/client.js`：
 * `sidebar.workspaces` 的 children 只声明了 5 个口子
 * （directoryFlow / session.menu.item / session.row.action /
 *  session.row.leading / session.row.hover），**工作区分组行
 * `ProjectRowItem` 自己没有任何 slot**。官方也没打算在那儿显示状态。
 * 折叠时更彻底：`deriveGroups` 里 `sessions: expanded ? … : []`，
 * 子会话节点压根不派生，数据层就已经没有运行状态了。
 *
 * 所以只有两条路：
 *   1. 自己写，在分组行 DOM 上补一个圆点（本插件）；
 *   2. 忍着，改视图选项或开会话管理窗口。
 *
 * 选了 1，代价是官方改类名/结构时要跟着改 —— 因此下面所有选择器都尽量
 * 靠 data-row-key 和 aria 属性，而不是 hash 类名（`hIlkoa_` 前缀是
 * CSS Modules 生成的，每次构建可能变）。
 *
 * ── 数据从哪来 ──────────────────────────────────────────────────
 * 不碰官方私有函数，只读两个公开快照：
 *   ctx.sessions.list    → { ids, byId, projectionsBySession }
 *   ctx.workspaces.list  → { items: [{ workspaceId, sessionIds, … }] }
 * 某工作区在跑几个 = ws.sessionIds 里 `running === true` 的个数，
 * 外加子代理部分（官方 `runningChildCount` 用的是同一份
 * `projectionsBySession[id].values.subagentCatalog`，这里对齐它的语义）。
 *
 * ── 按工作区树：父行也要亮 ───────────────────────────────────────
 * 树模式（`groupBy === 'workspace-tree'`）下官方把子工作区折叠进父行里，
 * 父工作区常常只是个目录容器、自己没有直属会话，于是按「直属会话数」
 * 算出来的父行永远是 0 —— 最外层工作区就一直没有圆点。
 *
 * 解法是沿目录前缀建立「子工作区 → 父工作区」映射（抄官方的
 * `owningParentFolder`：`child.startsWith(root + '/')` 取最长），再把每个
 * 子工作区的计数累加进它所有的祖先。只在树模式下做：平铺模式下父子行
 * 没有视觉从属关系，累加会让父行凭空多出不属于它的数字。
 */

window.__ModuleLoader__.load({
  id: 'dsh-workspace-running-dot',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;

    /** 官方插件一律从这里拿 React：模块表已注入，不需要自己打包。 */
    const React = require('react');

    const NS = 'workspace-running-dot';
    const DOT_CLASS = 'dsrwd-dot';
    const STYLE_MARK = 'dsrwd';
    /** 用户自选颜色存在浏览器本地：这是纯粹的界面偏好，不必进 Host 设置文档。 */
    const COLOR_KEY = 'dsrwd.color';
    /** 没自选时给 <input type="color"> 的初值，必须是一个合法 hex。 */
    const FALLBACK_HEX = '#3f7ff5';
    const PRESETS = ['#3f7ff5', '#16a34a', '#f59e0b', '#ef4444', '#a855f7', '#64748b'];
    /** 分组行的唯一稳定锚点：`data-row-key="workspace:<groupId>"`，groupId 就是 workspaceId。 */
    const ROW_SELECTOR = '[data-row-key^="workspace:"]';
    const KEY_PREFIX = 'workspace:';

    /* ---------------------------------------------------------------- */
    /* 样式                                                              */
    /* ---------------------------------------------------------------- */

    const CSS = `
.${DOT_CLASS}{
  flex:none;
  display:inline-flex;
  align-items:center;
  justify-content:center;
  box-sizing:border-box;
  min-width:16px;
  height:16px;
  padding:0 4px;
  margin-inline-start:6px;
  border-radius:999px;
  background:var(--dsrwd-dot-color,var(--dsw-alias-state-business-primary,#3f7ff5));
  color:#fff;
  font-size:10px;
  line-height:1;
  font-weight:600;
  font-family:inherit;
  font-variant-numeric:tabular-nums;
  letter-spacing:0;
  pointer-events:none;
  user-select:none;
  animation:dsrwd-pulse 1.8s ease-in-out infinite;
}
.${DOT_CLASS}[data-count="1"]{animation:dsrwd-pulse 1.8s ease-in-out infinite}
@keyframes dsrwd-pulse{
  0%,100%{opacity:1;transform:scale(1)}
  50%{opacity:.55;transform:scale(.86)}
}
@media (prefers-reduced-motion:reduce){
  .${DOT_CLASS}{animation:none}
}
`

    /* ---------------------------------------------------------------- */
    /* 颜色偏好：一个很小的本地 store                                     */
    /* ---------------------------------------------------------------- */

    /** 只接受 #rgb / #rrggbb，其余一律当没设置。 */
    function normalizeHex(value) {
      if (typeof value !== 'string') return null
      const text = value.trim().toLowerCase()
      if (/^#[0-9a-f]{6}$/.test(text)) return text
      if (/^#[0-9a-f]{3}$/.test(text)) {
        return `#${text[1]}${text[1]}${text[2]}${text[2]}${text[3]}${text[3]}`
      }
      return null
    }

    const colorListeners = new Set()

    /**
     * 词典只能注册一次。
     *
     * locale 是全局服务，register 上去的东西不跟着插件卸载一起清；
     * 而 HMR / 重复 apply 会让这段再跑一遍，第二次会抛
     * `locale namespace "workspace-running-dot" already has locale "zh"`。
     * 用一个模块级标记挡住 —— 模块本身随插件卸载而丢弃，所以不会永久失效。
     */
    let dictionariesRegistered = false

    function readColor() {
      try {
        return normalizeHex(window.localStorage.getItem(COLOR_KEY)) ?? FALLBACK_HEX
      } catch (_) {
        return FALLBACK_HEX
      }
    }

    /**
     * 圆点颜色走一个 CSS 自定义属性，而不是给每个圆点写 inline style。
     * 理由：圆点会被 MutationObserver 反复重画，写 inline style 就得在
     * 每次 paint 时补一次；变量挂在 :root 上，改一次全部圆点立刻跟着变。
     */
    function applyColor(hex) {
      document.documentElement.style.setProperty('--dsrwd-dot-color', hex)
    }

    function writeColor(value) {
      const hex = normalizeHex(value) ?? FALLBACK_HEX
      try {
        window.localStorage.setItem(COLOR_KEY, hex)
      } catch (_) { /* 隐私模式写不进去，本次会话仍然生效 */ }
      applyColor(hex)
      for (const listener of colorListeners) {
        try { listener(hex) } catch (_) { /* 某个订阅者出错不该连累别人 */ }
      }
      return hex
    }

    function subscribeColor(listener) {
      colorListeners.add(listener)
      return () => { colorListeners.delete(listener) }
    }

    /* ---------------------------------------------------------------- */
    /* 设置页：插件自己的配置单元                                         */
    /* ---------------------------------------------------------------- */

    const SETTINGS_TEXT = {
      zh: {
        title: '圆点颜色',
        hint: '选一个颜色，折叠的工作区分组行上那个「有会话在跑」的圆点就用它。改动立即生效，存在本机浏览器里。',
        reset: '恢复默认',
        custom: '自定义',
        current: '当前',
      },
      en: {
        title: 'Dot color',
        hint: 'Pick the color of the running dot on collapsed workspace rows. Applies immediately and is stored in this browser.',
        reset: 'Reset to default',
        custom: 'Custom',
        current: 'Current',
      },
    }

    const SWATCH = {
      width: '28px',
      height: '28px',
      borderRadius: '999px',
      border: '1px solid var(--dsw-alias-border-secondary, rgba(0,0,0,.16))',
      cursor: 'pointer',
      padding: '0',
      flex: 'none',
    }

    function DotColorSettings(props) {
      const t = props.t
      const [color, setColor] = React.useState(readColor)

      React.useEffect(() => subscribeColor(setColor), [])

      const swatches = PRESETS.map((hex) => {
        const selected = hex === color
        return React.createElement('button', {
          key: hex,
          type: 'button',
          title: hex,
          'aria-label': hex,
          'aria-pressed': selected ? 'true' : 'false',
          onClick: () => writeColor(hex),
          style: {
            ...SWATCH,
            background: hex,
            boxShadow: selected
              ? '0 0 0 2px var(--dsw-alias-label-primary, #1f2329)'
              : 'none',
          },
        })
      })

      return React.createElement(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: '10px' } },
        React.createElement(
          'div',
          { style: { fontSize: '13px', fontWeight: 600 } },
          t('title'),
        ),
        React.createElement(
          'div',
          {
            style: {
              fontSize: '12px',
              lineHeight: 1.6,
              color: 'var(--dsw-alias-label-secondary, rgba(0,0,0,.6))',
            },
          },
          t('hint'),
        ),
        React.createElement(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' } },
          swatches,
          React.createElement('input', {
            type: 'color',
            value: color,
            'aria-label': t('custom'),
            title: t('custom'),
            onChange: (event) => writeColor(event.target.value),
            style: { ...SWATCH, background: 'transparent' },
          }),
          React.createElement(
            'button',
            {
              type: 'button',
              onClick: () => writeColor(FALLBACK_HEX),
              style: {
                marginInlineStart: '4px',
                padding: '4px 10px',
                fontSize: '12px',
                borderRadius: '6px',
                border: '1px solid var(--dsw-alias-border-secondary, rgba(0,0,0,.16))',
                background: 'transparent',
                color: 'inherit',
                cursor: 'pointer',
              },
            },
            t('reset'),
          ),
        ),
      )
    }


    /**
     * 一个会话算不算「正在进行」。
     *
     * 先看它自己：summary.running 是 Host 推送的权威标记。
     * 再看它挂着的子代理：主会话的轮次已经结束时，子代理可能还在跑，
     * 这在官方侧栏里是靠 `runningChildCount` 单独补上的，这里照做，
     * 否则会漏掉「只有子代理在跑」的工作区。
     */
    function isSessionBusy(list, id) {
      const summary = list.byId?.[id]
      if (summary === undefined) return false
      if (summary.running === true) return true
      const catalog = list.projectionsBySession?.[id]?.values?.subagentCatalog
      if (!Array.isArray(catalog)) return false
      return catalog.some((child) => list.byId?.[child.id]?.running === true)
    }

    /**
     * 收集所有「作为子代理出现过」的会话 id。
     *
     * 为什么要单独收集：子代理也是一条独立的会话记录，会出现在 `list.ids`
     * 里，但侧栏从不给它单独的行 —— 它的运行状态已经通过父会话的
     * subagentCatalog 算进父会话了。若把它当独立会话再数一遍，一个带子代理
     * 的会话就会让圆点凭空多 1。
     *
     * 判据来自官方 `runningChildCount`：`projectionsBySession[parentId].values
     * .subagentCatalog`。**不能**用 `summary.parentSessionId` —— 实测真实
     * 快照里的 summary 根本没有这个字段（键只有 id/displayTitle/running/
     * retainedBy/blank/updatedAt/formatStatus/projectionValues/title/cwd），
     * 拿它判会永远判不出来。
     *
     * @returns Set<子代理会话 id>
     */
    function collectSubagentIds(list) {
      const ids = new Set()
      const bySession = list.projectionsBySession
      if (bySession === undefined || bySession === null) return ids
      for (const key of Object.keys(bySession)) {
        const catalog = bySession[key]?.values?.subagentCatalog
        if (!Array.isArray(catalog)) continue
        for (const child of catalog) {
          if (typeof child?.id === 'string') ids.add(child.id)
        }
      }
      return ids
    }

    /* ---------------------------------------------------------------- */
    /* 工作区树的父子关系                                                 */
    /* ---------------------------------------------------------------- */

    /**
     * 归一化路径分隔符，只为比较，不改写真实路径。
     *
     * 与官方 `owningParentFolder` 内部的 `folderPath()` 同构：Windows 盘符
     * 或 UNC 路径把 `\` 折成 `/` 并去掉尾部分隔符；POSIX 路径原样保留
     * （POSIX 下反斜杠是合法的文件名字符，不能当分隔符吃掉）。
     *
     * @param path - 工作区目录
     * @returns 可比较的路径串
     */
    function folderPath(path) {
      const windows = /^[A-Za-z]:[/\\]/.test(path) || path.startsWith('\\\\')
      return (windows ? path.replaceAll('\\', '/') : path).replace(/\/+$/, '')
    }

    /**
     * 找出某个工作区最近的已注册父工作区（不含它自己）。
     *
     * 匹配规则抄官方：`child !== root && child.startsWith(root + '/')`，
     * 在满足条件的里面取最长的那一个；大小写敏感，与 Workspace 身份一致。
     *
     * @param path    - 子工作区目录
     * @param parents - 所有已注册工作区目录
     * @returns 父目录原样字符串，或 undefined
     */
    function owningParentFolder(path, parents) {
      const child = folderPath(path)
      let owner
      let length = -1
      for (const parent of parents) {
        const root = folderPath(parent)
        if (root.length > length && child !== root && child.startsWith(`${root}/`)) {
          owner = parent
          length = root.length
        }
      }
      return owner
    }

    /**
     * 建立「子工作区 → 父工作区」映射。
     *
     * 官方只在「按工作区树」模式下做嵌套，用的是同一套
     * `owningParentFolder`；「按工作区」模式下 parents 是空 Map，所有行平铺。
     * 这里把两种模式所需的父子关系都算出来，由调用方按当前模式决定用不用。
     *
     * 没有 `path` 的条目（理论上不该出现）直接跳过 —— 宁可退化成平铺，
     * 也不要因为缺字段把两个不相干的工作区凑成父子。
     *
     * @param items - ctx.workspaces.list 快照里的 items
     * @returns Map<子 workspaceId, 父 workspaceId>
     */
    function buildParents(items) {
      const paths = []
      const idByPath = new Map()
      for (const workspace of items) {
        const path = workspace?.path
        if (typeof path !== 'string' || path === '') continue
        paths.push(path)
        idByPath.set(folderPath(path), workspace.workspaceId)
      }
      const parents = new Map()
      for (const workspace of items) {
        const path = workspace?.path
        if (typeof path !== 'string' || path === '') continue
        const owner = owningParentFolder(path, paths)
        if (owner === undefined) continue
        const parentId = idByPath.get(folderPath(owner))
        if (parentId === undefined || parentId === workspace.workspaceId) continue
        parents.set(workspace.workspaceId, parentId)
      }
      return parents
    }

    /**
     * 把每个工作区自己的计数，沿父子链累加进它的所有祖先。
     *
     * 这就是「最外层工作区没有圆点」的解法：父工作区往往只是个目录容器，
     * 自己没有直属会话，但它的子工作区里有会话在跑。树模式下父行既然把
     * 子工作区折叠在里面，它的圆点就必须反映「折叠在里面的那些」。
     *
     * 环保护：用 seen 记录走过的节点，万一父子关系成环也不会死循环。
     *
     * @param own     - Map<workspaceId, 自身直属的进行中会话数>
     * @param parents - Map<子 workspaceId, 父 workspaceId>
     * @returns 新的 Map，未分组那一桶（空串 key）原样保留
     */
    function rollUp(own, parents) {
      if (parents.size === 0) return own
      const total = new Map(own)
      for (const [childId, count] of own) {
        if (childId === '') continue
        let current = childId
        const seen = new Set([current])
        for (;;) {
          const parentId = parents.get(current)
          if (parentId === undefined || seen.has(parentId)) break
          seen.add(parentId)
          total.set(parentId, (total.get(parentId) ?? 0) + count)
          current = parentId
        }
      }
      return total
    }

    /* ---------------------------------------------------------------- */
    /* 分组模式：官方视图 store 的持久化键                                */
    /* ---------------------------------------------------------------- */

    /**
     * 官方 `createWorkspaceViewStore()` 声明的 `persist`，也就是
     * `defineStore` 落到 localStorage 时用的键（`persist` 是字符串时
     * 直接当键名，不再加作用域后缀）。
     */
    const VIEW_STORE_KEY = 'dsh.workspace.view.v5'

    /**
     * 读当前的分组模式：`workspace` / `workspace-tree` / `flat`。
     *
     * 为什么不从 ctx 拿：视图 store 是 `@deepseek-ai/dsh-client-ui-workspace`
     * 内部实例，`ctx.get('uiWorkspace')` 只把 actions 交出去，没有读口。
     * 而它的状态本来就落在这个 localStorage 键里，读它是稳定契约。
     *
     * 任何异常（键不存在、JSON 坏、非浏览器环境）一律退回官方的初始值
     * `workspace` —— 那时不做祖先汇总，宁可少画一个圆点，也不能在平铺
     * 模式下把子工作区的计数错误地堆到父行上。
     *
     * @returns 分组模式字符串
     */
    function readGroupBy() {
      try {
        const raw = localStorage.getItem(VIEW_STORE_KEY)
        if (raw !== null) {
          const parsed = JSON.parse(raw)
          const mode = parsed?.groupBy
          if (typeof mode === 'string') return mode
        }
      } catch (_) {
        /* 落到下面的 DOM 兜底 */
      }
      // localStorage 没这个键（用户从没动过视图设置）时不能假定是平铺：
      // 官方的初始值虽然是 "workspace"，但真正决定「父行里有没有子行」的
      // 是当前渲染出来的结构。树模式必然产生 div[role="group"] 包住分组行，
      // 平铺模式不会。以 DOM 为准，比以默认值为准更贴近眼前的事实。
      return detectTreeByDom() ? 'workspace-tree' : 'workspace'
    }

    /**
     * 从 DOM 判断当前是不是嵌套树：只要有一个 `role="group"` 容器里面
     * 装着分组行，就说明分组被嵌进去了。
     *
     * 只认 `workspace:` 前缀的行，会话行的容器不算 —— 平铺模式下会话也
     * 会被包进 `role="group"`，拿它当证据会误判。
     *
     * @returns 是否处于树模式
     */
    function detectTreeByDom() {
      if (typeof document === 'undefined') return false
      for (const group of document.querySelectorAll('div[role="group"]')) {
        if (group.querySelector(ROW_SELECTOR) !== null) return true
      }
      return false
    }

    /**
     * 算出每个分组行「自己」该显示几，并附带父子关系。
     *
     * 除了按工作区归拢，还要照顾「未分组」那一桶：不属于任何工作区的会话，
     * 官方把它们的分组 key 定成空串（`buildGroup("", …)`），行的
     * data-row-key 就是 `workspace:`。不统计这一桶的话，一个刚建的、还没
     * 落进工作区的会话跑起来时，侧栏上会一点动静都没有。
     *
     * @param list   - ctx.sessions.list 快照
     * @param items  - ctx.workspaces.list 快照里的 items
     * @returns {{ own: Map<groupId, number>, parents: Map<string, string> }}
     *          `own` 只保留大于 0 的项；`parents` 是子→父的工作区映射
     */
    function computeByWorkspace(list, items) {
      const own = new Map()
      const grouped = new Set()
      const subagents = collectSubagentIds(list)

      for (const workspace of items) {
        const ids = workspace?.sessionIds
        if (!Array.isArray(ids)) continue
        let busy = 0
        for (const id of ids) {
          grouped.add(id)
          if (isSessionBusy(list, id)) busy += 1
        }
        if (busy > 0) own.set(workspace.workspaceId, busy)
      }

      // 未归入任何工作区的会话 → 空 key 那一桶。子代理跳过（见上）。
      let loose = 0
      for (const id of list.ids ?? []) {
        if (grouped.has(id) || subagents.has(id)) continue
        if (isSessionBusy(list, id)) loose += 1
      }
      if (loose > 0) own.set('', loose)

      return { own, parents: buildParents(items) }
    }

    /* ---------------------------------------------------------------- */
    /* DOM：在分组行上画出/擦掉那个圆点                                   */
    /* ---------------------------------------------------------------- */

    /**
     * 圆点插在 `projectText` 之后、`rowActions` 之前。
     *
     * 为什么不直接 append 到行尾：`rowActions` 是 `display:none`，只在
     * hover 或菜单打开时才 `inline-flex`。放在它后面的话，hover 时圆点会被
     * 挤到更右边，位置来回跳；放在它前面则始终贴着标题右侧，稳定。
     */
    function dotAnchor(row) {
      for (const child of row.children) {
        const cls = typeof child.className === 'string' ? child.className : ''
        if (cls.includes('rowActions')) return child
      }
      return null
    }

    /**
     * @param row        - 分组行（`data-row-key="workspace:…"`）
     * @param count      - 这一行该显示的数字
     * @param aggregated - 这个数字里是否含了子工作区的会话
     * @returns 是否真的改动了 DOM（决定要不要再扫一帧）
     */
    function paintRow(row, count, aggregated = false) {
      const existing = row.querySelector(`.${DOT_CLASS}`)
      if (count <= 0) {
        if (existing === null) return false
        existing.remove()
        return true
      }
      // 一律显示数字：只有 1 个时也写「1」，否则纯圆点看不出到底几个在跑。
      const wanted = String(count)
      // 父行的数字是「自己 + 折叠在里面的子工作区」加起来的结果，跟单工作区
      // 的直属会话数不是一回事，提示语要说清楚，免得用户按数字找不到那么多会话。
      const label = aggregated
        ? `${count} 个会话正在进行（含子工作区）`
        : `${count} 个会话正在进行`
      let dot = existing
      let changed = false
      if (dot === null) {
        dot = document.createElement('span')
        dot.className = DOT_CLASS
        const anchor = dotAnchor(row)
        if (anchor !== null) row.insertBefore(dot, anchor)
        else row.appendChild(dot)
        changed = true
      }
      if (dot.textContent !== wanted) {
        dot.textContent = wanted
        changed = true
      }
      const stamp = `${count}:${aggregated ? 'all' : 'own'}`
      if (dot.dataset.stamp !== stamp) {
        dot.dataset.stamp = stamp
        dot.dataset.count = String(count)
        dot.title = label
        dot.setAttribute('aria-label', label)
        dot.setAttribute('role', 'status')
        changed = true
      }
      return changed
    }

    /* ---------------------------------------------------------------- */
    /* 插件入口                                                          */
    /* ---------------------------------------------------------------- */

    /**
     * @param ctx - 本插件的 fiber ctx（动态包的门禁代理）。
     */
    function apply(ctx) {
      let disposed = false
      /** 每个工作区「自己的」进行中会话数：Map<workspaceId, count> */
      let ownCounts = new Map()
      /** 子工作区 → 父工作区：Map<workspaceId, workspaceId> */
      let parentLinks = new Map()
      let observer = null
      let frame = 0
      /** 观察参数提到外面，disconnect 之后要用同一份重新挂上。 */
      const OBSERVE_OPTS = { childList: true, subtree: true }

      ctx.effect(() => {
        const style = document.createElement('style')
        style.dataset.pluginCss = STYLE_MARK
        style.textContent = CSS
        document.head.appendChild(style)
        return () => {
          style.remove()
        }
      }, `${NS}: styles`)

      // 颜色先落地，否则第一帧圆点会闪一下默认色再变色。
      ctx.effect(() => {
        const hex = readColor()
        applyColor(hex)
        return () => {
          document.documentElement.style.removeProperty('--dsrwd-dot-color')
        }
      }, `${NS}: dot color`)

      // 设置页：注册到插件自己那一页的配置单元（插件页按包名派发这个 key）。
      // 整段都做防御：设置页是附加功能，它出问题不该把「圆点」这个主功能一起带走。
      try {
        const locale = ctx.get('locale')
        const slots = ctx.get('slots')
        if (locale !== undefined) {
          // 词典挂在 locale 这个全局服务上，不会随插件卸载而清空；
          // 而 HMR 会让 apply 再跑一次，第二次 register 会抛
          // 「locale namespace ... already has locale ...」。所以进程内只注册一次。
          if (!dictionariesRegistered) {
            locale.register(NS, SETTINGS_TEXT)
            dictionariesRegistered = true
          }
        }
        if (slots !== undefined) {
          // slots.inject 自己就把等待-注册这一对包在 ctx.effect 里并返回 disposer，
          // 不必再套一层 ctx.effect。
          slots.inject('plugins.bundle.config', () => slots.register(
            { name: 'plugins.bundle.config', key: 'dsh-workspace-running-dot', locale: NS },
            DotColorSettings,
          ))
        }
      } catch (error) {
        console.warn(`[${NS}] 设置页注册失败，圆点功能不受影响：`, error)
      }

      /**
       * 自己改 DOM 会引起 MutationObserver 再次回调，若不隔离就是一个
       * 永不收敛的循环（每帧都在改写自己刚写的节点）。做法：
       * 扫描前 disconnect，扫描后重新 observe；并且只有在真的改动过
       * 节点时才补排一帧，把这段时间里别人做的改动捞回来。
       */
      function paintAll() {
        frame = 0
        if (disposed) return
        if (observer !== null) observer.disconnect()
        let changed = false
        try {
          // 分组模式在这里读，而不是在 recompute 里。
          // 切换「按工作区 / 按工作区树」只改视图 store，sessions 与
          // workspaces 两个 store 一声不响，订阅不到；但官方重渲染侧栏
          // 会动 DOM，MutationObserver 必然把我们叫醒。把模式判断放在
          // 绘制这一端，顺手就拿到了最新的模式。
          const nested = readGroupBy() === 'workspace-tree'
          const base = ownCounts
          const merged = nested ? rollUp(base, parentLinks) : base
          // 树模式下，凡是「有子工作区」的父行，它的数字都含了别人的会话。
          const parentsOnly = new Set(parentLinks.values())
          for (const row of document.querySelectorAll(ROW_SELECTOR)) {
            const key = String(row.dataset.rowKey ?? '').slice(KEY_PREFIX.length)
            const count = merged.get(key) ?? 0
            // 只有数字真的比「自己的」大，才说明它掺了子工作区的会话。
            // 否则一个父工作区哪怕有子工作区、但子工作区全是空闲的，
            // 也会被标成「含子工作区」，读起来像在撒谎。
            const aggregated = nested && parentsOnly.has(key) && count > (base.get(key) ?? 0)
            if (paintRow(row, count, aggregated)) changed = true
          }
        } finally {
          if (!disposed && observer !== null) observer.observe(document.body, OBSERVE_OPTS)
        }
        if (changed) schedulePaint()
      }

      function schedulePaint() {
        if (disposed || frame !== 0) return
        frame = requestAnimationFrame(paintAll)
      }

      function recompute() {
        if (disposed) return
        const list = ctx.sessions?.list?.getSnapshot?.()
        const snapshot = ctx.workspaces?.list?.getSnapshot?.()
        const items = snapshot?.items
        if (list === undefined || !Array.isArray(items)) {
          ownCounts = new Map()
          parentLinks = new Map()
          schedulePaint()
          return
        }
        // 只缓存「每个工作区自己的」计数与父子关系，不缓存汇总结果 ——
        // 汇总依赖当前分组模式，而那东西会在绘制时变（见 paintAll）。
        const computed = computeByWorkspace(list, items)
        ownCounts = computed.own
        parentLinks = computed.parents
        schedulePaint()
      }

      // 数据变了就重算。两个 store 都只在真正变化时才通知，
      // 所以这里不需要额外的节流。
      ctx.effect(() => {
        const offs = []
        const subscribe = (store) => {
          if (typeof store?.subscribe !== 'function') return
          const off = store.subscribe(recompute)
          if (typeof off === 'function') offs.push(off)
        }
        subscribe(ctx.sessions?.list)
        subscribe(ctx.workspaces?.list)
        return () => {
          for (const off of offs) {
            try { off() } catch (_) { /* store 已销毁，忽略 */ }
          }
        }
      }, `${NS}: subscriptions`)

      // DOM 变了（折叠/展开、切换视图、新建工作区）就重扫。
      ctx.effect(() => {
        observer = new MutationObserver(schedulePaint)
        observer.observe(document.body, OBSERVE_OPTS)
        return () => {
          observer?.disconnect()
          observer = null
        }
      }, `${NS}: row observer`)

      ctx.effect(() => {
        recompute()
        return () => {
          disposed = true
          if (frame !== 0) cancelAnimationFrame(frame)
          frame = 0
          for (const dot of document.querySelectorAll(`.${DOT_CLASS}`)) dot.remove()
        }
      }, `${NS}: initial paint`)
    }

    exports.name = NS
    /** 两个快照 store 都在白名单服务里；拿不到时插件会被 park 而不是静默降级。
     * `slots` / `locale` 只用于设置页，用 ctx.get 取，缺失时降级为「没有设置页」，
     * 不写进 inject —— 否则这两个服务缺失会让整个圆点功能一起被 park。 */
    exports.inject = ['sessions', 'workspaces']
    exports.apply = apply

    return module.exports
  },
})
