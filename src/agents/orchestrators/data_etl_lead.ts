// file: src/agents/orchestrators/data_etl_lead.ts
// description: Data/ETL Lead — dispatches to importer / transformer / validator workers.
// reference: src/agents/orchestrators/_dispatch.ts

import { BaseAgent, type AgentConfig } from '../base';
import type { LedgerTaskStar, LedgerCapability } from '../../core/types';
import { dispatchCapability } from './_dispatch';

const DATA_ETL_LEAD_CONFIG: AgentConfig = {
  id: 'data_etl_lead',
  name: 'Data/ETL Lead',
  description: 'Data processing orchestrator managing import, transformation, and validation',
  capabilities: ['data_import', 'data_transformation', 'data_validation'],
};

const CAPABILITY_TO_WORKER: Partial<Record<LedgerCapability, string>> = {
  data_import: 'data_csv_importer',
  data_transformation: 'data_data_transformer',
  data_validation: 'data_data_validator',
};

export class DataETLLeadAgent extends BaseAgent {
  constructor(config: Partial<AgentConfig> = {}) {
    super({ ...DATA_ETL_LEAD_CONFIG, ...config });
  }

  protected async execute(task: LedgerTaskStar): Promise<Record<string, unknown>> {
    this.ensure_tenant_context();
    return dispatchCapability(
      this,
      task,
      CAPABILITY_TO_WORKER,
      'You are the Data/ETL Lead. Ensure imports are clean, transformations lossless, and validations catch real problems.',
      'Data/ETL Lead'
    );
  }
}
