"""List all 110 original entry wrappers and the Web execution boundary.

Only decodes the short Magic entry wrappers, not arbitrary SO functions. A
symbol link proves an entry exists; it is never counted as an implemented skill.
"""
import hashlib
import json
import struct
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main():
    binary = ROOT/'evidence/binary'
    code = (binary/'SCRIPT_MAGIC.SO').read_bytes()
    symbols = json.loads((binary/'SCRIPT_MAGIC.SO.symbols.json').read_text(encoding='utf8'))
    by_name = {s['name']: s for s in symbols}
    by_offset = {s['offset']: s['name'] for s in symbols}
    manifest = json.loads((ROOT.parent/'sango2-web/packages/core/src/native-magic-manifest.json').read_text(encoding='utf8'))
    widths = {op: 1 for op in [1,2,3,4,6,7,8,9,10,11,12,13,29,30,31,32,33,34,59,60,61,78,79,*range(80,90)]}
    widths.update({5: 2, 64: 2})
    groups = defaultdict(list)
    table = []
    shoot = {502,514,552,558}
    # Seven wrappers now execute the reconstructed MoreSoldier /
    # BackSoldier VM boundary; visuals and global object order remain open.
    reinforce = {509,523,565,584,524,533,541}
    for item in manifest:
        ip = by_name[item['scriptSymbol']]['offset']
        end = min(offset for offset in by_offset if offset > ip)
        calls = []
        while ip < end:
            op = struct.unpack_from('<I',code,ip)[0]
            assert op < 90, (item['sequence'],hex(ip),op)
            if op == 4:
                calls.append(by_offset[struct.unpack_from('<I',code,ip+4)[0]])
            ip += 4+4*widths.get(op,0)
        assert ip == end
        family = ' / '.join(calls) or '直接入口'
        groups[family].append(item['sequence'])
        status = ('原主流程、弹道、伤害、镜头已接；完整视觉/声音/全局顺序未齐' if item['script'] in shoot else
                  'Heal 与全部子协程、等待、回血和脚本 RNG 已接；原光效素材已显示，完整对象顺序/调色板/音效未齐' if item['effectType']=='heal' else
                  '脚本全事件、兵员槽位与结算已对照；全局对象顺序、原像素和音效仍待验收' if item['script'] in reinforce else
                  '暂定通用执行器；原脚本效果与时序未移植')
        table.append(f"| {item['sequence']} | {item['name']} | {item['script']} / {item['scriptSymbol']} | {family} | {status} |")
    lines = [
        '# 110 个武将技逐项差距清单', '',
        '核查日期：2026-11-20。按当前 `castSkill` 的实际分派核查，不按 manifest 的 `verified` 标签计算完整度。', '',
        '**4 个技能已接原 ShootObject 主流程；2 个治疗技能已接 Heal 与全部后代协程；7 个补兵技能已接 MoreSoldier/BackSoldier 原 VM 边界。其余 97 个仍走暂定通用执行器。13 个已接原脚本的技能仍有完整对象顺序、视觉或音效缺口，没有一个在这里被宣称已完成整场逐帧、逐像素验收。**', '',
        f"源 `SCRIPT_MAGIC.SO` SHA-256：`{hashlib.sha256(code).hexdigest()}`。", '',
        '原 110 个包装器共调用 44 组共用入口。下表只定位包装器的直接调用；共用入口的存在不证明它已实现，更不证明所有后代子脚本已执行。', '',
        '增兵专项已对照 168 组原 VM 的全部脚本事件、632 组原分配宿主、2 组死亡复用和56 组战后结算。两类取证的替代边界不同，见[增兵脚本与兵员槽位](NATIVE-REINFORCE-PARITY-2026-11-20.md)。', '',
        '## 共用入口与覆盖范围', '', '| 原入口 | 技能 sequence | 当前状态 |', '| --- | --- | --- |',
    ]
    for family, sequences in groups.items():
        status = ('部分原码接入' if family in ['Heal','ShootObject'] else
                  '168 组脚本事件与独立宿主对照；完整对象链、原像素和音效待验' if family in ['MoreSoldier','BackSoldier'] else
                  '待移植原脚本')
        lines.append(f"| {family} | {', '.join(map(str,sequences))} | {status} |")
    lines += ['', '## 逐项记录', '', '| sequence | 技能 | SCRIPT / 符号 | 直接调用 | 当前差距 |', '| --- | --- | --- | --- | --- |', *table, '',
        '## 复核方式', '',
        '在 `web-port-research` 内运行 `.venv-ai/Scripts/python.exe tools/audit_magic_coverage.py`。需要本地原 SO 与符号表；公开仓库不包含原二进制。生成器拒绝无法解码的包装器，不补猜测的函数名。', '',
        '所有暂定执行器仍可供开发演武，但不能用于证明原版 AI 的实际技能收益、下一次决策输入或全局 RNG 相同。完整恢复应沿共用入口、子脚本、对象宿主及实际战场回放共同核验。', '',
        '总体差距见 [当前复刻状态](PARITY-STATUS-2026-11-19.md)，增兵证据见 [伏兵与后伏](NATIVE-REINFORCE-PARITY-2026-11-20.md)，治疗证据见 [Heal 全部子协程](NATIVE-HEAL-PARITY-2026-11-19.md)，集气、恢复、坐骑速度和镜头证据见 [源更新与技能镜头](NATIVE-GENERAL-CAMERA-PARITY-2026-11-19.md)。', '',
    ]
    output = ROOT.parent/'sango2-web/docs/MAGIC-COVERAGE-2026-11-19.md'
    output.write_text('\n'.join(lines),encoding='utf8')
    print(json.dumps(dict(skills=len(table),families=len(groups),shootMain=4,healTree=2,reinforceVm=7,generic=97,fullParity=0)))


if __name__ == '__main__':
    main()
