import {diagnose} from './lib/doctor.mjs';
const report=await diagnose({probe:process.argv.includes('--probe-local-tcp')});
if(process.argv.includes('--json'))console.log(JSON.stringify(report,null,2));
else {console.log(report.scope);for(const check of report.checks)console.log(`[${check.status}] ${check.message}`);}
if(!report.ok)process.exitCode=1;
