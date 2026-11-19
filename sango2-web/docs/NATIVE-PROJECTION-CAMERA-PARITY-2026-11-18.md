# 原版透视、镜头与战场显示对照（2026-11-18）

本轮修正了一个会直接破坏战斗观感的问题：Web 旧显示坐标会在逻辑格之外保留排兵偏移，单位避让也只移动画面坐标，导致两个逻辑相邻单位在画面上相隔很远。新战斗的显示快照现在从原 71×14 格的固定点坐标生成；移动、攻击、死亡飞行、脱离坐骑、投射物、技能效果和小地图都读取同一份坐标。

## 原码证据

基准 EXE SHA256：`1098558aaea96ae552753df786a8d3910df08fda11c8219dfa133ca001d8e419`。

| 地址 | Web 对照 |
|---|---|
| `0x441C9A` | 生成 4096 项 `screenYTable` 与 `scaleTable`，使用原 620 焦距、238 地面高度、baseY 8、horizon -192 |
| `0x43A562` | 16.16 世界坐标投影；乘法先按 x86 `IMUL` 截断，再算术右移；深度超出 4096 返回不可见 |
| `0x441E07` | 镜头 `x=240..6560`、`y=0..800` 限制 |
| `0x43FF4E` | 绘制深度键、对象 `OF_BIGSHAPE` 的 `48384/65536` 缩放，以及源图朝向 |
| `0x4419A0` | 景色层按 `(cameraX+256)*(W-640)/7072` 裁切 |
| `0x44068B` | 小地图使用原 71×14 占格、纵轴翻转和镜头框 |
| `0x441E61` | 方向键、边缘移动、肖像定位、小地图定位；视图操作不写模拟 RNG |

## 生成证据

`web-port-research/tools/native_projection_oracle.py` 在 Unicorn 中执行原函数并生成 `packages/core/fixtures/native-projection-vectors.json`：

- 4096 项投影表；978 个世界点；45 个镜头边界样本；560 个原对象绘制提交样本。
- 核心测试 `native-projection.test.ts` 逐项验证投影表、世界点、镜头限制、深度和对象缩放。
- PAK 对象 `OF_BIGSHAPE` 已写入战场图集的 `nativeScale`；普通旗帜保持 65536。

## 用户可见行为

- 新战斗进入原版 640×344 视口语义；宽屏使用局部镜头，远景和近景是可见的 Web 辅助模式。
- `我军主将`、`敌军主将`、`交锋前线`可定位；拖动战场或聚焦后用方向键平移，Home 返回我军。小地图点击定位，黄色框表示镜头范围。
- 矮屏下镜头按钮进入标题栏，军令和 HUD 保持可点击；布局使用 `100dvh`、`@container` 与 `aspect-ratio`。
- 画布暴露 `data-projection`、`data-camera-x/y`、`data-camera-zoom`，便于存档回放和视觉回归检查。
- 地面扫描带按镜头纵坐标缓存；相机横向移动只更新纹理采样起点，避免每帧重复生成 4096 项投影表。

## 当前边界

地面已经按原投影表生成扫描带，近处纹理放大、远处压缩；底层 `0x46BE10` 的完整扫描线纹理状态和所有图层混合仍待逐帧核验。全局对象链的逐对象绘制时序、技能脚本的原始投影坐标、特殊城池图层仍待逐帧核验。不能把本轮函数样本一致表述为整局 SAV 一比一。

## 验证

- 核心：31 个文件、11,194 项通过。
- Chromium：本轮镜头/满编战场 3 项通过；全屏、矮屏、地图、AI、存档和地形回归共 38 项通过。
- `pnpm typecheck` 与 `pnpm build` 通过；服务仍固定 `http://127.0.0.1:25369/`。

### Effect anchor parity

Modern effects preserve optional sourceId and targetId ownership. Native rendering resolves those IDs through battleScenePoints before projection, so camera movement and crowded formations keep impact flashes and arrows attached to the original actor anchors. General horse, body, and weapon objects also use their own atlas nativeScale values while sharing one foot anchor.
