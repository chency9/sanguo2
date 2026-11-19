"""Original troop capacities and active/reserve formation allocations, no hooks."""
import json
import shutil
import struct
from native_ai_oracle import Oracle,ROOT,HEAP,PE,SHA


def main():
    vm=Oracle();capacities=[];allocations=[];objects=[]
    for level in range(-1,100):
        vm.put(HEAP+46,level,True)
        values=[vm.call(f,HEAP) for f in [0x409FB6,0x409FD8]]
        capacities.append(dict(level=level,native=[v if v<0x80000000 else v-0x100000000 for v in values]))
    for formation in range(34):
        for count in [0,1,2,3,7,19,33,50,99,100]:
            for reserve in [False,True]:
                values=[vm.call(0x404D18 if reserve else 0x404A10,formation,count,division) for division in range(1,6)]
                allocations.append(dict(formation=formation,count=count,reserve=reserve,native=values))
    for unit in range(13):
        for side in [0,1]:
            objects.append(dict(unit=unit,side=side,active=vm.call(0x406499,1<<unit,side),reserve=vm.call(0x406501,1<<unit,side)))
    path=ROOT/'evidence/ai/native-troop-vectors.json'
    path.write_text(json.dumps(dict(exeSha256=SHA,capacities=capacities,allocations=allocations,objects=objects),separators=(',',':')),encoding='utf8')
    shutil.copyfile(path,ROOT.parent/'sango2-web/packages/core/fixtures/native-troop-vectors.json')
    table=[list(struct.unpack('<5h',PE.get_data(0x85DA8+i*12,10))) for i in range(33)]
    (ROOT.parent/'sango2-web/packages/core/src/native-troop-formations.json').write_text(json.dumps(table),encoding='utf8')
    print(json.dumps(dict(capacities=len(capacities),allocations=len(allocations),objects=len(objects))))


if __name__=='__main__':main()
