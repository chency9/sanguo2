"""Original font code/IDX/draw dispatch vectors from pinned 1.05+ x86.

0x46CB50, 0x46CB80 and 0x46CC10 execute unmodified. Stub 0x45831B
records the actual glyph index, descriptor, position, colour and shadow call;
the source bitmap bytes and hashes are separately retained in font proof.json.
This proves lookup/dispatch and source pixels, not a full EXE frame capture.
"""
import hashlib
import json
import random
import struct
from pathlib import Path
from native_ai_oracle import HEAP,SHA
from native_policy_search_oracle import PolicyOracle


def main():
    pak=next((Path(__file__).resolve().parents[2]/'game-original-105plus').glob('*/Sango2.PAK')).read_bytes()
    assert hashlib.sha256(pak).hexdigest()=='4db9aa8d7ecaedc61b2826c63e4e130bffaae0f3c36c0c34b20bc76bb7bc47e6'
    _,count,offset=struct.unpack_from('<4sII',pak);entries={}
    for i in range(count):
        row=pak[offset+i*64:offset+(i+1)*64];size,pos=struct.unpack_from('<II',row);entries[row[24:].split(b'\0',1)[0].decode('ascii').upper()]=pak[pos:pos+size]
    idx=entries['SANGO.IDX'];o=PolicyOracle();o.cpu.mem_write(HEAP,idx)
    o.put(0x4A7B8C,HEAP);o.put(0x4A7B90,HEAP+0x10000);o.put(0x4C892C,HEAP+0x11000);o.put(0x4A7B98,HEAP+0x20000);o.put(0x4C8930,HEAP+0x21000);o.put(0x4C8814,2)
    calls=[]
    def draw(sp):
        values=[o.u32(sp+4+i*4) for i in range(6)];calls.append(dict(x=values[0],y=values[1],descriptor='chinese' if values[2]==HEAP+0x11000 else 'ascii',flags=values[3],glyph=values[4],color=values[5]));return 0
    o.callbacks[0x45831B]=draw;r=random.Random(46)
    cases=[];characters=list('三國群英傳曹操命療術年內政')
    codes=[int.from_bytes(c.encode('cp950'),'little') for c in characters]
    codes += [lead|(trail<<8) for lead in [129,160,161,164,176,192,249] for trail in [64,126,161,254]]
    for i in range(180):
        code=codes[i%len(codes)];slot=o.call(0x46CB50,code);x,y,flags,color,shadow=r.randrange(640),r.randrange(480),r.randrange(16),r.randrange(65536),r.choice([0,0,0,65535]);calls.clear()
        o.call(0x46CB80,code,x,y,flags,color,shadow)
        cases.append(dict(code=code,slot=slot,x=x,y=y,flags=flags,color=color,shadow=shadow,glyph=struct.unpack_from('<H',idx,slot*2)[0],calls=list(calls)))
    ascii_cases=[]
    for code in range(32,127):
        calls.clear();o.call(0x46CC10,code,10,20,3,65535,0);ascii_cases.append(dict(code=code,calls=list(calls)))
    output=dict(exeSha256=SHA,boundary=__doc__,indexSha256=hashlib.sha256(idx).hexdigest(),chineseCases=cases,asciiCases=ascii_cases)
    dest=Path(__file__).resolve().parents[2]/'sango2-web/packages/core/fixtures/native-bitmap-font-vectors.json';dest.write_text(json.dumps(output,separators=(',',':'))+'\n',encoding='utf8');print(dict(chineseCases=len(cases),asciiCases=len(ascii_cases)))


if __name__=='__main__':main()
