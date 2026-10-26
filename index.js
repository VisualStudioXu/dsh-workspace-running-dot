/**
 * dsh-workspace-running-dot — Host 半。
 *
 * 这个插件全部工作在浏览器侧，Host 侧只留一张空壳。
 *
 * 为什么还需要一个文件：客户端模块系统是靠扫描 Loader 的行来找 `dsh.client`
 * 声明的（`@deepseek-ai/dsh-client-modules` 的 node half）。没有这条 Loader 行，
 * 包里的 `client.js` 根本不会被送到浏览器，浏览器也就没有这个插件。
 *
 * 为什么必须导出 `apply`：cordis 认一个模块是否为合法插件，看的是
 * 「函数本身 / 有 `apply` 的对象 / 有 `default` 的对象」。只导出 `name` 的对象
 * 会在建 fiber 时就被判为非法插件，激活审计里只会显示一行没头没尾的
 * `failed to import`（踩过）。所以这里留一个空 `apply`。
 *
 * 空壳不注册任何服务、不发任何工具：它没有任何副作用，也就不需要 `ctx.effect`
 * 去回收什么。
 */

export const name = 'workspace-running-dot'

export function apply() {
  // 故意留空：本插件的全部行为都在 client.js 里。
}
