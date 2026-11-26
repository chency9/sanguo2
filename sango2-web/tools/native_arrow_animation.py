"""ArrowSupport WAIT artwork with verified original node messages.

The renderer receives messages as metadata; the source SO runtime dispatches
them. Unknown messages fail conversion rather than silently disappearing.
"""
import re
from native_animation import attack_frames,attack_timeline

def arrow_wait_animation(text,directory):
    cleaned=[];messages=[];shapes=0
    for raw in text.split(','):
        token=raw.strip().upper()
        if token.startswith('!'):
            if token not in ['!6003','!6004'] or shapes==0:raise ValueError(f'Unverified ArrowSupport script node: {token}')
            messages.append((shapes-1,'script',int(token[1:])))
        elif token=='@%OM_REMOVE':
            if shapes==0:raise ValueError('ArrowSupport removal before shape')
            messages.append((shapes-1,'remove',3))
        else:
            cleaned.append(raw)
            if re.fullmatch(r'[A-Z][A-Z0-9]{5,}',token) and token!='SCROVER':shapes+=1
            if token=='SCROVER':break
    frames=attack_frames(','.join(cleaned),directory,finite=False);timing=attack_timeline(frames)
    script_ticks=[]
    for index,kind,value in messages:
        tick=sum(f['ticks'] for f in frames[:index])
        if kind=='script':script_ticks.append(dict(tick=tick,script=value))
        else:timing['removeTick']=tick
    return {'frames':[{'key':f['key'],'ticks':f['ticks']} for f in frames],**timing,
            'loop':'SCROVER' not in text.upper(),'scriptTicks':script_ticks}
