/**
 * 20261025-test-dot.mjs — 在 Node 里用最小 DOM 桩跑一遍 client.js 的核心逻辑。
 *
 * 为什么需要它：这个插件的全部行为都在浏览器里，而重启整个桌面应用去验证
 * 一次「圆点出现/消失」代价太高（每次十几秒，且失败时只有控制台一行报错）。
 * 这里用假 DOM 把三条真规则跑一遍：
 *   1. 折叠状态不影响计数 —— 计数只读 sessions/workspaces 快照，不读 DOM 展开态；
 *   2. 圆点插在 rowActions 之前，且数量 >1 才显示数字；
 *   3. 数据归零后圆点被移除，不留残骸。
 *
 * 跑法：node scripts/20261025-test-dot.mjs
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
/** 仓库根就是插件包根：client.js 在上一级。 */
const PLUGIN = join(HERE, '..', 'client.js')

/* ------------------------------------------------------------------ */
/* 最小 DOM 桩                                                         */
/* ------------------------------------------------------------------ */

let idSeq = 0

class El {
  constructor(tag) {
    this.tagName = tag.toUpperCase()
    this.children = []
    this.parentNode = null
    this.className = ''
    this.dataset = {}
    this.attributes = {}
    this.textContent = ''
    this.title = ''
    this.id = ++idSeq
  }
  get classList() {
    const self = this
    return {
      contains: (c) => self.className.split(/\s+/).includes(c),
    }
  }
  appendChild(node) {
    node.parentNode = this
    this.children.push(node)
    return node
  }
  insertBefore(node, ref) {
    node.parentNode = this
    const at = this.children.indexOf(ref)
    if (at < 0) this.children.push(node)
    else this.children.splice(at, 0, node)
    return node
  }
  removeChild(node) {
    const at = this.children.indexOf(node)
    if (at >= 0) this.children.splice(at, 1)
    node.parentNode = null
    return node
  }
  remove() {
    this.parentNode?.removeChild(this)
  }
  setAttribute(name, value) {
    this.attributes[name] = String(value)
  }
  getAttribute(name) {
    return this.attributes[name] ?? null
  }
  /** 只实现本插件用到的那几种选择器。 */
  matches(sel) {
    if (sel.startsWith('.')) return this.classList.contains(sel.slice(1))
    if (sel.startsWith('[data-row-key^="')) {
      const prefix = sel.slice('[data-row-key^="'.length, -2)
      return String(this.dataset.rowKey ?? '').startsWith(prefix)
    }
    return false
  }
  *walk() {
    for (const child of this.children) {
      yield child
      yield* child.walk()
    }
  }
  querySelectorAll(sel) {
    const out = []
    if (sel.includes(',')) {
      for (const part of sel.split(',').map((s) => s.trim())) out.push(...this.querySelectorAll(part))
      return out
    }
    for (const node of this.walk()) if (node.matches(sel)) out.push(node)
    return out
  }
  querySelector(sel) {
    return this.querySelectorAll(sel)[0] ?? null
  }
}

const head = new El('head')
const body = new El('body')
const rafQueue = []
/** 圆点颜色变量挂在 :root 上，桩里也要有 documentElement。 */
const rootStyle = new Map()
const documentElement = {
  style: {
    setProperty: (name, value) => rootStyle.set(name, value),
    removeProperty: (name) => rootStyle.delete(name),
    getPropertyValue: (name) => rootStyle.get(name) ?? '',
  },
}

globalThis.document = {
  head,
  body,
  documentElement,
  createElement: (tag) => new El(tag),
  querySelectorAll: (sel) => body.querySelectorAll(sel),
}
globalThis.localStorage = {
  store: new Map(),
  getItem(key) { return this.store.has(key) ? this.store.get(key) : null },
  setItem(key, value) { this.store.set(key, String(value)) },
  removeItem(key) { this.store.delete(key) },
}

globalThis.requestAnimationFrame = (fn) => {
  rafQueue.push(fn)
  return rafQueue.length
}
globalThis.cancelAnimationFrame = () => {}
globalThis.MutationObserver = class {
  constructor(cb) { this.cb = cb }
  observe() {}
  disconnect() {}
}

