# 普通远程弹道、碰撞与存档

新建战斗采用 `projectileRules: native-projectiles-v1`。弓箭、飞刀、链锤、弩箭在发射事件时创建独立对象，按源更新飞行，在实际经过的预约格查询碰撞后结算伤害。取消新战斗中“发射时立即伤害最初目标”的旧适配。

**本轮验证的是普通投射物创建与局部回调，不代表全局对象调度或整场游戏已一比一。** 旧战中存档继续使用原有立即伤害规则，不回算随机流。

## 原版证据

EXE SHA256：`1098558aaea96ae552753df786a8d3910df08fda11c8219dfa133ca001d8e419`。

PAK SHA256：`4db9aa8d7ecaedc61b2826c63e4e130bffaae0f3c36c0c34b20bc76bb7bc47e6`。

| 地址 | 行为 |
|---|---|
| `0x43D686` | 攻击事件重新查询相邻格；只有相邻格为空且射程大于 1 时发射投射物。相邻友军会挡住此次攻击 |
| `0x4065D1` | 弓兵、链锤、飞刀、弩兵分别映射对象 500、502、501、503；其余兵种返回 0 |
| `0x43D5BF` | 从射手事件定点位置取整数部分，沿朝向偏移 30，纵向加 2、高度加 48；设置射手记录指针，以速度 12 发射 |
| `0x4217FE` | 创建对象及初始 WAIT 节点；初始 WAIT 不经过动作选择器的随机帧延长 |
| `0x4224C1` | 用原近似 π `3.1415926` 将角度/速度转换为 16.16 定点速度，向零取整 |
| `0x43E28B` 消息 2 | 先调用通用对象推进，再将当前位置映射到 96×72 格。忽略发射者自己；友军触发偏转，敌军调用命中函数 |
| `0x43D862` | 在碰撞时执行 `0x43D400` 命中抽签，并在返回前向受击者发送命中/格挡消息 |
| `0x43E28B` 消息 65539 | 命中后速度改 1，淡出 8 次；格挡/友军拦截后随机偏转、恢复重力、选择 DEATH，淡出 24 次 |
| `0x422AB1` | 运动、重力、动画、2400 次寿命递减；本对象重力每次为 81920，不能复用尸体的 20480 |

格挡分支依次消耗 `below(96)`、`below(3)`、`below(0x40000)`、`below(5)`、`below(6)`：朝向、平面速度、垂直速度、带 `OF_NONSYNCHRONISM` 的 DEATH 首帧延长、立即跳过的帧数。最后一次若跳帧，会覆盖首帧延长后的计数。双方朝向均保留原整数截断产生的微小纵向速度。

投射物没有持续追踪最初目标，也不在抵达原目标位置后自动消失；目标离开后可能经过空格、撞上另一单位，或继续飞到寿命结束。友军阻挡只消耗偏转随机数，不进行敌方命中抽签。射手死亡不撤销已发射的箭。

## 机器码轨迹与素材

`../web-port-research/tools/native_projectile_oracle.py` 从原 PAK 读取四类 WAIT/DEATH 的时长，构造对应 TYPE_FORCE 资源与占格，执行原创建函数、投射物回调、通用运动、动作选择、命中抽签和随机函数。GetTickCount 只提供固定零时间戳；目标端用记录通知的空回调观察 65540/65546，**不以此声称执行过完整目标受击/死亡链**。伤害及死亡函数另有前轮机器码对照。

生成 **240 组轨迹、3,621 次源推进**，覆盖四类投射物、双向发射、命中/偏转、空格/自身/友军/敌军、主将与普通目标、现役/预备射手、目标移动状态、不同战力和寿命到期。每一步核对位置、速度、重力标记、对象类型、动作帧及剩余时间、寿命、淡出、释放状态、命中消息和完整双字 RNG。证据位于 `../web-port-research/evidence/ai/native-projectile-vectors.json`，核心 `fixtures` 保留副本。

