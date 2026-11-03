import type { RemoteResponse } from "../shared/types";
import { imageBlobFromDataUrl } from "../core/image-preflight";
import { prepareImagePreview } from "./image-preview";

const limits = {maxBytes:16 * 1024 * 1024,maxPixels:32_000_000,maxDimension:16384};

/** Backend pixels remain untrusted. Only bounded static bytes reach a decoder or blob URL. */
export function mountRemoteImages(host: HTMLElement) {
  const cache = new WeakMap<RemoteResponse, readonly Blob[]>();
  let epoch = 0, controller: AbortController | undefined;
  let release: (() => void) | undefined;
  function invalidate() {
    epoch++; controller?.abort(); controller=undefined;
    release?.(); release=undefined; host.replaceChildren();
  }
  async function validate(response: RemoteResponse, required = false, signal?:AbortSignal): Promise<readonly Blob[]> {
    const cached=cache.get(response);
    if (cached) { if(required && cached.length!==1) throw new Error("O backend não retornou exatamente uma imagem validável."); return cached; }
    if(response.status!=="ok") return [];
    const data=response.data && typeof response.data==="object" && !Array.isArray(response.data) ? response.data as Record<string,unknown> : undefined;
    const images=data?.images;
    if(images===undefined && !required) return [];
    if(!Array.isArray(images) || images.length!==1) throw new Error("O backend deve retornar exatamente uma imagem; nenhuma imagem foi exibida.");
    const item=images[0];
    if(!item || typeof item!=="object" || Array.isArray(item)) throw new Error("Descritor de imagem incompatível.");
    const image=item as Record<string,unknown>;
    if(typeof image.base64!=="string" || !["image/png","image/jpeg","image/webp"].includes(String(image.mime)))
      throw new Error("A prévia exige bytes PNG, JPEG ou WebP. URLs de imagem do backend não são abertas automaticamente.");
    const blob=await imageBlobFromDataUrl(`data:${image.mime};base64,${image.base64}`,{...limits,signal,deadline:performance.now()+30_000});
    signal?.throwIfAborted();
    const result=Object.freeze([blob]); cache.set(response,result); return result;
  }
  async function show(response:RemoteResponse) {
    invalidate(); const mine=epoch, current=new AbortController(); controller=current;
    try {
      const images=await validate(response,false,current.signal);
      if(mine!==epoch || current.signal.aborted || !images.length) return;
      const image=host.ownerDocument.createElement("img");
      image.alt="Thumbnail gerada pelo provedor configurado";
      image.style.cssText="max-width:100%;max-height:500px;border-radius:8px";
      const preview=await prepareImagePreview(image,images[0],{...limits,signal:current.signal,deadline:performance.now()+30_000});
      if(mine!==epoch || current.signal.aborted) { preview.release(); return; }
      release=preview.release;
      const link=host.ownerDocument.createElement("a");
      link.textContent="Abrir / salvar imagem gerada validada"; link.href=preview.url;
      link.target="_blank"; link.rel="noopener noreferrer";
      link.download=`prevlev-gerada.${images[0].type==="image/jpeg"?"jpg":images[0].type==="image/webp"?"webp":"png"}`;
      host.append(image,host.ownerDocument.createElement("p"),link);
    } catch(error) {
      if(mine!==epoch || current.signal.aborted) return;
      host.replaceChildren(); throw error;
    }
  }
  return {validate,show,invalidate};
}
