# 虎咆系武将技：ExplodeRound 与点碰撞

2026-11-20。虎咆、虎咆震、虎咆陽炎对应 `SCRIPT_MAGIC.SO` 的 `ExplodeRound` 主入口：

| sequence | 修正版技能名 | script / wrapper | 请求数 | 半径参数 |
| ---: | --- | ---: | ---: | ---: |
| 7 | 虎咆 | 508 / Magic8 | 18 | 160 |
| 16 | 虎咆震 | 519 / Magic19 | 32 | 240 |
| 23 | 虎咆陽炎 | 531 / Magic31 | 48 | 380 |

当前 Web 接入了主协程、点碰撞、回调 VM、主将伤害和战场对象生命周期。它们不会把一次技能改写成“全军随机扣血”：原版创建多个 `18003` 点碰撞对象，逐源更新查找当前占格，再按对象 flags、目标阵营和高度决定命中。

## 已确认的执行边界

主脚本先经过暗场和镜头阶段，随后创建 `18002` 中央对象，再由 `ProduceRound` 创建 `18003` 点碰撞对象。每个碰撞对象追加 `CreateExplodeRound` 子协程并创建 `18004` 火花/爆炸对象。对象生命期来自原对象更新：`18003` 到第 28 帧结束，`18004` 到第 18 帧结束；`18002` 由其自己的淡出和循环状态结束。

`host 44` 设置回调 `8001`，`host 41` 写入敌将与敌兵碰撞 flags `0x3000000`。普通源更新在 `0x40A8CC` 中先执行对象移动、帧和高度门槛，再查询一个当前占格目标。高度达到 `96` 个世界单位、对象 action 为 `32`、目标不存在或 flags 不匹配时不会触发目标事件。有效命中先产生士兵 `65539` 或主将 `65540`，之后才进入 `ExplodeRoundCallback`。

回调对主将使用 `Hurt`，直接伤害为 `trunc(ATTACK / hitDivisor)`，初始除数为 1；每次算出正伤害后除数乘 2。`Hurt` 的来源参数为空，所以不叠加普通攻击的来源等级倍率、不抽普通攻击伤害随机数，也不扣技力。施法锁会保护 HP，但不会阻止回调推进除数和清除当前碰撞对象的主将 flags。

士兵命中先走通用死亡事件，再播放 `Hit01`。`LockTargetTime2` 和 `FireMan` 是附着效果，不是第二次伤害：它们创建 `10016`，按目标坐标跟随最多 60 次源更新；目标为存活主将时 `LockTargetTime2` 使用高度偏移 40，其他情况为 0。`host 49` 只写对象模式字段，透明度仍由 `host 39` 写入。

## 原码与 Web 差分样本

本轮新增的 [native_magic_round_host_oracle.py](../../web-port-research/tools/native_magic_round_host_oracle.py) 生成 408 项宿主样本：

- 102 项 `host 21` 固定点附着，覆盖两种起始小数、17 个方向和三种距离；
- 180 项点碰撞，覆盖五组 flags、兵/将、友/敌、0/95/96 高度、action 32 和空占格；
- 126 项原 `0x43ED96` 主将伤害，覆盖 HP、伤害、施法锁和 charge 边界。

[native-magic-round-host.test.ts](../packages/core/src/native-magic-round-host.test.ts) 直接调用 Web 实际的 `nativeExplodeAttach`、`battleExplodeCollision` 和 `nativeMagicDirectHit`，408 项全部通过。主协程 VM 有36组完整轨迹，回调、`LockTargetTime2` 和 `FireMan` 子树另有64组事件对照；`native-magic-explode.test.ts` 共101项专项通过。graphics、音频和整场混合对象列表仍是替代边界。

## 仍待完成

- `18002/18003/18004/10016` 的原图帧、调色板、遮挡和混合模式还需要同状态原客户端截图逐像素验收。
- `m008snd01` 和回调音效已从脚本事件取证，实际音频播放、并发和停止时序仍待接入。
- 主脚本、点碰撞对象、火花、尸体、投射物和普通单位的全局对象遍历仍缺一份连续原客户端回放。
- 三个技能已脱离通用暂定伤害执行器，但不代表 110 个武将技或整场战斗已经完成一比一复刻。

复现原码样本：在 `web-port-research` 运行 `.venv-ai/Scripts/python.exe tools/native_magic_round_host_oracle.py`；原 EXE/SO 需准备在本地，仓库只保存工具与 fixture。
