"""Export only the hash-pinned ArrowSupport integer SO instruction subset."""
import hashlib,json,struct
from native_ai_oracle import ROOT
from native_magic_shoot_oracle import CODE,BY_NAME,SYMBOLS,STRINGS

NAMES=['Magic3','Magic15','Magic34','Magic45','Magic72','Magic90','ArrowSupport',
       'ProduceArrowSoldier','AddSoldierLeft','AddSoldierRight','ChangeLeftFirePos','ChangeRightFirePos',
       'FlyArrowLU','FlyArrowRU','FlyArrowLB1','FlyArrowRB1','FlyArrowLB2','FlyArrowRB2',
       'TraceArrow','HideArrow','ArrowCallback1','ArrowCallback2','LockTargetTime2','FireMan',
       'Hurt','MoveCamera','DownBrightness','RaiseBrightness']
OPERANDS={k:1 for k in [2,3,4,6,7,8,9,10,11,12,29,32,33,59,60,61]}
OPERANDS.update({5:2,64:2})

def main():
    instructions={};symbols={};ops=set()
    for name in NAMES:
        symbol=BY_NAME[name];p=symbol['offset'];end=min(x['offset'] for x in SYMBOLS if x['offset']>p)
        symbols[name]=dict(offset=p,args=symbol['arg_count_candidate'])
        while p<end:
            at=p;op=struct.unpack_from('<I',CODE,p)[0];p+=4;n=OPERANDS.get(op,0)
            args=list(struct.unpack_from('<'+'i'*n,CODE,p));p+=4*n
            if op==7:args=[STRINGS[args[0]]['text_cp950']]
            instructions[at]=[op,p,*args];ops.add(op)
    object_evidence=json.loads((ROOT/'evidence/ai/native-arrow-object-host-vectors.json').read_text(encoding='utf8'))
    objects={c['object']:dict(flags=c['flags'],frameTicks=[n['ticks'] for n in c['native']['frames']],
              messages=c['native']['messages'],loop=c['native']['loop'],
              deathAt=next((e['t'] for e in c.get('deathNative',{}).get('messages',[]) if e['event']==3),None)) for c in object_evidence['cases']}
    out=dict(scriptSha256=hashlib.sha256(CODE).hexdigest(),pakSha256=object_evidence['pakSha256'],symbols=symbols,instructions=instructions,objects=objects)
    dest=ROOT.parent/'sango2-web/packages/core/src/native-magic-arrow-support-program.json'
    dest.write_text(json.dumps(out,ensure_ascii=False,separators=(',',':')),encoding='utf8')
    print(json.dumps(dict(symbols=len(symbols),instructions=len(instructions),opcodes=sorted(ops))))

if __name__=='__main__':main()
