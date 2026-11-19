/** Visit only potentially overlapping earlier units, in original i/j order.
 * The visitor may move both points. Refresh their buckets and re-query after
 * a bucket crossing, so a correction cannot miss a new pair. */
export function nearbyPairs<T extends {x:number;y:number}>(points:T[],visit:(a:T,b:T)=>void):void {
  const buckets=new Map<number,Set<number>>(),keys:number[]=[];
  const key=(p:T)=>Math.floor(p.y/40)*100+Math.floor(p.x/44);
  const place=(i:number)=>{const k=key(points[i]);keys[i]=k;let set=buckets.get(k);if(!set)buckets.set(k,set=new Set());set.add(i);};
  const refresh=(i:number)=>{if(key(points[i])!==keys[i]){buckets.get(keys[i])!.delete(i);place(i);}};
  points.forEach((_,i)=>place(i));
  for(let i=0;i<points.length;i++) {
    let after=-1;
    while(true) {
      const x=Math.floor(points[i].x/44),y=Math.floor(points[i].y/40),before=keys[i],candidates:number[]=[];
      for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)for(const j of buckets.get((y+dy)*100+x+dx)??[])if(j>after&&j<i)candidates.push(j);
      candidates.sort((a,b)=>a-b);let crossed=false;
      for(const next of candidates) {
        after=next;visit(points[i],points[next]);refresh(i);refresh(next);
        if(keys[i]!==before){crossed=true;break;}
      }
      if(!crossed)break;
    }
  }
}
