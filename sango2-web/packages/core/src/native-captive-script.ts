import data from './native-captive-script-data.json';
import {nativeBelow,type NativeRandomState} from './native-strategic-ai';

export type NativeCaptiveChoice='yield'|'kill'|'free';
export interface NativeCaptiveScriptContext {rulerId:string;captiveId:string;rulerName?:string;captiveName?:string}
export interface NativeCaptiveDialogue {channel:number;speakerId:string;messageId:number;rawText:string;text:string}
export interface NativeCaptiveScriptEvent {t:number;host:number;args:(number|string)[]}
export interface NativeCaptiveScript {
  version:1;choice:NativeCaptiveChoice;accepted:boolean;context:NativeCaptiveScriptContext;
  /** Only the verified original three functions are executable. */
  vm:{ip:number;frame:number;stack:(number|string)[]};
  phase:'ready'|'dialogue'|'wait'|'done';age:number;waitRemaining:number;
  dialogue?:NativeCaptiveDialogue;callback?:521|528|529;
}
const words=data.words,offset=data.codeOffset,strings=data.strings as Record<string,string>,messages=data.messages as Record<string,string>;
const argCounts:Record<number,number>={2:1,3:1,5:2,6:1,7:1,8:1,10:1,11:1,59:1,64:2};
const instructionAddresses=new Set<number>();
for(let index=0;index<words.length;) {
  instructionAddresses.add(offset+index*4);index+=1+(argCounts[words[index]]??0);
}
instructionAddresses.add(offset+words.length*4);
const valueNumber=(value:number|string)=>{if(typeof value!=='number')throw new Error('Invalid native captive numeric operand');return value|0;};

/** Original MESSAGE.INI text. Its wait/end formatting tokens remain in
 * rawText for presentation; text substitutes only the two supplied speakers. */
export function nativeCaptiveMessage(messageId:number,context:NativeCaptiveScriptContext):{rawText:string;text:string}|undefined {
  const rawText=messages[String(messageId)];if(rawText===undefined)return;
  return {rawText,text:rawText.replace(/%S1%/gi,context.rulerName??context.rulerId).replace(/%S2%/gi,context.captiveName??context.captiveId).replace(/%[KLE]%/gi,'')};
}
/** Initialization consumes no RNG. The first source update executes only as
 * far as the first blocking dialogue, preserving the original future draws. */
export function createNativeCaptiveScript(choice:NativeCaptiveChoice,accepted:boolean,context:NativeCaptiveScriptContext):NativeCaptiveScript {
  const stack=choice==='yield'?[accepted?1:0,0,0,0]:[0,0];
  return {version:1,choice,accepted,context:{...context},vm:{ip:data.entries[choice],frame:stack.length-1,stack},phase:'ready',age:0,waitRemaining:0};
}

/** Executes original SYSTEM.SO words. Hosts10/3 retain the 0x41F924 dialogue
 * wait; host771 executes native RNG at the actual instruction. %E% closes the
 * presentation window immediately in this adapter. Its original UI fade and
 * letter-by-letter rendering remain presentation boundaries. */
