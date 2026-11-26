import type {SoundDefinition} from '@sango2/content';
import type {BattleState} from '@sango2/core';

interface SoundEvent {id:number;sourceTick:number;name:string;volume:number}
const soundKey=(name:string)=>name.replace(/^SOUND[\\/]/i,'').replace(/\.WAV$/i,'').toUpperCase();

/** Browser playback is an output sink: it never changes simulation or RNG.
 * Source callbacks retain their original names, volumes and update numbers. */
export class BattleSoundPlayer {
  private context:AudioContext|null=null;
  private master:GainNode|null=null;
  private buffers=new Map<string,Promise<AudioBuffer|null>>();
  private paths:Map<string,string>;
  private voices=new Set<AudioBufferSourceNode>();
  private enabled=false;
  private generation=0;
  private key='';
  private lastId=0;
  constructor(sounds:readonly SoundDefinition[]) {
    this.paths=new Map(sounds.map(sound=>[soundKey(sound.id),`/assets/${sound.path}`]));
  }
  /** Call directly in a user's click handler to satisfy autoplay policies. */
  async setEnabled(enabled:boolean):Promise<void> {
    this.enabled=enabled;this.generation++;
    if(!enabled){this.stopVoices();return;}
    if(!this.context) {
      this.context=new AudioContext();this.master=this.context.createGain();
      this.master.gain.value=.35;this.master.connect(this.context.destination);
    }
    try {await this.context.resume();}
    catch(error){this.enabled=false;throw error;}
  }
  private stopVoices():void {
    for(const source of this.voices)source.stop();
    this.voices.clear();
  }
  /** Loading a battle marks its existing queue as heard. No old callback is
   * replayed when restoring a save, enabling audio, or opening a new round. */
  reset(battle:BattleState|null):void {
    this.generation++;this.stopVoices();
    this.key=battle?`${battle.id}/${battle.round}`:'';
    this.lastId=battle?.soundEvents?.events.at(-1)?.id??0;
  }
  consume(battle:BattleState|null):void {
    const key=battle?`${battle.id}/${battle.round}`:'';
    if(key!==this.key){this.reset(battle);return;}
    if(!battle?.soundEvents)return;
    for(const event of battle.soundEvents.events)if(event.id>this.lastId) {
      this.lastId=event.id;
      if(this.enabled&&document.visibilityState==='visible')void this.play(event);
    }
  }
  private async play(event:SoundEvent):Promise<void> {
    const ctx=this.context,path=this.paths.get(soundKey(event.name));
    if(!ctx||!path||!this.master)return;
    const epoch=this.generation,requestedAt=performance.now();
    let pending=this.buffers.get(path);
    if(!pending) {
      // Fetch only a requested sound. There is no upfront 99-file preload.
      pending=fetch(path).then(response=>response.ok?response.arrayBuffer():null)
        .then(data=>data?ctx.decodeAudioData(data):null).catch(()=>null);
      this.buffers.set(path,pending);
    }
    const buffer=await pending;
    if(!buffer||!this.enabled||epoch!==this.generation||document.visibilityState!=='visible'||ctx.state!=='running'||performance.now()-requestedAt>1000)return;
    // Bound the output mixer when fast-forwarding large formations. This does
    // not suppress or reorder source events in the saved simulation.
    if(this.voices.size>=32) {
      const oldest=this.voices.values().next().value;
      if(oldest){this.voices.delete(oldest);oldest.stop();}
    }
    const source=ctx.createBufferSource(),gain=ctx.createGain();
    source.buffer=buffer;gain.gain.value=Math.max(0,Math.min(255,event.volume))/255;
    source.connect(gain);gain.connect(this.master);this.voices.add(source);
    source.onended=()=>{this.voices.delete(source);source.disconnect();gain.disconnect();};
    source.start();
  }
  silence():void {this.generation++;this.stopVoices();}
  dispose():void {
    this.enabled=false;this.silence();this.buffers.clear();
    if(this.context)void this.context.close();this.context=null;this.master=null;
  }
}
