"""Check all explicit resource references and optional SHP assets; render a map.

These checks are static. An unresolved reference may be a sentinel, shorthand,
or unused original-data record; it does not establish an original-game bug.
"""
import collections
import json
import pathlib
import re
import sys
from PIL import Image, ImageDraw, ImageFont
from analyze_game import ROOT, WORKSPACE, shp, values, write_json, write_csv


def read(name):
    return json.loads((ROOT / 'data' / name).read_text(encoding='utf-8'))


def main():
    sys.stdout.reconfigure(encoding='utf-8')
    manifest = read('pak-manifest.json')
    names = {x['path'].upper() for x in manifest}
    configs = read('config-records.json')
    catalog = read('game-catalog.json')
    issues, links, actions, objects = [], [], [], []
    action_keys = {'WAIT','WALK','WIN','LOSE','ATTACK','DEFENSE','DEATH','PAIN','FIRST',
                   *('ATTACK' + str(i) for i in range(2,9)), 'SPELL1','SPELL2','SHOT1','SHOT2','SHOT3'}
    token_counts, event_counts, process_counts = collections.Counter(), collections.Counter(), collections.Counter()
    shape_refs, missing_shape_refs = set(), set()
    for sec in configs['THINGS.INI']['sections']:
        if sec['kind'] != 'OBJECT':
            continue
        obj = values(sec)
        objects.append(dict(obj, _line=sec['line']))
        process_counts[obj.get('PROCESS', '')] += 1
        directory = obj.get('DIRECTORY','').strip('\\')
        for e in sec['entries']:
            if e['key'].upper() not in action_keys:
                continue
            tokens = [t.strip() for t in e['value'].split(',') if t.strip()]
            parsed = []
            for token in tokens:
                if token.startswith('#'):
                    kind = 'timing-directive'
                elif token.startswith('@'):
                    kind = 'event-directive'
                    event_counts[token] += 1
                elif token.startswith('!'):
                    kind = 'script-directive'
                    event_counts[token] += 1
                elif token.startswith('$'):
                    kind = 'sound-directive'
                    candidate = ('SOUND\\' + token[1:] + '.WAV').upper()
                    links.append({'source':'THINGS.INI','line':e['line'],'field':e['key'],
                                  'target':candidate,'resolved':candidate in names})
                    event_counts[token] += 1
                elif token.upper() in ('SCROVER','SCRLOOP','SCRREMOVE','NULL','NUL','0'):
                    kind = 'control-token'
                    event_counts[token] += 1
                elif re.fullmatch(r'[A-Za-z0-9_\\.\-]+',token):
                    candidate = ('SHAPE\\' + directory + '\\' + token).replace('\\\\','\\').upper()
                    if not candidate.endswith('.SHP'):
                        candidate += '.SHP'
                    kind = 'shape' if candidate in names else 'unresolved-name'
                    shape_refs.add(candidate)
                    if kind == 'unresolved-name':
                        missing_shape_refs.add(candidate)
                    links.append({'source': 'THINGS.INI', 'line': e['line'], 'field': e['key'],
                                  'target': candidate, 'resolved': candidate in names})
                else:
                    kind = 'other-directive'
                    event_counts[token] += 1
                token_counts[kind] += 1
                parsed.append({'raw':token,'kind':kind})
            actions.append({'object':obj.get('SEQUENCE'), 'name':obj.get('NAME'), 'action':e['key'],
                            'line':e['line'], 'directory':directory, 'tokens':parsed})
    scenario_checks = []
    for filename, scene in catalog['scenarios'].items():
        generals = {x['NAME'] for x in scene['GENERAL']}
        cities = {x['NAME'] for x in scene['CITY']}
        kings = {x['NAME'] for x in scene['KING']}
        items = {x['NAME'] for x in catalog['items']}
        adjacency = {x: set() for x in cities}
        local = []
        checks = 0
        def ref(value, targets, row, field, allowed=('',)):
            nonlocal checks
            checks += 1
            if value not in targets and value not in allowed:
                local.append({'source':filename,'line':row['_line'],'field':field,'value':value})
        for row in scene['PATH']:
            ref(row['START'],cities,row,'PATH.START')
            ref(row['END'],cities,row,'PATH.END')
            if row['START'] in cities and row['END'] in cities:
                adjacency[row['START']].add(row['END'])
                adjacency[row['END']].add(row['START'])
        for row in scene['CITY']:
            ref(row.get('KING',''),kings,row,'CITY.KING',('',*map(str,range(33))))
            for k in ('MAJOR','WISE'):
                ref(row.get(k,''),generals,row,'CITY.'+k)
        for row in scene['GENERAL']:
            ref(row.get('CITY',''),cities,row,'GENERAL.CITY')
            for token in row.get('POS','').split():
                ref(token,cities,row,'GENERAL.POS',('未',))
            for field in ('WEAPON','HORSE','THING'):
                ref(row.get(field,''),items,row,'GENERAL.'+field)
            for field in ('BLOOD','LOYALKING'):
                for token in row.get(field,'').split():
                    ref(token,generals,row,'GENERAL.'+field)
            face='SHAPE\\'+row.get('FACE','')+'.SHP'
            if face.upper() not in names:
                local.append({'source':filename,'line':row['_line'],'field':'GENERAL.FACE','value':face})
        visited=set()
        components=[]
        for city in sorted(cities):
            if city in visited: continue
            queue=[city];component=[];visited.add(city)
            while queue:
                current=queue.pop();component.append(current)
                for neighbor in adjacency[current] - visited:
                    visited.add(neighbor);queue.append(neighbor)
            components.append(component)
        scenario_checks.append({'file':filename,'checks':checks,'issues':local,
                                'undirected_connected_components':components})
        issues.extend(local)
    optional=[]
    game=pathlib.Path(read('summary.json')['source'])
    for path in sorted(game.rglob('*')):
        if path.is_file() and path.suffix.lower()=='.shp':
            blob=path.read_bytes()
            try:
                sprite=shp.decode(blob)
                exact=shp.encode(sprite)==blob
                optional.append({'path':path.relative_to(game).as_posix(),'width':sprite.width,'height':sprite.height,
                                 'decoded':True,'roundtrip_exact':exact})
                if not exact: issues.append({'source':str(path),'error':'roundtrip different'})
            except Exception as ex:
                optional.append({'path':path.relative_to(game).as_posix(),'decoded':False,'error':str(ex)})
                issues.append({'source':str(path),'error':str(ex)})
    summary={'objects':len(objects),'unique_object_ids':len({o.get('SEQUENCE') for o in objects}),
             'duplicate_ids':{k:v for k,v in collections.Counter(o.get('SEQUENCE') for o in objects).items() if v>1},
             'process_counts':dict(process_counts),'actions':len(actions),'tokens':dict(token_counts),
             'event_directives':dict(event_counts),'unique_shape_references':len(shape_refs),
             'unresolved_shape_references':sorted(missing_shape_refs),'scenario_checks':scenario_checks,
             'optional_shp_count':len(optional),'optional_shp_decoded':sum(x['decoded'] for x in optional),
             'optional_shp_roundtrip_exact':sum(x.get('roundtrip_exact',False) for x in optional),'issues':issues}
    write_json(ROOT/'data/content-checks.json',summary)
    write_json(ROOT/'data/animation-actions.json',actions)
    write_json(ROOT/'data/object-definitions.json',objects)
    write_json(ROOT/'data/optional-shp-checks.json',optional)
    write_csv(ROOT/'data/resource-links.csv',links,['source','line','field','target','resolved'])
    # Actual route points from Times1, not a guessed straight-line road graph.
    map_file=ROOT/'previews/SHAPE__MAP__CHINAMAP.SHP.png'
    image=Image.open(map_file).convert('RGBA')
    overlay=Image.new('RGBA',image.size)
    draw=ImageDraw.Draw(overlay)
    font=ImageFont.truetype('C:/Windows/Fonts/msyh.ttc',14)
    scene=catalog['scenarios']['TIMES1.INI']
    for path in scene['PATH']:
        points=[tuple(map(int,t.split(','))) for t in path['POINT'].split()]
        draw.line(points,fill=(255,238,130,210),width=2)
    for city in scene['CITY']:
        x,y=map(int,city['POS'].split())
        draw.ellipse((x-4,y-4,x+4,y+4),fill=(250,90,70,255),outline='white')
        draw.text((x+5,y-12),city['NAME'],font=font,fill='white',stroke_width=2,stroke_fill='#18232a')
    Image.alpha_composite(image,overlay).convert('RGB').save(ROOT/'previews/world-map-routes.png')
    # Resolve and display primitive categories without asserting runtime directive semantics.
    columns=['SEQUENCE','NAME','TYPE','PROCESS','DIRECTORY','SPACE','_line']
    write_csv(ROOT/'data/object-definitions.csv',objects,columns)
    for name in ('items','terrain','magic','strategies'):
        rows=catalog[name]
        fields=list(dict.fromkeys(k for row in rows for k in row))
        write_csv(ROOT/'data'/f'{name}.csv',rows,fields)
    for filename,scene in catalog['scenarios'].items():
        for category in ('GENERAL','CITY','PATH','KING'):
            rows=scene[category]
            fields=list(dict.fromkeys(k for row in rows for k in row))
            write_csv(ROOT/'data'/f'{filename.lower()}-{category.lower()}.csv',rows,fields)
    print(json.dumps({k:summary[k] for k in ('objects','unique_object_ids','duplicate_ids','actions','tokens','unique_shape_references','unresolved_shape_references','optional_shp_count','optional_shp_decoded','optional_shp_roundtrip_exact')},ensure_ascii=False,indent=2))
    print('Scenario reference issues:',len(issues))
    print('Components per scenario:',[len(s['undirected_connected_components']) for s in scenario_checks])


if __name__=='__main__':
    main()
