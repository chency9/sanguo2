"""Convert original 1-bit game glyphs to outlines without changing pixels.

SANGO.IDX uses the original 0x46CB50 Big5 slot formula. Horizontal runs become
clockwise TrueType rectangles; UPEM=height*64 yields an exact 1/64 native scale.
Generated WOFF2 files contain original game data and remain in ignored assets.
"""
from pathlib import Path
import hashlib
import json
import struct
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib import newTable
from PIL import Image


def native_big5_slot(first,second):
    return 157*(first-129)+(second-98 if second>126 else second-64)


def bitmap(data,index,width,height,stride):
    offset=index*height*stride
    return [[int(bool(data[offset+y*stride+x//8]&(0x80>>(x%8)))) for x in range(width)] for y in range(height)]


def outline(pixels,scale):
    pen=TTGlyphPen(None);height=len(pixels)
    for y,row in enumerate(pixels):
        x=0
        while x<len(row):
            if not row[x]:x+=1;continue
            start=x
            while x<len(row) and row[x]:x+=1
            left,right,bottom,top=start*scale,x*scale,(height-y-1)*scale,(height-y)*scale
            pen.moveTo((left,bottom));pen.lineTo((left,top));pen.lineTo((right,top));pen.lineTo((right,bottom));pen.closePath()
    return pen.glyph()


def export_native_fonts(read,out):
    out=Path(out);out.mkdir(parents=True,exist_ok=True);index=struct.unpack('<19000H',read('SANGO.IDX'))
    unicode_map={}
    for lead in range(129,255):
        for trail in [*range(64,127),*range(161,255)]:
            slot=native_big5_slot(lead,trail)
            if slot>=len(index):continue
            try:character=bytes([lead,trail]).decode('cp950')
            except UnicodeDecodeError:continue
            if len(character)!=1 or character.encode('cp950')!=bytes([lead,trail]):continue
            if index[slot]:unicode_map[ord(character)]=index[slot]
    proof={'indexSha256':hashlib.sha256(read('SANGO.IDX')).hexdigest(),'fonts':[]}
    for height,width,stride,ascii_name,ascii_width,ascii_stride in [(20,20,3,'MINGASC.20',10,2),(15,16,2,'OLDASC.15',8,1)]:
        source_name=f'SANGO.{height}';source,ascii_data=read(source_name),read(ascii_name);scale=64;units=height*scale
        family=f'Sango2 Original {height}';glyphs={};metrics={};order=['.notdef'];glyphs['.notdef']=outline([[0]],scale);metrics['.notdef']=(width*scale,0)
        cmaps={}
        for code in range(32,127):
            name=f'ascii{code}';pixels=bitmap(ascii_data,code,ascii_width,height,ascii_stride);order.append(name);glyphs[name]=outline(pixels,scale)
            bearing=min((x for row in pixels for x,value in enumerate(row) if value),default=0)*scale
            metrics[name]=(ascii_width*scale,bearing);cmaps[code]=name
        for glyph_index in sorted(set(unicode_map.values())):
            name=f'original{glyph_index}';pixels=bitmap(source,glyph_index,width,height,stride);order.append(name);glyphs[name]=outline(pixels,scale)
            bearing=min((x for row in pixels for x,value in enumerate(row) if value),default=0)*scale;metrics[name]=(width*scale,bearing)
        cmaps.update({code:f'original{glyph_index}' for code,glyph_index in unicode_map.items()})
        fb=FontBuilder(units,isTTF=True);fb.setupGlyphOrder(order);fb.setupCharacterMap(cmaps);fb.setupGlyf(glyphs);fb.setupHorizontalMetrics(metrics)
        fb.setupHorizontalHeader(ascent=units,descent=0,lineGap=0)
        fb.setupNameTable({'familyName':family,'styleName':'Regular','uniqueFontIdentifier':f'{family} bitmap conversion v1','fullName':family,'psName':f'Sango2Original{height}','version':'Version 1.000'})
        fb.setupOS2(version=4,sTypoAscender=units,sTypoDescender=0,sTypoLineGap=0,usWinAscent=units,usWinDescent=0,fsSelection=0x40|0x80)
        fb.setupPost();fb.setupMaxp();fb.font['head'].flags=3;fb.font['head'].created=fb.font['head'].modified=3406620153;fb.font.recalcTimestamp=False
        gasp=newTable('gasp');gasp.gaspRange={65535:0};fb.font['gasp']=gasp
        fb.font.flavor='woff2';filename=f'sango2-{height}.woff2';fb.save(out/filename)
        columns=128;atlas=Image.new('RGBA',(columns*width,((len(order)-1+columns-1)//columns)*height),(0,0,0,0));locations={}
        # Atlas uses source bytes directly, retaining alpha0/255 without the
        # browser's platform text rasterizer or subpixel-edge smoothing.
        for ordinal,name in enumerate(order[1:]):
            is_ascii=name.startswith('ascii');glyph_index=int(name[5:] if is_ascii else name[8:]);glyph_width=ascii_width if is_ascii else width
            pixels=bitmap(ascii_data if is_ascii else source,glyph_index,glyph_width,height,ascii_stride if is_ascii else stride)
            left,top=(ordinal%columns)*width,(ordinal//columns)*height
            for py,row in enumerate(pixels):
                for px,value in enumerate(row):
                    if value:atlas.putpixel((left+px,top+py),(255,255,255,255))
            locations[name]={'x':left,'y':top,'width':glyph_width,'height':height,'advance':glyph_width}
        atlas_name=f'sango2-{height}.png';atlas.save(out/atlas_name,optimize=True)
        (out/f'sango2-{height}.json').write_text(json.dumps({'size':height,'image':atlas_name,'characters':{chr(code):locations[name] for code,name in cmaps.items()}},ensure_ascii=False,separators=(',',':'))+'\n',encoding='utf8')
        samples=[]
        for character in '三國群英傳曹操命療術年內政0129Aa!?':
            code=ord(character)
            if code<128:pixels=bitmap(ascii_data,code,ascii_width,height,ascii_stride);glyph_index=code
            else:glyph_index=unicode_map[code];pixels=bitmap(source,glyph_index,width,height,stride)
            samples.append({'character':character,'index':glyph_index,'width':len(pixels[0]),'pixels':[''.join(map(str,row)) for row in pixels],'atlas':locations[cmaps[code]]})
        proof['fonts'].append({'family':family,'path':filename,'atlas':atlas_name,'size':height,'glyphs':len(order),'codepoints':len(cmaps),'source':source_name,'sourceSha256':hashlib.sha256(source).hexdigest(),'asciiSource':ascii_name,'samples':samples})
    (out/'proof.json').write_text(json.dumps(proof,ensure_ascii=False,separators=(',',':'))+'\n',encoding='utf8')
    return proof


if __name__=='__main__':
    import argparse
    ap=argparse.ArgumentParser();ap.add_argument('--game',type=Path,default=Path(__file__).resolve().parents[2]/'game-original-105plus'/'三国群英传2 修正版 1.05+');ap.add_argument('--out',type=Path,default=Path(__file__).resolve().parents[1]/'apps/game/public/assets/fonts');args=ap.parse_args()
    data=(args.game/'Sango2.PAK').read_bytes()
    if hashlib.sha256(data).hexdigest()!='4db9aa8d7ecaedc61b2826c63e4e130bffaae0f3c36c0c34b20bc76bb7bc47e6':raise ValueError('Original 1.05+ PAK hash mismatch')
    _,count,offset=struct.unpack_from('<4sII',data);entries={}
    for i in range(count):
        row=data[offset+i*64:offset+(i+1)*64];size,pos=struct.unpack_from('<II',row);entries[row[24:].split(b'\0',1)[0].decode('ascii').upper()]=data[pos:pos+size]
    proof=export_native_fonts(lambda name:entries[name.upper()],args.out)
    print([(font['family'],font['glyphs'],font['codepoints']) for font in proof['fonts']])
