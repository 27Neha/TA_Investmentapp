/**
 * DRAFT legal documents for local development and legal review. They are NOT approved legal text and carry no reviewer (`reviewedBy` stays null).
 * They describe how the app works today and leave every contractual clause as a marked blank for counsel. In production, signup is refused
 * until the stored TERMS and PRIVACY versions have been reviewed (see AuthService.signup). Replace these by inserting reviewed rows.
 *
 * Body format (rendered by the mobile app): "# " heading, "## " sub-heading, "- " bullet, blank line between paragraphs.
 */
export const DRAFT_VERSION = '0.2-draft';
export const DRAFT_BANNER = 'DRAFT FOR LEGAL REVIEW. This text has not been approved by a lawyer or any regulator and is not a binding agreement. Items in [square brackets] are intentionally blank until counsel supplies them.';

export const DRAFT_TERMS_BODY = `${DRAFT_BANNER}

# 1. About this document
This draft explains, in plain language, what the TechArtha app does today. The legal terms themselves are still to be written and approved: [LEGAL TO SUPPLY: definitions, scope, acceptance mechanics].

# 2. Who provides the app
The app is operated by TechArtha Financial Services Pvt Ltd. [LEGAL TO CONFIRM: registered details, distributor registration and the exact wording for any AMFI / ARN reference.]

# 3. What the app does today
- Educational information about mutual funds and personal finance.
- A personal risk-profile questionnaire. The result describes you, not a scheme, and is not a scheme Riskometer.
- Goal planning, a watchlist, support requests and a message inbox.
- Mutual fund investing, payments, mandates, SIPs and identity verification are not available yet. Nothing in the app buys, sells or switches any investment until those services are connected and approved.

# 4. Not investment advice
Content in the app is general information. It is not investment advice or a recommendation to buy or sell anything. Mutual fund investments are subject to market risks. Read all scheme related documents carefully. [LEGAL TO CONFIRM: regulatory disclosure wording.]

# 5. Your account
- Give accurate information and keep your password private.
- TechArtha will never ask you for your OTP or password.
- Do not put PAN, Aadhaar, card or account numbers, OTPs or passwords in support messages.

# 6. Who can use the app
[LEGAL TO SUPPLY: eligibility, age requirements and guardian rules.] Investing for minors is disabled in the app.

# 7. Fees, liability, termination, governing law and grievance redressal
[LEGAL TO SUPPLY: intentionally left blank. No fees are charged by the app today.]

# 8. Changes to these terms
[LEGAL TO SUPPLY: how changes are notified and re-accepted.]`;

export const DRAFT_PRIVACY_BODY = `${DRAFT_BANNER}

# 1. About this document
This draft lists what the app collects and why, based on how it works today. The formal privacy notice is still to be written and approved: [LEGAL TO SUPPLY: notice wording under the Digital Personal Data Protection Act, 2023 and other applicable rules].

# 2. What we collect when you create an account
- Name, email address, mobile number and date of birth.
- Your password, stored only as a one-way hash.
- A record of the documents you accepted (which version and when), a one-way hash of your IP address and your device's user-agent text.

# 3. What we may collect as you use the app
- Your risk-profile answers and results, goals, watchlist and preferences.
- Support requests and any files you attach (stored privately; only you can open them through short-lived links).
- Where identity verification, bank or investing features are later enabled: PAN, bank details and verification results. PAN and bank details are encrypted when stored. [LEGAL TO CONFIRM: exact list and consent wording.]

# 4. Why we use it
- To create and secure your account and send you verification codes.
- To provide the features you use and respond to your requests.
- [LEGAL TO SUPPLY: other purposes, if any.]

# 5. Who may process it for us
Service providers that are connected may process some data for us, for example email delivery and customer support tools. [LEGAL TO LIST: providers, locations and safeguards.]

# 6. Keeping and deleting data
[LEGAL TO SUPPLY: retention periods and deletion rules.]

# 7. Your rights and how to contact us
[LEGAL TO SUPPLY: access, correction, erasure and withdrawal of consent, grievance officer details.] You can reach support at support@TechArtha.com.

# 8. Children
[LEGAL TO SUPPLY: handling of data of minors and guardians.]`;

export const DRAFT_DISCLOSURES = [
  { kind: 'TERMS', title: 'Terms of Use (DRAFT — pending legal review)', body: DRAFT_TERMS_BODY },
  { kind: 'PRIVACY', title: 'Privacy Policy (DRAFT — pending legal review)', body: DRAFT_PRIVACY_BODY },
] as const;
