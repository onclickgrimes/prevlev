import {extractSponsorships} from '../src/core/sponsorships.ts';
/** Shared pure extractor; importing this module starts no service or request. Node.js24+. */
export function analyzeSponsorships(payload) {
  const report=extractSponsorships(payload);
  return {status:'ok',source:'prevlev:sponsorship-evidence',data:report,limitations:report.limitations};
}
