"""List every native content record for the full-parity audit; no completion %.

Requires the locally converted, hash-validated original content.json. Effect
support is read from the actual current dispatcher, never inferred from names.
"""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main():
    content = json.loads((ROOT/'apps/game/public/assets/content.json').read_text(encoding='utf-8'))
    assert content['sourceHash'] == '4db9aa8d7ecaedc61b2826c63e4e130bffaae0f3c36c0c34b20bc76bb7bc47e6'
    source = (ROOT/'packages/core/src/native-strategy-effects.ts').read_text(encoding='utf-8')
    supported = {int(x) for x in re.search(r'SUPPORTED_STRATEGY_EXECUTES=\[([^\]]+)\]', source)[1].split(',')}
    lines = ['# 原版内容逐条核对表', '', '生成于2026-11-19；原包SHA-256：`'+content['sourceHash']+'`。', '',
             '本表列全原配置记录，不能把“已导入”当成“已复刻”。总功能与界面遗漏见[一比一复刻总账](FULL-PARITY-BACKLOG.md)。运行 `python tools/audit_parity_inventory.py` 可按本地已转换内容重新生成。', '',
             '## 武将技：110项', '', '[110项名称、SCRIPT、共用入口、实际差距](MAGIC-COVERAGE-2026-11-19.md)逐条维护。4个飞射、2个治疗已接部分原脚本，104个仍是通用替代；全部均未完成完整一比一验收。', '',
             '## 军师技：67条等级记录', '',
             '下表按原SEQUENCE列出；同名不同级也必须分别验收。“入口部分已接”仅表示当前效果分派包含其EXECUTE，不证明冲突、作用对象、生命周期、音画或战役结算完整。数字0的化解也不能当成无须实现。', '',
             '| SEQUENCE | 名称 / 级 | EXECUTE | 当前效果入口 | 仍需完成 |', '| --- | --- | --- | --- | --- |']
    for record in content['strategies']:
        execute = int(record['EXECUTE'])
        status = '入口部分已接' if execute in supported else '效果未接'
        lines.append(f"| {record['SEQUENCE']} | {record['NAME']} / {record['WISELEVEL']} | {execute} | {status} | STR-01～04：逐级、成败、化解/冲突、对象、跨轮与结算；MAGIC.INI:{record['_line']} |")
    lines += ['', '## 物品：77项', '',
              '全部物品目前仍缺完整主动搜索、库存、分配/使用流程。已有初始装备外观及装备速度派生，不作为该物品玩法完成。RATE是原权重字段，不是已验收的掉落百分比。原效果字段保持原词，空值略去。', '',
              '| SEQUENCE | 名称 | 类别 | 等级 / RATE | 原效果字段 | 仍需完成 |', '| --- | --- | --- | --- | --- | --- |']
    keys = ['STR','INT','MAXHP','MAXMP','FORCE','BATTLE','SKILL','SPEED','HP','MP','SPIRIT','LOYAL','TIRE']
    for record in content['items']:
        effects = '；'.join(f'{k}={record[k]}' for k in keys if record.get(k)) or '按原属性/类型处理'
        lines.append(f"| {record['SEQUENCE']} | {record['NAME']} | {record['TYPE']} / {record['ATTRIB']} | {record['LEVEL']} / {record['RATE']} | {effects} | ITM-01～04：搜索/库存/限制/唯一性/装备或消耗；SANGO.INI:{record['_line']} |")
    lines += ['', '## 剧本：5个', '', '| 剧本 | 年份 | 当前与缺口 |', '| --- | --- | --- |']
    for scene in content['scenarios']:
        lines.append(f"| {scene['title']} | {scene['year']} | 已导入{len(scene['cities'])}城/{len(scene['generals'])}人物/{len(scene['roads'])}路；NEW-01～06、POL-01～12、CAM-01均需逐剧本验收 |")
    lines += ['', '## 地形：12项 / 24组景色', '', '| ID | 名称 | 景色 | 当前与缺口 |', '| --- | --- | --- | --- |']
    for terrain in content['terrains']:
        lines.append(f"| {terrain['id']} | {terrain['name']} | {' / '.join(v['id'] for v in terrain['variants'])} | 原素材已接；MAP-09自动选景与VIS-07透视/裁切/调色板仍待逐场验收 |")
    lines += ['', '## 兵种：13类', '', '| 原兵种序号 | 名称 | 当前与缺口 |', '| --- | --- | --- |']
    for i, name in enumerate(['朴刀兵','長槍兵','大刀兵','弓箭兵','鏈鎚兵','飛刀兵','武鬥兵','蠻族兵','鐵鎚兵','籐甲兵','黃巾兵','弩兵','女兵']):
        lines.append(f'| {i} | {name} | 素材/基础战斗/克制已接；NEW-03初始配兵、BAT-03/07动作消息、BAT-09混合调度、ITM-03兵符仍待验收 |')
    lines += ['', '## 常规阵形：9种', '', '| 名称 | 当前与缺口 |', '| --- | --- |']
    for name in ['方形','圓形','錐形','雁形','玄襄','魚麗','鉤形','衝鋒','箭矢']:
        lines.append(f'| {name} | 已有原表与选择；BAT-02全部约束/特殊阵并用、VIS-04原布阵界面、ITM-03阵书学习仍待验收 |')
    lines += ['', '特殊阵形与系统脚本不混入上述9种计数，仍按总账 BAT-02、STR-03、SYS-01 单独验收。原版菜单与对话逐状态截图尚不完整，不能宣称此内容表已穷尽未知的运行时分支；发现新的条件或分支时必须补入总账。', '']
    output = ROOT/'docs/PARITY-CONTENT-INVENTORY.md'
    output.write_text('\n'.join(lines), encoding='utf-8')
    print(f'Wrote {len(content["strategies"])} strategy records, {len(content["items"])} items, 5 scenarios, 12 terrains, 13 units and 9 formations: {output}')


if __name__ == '__main__':
    main()
