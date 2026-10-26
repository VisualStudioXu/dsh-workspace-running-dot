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

    /**
     * 算出每个分组行该显示几。
     *
     * 除了按工作区归拢，还要照顾「未分组」那一桶：不属于任何工作区的会话，
     * 官方把它们的分组 key 定成空串（`buildGroup("", …)`），行的
     * data-row-key 就是 `workspace:`。不统计这一桶的话，一个刚建的、还没
     * 落进工作区的会话跑起来时，侧栏上会一点动静都没有。
     *
     * @param list   - ctx.sessions.list 快照
     * @param items  - ctx.workspaces.list 快照里的 items
     * @returns Map<groupId, 正在进行的会话数>，只保留大于 0 的项
     */
    function computeByWorkspace(list, items) {
      const result = new Map()
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
        if (busy > 0) result.set(workspace.workspaceId, busy)
      }

      // 未归入任何工作区的会话 → 空 key 那一桶。子代理跳过（见上）。
      let loose = 0
      for (const id of list.ids ?? []) {
        if (grouped.has(id) || subagents.has(id)) continue
        if (isSessionBusy(list, id)) loose += 1
      }
      if (loose > 0) result.set('', loose)

      return result
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
     * @returns 是否真的改动了 DOM（决定要不要再扫一帧）
     */
    function paintRow(row, count) {
      const existing = row.querySelector(`.${DOT_CLASS}`)
      if (count <= 0) {
        if (existing === null) return false
        existing.remove()
        return true
      }
      // 一律显示数字：只有 1 个时也写「1」，否则纯圆点看不出到底几个在跑。
      const wanted = String(count)
      const label = `${count} 个会话正在进行`
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
      if (dot.dataset.count !== String(count)) {
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
      /** 最新一次算出来的 Map<workspaceId, count> */
      let counts = new Map()
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
          for (const row of document.querySelectorAll(ROW_SELECTOR)) {
            const key = String(row.dataset.rowKey ?? '').slice(KEY_PREFIX.length)
            if (paintRow(row, counts.get(key) ?? 0)) changed = true
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
        counts = list !== undefined && Array.isArray(items) ? computeByWorkspace(list, items) : new Map()
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
