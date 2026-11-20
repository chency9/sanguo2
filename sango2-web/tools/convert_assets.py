"""Build the first Web content pack directly from the user's unchanged game PAK.

PAK/SHP layout derived from sango2-english-patch (MIT); see tools/NOTICE.md.
Only selected original assets are exported. No executable is launched.
Requires Python 3.12+ and Pillow. Usage: python tools/convert_assets.py --game PATH
"""
import argparse
import io
import hashlib
import json
from pathlib import Path
import re
import shutil
import struct
from io import BytesIO
from PIL import Image
from native_general import initial_level, initial_vitals, learning_entries, equipment_speed, force_mask
from native_animation import attack_frames, attack_timeline

ROOT = Path(__file__).resolve().parents[1]
COLORS = ['#65a9bd','#d7ac55','#8aaa75','#b67782','#9d93c9','#6bb7a5','#cf8b66',
          '#abb777','#99a6c4','#cda183','#8fbaad','#b6a4cb','#c9959c','#c2b174','#88969c']


def parse(text):
    records=[]
    for number,line in enumerate(text.splitlines(),1):
        line=line.strip()
        if not line or line.startswith((';','//')):continue
        if line.startswith('['):
            name=line[1:line.index(']')]
            records.append({'section':name,'kind':re.sub(r'\d+$','',name).upper(),'line':number,'entries':[]})
        elif '=' in line and records:
            k,v=line.split('=',1)
            records[-1]['entries'].append((k.strip().upper(),v.strip()))
    return records


def rows(records,kind):
    return [dict(r['entries'],_section=r['section'],_line=r['line']) for r in records if r['kind']==kind]


def number(text,default=0):
    try:return int(text)
    except (ValueError,TypeError):return default


