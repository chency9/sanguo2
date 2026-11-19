# 三国群英传 II · Web 开发说明

项目介绍、实机截图、快速开始与复刻进度见 [仓库首页](../README.md)。当前为 v0.4 开发版，整体尚未达到原版一比一验收标准。[全系统漏项总账](docs/FULL-PARITY-BACKLOG.md)与[原内容逐条核对表](docs/PARITY-CONTENT-INVENTORY.md)是后续开发和验收入口。

## 本地运行

要求 Node.js ≥ 22.22、pnpm 11.13.0、Python ≥ 3.12。以下命令在本目录执行：

```powershell
corepack enable
corepack prepare pnpm@11.13.0 --activate
pnpm install --frozen-lockfile
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r tools/requirements.txt
.\.venv\Scripts\python.exe tools/convert_assets.py --game 'D:\Games\三国群英传2 修正版 1.05+'
pnpm dev
```

`--game` 指向包含 `Sango2.PAK` 和原包 MP3 的 1.05+ 游戏目录。资源版本指纹与故障说明见 [首页](../README.md#开始体验)。转换结果在 `apps/game/public/assets/`，由 Git 忽略；转换器不会运行游戏 EXE。

打开 [http://127.0.0.1:25369/](http://127.0.0.1:25369/)。开发与预览端口固定，端口占用时报错。浏览器直接运行模拟和本地存档，无需后端或 API Key。

## 常用命令

| 命令 | 用途 |
| --- | --- |
| `pnpm dev` | 启动开发服务器 |
| `pnpm typecheck` | TypeScript 类型检查 |
| `pnpm test` | Vitest 内核、内容与资源测试 |
| `pnpm exec playwright install chromium` | 安装 E2E 浏览器 |
| `pnpm test:e2e` | Chromium 全量浏览器场景 |
| `pnpm build` | 类型检查及生产构建，输出 `apps/game/dist/` |
| `pnpm preview` | 在 25369 端口预览生产构建 |
| `.\.venv\Scripts\python.exe -m unittest discover -s tools -p 'test_*.py'` | Python 人物与转换规则测试 |

全量测试和构建前需要生成本地资源；部分测试直接核对生成图集。当前仅支持站点根路径部署。开发服务器默认监听 `127.0.0.1`。

## 模块入口

- `apps/game/src/WorldMap.tsx`：PixiJS 地图、城池归属与输入。
- `apps/game/src/BattleView.tsx`：Canvas 战场、素材解码、军令和显示时钟。
- `apps/game/src/BattleCamera.tsx`：镜头拖动、定位与视距。
- `apps/game/src/classic.css`：原素材主题与全屏战斗布局。
- `apps/game/src/PolicyScreen.tsx`：年度内政、开发/搜索、城池自治、库存、太守、配兵与报告。
- `packages/core/src/native-policy.ts`：原开发和税收规则、内政阶段与行动记录。
- `packages/core/src/native-policy-search.ts`：搜索、物品权重、登用/经验和自治原函数内核。
- `packages/core/src/native-policy-actions.ts`：搜索落城、库存、报告、自治执行与名单适配。
- `packages/core/src/native-progression.ts`：运行等级、归附逐级成长与体技力上限。
- `packages/core/src/index.ts`：战役命令、存档迁移与校验。
- `packages/core/src/battle.ts`：固定步长战斗与轮战接入。
- `packages/core/src/native-*.ts`：原版规则纯函数。
- `packages/core/src/battle-native-magic.ts`：四种 ShootObject 技能的实战适配。
- `packages/core/src/native-magic-camera.ts`：原脚本锁定与返回镜头的整数轨迹。
- `packages/core/src/native-general-tick.ts`：主将逐源集气、撤退与军师恢复。
- `packages/core/fixtures/`：原机器码和 SO 脚本的对照样本。
- `tools/convert_assets.py`：资源转换；Python 依赖见 `tools/requirements.txt`。

`dispatch` 不改变输入状态；`tickBattle` 修改调用者持有的战斗快照。渲染和镜头不修改模拟状态、不抽取战斗随机数。新规则使用可选版本标记，旧 Web 存档保留原有执行路径。

## 本轮验证与证据

2026-11-19：41 个测试文件、13,382 项核心测试、51 个 Chromium 场景、5 项 Python 测试通过；类型检查与生产构建通过。本次新增780组搜索/登用/成长/自治原x86样本；前序有240组开发/税收原机器码样本；前序有72组Heal脚本树原解释器样本，共28,224次源更新；前序装备速度测试包含 698 组原码样本。

- [搜索、登用、库存与四种自治：780组原x86样本](docs/NATIVE-POLICY-SEARCH-PARITY-2026-11-19.md)
- [年度内政规则、240组原码样本与未完成范围](docs/NATIVE-POLICY-PARITY-2026-11-19.md)
- [四种飞行武将技：规则、原码对照与限制](docs/NATIVE-MAGIC-SHOOT-PARITY-2026-11-19.md)
- [主将源更新、装备速度、技能镜头](docs/NATIVE-GENERAL-CAMERA-PARITY-2026-11-19.md)
- [命疗术、回天术的 Heal 全部子协程与原光效](docs/NATIVE-HEAL-PARITY-2026-11-19.md)
- [当前全范围差距](docs/PARITY-STATUS-2026-11-19.md) · [110 技能逐项清单](docs/MAGIC-COVERAGE-2026-11-19.md)
- [原版 AI 的已验证范围及全局差距](docs/NATIVE-AI-PARITY-2026-11-17.md)
- [战场渲染与存档边界](docs/BATTLE-RENDER-AUDIT-2026-11-19.md)
- [命令原始日志](docs/evidence/commands/)
- [历次开发记录](DEVELOPMENT-HISTORY.md)（含历史规则和历史测试数量，以最新专项文档为准）

重新生成原码证据还需准备本地 EXE / SO 及分析产物；工具位于 [web-port-research/tools](../web-port-research/tools/)，依赖见其 `requirements.txt`。提交的 fixture 可独立用于相应纯函数差分测试，不代表全量测试无需游戏素材。

存档有三个槽位与 JSON 导入导出，目前没有自动保存。原版 SAV 不支持。素材与工具来源见 [NOTICE](tools/NOTICE.md)；完整复刻尚待实现的内容见 [首页进度表](../README.md#复刻进度)。
