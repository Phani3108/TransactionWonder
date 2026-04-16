// file: src/skills/index.ts
// description: Public entry point for the skills layer. Side-effect imports
//              register the built-in skills on load.
// reference: src/skills/executor.ts, src/skills/registry.ts

import { registerSkill } from './registry';
import { invoiceProcessor } from './handlers/invoice-processor';
import { paymentGateway } from './handlers/payment-gateway';

// Auto-register known skills. When P1-6 lands (remaining 6 skills) they
// each add one line here.
registerSkill(invoiceProcessor);
registerSkill(paymentGateway);

export { invokeSkill } from './executor';
export { listSkills, getSkill, registerSkill } from './registry';
export {
  SkillNotFoundError,
  SkillInputError,
  SkillOutputError,
  type SkillContext,
  type SkillDefinition,
} from './types';
