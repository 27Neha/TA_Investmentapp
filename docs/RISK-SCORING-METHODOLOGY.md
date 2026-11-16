# Risk Scoring Methodology — `ta-risk-v1`

**Status: original TechArtha framework, NOT regulator-approved, NOT investment advice.** Thresholds, weights and caps are proposals for compliance review. It is inspired in coverage only by common industry practice; no question text or method from any other platform is used. Source of truth: `apps/api/src/risk/engine/ta-risk-v1.ts` (tests: `ta-risk-v1.spec.ts`, `test/risk-assessment.int.spec.ts`).

## Design principles
- Calculated only on the server from answers. API bodies accept `answers` and nothing else; any `score`/`band` field is rejected.
- Three separate concepts: **willingness** (how much loss the person accepts), **capacity** (how much loss they can afford) and **knowledge**.
- Versioned: stored rows keep `version`, `answers`, `score`, `band`. Results are recomputed from answers with the stored version (`reproducible` flag exposes tampering or drift). Any change to a number here requires a NEW version id; old versions stay in `engine/registry.ts`.
- Reassessment always inserts a new row. No migration is needed: the existing `RiskAssessment` and `RiskDraft` tables hold it.

## Questions (4 options each, scored 0,1,2,3 in listed order) and weights inside their dimension
| # | Question id | Dimension | Weight | Options (0→3) |
|---|---|---|---|---|
| 1 | objective | Willingness | 0.20 | capital_preservation, regular_income, balanced_growth, long_term_growth |
| 9 | decline_reaction (10/20/30% fall) | Willingness | 0.30 | sell_all, sell_some, hold, buy_more |
| 10 | loss_tolerance (temporary loss in a year) | Willingness | 0.25 | lt5, 5to10, 10to20, gt20 (%) |
| 12 | return_vs_risk | Willingness | 0.25 | stable_low, small_swings, moderate_swings, large_swings_high |
| 2 | horizon | Capacity | 0.22 | lt1, 1to3, 3to7, gt7 (years) |
| 3 | income (monthly) | Capacity | 0.12 | lt25k, 25to75k, 75kto2l, gt2l |
| 4 | surplus (% of income investible) | Capacity | 0.16 | lt5, 5to15, 15to30, gt30 |
| 6 | emergency fund | Capacity | 0.18 | none, lt3m, 3to6m, gt6m |
| 7 | liabilities and dependants | Capacity | 0.16 | heavy, significant, moderate, low |
| 11 | liquidity need | Capacity | 0.16 | all_within_1y, part_1to3y, rarely, not_needed |
| 5 | existing investments/experience | Knowledge | 0.50 | none, deposits_only, some_mf_or_equity, diversified_5y |
| 8 | investment knowledge | Knowledge | 0.50 | none, basic, good, advanced |

Weights inside each dimension sum to 1 (asserted by a test). Question wording is in the app's translation files (English authoritative; other languages stay English until human review).

## Formula
1. Normalise each answer: `n = score / 3 × 100`.
2. Dimension score `D = Σ weight × n` for its questions → W, C, K, each 0–100.
3. `base = 0.50·W + 0.35·C + 0.15·K`. Rationale: stated tolerance matters most, affordability next, knowledge least (it informs education more than risk).
4. Ceiling = min of: **capacity limit** `C + 15`; hard caps — horizon `lt1` → 40, no emergency fund → 60, all money needed within a year → 60; and **consistency ceiling** 60 when any contradiction below is detected.
5. `score = round(min(base, ceiling))`, clamped 0–100.
Effect: high willingness with low capacity cannot yield an aggressive result (proved by test: W=100, C=0 ⇒ score ≤ 15).

## Bands (inclusive upper bounds on the rounded score; proposed, configurable only via a new version)
0–20 Very Conservative · 21–40 Conservative · 41–60 Moderate · 61–80 Moderately Aggressive · 81–100 Aggressive.

## Consistency checks (flag + ceiling 60 + "answers need review")
sell_all on decline + large_swings_high · sell_all + loss_tolerance gt20 · long_term_growth + horizon lt1 · all_within_1y + horizon gt7 · capital_preservation + large_swings_high · heavy liabilities + large_swings_high. The score is still stored; the app asks the person to review.

## Outputs
Score, band, W/C/K breakdown, caps applied, flags, strengths, concerns, minimum suggested horizon (1/3/5/7/10 years by band), and category-level guidance codes. **Guidance is `guidanceApproved: false`** and must stay behind a compliance notice until approved. A match never implies guaranteed returns or no loss.

## Relationship to scheme Riskometers
A person's profile is not a scheme's SEBI Riskometer (Low … Very High). `suitabilityFlag(band, capacity, schemeLevel)` only flags a mismatch (`ABOVE_PROFILE`, `ABOVE_CAPACITY`) and returns `UNKNOWN` when verified scheme data is absent. It never creates or recommends an order.

## Limitations and open decisions (need owner/compliance)
Question wording and option cut-offs, weights, band thresholds, category guidance and retake frequency are unreviewed. The framework has not been statistically validated. No approval by any regulator is claimed.