function flushFrames() {
  for (let i = 0; i < 8 && rafQueue.length > 0; i += 1) {
    const batch = rafQueue.splice(0, rafQueue.length)
    for (const fn of batch) fn()
  }
}

/* ------------------------------------------------------------------ */
/* 加载插件                                                            */
/* ------------------------------------------------------------------ */

let captured = null
globalThis.window = {
  localStorage: globalThis.localStorage,
  __ModuleLoader__: {
    load(entry) {
      captured = entry.factory((name) => {
        if (name === 'react') return { createElement: () => null }
        throw new Error(`unexpected require: ${name}`)
      })
    },
  },
}

await import(`file://${PLUGIN.replace(/\\/g, '/')}`)
if (captured === null) throw new Error('client.js 没有调用 window.__ModuleLoader__.load')

/* ------------------------------------------------------------------ */
/* 假 ctx                                                              */
/* ------------------------------------------------------------------ */

function makeStore(initial) {
  let snapshot = initial
  const listeners = new Set()
  return {
    getSnapshot: () => snapshot,
    subscribe: (fn) => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    set(next) {
      snapshot = next
      for (const fn of listeners) fn()
    },
  }
}

const listStore = makeStore({ ids: [], byId: {}, projectionsBySession: {} })
const wsStore = makeStore({ items: [] })

const effects = []
const ctx = {
  sessions: { list: listStore },
  workspaces: { list: wsStore },
  /** 动态包门禁代理上的 optional lookup；桩里没有 locale/slots，走降级分支。 */
  get: () => undefined,
  effect(fn, _label) {
    const dispose = fn()
    if (typeof dispose === 'function') effects.push(dispose)
    return () => {}
  },
}

captured.apply(ctx)

/* ------------------------------------------------------------------ */
/* 造行：模拟官方 ProjectRowItem 的 child 顺序                          */
/* ------------------------------------------------------------------ */

function makeRow(workspaceId) {
  const row = new El('div')
  row.className = 'hIlkoa_projectRow'
  row.dataset.rowKey = `workspace:${workspaceId}`
  row.setAttribute('aria-expanded', 'false')
  row.appendChild(Object.assign(new El('span'), { className: 'hIlkoa_slot hIlkoa_folder' }))
  row.appendChild(Object.assign(new El('span'), { className: 'hIlkoa_slot hIlkoa_chevron' }))
  const text = Object.assign(new El('span'), { className: 'hIlkoa_projectText' })
  text.appendChild(Object.assign(new El('span'), { className: 'hIlkoa_title' }))
  row.appendChild(text)
  row.appendChild(Object.assign(new El('span'), { className: 'hIlkoa_rowActions' }))
  body.appendChild(row)
  return row
}

const rowA = makeRow('ws-a')
const rowB = makeRow('ws-b')
const rowC = makeRow('ws-c')
/** 未归入任何工作区的会话，官方把它们的分组 key 定成空串。 */
const rowLoose = makeRow('')

/* ------------------------------------------------------------------ */
/* 断言                                                                */
/* ------------------------------------------------------------------ */

