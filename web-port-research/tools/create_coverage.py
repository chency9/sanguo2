"""Create initial implementation coverage; every feature starts unimplemented."""
import collections
import json
from analyze_game import ROOT, write_csv, write_json


def main():
    catalog = json.loads((ROOT/'data/game-catalog.json').read_text(encoding='utf-8'))
    objects = json.loads((ROOT/'data/object-definitions.json').read_text(encoding='utf-8'))
    rows = []
    def add(category, source, record, ordinal):
        source_id = record.get('SEQUENCE', record.get('_section', str(ordinal)))
        rows.append({'category':category,'source':source,'source_id':source_id,'source_line':record.get('_line',''),
                     'name':record.get('NAME',record.get('TIME',record.get('START','')+' -> '+record.get('END',''))),
                     'raw_record_parsed':'yes','runtime_semantics':'pending',
                     'web_implementation':'not_started','behavior_comparison':'not_run','notes':''})
    for filename, scene in catalog['scenarios'].items():
        for category in ('SYSTEM','KING','CITY','PATH','GENERAL'):
            for i, record in enumerate(scene[category],1):
                add('scenario.'+category.lower(),filename,record,i)
    for category,source in [('items','SANGO.INI'),('terrain','SANGO.INI'),('magic','MAGIC.INI'),('strategies','MAGIC.INI')]:
        for i,record in enumerate(catalog[category],1):
            add(category,source,record,i)
    for i,record in enumerate(objects,1):
        add('object','THINGS.INI',record,i)
        if record.get('SEQUENCE')=='17021':
            rows[-1]['notes']='two identical source declarations; one normalized definition'
        elif record.get('SEQUENCE')=='99':
            rows[-1]['notes']='test object: eight unresolved sprite names; runtime reachability unverified'
    write_csv(ROOT/'data/content-coverage.csv',rows,list(rows[0]))
    result={'total_source_records':len(rows),'by_category':dict(collections.Counter(r['category'] for r in rows)),
            'web_implemented':0,'behavior_verified':0,
            'note':'Counts include scenario-specific records and duplicate original object declarations, not unique game entities.'}
    write_json(ROOT/'data/content-coverage-summary.json',result)
    print(json.dumps(result,ensure_ascii=False))


if __name__=='__main__':
    main()
