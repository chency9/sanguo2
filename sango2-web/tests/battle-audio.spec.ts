import {test,expect,type Page} from '@playwright/test';
import {finishInitialPolicy} from './campaign-fixture';

interface Voice {id:number;path:string;duration:number;state:string}
interface SoundProbe {requests:string[];decoded:{path:string;duration:number;peak:number;length:number}[];starts:Voice[];stops:number[]}
type AudioWindow=Window&{soundProbe:SoundProbe;audioHarness?:{player:{setEnabled(value:boolean):Promise<void>;reset(battle:unknown):void;consume(battle:unknown):void;dispose():void};battle:{id:string;round:number;soundEvents:{nextId:number;events:{id:number;sourceTick:number;name:string;volume:number}[]}}}};

/** Observes native browser operations without replacing decoding or playback. */
class BattleAudioScreen {
  constructor(readonly page:Page){}
  get battle(){return this.page.getByRole('main');}
  get canvas(){return this.page.getByRole('img',{name:'实时战场画面'});}
  get heal(){return this.battle.getByRole('button',{name:/命療術/});}
  async instrument(){
    await this.page.addInitScript(()=>{
      const state=window as unknown as AudioWindow;state.soundProbe={requests:[],decoded:[],starts:[],stops:[]};
      const paths=new WeakMap<ArrayBuffer,string>(),buffers=new WeakMap<AudioBuffer,string>(),voices=new WeakMap<AudioBufferSourceNode,number>();
      const fetchOriginal=window.fetch;
      window.fetch=async function(...args:Parameters<typeof fetch>){
        const response=await fetchOriginal.apply(this,args),url=String(args[0] instanceof Request?args[0].url:args[0]);
        if(/\/assets\/sound\/.*\.wav$/i.test(url)){
          state.soundProbe.requests.push(url);const read=response.arrayBuffer.bind(response);
          response.arrayBuffer=async()=>{const data=await read();paths.set(data,url);return data;};
        }
        return response;
      };
      const decode=AudioContext.prototype.decodeAudioData;
      AudioContext.prototype.decodeAudioData=function(data:ArrayBuffer){
        const path=paths.get(data)??'';
        return decode.call(this,data).then(buffer=>{
          buffers.set(buffer,path);const samples=buffer.getChannelData(0);let peak=0;
          for(let i=0;i<samples.length;i++)peak=Math.max(peak,Math.abs(samples[i]));
          state.soundProbe.decoded.push({path,duration:buffer.duration,peak,length:buffer.length});return buffer;
        });
      };
      const start=AudioBufferSourceNode.prototype.start,stop=AudioBufferSourceNode.prototype.stop;
      AudioBufferSourceNode.prototype.start=function(...args:Parameters<typeof start>){
        const id=state.soundProbe.starts.length+1;voices.set(this,id);
        state.soundProbe.starts.push({id,path:this.buffer?buffers.get(this.buffer)??'':'',duration:this.buffer?.duration??0,state:this.context.state});
        return Reflect.apply(start,this,args);
      };
      AudioBufferSourceNode.prototype.stop=function(...args:Parameters<typeof stop>){state.soundProbe.stops.push(voices.get(this)??0);return Reflect.apply(stop,this,args);};
    });
  }
  async open(){
    await this.instrument();
    await this.page.route('**/assets/content.json',async route=>{
      const response=await route.fetch(),content=await response.json();
      const generals=content.scenarios[0].generals,caster=generals.find((g:{name:string})=>g.name==='曹操');
      caster.skillLearnset=[{level:1,sequence:1}];caster.rawSkill='1, 1';caster.mp=150;caster.intelligence=10000;
      generals.find((g:{name:string})=>g.name==='張角').skillLearnset=[];
      await route.fulfill({response,json:content});
    });
    await this.page.goto('/');await this.page.getByRole('button',{name:/执掌何進/}).click();await finishInitialPolicy(this.page);
    await this.page.getByRole('button',{name:'演武场',exact:true}).click();
    await expect(this.battle.getByRole('button',{name:'擂鼓开战'})).toBeEnabled();
  }
  probe(){return this.page.evaluate(()=>(window as unknown as AudioWindow).soundProbe);}
  async settleRender(){await this.page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));}
  async readyToCast(){
    await this.page.getByLabel('战场速度').selectOption('4');
    const start=this.battle.getByRole('button',{name:'擂鼓开战'});
    if(await start.count())await start.click();
    else await this.battle.getByRole('button',{name:'继续战斗',exact:true}).click();
    await expect(this.heal).toBeEnabled({timeout:15000});
    await this.battle.getByRole('button',{name:'暂停战斗',exact:true}).click();
  }
  async cast(speed='1'){
    await this.heal.click();await expect(this.canvas).toHaveAttribute('data-magic-script-kind','native-heal');
    await this.page.getByLabel('战场速度').selectOption(speed);
    await this.battle.getByRole('button',{name:'继续战斗',exact:true}).click();
  }
}