转换器新增 500–503 对象和 43 张源帧，资源总计 **231 个对象、5,789 张源帧**。投射物 WAIT/DEATH 使用完整循环时长，不受旧转换器 128 上限影响；渲染直接读取保存的帧号。弓箭和弩箭单帧 WAIT 为 9999；飞刀为 12；链锤是 8 帧、每帧 4；四种 DEATH 均 8 帧、每帧 2。碰撞后的随机跳帧由模拟决定，绘制不消耗随机数。

## Web 接入与兼容

- `native-projectile.ts`：独立的原函数转写；动画、位移和随机顺序有原轨迹测试。
- `battle-projectiles.ts`：按实际预约格查询活单位，调用已有伤害/死亡逻辑，再继续偏转抽签；保存所有飞行状态、源更新年龄和射手引用。
- `battle-unit-scheduler.ts`：每次单位源更新后按创建顺序推进投射物，包括当次新发射对象。发射不要求原目标仍活着，碰撞重新取当前格单位。
- `BattleView.tsx`：加载四类真实图集，按源帧、位置、高度、淡出绘制；暂停和刷新都不重建飞行路径。
- 死亡射手仍有投射物时保留其逻辑记录，尸体按既有期限停止绘制；最后一枚投射物消失后清理记录。避免长途飞行箭失去来源，导致存档失效或碰撞时崩溃。
- 旧快照没有 `projectileRules` 时继续旧箭矢效果、立即伤害和随机顺序。通过现有选将流程重建下一阵时使用新规则。
- 校验拒绝无效来源、重复 ID、非法定点数、失配寿命、损坏帧/计数、丢失投射物列表和不兼容规则版本。

## 验证

本轮新增 250 项：240 组机器码逐步对照、兵种映射、9 项 Web 集成与资产测试。集成包括延迟伤害、目标换行、另一个目标接箭、友军拦截、不重复命中、射手死亡与尸体消失后的来源生命周期、飞行/偏转中 JSON 重放、旧规则以及损坏存档。

完整浏览器回归 32 场景通过，新增战役中飞行投射物保存、刷新恢复、继续飞行；桌面/手机满编战斗验证真实投射物出现，暂停时数量和年龄不变。截图 `screenshots/native-projectiles-restored.png`、`screenshots/native-troops-combat-1440.png`、`screenshots/native-troops-combat-390.png` 已检查。

最终核心全量、类型检查、构建和生命周期修复后的浏览器复验结果见 README 最新记录。

## 仍未对齐

1. 全局混合对象链表没有完整移植。当前“单位→投射物”按次序推进；AI、军师恢复、集气、尸体与脱离坐骑仍有外层成组更新。不能声称整场 RNG 顺序已经一致。
2. 原目标端格挡/受伤消息及全部非攻击动作尚未接齐；本轮飞行状态和偏转 RNG 对齐不能覆盖这些额外状态转移。
3. 原屏幕坐标、透视和所有朝向绘制尚未整体校准；当前沿用 Web 画布投影及可读性偏移，投射物精灵的屏幕缩放仍是适配。
4. 武将技投射物是其他回调，不属于这四种普通兵种投射物。完整技能、主将速度/装备以及战略层缺项仍需继续。

本轮检索 Modern Web Guidance 的 Canvas 动画/帧计时，没有适用原机器码弹道语义的条目；浏览器验证沿用 Playwright Expert 的页面对象与自动等待。

## 2026-11-18 Healing visual parity

The verified Magic1 -> Heal -> CreateHolyLight -> IncreaseHP path now has a Canvas holy-light layer. Its pulse, rays, and brightness remain driven by the saved ctiveScript cursor, so pause, save, and restore cannot advance the effect independently of the point-by-point HP writes.

The canvas exposes data-magic-script-kind, data-magic-script-phase, and data-magic-script-age for replay diagnostics and browser regression checks. For healing, the phase is heal and the age is the number of completed HP writes from the verified IncreaseHP loop.

Magic2 keeps its verified windup/flight/impact projectile presentation. Other skill sequences remain unavailable until their native execution semantics are proven; no unverified damage or animation is synthesized.
