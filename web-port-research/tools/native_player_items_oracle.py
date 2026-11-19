"""Execute original 0x424509, including eligibility, unload/apply and stock.

Only the three text/message notification callbacks are replaced. No decision,
item arithmetic, stock function or RNG is substituted. Isolated snapshots,
not a replay of the original inventory window or complete campaign.
"""
import json
import random
import struct
from pathlib import Path
from native_ai_oracle import HEAP, SHA
from native_policy_search_oracle import PolicyOracle
from native_policy_annual_oracle import write_officer, read_officer, write_items


def main():
    r = random.Random(424509)
    o = PolicyOracle()
    output = dict(exeSha256=SHA, cases=[])
    for i in range(384):
        o.cpu.mem_write(HEAP, bytes(0x70000))
        o.callbacks.clear()
        for address in [0x408818, 0x408865, 0x4088B2]:
            o.callbacks[address] = lambda sp: 0
        ptr, owner = HEAP+0x1000, HEAP+0x60000
        def item(key, flags):
            return dict(id=key, flags=flags, level=1,
                        strength=r.randrange(-5,31), intelligence=r.randrange(-5,31),
                        maxHp=r.randrange(16), maxMp=r.randrange(16), speed=r.randrange(-3,9),
                        hp=r.randrange(-30,101), mp=r.randrange(-30,101),
                        morale=r.randrange(-30,31), loyalty=0, fatigue=r.randrange(-30,31),
                        forceMask=0, battleMask=0)
        g = dict(level=r.randrange(1,61), strength=r.randrange(30,121), intelligence=r.randrange(30,121),
                 maxHp=160, maxMp=100, hp=r.randrange(1,161), mp=r.randrange(1,101),
                 morale=r.randrange(101), loyalty=r.randrange(101), fatigue=r.randrange(101),
                 speed=r.randrange(16), forceMask=1, battleMask=1, weaponId=0, horseId=0, thingId=0)
        flags = [16,32,64,1][(i//8)%4]
        new = item(2, flags)
        old = item(3, flags if flags != 1 else 64)
        slot = {16:'weaponId',32:'horseId',64:'thingId'}.get(flags, 'thingId')
        mode = i%8
        if mode in [0,2,3,4,5,6]:
            g[slot] = old['id']
        if mode == 3:
            old = dict(new)
            g[slot] = new['id']
        if mode == 4:
            new['level'] = g['level']+1
        if mode == 5:
            new['forceMask'] = 1
        if mode == 6:
            new['battleMask'] = 1
        ruler = i%3 == 0
        if mode == 7:
            new['loyalty'] = 30
        if i >= 352:
            g['strength'] = 32760
            new['strength'] = 30
        items = [new] if old['id'] == new['id'] else [new, old]
        inventory = {str(new['id']):99 if mode == 3 else r.randrange(1,4)}
        if old['id'] != new['id']:
            inventory[str(old['id'])] = 99 if mode == 2 else r.randrange(1,4)
        selected = 0 if mode == 0 else new['id']
        o.put(ptr+203, owner)
        o.put(owner+12, ptr if ruler else HEAP+0x2000)
        write_items(o, items)
        write_officer(o, ptr, g)
        for key, count in inventory.items():
            o.put(owner+308+2*int(key), count, True)
        before = [r.randrange(1,2**32),r.randrange(1,2**32)]
        o.set_rng(before)
        o.call(0x424509, owner, ptr, selected)
        stock = {str(j):struct.unpack('<h',o.cpu.mem_read(owner+308+2*j,2))[0] for j in range(1,128)}
        output['cases'].append(dict(input=g,items=items,itemId=selected,ruler=ruler,
            inventory=inventory,rng=before,output=read_officer(o,ptr),
            inventoryAfter={key:count for key,count in stock.items() if count},rngAfter=o.rng()))
    path = Path(__file__).resolve().parents[2]/'sango2-web/packages/core/fixtures/native-player-items.json'
    path.write_text(json.dumps(output,ensure_ascii=False,separators=(',',':'))+'\n',encoding='utf8')
    print(f'{len(output["cases"])} original player item cases -> {path}')


if __name__ == '__main__':
    main()