const failures = []
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failures.push(`${label}\n  期望 ${JSON.stringify(expected)}\n  实际 ${JSON.stringify(actual)}`)
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`)
}

// 场景 1：ws-a 有 1 个在跑，ws-b 有 3 个（含一个只有子代理在跑），ws-c 全空闲，
// 另有一个不属于任何工作区的会话 s9 在跑（官方放在空 key 那一桶）。
//
// s3 是 s5 的子代理：它也在 list.ids 里，但不在任何工作区的 sessionIds 里，
// 且它没有 parentSessionId 字段（真实快照就没有）。它必须靠 subagentCatalog
// 被认出来并排除，否则它会和 s9 一起被数成 2，圆点上出现凭空的数字。
listStore.set({
  ids: ['s1', 's2', 's3', 's4', 's5', 's9'],
  byId: {
    s1: { id: 's1', running: true },
    s2: { id: 's2', running: true },
    s3: { id: 's3', running: true },
    s4: { id: 's4', running: true },
    s5: { id: 's5', running: false },
    s9: { id: 's9', running: true },
  },
  projectionsBySession: {
    // s5 自己没在跑，但挂着的子代理 s3 在跑 —— 这一格就是 runningChildCount 的语义
    s5: { values: { subagentCatalog: [{ id: 's3' }] } },
  },
})
wsStore.set({
  items: [
    { workspaceId: 'ws-a', sessionIds: ['s1'] },
    { workspaceId: 'ws-b', sessionIds: ['s2', 's4', 's5'] },
    { workspaceId: 'ws-c', sessionIds: [] },
  ],
})
flushFrames()

check('ws-a 单会话：圆点显示 1', rowA.querySelector('.dsrwd-dot')?.textContent, '1')
check('ws-b 三会话：圆点显示 3', rowB.querySelector('.dsrwd-dot')?.textContent, '3')
check('ws-c 空闲：无圆点', rowC.querySelector('.dsrwd-dot'), null)
check('未分组桶：只数散落会话，子代理不算（显示 1）', rowLoose.querySelector('.dsrwd-dot')?.textContent, '1')
check(
  '圆点插在 rowActions 之前',
  rowA.children.findIndex((n) => n.classList.contains('dsrwd-dot')) <
    rowA.children.findIndex((n) => n.className.includes('rowActions')),
  true,
)
check('折叠状态（aria-expanded=false）下仍然有圆点', rowB.querySelector('.dsrwd-dot') !== null, true)
check('title 可读', rowB.querySelector('.dsrwd-dot')?.getAttribute('aria-label'), '3 个会话正在进行')

// 场景 2：全部停下来，圆点必须消失。
listStore.set({
  ids: ['s1', 's2'],
  byId: { s1: { id: 's1', running: false }, s2: { id: 's2', running: false } },
  projectionsBySession: {},
})
flushFrames()
check('归零后 ws-a 无残留', body.querySelectorAll('.dsrwd-dot').length, 0)

// 场景 3：数据源缺失时不炸，只是没圆点。
listStore.set({ ids: [], byId: {}, projectionsBySession: {} })
wsStore.set({ items: [] })
flushFrames()
check('空数据不抛错、无圆点', body.querySelectorAll('.dsrwd-dot').length, 0)

/* ------------------------------------------------------------------ */
/* 颜色偏好                                                            */
/* ------------------------------------------------------------------ */

// 颜色变量挂在 :root 上，插件装载时就该写入（否则首帧会闪一下默认色）。
check('默认色写入 --dsrwd-dot-color', rootStyle.get('--dsrwd-dot-color'), '#3f7ff5')

/** 用一份新的 ctx 重装一次，观察它读到的 localStorage 值。 */
function reapplyWithStoredColor(stored) {
  if (stored === null) localStorage.removeItem('dsrwd.color')
  else localStorage.setItem('dsrwd.color', stored)
  rootStyle.delete('--dsrwd-dot-color')
  captured.apply({
    sessions: { list: listStore },
    workspaces: { list: wsStore },
    get: () => undefined,
    effect(fn) {
      const dispose = fn()
      if (typeof dispose === 'function') effects.push(dispose)
      return () => {}
    },
  })
  return rootStyle.get('--dsrwd-dot-color')
}

check('读到已存颜色', reapplyWithStoredColor('#16a34a'), '#16a34a')
check('三位 hex 归一化成六位', reapplyWithStoredColor('#abc'), '#aabbcc')
check('非法值回落默认色', reapplyWithStoredColor('rgb(1,2,3)'), '#3f7ff5')
check('大写 hex 归一化成小写', reapplyWithStoredColor('#EF4444'), '#ef4444')
check('没有存过时用默认色', reapplyWithStoredColor(null), '#3f7ff5')

/* ------------------------------------------------------------------ */
/* 场景 4：卸载清理。                                                   */
/* ------------------------------------------------------------------ */
for (const dispose of effects) dispose()
check('卸载后样式与圆点都被清掉', head.querySelectorAll('style').length + body.querySelectorAll('.dsrwd-dot').length, 0)
check('卸载后颜色变量也被清掉', rootStyle.has('--dsrwd-dot-color'), false)

console.log('')
if (failures.length > 0) {
  console.log(`FAILED ${failures.length}:`)
  for (const line of failures) console.log(' - ' + line)
  process.exit(1)
}
console.log('ALL PASS')