test('real skill WAV stays opt-in, decodes and plays after enabling, and stops independently of music',async({page},testInfo)=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  const screen=new BattleAudioScreen(page);await screen.open();
  await expect(screen.battle.getByRole('button',{name:'音效关',exact:true})).toHaveAttribute('aria-pressed','false');
  await expect(screen.battle.getByRole('button',{name:'音乐关',exact:true})).toHaveAttribute('aria-pressed','false');
  await screen.readyToCast();await screen.cast('4');
  await expect(screen.canvas).toHaveAttribute('data-magic-script-kind','idle',{timeout:15000});
  await screen.battle.getByRole('button',{name:'暂停战斗',exact:true}).click();
  expect(await screen.probe()).toEqual({requests:[],decoded:[],starts:[],stops:[]});
  await screen.battle.getByRole('button',{name:'音效关',exact:true}).click();await screen.settleRender();
  await expect(screen.battle.getByRole('button',{name:'音效开',exact:true})).toHaveAttribute('aria-pressed','true');
  expect((await screen.probe()).requests).toEqual([]);
  await screen.battle.getByRole('button',{name:'音乐关',exact:true}).click();
  await expect(screen.battle.getByRole('button',{name:'音乐开',exact:true})).toHaveAttribute('aria-pressed','true');
  expect(await page.locator('audio').evaluate(audio=>(audio as HTMLAudioElement).paused)).toBe(false);
  await screen.readyToCast();await screen.cast();
  await expect.poll(async()=>(await screen.probe()).starts.filter(voice=>voice.path.endsWith('/m016snd01.wav')).length,{timeout:10000}).toBe(1);
  await screen.battle.getByRole('button',{name:'暂停战斗',exact:true}).click();
  const heard=await screen.probe(),voice=heard.starts.find(voice=>voice.path.endsWith('/m016snd01.wav'))!;
  expect(voice.state).toBe('running');expect(voice.duration).toBeGreaterThan(3);
  expect(heard.decoded.find(buffer=>buffer.path.endsWith('/m016snd01.wav'))).toMatchObject({length:expect.any(Number),peak:expect.any(Number)});
  expect(heard.decoded.find(buffer=>buffer.path.endsWith('/m016snd01.wav'))!.peak).toBeGreaterThan(.01);
  await screen.battle.getByRole('button',{name:'音效开',exact:true}).click();
  await expect.poll(async()=>(await screen.probe()).stops).toContain(voice.id);
  expect(await page.locator('audio').evaluate(audio=>(audio as HTMLAudioElement).paused)).toBe(false);
  await expect(screen.battle.getByRole('button',{name:'音乐开',exact:true})).toHaveAttribute('aria-pressed','true');
  await screen.battle.getByRole('button',{name:'音效关',exact:true}).click();await screen.settleRender();
  expect((await screen.probe()).starts.filter(voice=>voice.path.endsWith('/m016snd01.wav'))).toHaveLength(1);
  await screen.battle.getByRole('button',{name:'音乐开',exact:true}).click();
  expect(await page.locator('audio').evaluate(audio=>(audio as HTMLAudioElement).paused)).toBe(true);
  await expect(screen.battle.getByRole('button',{name:'音效开',exact:true})).toHaveAttribute('aria-pressed','true');
  await testInfo.attach('browser-native-wav-playback.json',{body:Buffer.from(JSON.stringify(await screen.probe(),null,2)),contentType:'application/json'});
  expect(errors).toEqual([]);
});

