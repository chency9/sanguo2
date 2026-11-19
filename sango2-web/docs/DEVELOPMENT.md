# 2026-11-16 开发记录

此页保留 v0.1 的历史记录。当前 v0.2 已加入滚轮缩放、原版材质界面与实时战场，最新状态见 [v0.2 开发记录](V02.md)。下文的简化结算、测试数量与未实现项仅描述当时版本。

## 本次交付边界

用户要求安装 GoogleChrome/modern-web-guidance，并开始开发。已用 skill-installer 从官方仓库 `skills/modern-web-guidance` 安装到 `C:/Users/chency/.codex/skills/modern-web-guidance`。既有版本先备份到 `C:/Users/chency/.codex/skill-backups/20261116-sanguo2-modern-web-guidance`；官方 SKILL.md 与原版本 SHA256 一致：`37D68A514C25066840299356E5857B750BEC3CC27C0CF57DBE88369B051B573E`。无需为获取同版再次覆盖；后续会话会自动加载，本次已主动读取使用。

工程位于独立的 `sango2-web`。没有修改原游戏、没有执行 EXE 或修改器，也没有修改 `sango2-english-patch` 的实现。前期研究与方案仍作为完整复刻目标，本次先交付可玩的战略原型。

## 已采用的 Modern Web Guidance

先执行 search `confirmation modal dialog`、`responsive canvas resize`，再 retrieve `dialog,responsive-design,accessibility`，阅读全文后实施。版本参数：`2026_11_09-5bcc021b`。

- **dialog**：原生 `<dialog>` + `showModal()`，依赖浏览器 Escape、焦点归还与外部 inert；样式没有无条件设置 dialog 的 display。原文：**“DON'T set `display` on `dialog` unconditionally.”** 同时采用 `dialog:modal` / `::backdrop` 的 overscroll 限制，没有设置 body 的 overflow 锁。
- **responsive-design**：视口高度与对话框上限使用 dvh，图片设置 width/height 与 aspect-ratio，手机布局改为纵向，地图可缩放并提供 DOM 城市列表。原文：**“Use dynamic viewport units”**。
- **accessibility**：按钮、表单控件、表格标题和表头均用原生语义，Canvas 标记 aria-hidden 并以可操作的城池列表提供同等入口；状态提示不播报每次时钟推进。原文：**“Prefer HTML elements and attributes to ARIA”**。

## 实现决策

1. 内容包固定指纹，原始数据与战役运行状态分离；技能数据保留但不假定已恢复技能逻辑。
2. 核心命令不依赖 React / Pixi / DOM；按日推进，种子随机数写入存档。
3. 地图延迟加载，静态时停止渲染循环；ResizeObserver 处理画布尺寸变化，像素比上限 2。
4. 桌面先围绕地图、势力、城池命令布局；手机保留同样的命令和存档能力。
5. IndexedDB 三槽位保存，revision 防止不同标签页静默覆盖；导入先完整验证再替换。
6. 不引入账号、云服务、PWA 更新机制；先完成单机的内容、状态与玩法边界。

## 实测证据

| 项目 | 结果 |
|---|---|
| 核心行为与无效存档 | 16 / 16 通过 |
| 浏览器玩家流程 | 4 / 4 通过，Chromium 159 |
| 类型检查 | 通过 |
| Vite 生产构建 | 通过，无大块警告；主入口约 255 KB / gzip 81 KB，地图主块约 270 KB / gzip 79 KB |
| 地图与 UI 截图 | 1440×1000、390×844 已查看；见 screenshots |
| 新页面存档恢复 | 读取 IndexedDB 后可继续占城后的战役 |
| 重复标签页 | 第二页在旧 revision 上写入被拒绝 |
| Tabbit | 接口新建页面失败；未把此通道报告为验证成功 |

资源文件 11.96 MB 是本次导出的本地目录大小，不是完整游戏资源体积；构建块大小也不是完整首屏网络流量。尚未测量战斗压力、真实设备内存和完整游戏帧率。

## 下一阶段执行清单

### A. 真实战场切片

- 从研究目录的 SHP/组合物件资料建立纹理图集、人物身体/武器/坐骑合成，按原始帧的偏移校准锚点。
- 先接入一个地形、两名武将与两种兵，验证静止、移动、近远程攻击、受击、死亡。
- 把模拟固定步长与渲染分开，记录动画命中事件，避免依显示刷新率结算伤害。
- 选一个普通伤害技能、一个持续技能，对照原程序的耗蓝、命中次数、结束时机；不能用当前简化公式推导原版技能。
- 战役进入战场后暂停战略时间，由战斗结果命令完成一次性结算，保留战前状态便于复现。

### B. 行为与 AI 基准

- 建立原程序的可重复场景，核对人口/金钱周期、招募、部队上限、特殊关隘、SELECT 的真正语义。
- 将原型规则整理为可替换规则集；有证据后逐项替换，升级 ruleset 与存档版本。
- 敌方 AI 只能发出与玩家相同的合法命令，先做到一次完整决策，再校准行为，不能直接修改城市归属。
- 补入武将成长、物品、俘虏与最后城池失守的真实规则，建立统一/失败条件。

### C. 完整发布门槛

- 按研究方案验收矩阵逐项补齐。原生存档兼容、离线缓存和云服务属于后续独立范围。
- 浏览器矩阵加入 Firefox/Safari，验证触摸拖动、缩放、音频拒绝、图形上下文丢失与恢复。
- 添加长局模拟与完整战斗压力场景，再给出性能预算达成结论。
