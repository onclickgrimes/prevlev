import {describe,it,expect,vi} from 'vitest';
import {hashPixels,hammingDistance,visualReportCsv,visualReportJson,compareLocalImages,type VisualReport} from '../src/core/visual-similarity';

describe('visual similarity primitives and bounds',()=>{
  it('hashes horizontal brightness comparisons and composites alpha on white',()=>{
    const pixels=new Uint8ClampedArray(9*8*4);for(let y=0;y<8;y++)for(let x=0;x<9;x++){const i=(y*9+x)*4;pixels[i]=pixels[i+1]=pixels[i+2]=255-x*20;pixels[i+3]=255;}
    expect(hashPixels(pixels)).toBe('ffffffffffffffff');expect(hammingDistance(hashPixels(pixels),'0000000000000000')).toBe(64);
    for(let i=0;i<pixels.length;i+=4)pixels[i+3]=0;
    expect(hashPixels(pixels)).toBe('0000000000000000');expect(()=>hashPixels(new Uint8ClampedArray(1))).toThrow();expect(()=>hammingDistance('oops','0')).toThrow();
  });
  it('exports match and invalid data safely, without spreadsheet formulas',()=>{
    const report:VisualReport={algorithm:'dHash',reference:'=ref',matches:[{index:0,name:'+test.png',distance:0,similarity:100,hash:'0000000000000000'}],invalid:[{index:1,name:'bad.png',error:'invalid'}]};
    expect(visualReportCsv(report)).toContain("'=ref");expect(visualReportCsv(report)).toContain("'+test.png");expect(visualReportCsv(report)).toContain('bad.png');expect(JSON.parse(visualReportJson(report))).toEqual(report);
  });
  it('rejects unbounded and empty selections before decoding',async()=>{
    const file=new File(['x'],'test.png',{type:'image/png'});
    await expect(compareLocalImages(file,[])).rejects.toThrow('1 a 20');
    await expect(compareLocalImages(file,Array(21).fill(file))).rejects.toThrow('1 a 20');
    await expect(compareLocalImages(file,[file],{durationMs:15001})).rejects.toThrow('tempo');
    const controller=new AbortController();controller.abort();await expect(compareLocalImages(file,[file],{signal:controller.signal})).rejects.toMatchObject({name:'AbortError'});
  });
});

describe('image headers gate the decoder',()=>{
  it('rejects oversized PNG, JPEG and WebP headers before creating an ImageBitmap',async()=>{
    const png=new Uint8Array(33);png.set([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82]);new DataView(png.buffer).setUint32(16,5000);new DataView(png.buffer).setUint32(20,5000);
    const jpeg=new Uint8Array([0xff,0xd8,0xff,0xc0,0,11,8,0x13,0x88,0x13,0x88,1,1,0x11,0,0xff,0xda,0,2]);
    const webp=new Uint8Array([82,73,70,70,22,0,0,0,87,69,66,80,86,80,56,88,10,0,0,0,0,0,0,0,0x87,0x13,0,0x87,0x13,0]);
    const decoder=vi.fn();vi.stubGlobal('createImageBitmap',decoder);
    try{
      for(const [data,type] of [[png,'image/png'],[jpeg,'image/jpeg'],[webp,'image/webp']] as const){const file=new File([data],`misleading.${type==='image/png'?'jpg':'png'}`,{type});await expect(compareLocalImages(file,[file])).rejects.toThrow('excede 20 megapixels');}
      expect(decoder).not.toHaveBeenCalled();
    }finally{vi.unstubAllGlobals();}
  });
  it('rejects animation flags before invoking the decoder',async()=>{
    const png=new Uint8Array(45);png.set([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82]);new DataView(png.buffer).setUint32(16,1);new DataView(png.buffer).setUint32(20,1);png.set([0,0,0,0,97,99,84,76,0,0,0,0],33);
    const webp=new Uint8Array([82,73,70,70,22,0,0,0,87,69,66,80,86,80,56,88,10,0,0,0,2,0,0,0,0,0,0,0,0,0]);
    const decoder=vi.fn();vi.stubGlobal('createImageBitmap',decoder);
    try{for(const [data,type] of [[png,'image/png'],[webp,'image/webp']] as const){const file=new File([data],'animated',{type});await expect(compareLocalImages(file,[file])).rejects.toThrow('animadas');}expect(decoder).not.toHaveBeenCalled();}finally{vi.unstubAllGlobals();}
  });
  it('rejects malformed, mislabeled, and unsupported image containers before decoding',async()=>{
    const decoder=vi.fn();vi.stubGlobal('createImageBitmap',decoder);
    try{
      const bad=new File(['not an image'],'fake.png',{type:'image/png'});await expect(compareLocalImages(bad,[bad])).rejects.toThrow('Cabeçalho');
      const unsupported=new File(['x'],'x.gif',{type:'image/gif'});await expect(compareLocalImages(unsupported,[unsupported])).rejects.toThrow('Formato não suportado');
      expect(decoder).not.toHaveBeenCalled();
    }finally{vi.unstubAllGlobals();}
  });
});
