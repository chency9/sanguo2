import data from './native-formation-positions.json';
import {nativeTroopDivisions} from './native-troops';

export interface FormationSoldier {x:number;y:number;division:number;reserve:boolean}
export interface NativeDeploymentInput {
  formation:number;active:number;reserve:number;mirror:boolean;mode?:number;obstacles?:readonly (readonly number[])[];
}

/** 0x404DAF + 0x442CB6: source coordinates, signed division and mirroring. */
function transform(x:number,y:number,total:number,mirror:boolean,mode:number):[number,number] {
  const source=x;
  x+=Math.trunc((200-total)/25);
  if(mode===1||mode===2)x+=12;
  else if(mode===3)x=source;
  else if(mode===4)x=34-x;
  return [mirror?71-x:x,y];
}

/** 0x442D38: division order 1/3/4/5/2, reserve before active, shared
 * within-division index and the native horizontal collision scan. Rendering
 * scale is deliberately outside this function and cannot affect AI cells. */
export function nativeFormationDeployment(input:NativeDeploymentInput):{general:[number,number];soldiers:FormationSoldier[]} {
  const {formation,active,reserve,mirror,mode=0,obstacles=[]}=input;
  const table=data.formations[formation];
  if(!table||![active,reserve].every(n=>Number.isInteger(n)&&n>=0&&n<=100)||!Number.isInteger(mode)||mode<0||mode>4)throw new Error('原版布阵参数无效。');
  const total=active+reserve,general=transform(table.baseX,data.generalY,total,mirror,mode);
  if(mirror)general[0]=Math.min(70,general[0]);
  const occupied=new Set([general,...obstacles].map(([x,y])=>`${x},${y}`));
  const soldiers:FormationSoldier[]=[],a=nativeTroopDivisions(formation,active,false),r=nativeTroopDivisions(formation,reserve,true);
  for(const division of [1,3,4,5,2]) {
    let index=0;
    for(const isReserve of [true,false])for(let i=0;i<(isReserve?r:a)[division-1];i++) {
      const point=table.divisions[division-1][index++];
      if(!point)throw new Error('原版阵形坐标缺失。');
      let [x,y]=transform(table.baseX+point[0],point[1],total,mirror,mode),attempt=0;
      while(occupied.has(`${x},${y}`)) {
        // Source occupancy ignores cells outside 71x14.
        if(x<=1)x+=32;
        if(x>=112)x-=32;
        x+=x<54?-1:1;
        if(++attempt>200)throw new Error('原版布阵找不到空位。');
      }
      soldiers.push({x,y,division,reserve:isReserve});
      if(x>=0&&x<71&&y>=0&&y<14)occupied.add(`${x},${y}`);
    }
  }
  return {general,soldiers};
}
