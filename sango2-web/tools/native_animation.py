"""THINGS action nodes, transcribed from 0x436B9A (not legacy flat timing).

This intentionally accepts only the verified attack grammar used by exported
actors. Unrecognized messages/scripts fail conversion instead of disappearing.
"""
import re

def attack_frames(text, directory, *, finite=True):
    frames=[];duration=1;loop=True
    for raw in text.split(','):
        token=raw.strip().upper()
        if not token:continue
        if token.startswith('#'):
            duration=int(token[1:],0)
            if duration<0:raise ValueError('Negative action duration')
            if frames:frames[-1]['ticks']=duration
        elif token=='@%OM_ATTACK':
            if frames:frames[-1]['hit']=True
        elif token.startswith('$'):
            # Source sound lookup is independent of visual frame/event timing.
            if frames:frames[-1]['sound']=token[1:]
        elif token=='SCROVER':
            loop=False;break
        elif token.endswith('*'):
            # Original parser deliberately skips starred shape entries.
            continue
        elif re.fullmatch(r'[A-Z][A-Z0-9]{5,}',token):
            frames.append({'key':'SHAPE'+directory.rstrip('\\').upper()+'\\'+token+'.SHP','ticks':duration,'hit':False})
        else:raise ValueError(f'Unverified attack token: {token}')
    if frames and (sum(f['ticks'] for f in frames)<=0 or finite and loop):raise ValueError('Expected a finite attack action')
    return frames

def attack_timeline(frames):
    elapsed=0;hits=[];sounds=[]
    for frame in frames:
        if frame['hit']:hits.append(elapsed)
        if frame.get('sound'):
            # 0x421BF2 node entry invokes positional playback at volume 192.
            sounds.append({'tick':elapsed,'name':'SOUND\\'+frame['sound']+'.WAV','volume':192})
        elapsed+=frame['ticks']
    return {'ticks':elapsed,'hitTicks':hits,'frameTicks':[f['ticks'] for f in frames],'soundTicks':sounds}
