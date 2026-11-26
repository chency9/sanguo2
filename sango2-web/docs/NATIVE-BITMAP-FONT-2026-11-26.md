# 原版中文字库与 ASCII 字体

转换器现从原游戏包导出两套中文及西文字体，用于逐步恢复原菜单与战场文字。字体没有重新绘字：中文直接使用 `SANGO.IDX` 对应的原二值字形；西文直接使用 `MINGASC.20` 和 `OLDASC.15`。

## 来源与索引证据

原程序 SHA-256 为 `1098558aaea96ae552753df786a8d3910df08fda11c8219dfa133ca001d8e419`，原 PAK SHA-256 为 `4db9aa8d7ecaedc61b2826c63e4e130bffaae0f3c36c0c34b20bc76bb7bc47e6`。

`0x46CB50` 按 Big5 字节得到 `157 × (首字节 − 129) + (尾字节 > 126 ? 尾字节 − 98 : 尾字节 − 64)`。`0x46CB80` 读取 `SANGO.IDX` 该位置的 little-endian unsigned16 值，作为原中文绘制字形序号；阴影先在 `(x+1,y+1)` 绘制，再在原位置绘正文。`0x46CC10` 直接用 ASCII 码作西文字形序号，空格不绘图。

`web-port-research/tools/native_bitmap_font_oracle.py` 在哈希固定的原 x86 上执行这三个函数，只替换 `0x45831B` 输出函数以记录字形序号、坐标、描述对象、颜色与阴影。夹具 `native-bitmap-font-vectors.json` 保存 180 个中文样本、95 个 ASCII 样本及原 IDX 哈希。这证明索引和绘制参数，不等同于原客户端完整帧截图。

| 源文件 | 字形存储 | Web family / 原字号 | 原进位宽度 |
|---|---|---|---|
| `SANGO.20` + `MINGASC.20` | 中文 20×20，stride3；ASCII 10×20，stride2；MSB first | `Sango2 Original 20` / 20px | 中文20、西文10 |
| `SANGO.15` + `OLDASC.15` | 中文 16×15，stride2；ASCII 8×15，stride1；MSB first | `Sango2 Original 15` / 15px | 中文16、西文8 |

每套导出 13,835 个字形、13,834 个 Unicode 映射。Unicode 使用可回编码到相同字节的 CP950 映射，未将简体字或缺字擅自替换成另一原字。

## 两种输出的区别

`assets/fonts/sango2-20.woff2` 与 `sango2-15.woff2` 用原像素横向连续段生成矩形 TrueType 轮廓，原字号下字宽准确。浏览器和系统仍会对轮廓应用平滑；本机 Chromium 的逐像素比较确实有边缘 alpha 差异。因此，WOFF2 恢复原字形与字宽，但不宣称浏览器输出每个 alpha 与原版一致。

同目录 PNG atlas 与 JSON 映射直接保留二值像素。`native-bitmap-font.ts` 的 `loadNativeBitmapFont(15 | 20)` 和 `drawNativeBitmapText(...)` 用于 Canvas 原图文字；整数位置与整数倍缩放时关闭图像平滑。颜色通过原 alpha 着色，缺字返回 `null`，由调用者保留可读 fallback。此路径通过浏览器严格逐像素比较。

转换器与独立 `tools/native_bitmap_font.py` 均验证原包哈希。所有字体图片、WOFF2、Unicode 映射和样本矩阵保留在 Git 忽略的原资源目录，提交的是转换程序与验证方法。

## 验证与应用边界

Python 3 项测试覆盖 275 条原机器码索引/绘制样本、MSB/stride 解码及矩形轮廓坐标。Chromium 4 项测试检查两种尺寸共 44 个原中西文字形的 atlas alpha 零差、WOFF2 原进位宽度、Canvas 着色零差、真实战场将名、HUD 姓名、延迟字体不阻塞开战与缺字 fallback；测试报告另行记录 WOFF2 平滑产生的差异。TypeScript 检查通过。

战场头顶将名与 HUD 姓名已接原 bitmap atlas。HUD 姓名按 `0x441134` 选择 font4、两字名插入两个 ASCII 空格、4字名保留原起点；白色正文与 RGB565 `0x7394` 阴影在字库 Canvas 绘制，真实文字继续保留给辅助技术。字体异步失败或缺字均回退，开战不等待字体。

人工核查截图见 [接入前](screenshots/native-font-before.png) 与 [接入后](screenshots/native-font-after.png)。这两张是同一演武初始状态的 Web 截图，用来展示此次字体变化，不是原客户端基准。未全站替换。其余原菜单字号、文字基线、阴影色及窗口布局仍需按实际原客户端各状态逐项对照；任意字号或非整数缩放不能算原像素验收通过。
