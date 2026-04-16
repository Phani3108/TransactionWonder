// file: src/skills/index.ts
// description: Public entry point for the skills layer. Side-effect imports
//              register the built-in skills on load.
// reference: src/skills/executor.ts, src/skills/registry.ts

import { registerSkill } from './registry';
import { invoiceProcessor } from './handlers/invoice-processor';
import { paymentGateway } from './handlers/payment-gateway';
import { documentParser } from './handlers/document-parser';
import { bankReconciliation } from './handlers/bank-reconciliation';
import { complianceChecker } from './handlers/compliance-checker';
import { financialReporting } from './handlers/financial-reporting';
import { dataSync } from './handlers/data-sync';
import { auditTrail } from './handlers/audit-trail';

// Auto-register known skills.
registerSkill(invoiceProcessor);
registerSkill(paymentGateway);
registerSkill(documentParser);
registerSkill(bankReconciliation);
registerSkill(complianceChecker);
registerSkill(financialReporting);
registerSkill(dataSync);
registerSkill(auditTrail);

export { invokeSkill } from './executor';
export { listSkills, getSkill, registerSkill } from './registry';
export {
  SkillNotFoundError,
  SkillInputError,
  SkillOutputError,
  type SkillContext,
  type SkillDefinition,
} from './types';