def shp_image(data):
    if data[:4]!=b'TLHS':raise ValueError('Unknown SHP signature')
    fields=struct.unpack_from('<8I',data,4)
    w,h=fields[4:6]
    pixels=bytearray(w*h*4)
    for y in range(h):
        p=struct.unpack_from('<I',data,36+y*4)[0]
        while True:
            x=struct.unpack_from('<H',data,p)[0]
            if x==65535:break
            n=struct.unpack_from('<H',data,p+2)[0]
            if x+n>w:raise ValueError('SHP run outside width')
            for i,v in enumerate(struct.unpack_from(f'<{n}H',data,p+4)):
                k=(y*w+x+i)*4
                pixels[k:k+4]=bytes((((v>>11&31)*255+15)//31,((v>>5&63)*255+31)//63,((v&31)*255+15)//31,255))
            p+=4+2*n
    return Image.frombytes('RGBA',(w,h),bytes(pixels)),fields


def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('--game',type=Path,default=ROOT.parent/'game-original-105plus'/'三国群英传2 修正版 1.05+')
    args=ap.parse_args()
    source=(args.game/'Sango2.PAK').read_bytes()
    digest=hashlib.sha256(source).hexdigest()
    expected='4db9aa8d7ecaedc61b2826c63e4e130bffaae0f3c36c0c34b20bc76bb7bc47e6'
    if digest!=expected:raise ValueError('Content build requires the analyzed 1.05+ PAK; fingerprint differs')
    magic,count,offset=struct.unpack_from('<4sII',source)
    if magic!=b'PAKS' or offset+count*64>len(source):raise ValueError('Invalid PAK directory')
    entries={}
    for i in range(count):
        e=source[offset+i*64:offset+(i+1)*64]
        size,pos=struct.unpack_from('<II',e)
        name=e[24:].split(b'\0',1)[0].decode('ascii').upper()
        if name in entries or pos+size>offset:raise ValueError('Invalid PAK member')
        entries[name]=(pos,size)
    def read(name):
        pos,size=entries[name.upper()]
        return source[pos:pos+size]
    def ini(name):return parse(read(name).decode('cp950'))
    out=ROOT/'apps/game/public/assets'
    out.mkdir(parents=True,exist_ok=True)
    asset_records=[]
    def export_shp(name,relative):
        image,fields=shp_image(read(name))
        path=out/relative;path.parent.mkdir(parents=True,exist_ok=True)
        image.save(path,optimize=True)
        asset_records.append({'source':name,'path':relative,'width':image.width,'height':image.height,
                              'shpHeader':fields,'sha256':hashlib.sha256(path.read_bytes()).hexdigest()})
        return image, fields
    export_shp('SHAPE\\MAP\\CHINAMAP.SHP','world-map.png')
    for i in range(1,401):
        export_shp(f'SHAPE\\FACE\\FACE{i:03}.SHP',f'portraits/{i:03}.png')
    for i in range(1,5):export_shp(f'SHAPE\\MAP\\CITY{i:02}.SHP',f'city-{i}.png')
    # Small authentic movement sample for marching armies, kept separate from rule timing.
    for i in range(1,7):export_shp(f'SHAPE\\TROOP\\SOL1000{i}.SHP',f'march/{i}.png')
    # Original menu material and title artwork; crop only, never synthesize replacement art.
    title,_=export_shp('SHAPE\\MENU\\TITLEBG.SHP','ui/title.png')
    title.crop((45,15,600,155)).save(out/'ui/logo.png')
    title.crop((0,265,640,440)).save(out/'ui/army-banner.png')
    export_shp('SHAPE\\MENU\\WAR0D.SHP','ui/battle-panel.png')
    for entry in entries:
        if entry.startswith('SHAPE\\MENU\\WAR') and entry.endswith('.SHP'):
            export_shp(entry,f"ui/{entry.rsplit(chr(92),1)[-1][:-4].lower()}.png")
    # 0x449169 / pointer table 0x490598: thirteen native troop icons in HUD order.
    for i in range(1,14):export_shp(f'SHAPE\\MENU\\FORCE{i:02}.SHP',f'ui/force{i:02}.png')
    # SANGO.INI FONTS06/07 and 0x46CC10 use ASCII-numbered SHP glyphs.
    for font in ['WS','WB']:
        for code in range(47,58):export_shp(f'SHAPE\\FONTS\\{font}{code:03}.SHP',f'ui/fonts/{font.lower()}-{code}.png')
    # FONTS05, 0x440DC3: ASCII 48..58 represent zero through ten in Chinese.
    for code in range(48,59):export_shp(f'SHAPE\\FONTS\\TNUM{code:03}.SHP',f'ui/fonts/tnum-{code}.png')
    export_shp('SHAPE\\POLICY\\PALAIS01.SHP','ui/palace.png')
    for source_name,target in [('SHAPE\\MAP\\TEXTURE.TEX','ui/map-texture.png'),('SHAPE\\BG\\FLOOR00.TGA','battle/floor.png')]:
        path=out/target;path.parent.mkdir(parents=True,exist_ok=True)
        Image.open(BytesIO(read(source_name))).save(path)
    for layer in ['BG','MG','FG']:
        export_shp(f'SHAPE\\BG\\{layer}00A.SHP',f'battle/{layer.lower()}.png')
    # TERRAIN repeats each layer key for A/B artwork. Never flatten it with dict().
    terrains=[]
    for record in ini('SANGO.INI'):
        if record['kind']!='TERRAIN':continue
        values=dict(record['entries']); terrain_id=number(values['SEQUENCE'])
        folder=f'battle/terrain-{terrain_id:02}'
        (out/folder).mkdir(parents=True,exist_ok=True)
        floor_path=f'{folder}/floor.png'
        floor=Image.open(BytesIO(read(values['FLOOR'])))
        floor.save(out/floor_path)
        asset_records.append({'source':values['FLOOR'],'path':floor_path,'width':floor.width,'height':floor.height,
                              'sha256':hashlib.sha256((out/floor_path).read_bytes()).hexdigest()})
        terrain={'id':terrain_id,'name':values['NAME'],'soundtrack':number(values['SOUNDTRACK']),
                 'sourceLine':record['line'],'floor':floor_path,'variants':[]}
        layers={key:[value for k,value in record['entries'] if k==key] for key in ['BACKGROUND','MIDGROUND','FOREGROUND']}
        if any(len(paths)!=2 for paths in layers.values()):raise ValueError('Expected both A/B terrain layers')
        for index,variant in enumerate(['a','b']):
            entry={'id':variant}
            for key,paths in layers.items():
                relative=f'{folder}/{key.lower()}-{variant}.png'
                export_shp('SHAPE\\'+paths[index],relative);entry[key.lower()]=relative
            terrain['variants'].append(entry)
        terrains.append(terrain)
    if sorted(t['id'] for t in terrains)!=list(range(12)):raise ValueError('Incomplete terrain catalogue')
    for track in sorted(set(t['soundtrack'] for t in terrains)):
        music=args.game/f'MP3/{track:02}.mp3'
        if not music.is_file():raise ValueError(f'Missing terrain soundtrack {track}')
        shutil.copyfile(music,out/f'battle/music-{track:02}.mp3')
    # The native map selector samples the four seasonal CHINAMAP*.MSK masks
    # with the strategic coordinate divided by two (0x44FD1B).  Keep the
    # decoded masks in the conversion step so each city receives its actual
    # TERRAIN sequence instead of a name/flag heuristic.  Runtime maps
    # months 1-3, 4-6, 7-9 and 10-12 to these four entries respectively.
    map_masks=[]
    for map_index in range(1,5):
        mask=Image.open(io.BytesIO(read(f'SHAPE\\MAP\\CHINAMAP{map_index}.MSK')))
        mask.load()
        if mask.size!=(640,480):raise ValueError(f'Unexpected terrain mask size: {mask.size}')
        map_masks.append(mask.convert('P'))
    # Keep source animation frame order, # durations and OM_ATTACK timing for later calibration.
    objects=rows(ini('THINGS.INI'),'OBJECT')
    animations={}; frame_images={}; actions=['WAIT','WALK','ATTACK','DEATH','SPELL1'];attack_rules={}
    ids=[10,10016,18002,18003,18004]+list(range(26001,26007))+list(range(13001,13012))+list(range(500,504))+list(range(180,186))+list(range(190,196))+list(range(100,113))+list(range(120,133))+list(range(140,153))+list(range(160,173))+list(range(600,660))+list(range(800,860))+list(range(700,768))+list(range(900,908))
    for obj in objects:
        if number(obj.get('SEQUENCE')) not in ids:continue
        anim={}
        for action in actions:
            frames=[]; duration=6; elapsed=0; hit=None; remove=None
            for token in obj.get(action,'').split(','):
                token=token.strip().upper()
                if token.startswith('#'):
                    duration=number(token[1:],6)
                    if not (13001<=number(obj['SEQUENCE'])<=13011 or 26001<=number(obj['SEQUENCE'])<=26006 or number(obj['SEQUENCE']) in [10016,18002,18003,18004]):duration=min(128,duration)
                    continue
                if token=='@%OM_ATTACK':hit=elapsed;continue
                if token=='@%OM_REMOVE':remove=elapsed;continue
                if not re.fullmatch(r'[A-Z][A-Z0-9]{5,}',token) or token in ['SCROVER','NULSHAPE']:continue
                name='SHAPE'+obj['DIRECTORY'].rstrip('\\')+'\\'+token+'.SHP'
                name=name.upper()
                if name not in entries:raise ValueError(f'Animation frame missing: {name}')
                if name not in frame_images:frame_images[name]=shp_image(read(name))
                frames.append({'key':name,'ticks':duration});elapsed+=duration
            if frames:
                anim[action.lower()]={'frames':frames,'ticks':elapsed,'hitTick':hit}
                if remove is not None:anim[action.lower()]['removeTick']=remove
        for source_action,key in [('ATTACK','sourceAttack')]+([('WIN','specialAttack')] if 100<=number(obj['SEQUENCE'])<180 else []):
            frames=attack_frames(obj.get(source_action,''),obj['DIRECTORY'])
            if not frames:continue
            for f in frames:
                name=f['key']
                if name not in entries:raise ValueError(f'Native animation frame missing: {name}')
                if name not in frame_images:frame_images[name]=shp_image(read(name))
            timing=attack_timeline(frames)
            anim[key]={'frames':[{'key':f['key'],'ticks':f['ticks']} for f in frames],**timing}
            attack_rules.setdefault(obj['SEQUENCE'],{})[key]=timing
        if 500<=number(obj['SEQUENCE'])<=503:
            for action in ['WAIT','DEATH']:
                frames=attack_frames(obj[action],obj['DIRECTORY'],finite=False)
                for f in frames:
                    if f['key'] not in frame_images:frame_images[f['key']]=shp_image(read(f['key']))
                anim[action.lower()]={'frames':[{'key':f['key'],'ticks':f['ticks']} for f in frames],**attack_timeline(frames),'loop':True}
        animations[obj['SEQUENCE']]={'name':obj['NAME'],'nativeScale':48384 if 'OF_BIGSHAPE' in obj.get('FLAGS','') else 65536,
                                     'whiteLight':'OF_WHITELIGHT' in obj.get('FLAGS',''),'actions':anim}
    # Bounded pages: the client decodes only pages used by the current duel.
    size=2048; atlas=Image.new('RGBA',(size,size)); atlas_frames={}; x=y=row_h=page=0
    pages=[]
    def save_page():
        filename=f'atlas-{page}.png'
        atlas.crop((0,0,size,y+row_h+2)).save(out/'battle'/filename,optimize=True)
        pages.append(filename)
    for name,(im,fields) in frame_images.items():
        if im.width+2>size or im.height+2>size:raise ValueError('Frame exceeds page size')
        if x+im.width+2>size:
            if y+row_h+2+im.height+2>size:
                save_page();page+=1;atlas=Image.new('RGBA',(size,size));x=y=row_h=0
            else:x=0;y+=row_h+2;row_h=0
        if y+im.height+2>size:
            save_page();page+=1;atlas=Image.new('RGBA',(size,size));x=y=row_h=0
        atlas.alpha_composite(im,(x,y))
        signed=lambda v:v if v<2147483648 else v-4294967296
        atlas_frames[name]={'page':f'atlas-{page}.png','x':x,'y':y,'w':im.width,'h':im.height,'offsetX':signed(fields[6]),'offsetY':signed(fields[7])}
        x+=im.width+2;row_h=max(row_h,im.height)
    save_page()
    (out/'battle/animations.json').write_text(json.dumps({'objects':animations,'frames':atlas_frames,'pages':pages,'sourceTickRate':60,'tickRateVerified':False,'durationSemanticsVerified':False,'attackRules':'native-actions-v1'},ensure_ascii=False,separators=(',',':')),encoding='utf8')
    (ROOT/'packages/core/src/native-attack-actions.json').write_text(json.dumps(attack_rules,separators=(',',':')),encoding='utf8')
    print(f'Battle content: {len(animations)} objects, {len(frame_images)} source frames')
    music=args.game/'MP3/01.mp3'
    if music.exists():shutil.copyfile(music,out/'music.mp3')
    battle_music=args.game/'MP3/06.mp3'
    if battle_music.exists():shutil.copyfile(battle_music,out/'battle/music.mp3')
    items=rows(ini('SANGO.INI'),'ITEM'); item_by_name={r['NAME']:r for r in items}
    def appearance(g):
        weapon=item_by_name.get(g.get('WEAPON'),{})
        body_type=number(g.get('TYPE'),1)
        # TYPE 1..15 aligns with L1..LE/L0. Special bandit TYPE 30 has no direct
        # object in THINGS; L0 is an explicit fallback, not an established mapping.
        body=600+(body_type-1 if 1<=body_type<=15 else 14)*4+number(weapon.get('WEAPONTYPE'))
        soldier={'刀':100,'槍':101,'關':102,'大':102,'弓':103,'鏈':104,'鍊':104,'飛':105,'武':106,'蠻':107,'鐵':108,'籐':109,'賊':110,'黃':110,'弩':111,'女':112}.get(g.get('USEFORCE','')[:1],100)
        result={'body':body,'weapon':number(weapon.get('WEAPONOBJECT'),700),
                'horse':number(item_by_name.get(g.get('HORSE'),{}).get('WEAPONOBJECT'),900),'soldier':soldier}
        for key,obj in [('generalAttack',body),('soldierAttack',soldier),('reserveSoldierAttack',soldier+40)]:
            a=animations[str(obj)]['actions']['attack']
            if a['hitTick'] is None:raise ValueError(f'Missing attack event for {obj}')
            result[key]={'hitTick':a['hitTick'],'ticks':a['ticks']}
        for key in ['body','weapon','horse','soldier']:
            if str(result[key]) not in animations:raise ValueError(f'Unknown {key}: {result[key]}')
        return result
    scenarios=[]
    speed_items={item['NAME']:{'level':number(item.get('LEVEL'),1),'speed':number(item.get('SPEED'))} for item in rows(ini('SANGO.INI'),'ITEM')}
    for n in range(1,6):
        records=ini(f'TIMES{n}.INI')
        system=rows(records,'SYSTEM')[0]
        generals=rows(records,'GENERAL');cities=rows(records,'CITY');factions=rows(records,'KING')
        general_entries={r['line']:r['entries'] for r in records if r['kind']=='GENERAL'}
        general_id={g['NAME']:'g-'+g.get('SEQUENCE','bandit') for g in generals}
        city_id={c['NAME']:'c-'+c['_section'][4:] for c in cities}
        faction_id={f['NAME']:'f-'+f['_section'][4:] for f in factions}
        def faction(name):
            if name in faction_id:return faction_id[name]
            return f'f-{int(name):02}' if name.isdigit() and 1<=int(name)<=len(factions) else None
        scene={'id':f'scenario-{n}','title':system['TIME'],'year':number(system['YEAR']),
               'initialization':'native-105plus',
               'factions':[],'cities':[],'roads':[],'generals':[]}
        for i,f in enumerate(factions):
            scene['factions'].append({'id':faction_id[f['NAME']],'name':f['NAME'],'leaderId':general_id.get(f['NAME']),
                'color':COLORS[i%len(COLORS)],'select':number(f['SELECT']),'special':f['NAME']=='盜賊',
                'aiType':number(f.get('TYPE','2')),'flagNumber':number(f.get('FLAGNUM','0'))})
        for c in cities:
            px,py=(number(v)//2 for v in c['POS'].split())
            if not (0<=px<640 and 0<=py<480):raise ValueError(f'City {c["NAME"]} is outside the native terrain mask')
            seasonal_scenery=[]
            for mask in map_masks:
                terrain_id=mask.getpixel((px,py))
                if terrain_id>11:raise ValueError(f'City {c["NAME"]} is outside the native terrain mask')
                seasonal_scenery.append({'terrainId':int(terrain_id),'variant':'a'})
            battle_scenery=seasonal_scenery[0]
            scene['cities'].append({'id':city_id[c['NAME']],'name':c['NAME'],'ownerId':faction(c.get('KING','')),
                'governorId':general_id.get(c.get('MAJOR','')),'position':list(map(int,c['POS'].split())),
                'money':number(c['MONEY']),'population':number(c['POPULATION']),'defense':number(c['DEFENSE']),
                'nativeFlags':number(c.get('FLAGS','0')),'searchCategory':number(c.get('RATE'),3) if 1<=number(c.get('RATE'),3)<=5 else 3,
                'battleScenery':battle_scenery,'battleSceneryBySeason':seasonal_scenery,'battleSceneryMode':'random'})
        for g in generals:
            city=next((c for c in cities if c['NAME']==g.get('CITY')),None)
            fields=general_entries[g['_line']]
            level=initial_level(number(g.get('BASEEXP')))
            base_hp,base_mp=number(g.get('BASEHP')),number(g.get('BASEMP'))
            hp,mp=initial_vitals(base_hp,base_mp,number(g.get('STR')),number(g.get('INT')),level)
            scene['generals'].append({'id':general_id[g['NAME']],'name':g['NAME'],
                'portrait':f"portraits/{g['FACE'][-3:]}.png",'strength':number(g.get('STR')),
                'intelligence':number(g.get('INT')),'hp':hp,'mp':mp,'baseHp':base_hp,'baseMp':base_mp,'level':level,
                'speed':equipment_speed(level,[speed_items[g[key]] for key in ['WEAPON','HORSE','THING'] if g.get(key) in speed_items]),
                'loyalty':number(g.get('LOYAL')),'status':g['STATUS'],'cityId':city_id.get(g.get('CITY','')),
                # 0x42D4C2 literally reads LOYAL as a faction NAME, not LOYALKING.
                # Numeric LOYAL values in this pack therefore resolve to null.
                'loyalFactionId':faction_id.get(g.get('LOYAL','')),
                'ownerId':faction(city.get('KING','')) if city and g['STATUS']=='登' else None,
                'weapon':g.get('WEAPON',''),'horse':g.get('HORSE',''),'item':g.get('THING',''),
                'appearance':appearance(g),'bodyType':number(g.get('TYPE')),'baseExperience':number(g.get('BASEEXP')),
                'unit':g.get('USEFORCE',''),'forceMask':force_mask(g.get('FORCE','')),'formations':g.get('BATTLEARRAY','').split(),
                'skillLearnset':learning_entries(fields,'SKILL'),'strategyLearnset':learning_entries(fields,'WISESKILL'),
                'rawSkill':'\n'.join(v for k,v in fields if k=='SKILL'),
                'rawStrategy':'\n'.join(v for k,v in fields if k=='WISESKILL'),'sourceLine':g['_line']})
        def midpoint(points):
            segments=[];total=0.0
            for start,end in zip(points,points[1:]):
                dx,dy=end[0]-start[0],end[1]-start[1];length=(dx*dx+dy*dy)**.5
                segments.append((start,end,length));total+=length
            if not total:return points[0]
            remaining=total/2
            for start,end,length in segments:
                if remaining<=length:
                    ratio=remaining/length if length else 0
                    return (round(start[0]+(end[0]-start[0])*ratio),round(start[1]+(end[1]-start[1])*ratio))
                remaining-=length
            return points[-1]
        def terrain_at(mask,x,y):
            px,py=x//2,y//2
            if not (0<=px<640 and 0<=py<480):raise ValueError('Road midpoint is outside the native terrain mask')
            value=mask.getpixel((px,py))
            return 5 if value==255 else int(value)
        for r in rows(records,'PATH'):
            points=[list(map(int,p.split(','))) for p in r['POINT'].split()]
            middle=midpoint(points)
            midpoint_terrain=[terrain_at(mask,*middle) for mask in map_masks]
            if any(t>11 for t in midpoint_terrain):raise ValueError(f'Road {r["_section"]} has an invalid terrain mask value')
            scene['roads'].append({'id':'r-'+r['_section'][4:],'from':city_id[r['START']],'to':city_id[r['END']],
                'length':number(r['LENGTH']),'points':points,'restricted':number(r['LENGTH'])>=10000,
                'midpointTerrainBySeason':midpoint_terrain})
        assert len(scene['generals'])==401 and len(scene['cities'])==60 and len(scene['roads'])==116
        scenarios.append(scene)
    content={'version':1,'id':'sg2-105plus-20210916-pack-v1','sourceHash':digest,
             'scenarios':scenarios,'terrains':terrains,'skills':rows(ini('MAGIC.INI'),'MAGIC'),
             'strategies':rows(ini('MAGIC.INI'),'WISE'),'items':rows(ini('SANGO.INI'),'ITEM')}
    (out/'content.json').write_text(json.dumps(content,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
    (out/'manifest.json').write_text(json.dumps({'sourceHash':digest,'converterVersion':2,'assets':asset_records},ensure_ascii=False,indent=2),encoding='utf-8')
    print(f'Built {len(scenarios)} scenarios, {len(asset_records)} images; source SHA256 verified')
    print(f'Content: {(out / "content.json").stat().st_size:,} bytes; assets: {sum(p.stat().st_size for p in out.rglob("*") if p.is_file()):,} bytes')


if __name__=='__main__':main()
