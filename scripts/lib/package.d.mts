export const EXTENSION_FILES:readonly string[];
export function createZip(entries:{name:string;data:Uint8Array|string}[]):Buffer;
export function packageExtension(options?:{root?:string;outputDir?:string}):Promise<{file:string;sha256:string;bytes:number;files:{name:string;bytes:number;sha256:string}[]}>;
