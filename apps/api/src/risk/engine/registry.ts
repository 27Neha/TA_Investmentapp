import { Answers, RiskResult, scoreV1, TA_RISK_V1 } from './ta-risk-v1';

/** Every historical version stays here forever so any stored assessment can be recomputed. Never edit an entry; add a new one. */
export const ENGINES: Record<string, (a: Answers) => RiskResult> = { [TA_RISK_V1]: scoreV1 };
export const ACTIVE_ENGINE = TA_RISK_V1;