export function advanceNativeCaptiveScript(s:NativeCaptiveScript,rng:NativeRandomState,input:{type:'source-tick'}|{type:'dialogue-next'},emit:(event:NativeCaptiveScriptEvent)=>void=()=>{}):void {
  if(s.phase==='done')return;
  if(input.type==='dialogue-next') {
    if(s.phase==='dialogue'){delete s.dialogue;s.phase='ready';}
    return;
  }
  if(s.phase==='dialogue'){s.age++;return;}
  if(s.phase==='wait'&&s.waitRemaining>0){s.waitRemaining--;s.age++;return;}
  s.phase='ready';
  const vm=s.vm,pop=()=>{const value=vm.stack.pop();if(value===undefined)throw new Error('Native captive stack underflow');return value;};
  const read=()=>{const index=(vm.ip-offset)/4;if(!Number.isInteger(index)||index<0||index>=words.length)throw new Error('Native captive instruction outside source scripts');vm.ip+=4;return words[index];};
  const host=(host:number,args:(number|string)[])=>emit({t:s.age,host,args});
  for(let budget=0;budget<1000;budget++) {
    const opcode=read();
    if(opcode===2) {read();s.phase='done';break;}
    if(opcode===3) {for(let count=read();count>0;count--)vm.stack.push(0);}
    else if(opcode===6)vm.stack.push(read()|0);
    else if(opcode===7) {const text=strings[String(read())];if(text===undefined)throw new Error('Unknown native captive literal');vm.stack.push(text);}
    else if(opcode===8) {const value=vm.stack[vm.frame+(read()|0)];if(value===undefined)throw new Error('Invalid native captive local');vm.stack.push(value);}
    else if(opcode===10) {const global=read();if(global!==7&&global!==8)throw new Error('Unsupported native captive global');vm.stack.push(global===7?s.context.rulerId:s.context.captiveId);}
    else if(opcode===11) {const local=read()|0,value=pop();vm.stack[vm.frame+local]=value;}
    else if(opcode===14)pop();
    else if(opcode===15||opcode===20) {const right=valueNumber(pop()),left=valueNumber(pop());vm.stack.push(opcode===15?(left+right)|0:Math.imul(left,right));}
    else if(opcode===59)vm.ip=read();
    else if(opcode===64) {const value=pop(),expected=read()|0,target=read();if(value===expected)vm.ip=target;else vm.stack.push(value);}
    else if(opcode===66) {
      const count=valueNumber(pop());
      if(count>0){s.waitRemaining=count-1;s.phase='wait';break;}
    } else if(opcode===5) {
      const id=read(),signature=read(),count=signature&0xffff,args=vm.stack.splice(vm.stack.length-count,count);let result:number|string=0;
      if(id===771) {
        let a=valueNumber(args[0]),b=valueNumber(args[1]);if(a>b)[a,b]=[b,a];
        result=(a+nativeBelow(rng,(b-a+1)|0))|0;
      } else if(id===512) {
        host(id,args);result=args[0]===s.context.rulerId?s.context.rulerName??s.context.rulerId:s.context.captiveName??s.context.captiveId;
      } else if(id===10) {
        host(id,args);const messageId=valueNumber(args[2]),message=nativeCaptiveMessage(messageId,s.context);
        if(message){s.dialogue={channel:valueNumber(args[0]),speakerId:String(args[1]),messageId,...message};s.phase='dialogue';}
      } else if(id===3) {
        host(id,args);
        if(args[2]!=='%E%')throw new Error('Unsupported native captive direct dialogue');
      } else if(id===6||id===769)host(id,args);
      else if(id===521||id===528||id===529) {host(id,args);s.callback=id;}
      else throw new Error(`Unsupported native captive host ${id}`);
      if(signature>>>16)vm.stack.push(result);
      if(s.phase==='dialogue')break;
    } else throw new Error(`Unsupported native captive opcode ${opcode}`);
    if(budget===999)throw new Error('Native captive script exhausted its instruction budget');
  }
  s.age++;
}

export function validateNativeCaptiveScript(s:NativeCaptiveScript,fail:()=>never):void {
  const integer=(n:unknown,min=0,max=Number.MAX_SAFE_INTEGER):n is number=>typeof n==='number'&&Number.isSafeInteger(n)&&n>=min&&n<=max;
  if(!s||s.version!==1||!['yield','kill','free'].includes(s.choice)||typeof s.accepted!=='boolean'||!s.context||
    typeof s.context.rulerId!=='string'||typeof s.context.captiveId!=='string'||!s.vm||!instructionAddresses.has(s.vm.ip)||
    !integer(s.vm.frame,0,3)||!Array.isArray(s.vm.stack)||s.vm.stack.length>64||s.vm.stack.some(v=>typeof v!=='string'&&!integer(v,-2147483648,2147483647))||
    !['ready','dialogue','wait','done'].includes(s.phase)||!integer(s.age)||!integer(s.waitRemaining,0,19)||
    (s.phase==='dialogue')!==(s.dialogue!==undefined)||s.callback!==undefined&&![521,528,529].includes(s.callback))fail();
  if(s.dialogue) {
    const message=nativeCaptiveMessage(s.dialogue.messageId,s.context);
    if(!message||s.dialogue.rawText!==message.rawText||s.dialogue.text!==message.text||![0,1].includes(s.dialogue.channel)||
      ![s.context.rulerId,s.context.captiveId].includes(s.dialogue.speakerId))fail();
  }
  if(s.phase==='done'&&s.callback!==({kill:521,free:528,yield:529} as const)[s.choice])fail();
}
