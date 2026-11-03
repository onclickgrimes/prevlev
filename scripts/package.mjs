import {packageExtension} from './lib/package.mjs';
const result=await packageExtension();
console.log(`Pacote: ${result.file}\nSHA-256: ${result.sha256}\nBytes: ${result.bytes}`);
