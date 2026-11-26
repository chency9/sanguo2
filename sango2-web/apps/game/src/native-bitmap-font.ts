export interface NativeBitmapFont {size:number;image:HTMLImageElement;characters:Record<string,{x:number;y:number;width:number;height:number;advance:number}>}
const fonts=new Map<15|20,Promise<NativeBitmapFont>>();
const inks=new WeakMap<NativeBitmapFont,Map<string,HTMLCanvasElement>>();
/** Original glyph atlas for pixel-exact native canvas labels. DOM text can
 * use the matching WOFF2, whose final smoothing belongs to the browser. */
export function loadNativeBitmapFont(size:15|20):Promise<NativeBitmapFont> {
  let pending=fonts.get(size);if(pending)return pending;
  pending=(async()=>{
    const response=await fetch(`/assets/fonts/sango2-${size}.json`);if(!response.ok)throw new Error('原版字库加载失败。');
    const manifest=await response.json(),image=new Image();image.src=`/assets/fonts/${manifest.image}`;await image.decode();
    return {size,image,characters:manifest.characters};
  })();fonts.set(size,pending);return pending;
}
/** Coordinates and scale must be integer CSS/native pixels for exact output.
 * Returns advance width. Unsupported characters retain the caller's fallback
 * instead of silently replacing a source glyph with a newly drawn character. */
export function drawNativeBitmapText(context:CanvasRenderingContext2D,font:NativeBitmapFont,text:string,x:number,y:number,color='#fff',scale=1):number|null {
  if([...text].some(character=>!font.characters[character]))return null;
  const start=x;context.save();context.imageSmoothingEnabled=false;
  let cache=inks.get(font);if(!cache){cache=new Map();inks.set(font,cache);}
  for(const character of text) {
    const glyph=font.characters[character],key=`${color}/${character}`;let canvas=cache.get(key);
    if(!canvas) {
      canvas=document.createElement('canvas');canvas.width=glyph.width;canvas.height=glyph.height;
      const ink=canvas.getContext('2d')!;ink.drawImage(font.image,glyph.x,glyph.y,glyph.width,glyph.height,0,0,glyph.width,glyph.height);
      ink.globalCompositeOperation='source-in';ink.fillStyle=color;ink.fillRect(0,0,glyph.width,glyph.height);
      if(cache.size>=512)cache.delete(cache.keys().next().value!);cache.set(key,canvas);
    }
    context.drawImage(canvas,x,y,glyph.width*scale,glyph.height*scale);x+=glyph.advance*scale;
  }
  context.restore();return x-start;
}
