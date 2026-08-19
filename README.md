# dsh-agent-registry · Claw Agent 登记

治理套件的 **Phase 0**：把 DSH 工作区绑到一个稳定的 Claw Agent 上。只登记、解释、归档，**不拦截工具**。

合集与整体说明：https://github.com/xingyingyuzhui/dsh-claw-suite

打开 **设置 → Claw Agent**（在 **Agent 预设** 上方）：选 Agent，再用概览 / 人设 / 模型 / 权限 / 技能看各面。Main 不在这一页。

Claw Agent 按 **名字 → 名下会话** 组织。工作区默认建在 DeepSeek Harness 根目录（`$DSH_HOME`，一般是 `~/.dsh`）下的 `DSclaw/<agent>/`。

## 安装

```sh
dsh plugin --profile web add github:xingyingyuzhui/dsh-agent-registry
```

装完重启 `dsh web`。

本地开发：

```sh
dsh plugin --profile web add link:/abs/path/to/dsh-agent-registry
```

## 这一层做什么

- 只有在 Claw区显式创建的 Agent 才会出现在 Claw区；普通项目工作区留在「工作区」
- 每个 Claw Agent：管理名（文件夹）→ 名下会话；目录在 `~/.dsh/DSclaw/<slug>/`。它自己叫什么写在 `IDENTITY.md`，第一次对话按 `BOOTSTRAP.md` 问用户，不问就把文件夹名当成自称
- 左侧会话区标题是两个按钮：**工作区** / **Claw区**，用来切换分区
- 创建时从用户预设模板 `wa-template`（显示名 **claw区agent模板**）复制出 `wa-<slug>` 并绑定；新会话直接带上这个预设
- 人设注入需要另装 `dsh-agent-identity`
- Main 里四个官方预设照旧切换；Claw 会话只能跑自己的 `wa-*` 预设，不能再切模式
- Claw 预设不会出现在官方「Agent 预设」的「当前使用」里
- Claw Agent 的权限各面在本页的「权限」tab 可单独改并保存（仍不强制）
- 「模型」tab 给这个 Agent 记下默认模型；**新建** Claw 会话时用官方 `session.selectModel` 写一次。换模型仍走官方选择器。不拦截 `currentSelection`，不另挂预设
- 新绑定默认套用 **research** 只读声明，`enforced: false`
- 删除 = 归档绑定，不删项目目录、不删会话日志
- 绑定写在 `~/.dsh/workspace-agents/registry.json`
- 设置 → Claw Agent → 概览可选择卸掉本插件后：归档（默认）/ 转到官方工作区 / 删掉会话日志。卸载时按这个处理官方名单，避免 Claw 会话全挤进「工作区」。

卸掉本插件后，DSH 原来的权限预设照旧，不会变成全开。真正按策略拒绝，要等套件里的 `dsh-agent-gate`。

## 卸载

先在 **设置 → Claw Agent → 概览** 选好「卸掉本插件后」，再：

```sh
dsh plugin --profile web remove dsh-agent-registry
```

然后重启 `dsh web`。默认 **归档**：从官方「工作区」名单拿掉这些 Claw 行，会话日志和人设留在盘上。「转到工作区」会把它们留在官方名单里；「删掉会话记录」还会删会话日志，人设目录仍保留。

## 开发

```sh
npm test
```

## 治理套件

| 插件 | 安装 |
|---|---|
| 登记 | `dsh plugin --profile web add github:xingyingyuzhui/dsh-agent-registry` |
| 人设 | `dsh plugin --profile web add github:xingyingyuzhui/dsh-agent-identity` |
| 策略契约 | `dsh plugin --profile web add github:xingyingyuzhui/dsh-agent-policy` |
| 会话权限 | `dsh plugin --profile web add github:xingyingyuzhui/dsh-session-permissions` |
| 闸与审计 | `dsh plugin --profile web add github:xingyingyuzhui/dsh-agent-gate` |
| 委派 | `dsh plugin --profile web add github:xingyingyuzhui/dsh-agent-delegate` |
| 记忆 | `dsh plugin --profile web add github:xingyingyuzhui/dsh-agent-memory` |

## License

MIT