test('queued WAV decoding is discarded after disable, round change and save restoration',async({page})=>{
  const screen=new BattleAudioScreen(page);await screen.instrument();await page.goto('/');
  // Exercise the output sink with real browser decoding and deliberately late
  // network completion; no simulated game or RNG state needs to be modified.
  await page.getByRole('button',{name:'关闭对话框'}).click();
  await page.evaluate(async()=>{
    const modulePath='/src/battle-sound.ts',{BattleSoundPlayer}=await import(modulePath);
    const battle={id:'audio-output',round:1,soundEvents:{nextId:2,events:[{id:1,sourceTick:0,name:'SOUND\\M016SND01.WAV',volume:255}]}};
    const player=new BattleSoundPlayer([{id:'SOUND\\M016SND01.WAV',path:'sound/m016snd01.wav'}]);
    (window as unknown as AudioWindow).audioHarness={player,battle};await player.setEnabled(true);player.reset(battle);player.consume(battle);
  });
  await screen.settleRender();expect((await screen.probe()).requests).toEqual([]);
  for(const action of ['disable','round','restore'] as const){
    // A new output instance gives every case a genuinely pending fetch/decode.
    await page.evaluate(async()=>{
      const state=window as unknown as AudioWindow,modulePath='/src/battle-sound.ts',{BattleSoundPlayer}=await import(modulePath);
      state.audioHarness!.player.dispose();
      const battle={id:'audio-output',round:1,soundEvents:{nextId:1,events:[] as {id:number;sourceTick:number;name:string;volume:number}[]}};
      const player=new BattleSoundPlayer([{id:'SOUND\\M016SND01.WAV',path:'sound/m016snd01.wav'}]);state.audioHarness={player,battle};
      await player.setEnabled(true);player.reset(battle);
    });
    let release!:()=>void,markRequested!:()=>void;
    const gate=new Promise<void>(resolve=>release=resolve),requested=new Promise<void>(resolve=>markRequested=resolve);
    await page.route('**/assets/sound/m016snd01.wav',async route=>{markRequested();await gate;await route.continue();},{times:1});
    const before=await screen.probe();
    await page.evaluate(()=>{
      const {player,battle}=(window as unknown as AudioWindow).audioHarness!;
      battle.soundEvents.events.push({id:battle.soundEvents.nextId++,sourceTick:1,name:'SOUND\\M016SND01.WAV',volume:255});player.consume(battle);
    });
    await requested;
    await page.evaluate(async action=>{
      const harness=(window as unknown as AudioWindow).audioHarness!;
      if(action==='disable')await harness.player.setEnabled(false);
      else if(action==='round'){harness.battle.round++;harness.player.consume(harness.battle);}
      else {harness.battle=JSON.parse(JSON.stringify(harness.battle));harness.player.reset(harness.battle);harness.player.consume(harness.battle);}
    },action);
    release();
    await expect.poll(async()=>(await screen.probe()).decoded.length).toBe(before.decoded.length+1);
    await screen.settleRender();expect((await screen.probe()).starts).toHaveLength(before.starts.length);
    await page.evaluate(async()=>{const {player,battle}=(window as unknown as AudioWindow).audioHarness!;await player.setEnabled(true);player.consume(battle);});
    await screen.settleRender();expect((await screen.probe()).starts).toHaveLength(before.starts.length);
  }
  // A newly emitted callback still plays after those cancellations, proving
  // that the assertions did not merely leave a permanently muted player.
  await page.evaluate(()=>{const {player,battle}=(window as unknown as AudioWindow).audioHarness!;battle.soundEvents.events.push({id:battle.soundEvents.nextId++,sourceTick:2,name:'SOUND\\M016SND01.WAV',volume:192});player.consume(battle);});
  await expect.poll(async()=>(await screen.probe()).starts.length).toBe(1);
  await page.evaluate(()=>(window as unknown as AudioWindow).audioHarness!.player.dispose());
  await expect.poll(async()=>(await screen.probe()).stops.length).toBe(1);
});

