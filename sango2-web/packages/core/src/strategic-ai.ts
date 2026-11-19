import type {ScenarioDefinition} from '@sango2/content';
import type {Command} from './index';

export type StrategicAction=Extract<Command,{type:'develop'|'recruit'|'march'}>;

/** Web-only AI-versus-AI battle resolution estimate. Never used for native
 * strategic candidate generation or selection. Native battle outcome is pending. */
export function armyPower(scene:ScenarioDefinition,troops:number,ids:string[]) {
  const strength=ids.length?ids.reduce((sum,id)=>sum+(scene.generals.find(g=>g.id===id)?.strength??45),0)/ids.length:45;
  return (troops+ids.length*25)*(0.6+strength/100);
}
