/** Educational quizzes. General knowledge only: no rewards, no money, nothing tied to investing. Unreviewed text — compliance should review before release. */
export interface Question { q: string; options: string[]; answer: number; explain: string }
export interface Quiz { id: string; title: string; category: string; description: string; questions: Question[] }
const YN = ['Myth', 'Fact'];
export const QUIZZES: Quiz[] = [
  { id: 'mf-basics', title: 'Mutual Fund Basics', category: 'QUIZ', description: 'Core ideas behind mutual funds.', questions: [
    { q: 'What does NAV stand for?', options: ['Net Asset Value', 'National Asset Valuation', 'New Allotment Value', 'Net Annual Variation'], answer: 0, explain: 'NAV is the per-unit value of a scheme: its net assets divided by the units outstanding.' },
    { q: 'A SIP is…', options: ['A guaranteed return plan', 'Investing a fixed amount at regular intervals', 'A type of bank loan', 'A one-time tax'], answer: 1, explain: 'A Systematic Investment Plan invests a set amount on a schedule. It does not guarantee returns.' },
    { q: 'Which body regulates mutual funds in India?', options: ['RBI', 'SEBI', 'IRDAI', 'NPCI'], answer: 1, explain: 'SEBI regulates mutual funds; AMFI is the industry body.' },
    { q: 'A mutual fund scheme…', options: ['Is a single investor\'s private account', 'Pools money from many investors into a portfolio', 'Always invests only in shares', 'Is insured against loss'], answer: 1, explain: 'Many investors\' money is pooled and invested according to the scheme\'s objective. Mutual funds are not insured against loss.' },
    { q: 'Compared with a Regular plan, a Direct plan generally…', options: ['Includes distributor commission', 'Has no distributor commission in its expenses', 'Guarantees higher returns', 'Cannot be held for long'], answer: 1, explain: 'Direct plans do not include distributor commission, so their expense ratio is generally lower. That does not guarantee higher returns.' },
  ] },
  { id: 'risk-return', title: 'Risk vs Return', category: 'QUIZ', description: 'How risk, reward and time relate.', questions: [
    { q: 'Higher potential return usually comes with…', options: ['No extra risk', 'Higher risk of loss or volatility', 'A government guarantee', 'Lower costs'], answer: 1, explain: 'Risk and potential return tend to go together. Nothing is guaranteed.' },
    { q: 'Diversification means…', options: ['Putting everything in one asset', 'Spreading investments across different assets', 'Investing only in debt', 'Trading daily'], answer: 1, explain: 'Spreading across assets can reduce the impact of any one of them falling, but it cannot remove risk.' },
    { q: 'For money you need in about a year, which is usually the more sensible kind of option to consider?', options: ['Highly volatile options', 'Lower-volatility, easily accessible options', 'Whatever had the best last year', 'Options with a long lock-in'], answer: 1, explain: 'Short horizons leave little time to recover from a fall, so stability and access matter more.' },
    { q: 'Past performance of a fund…', options: ['Guarantees future returns', 'Does not guarantee future results', 'Is always repeated', 'Is illegal to show'], answer: 1, explain: 'Historical returns are information, not a promise.' },
    { q: 'The value of market-linked investments can…', options: ['Only rise', 'Rise and fall', 'Never change', 'Only fall'], answer: 1, explain: 'Market-linked values move both ways.' },
  ] },
  { id: 'financial-literacy', title: 'Financial Literacy', category: 'QUIZ', description: 'Everyday money fundamentals.', questions: [
    { q: 'An emergency fund is meant to…', options: ['Buy investments', 'Cover unexpected expenses or a loss of income', 'Pay for holidays', 'Earn the highest return'], answer: 1, explain: 'It is a cushion kept in easily accessible form.' },
    { q: 'Compounding means…', options: ['Earning returns on your earlier returns too', 'Paying a fee each year', 'Spending more over time', 'A type of tax'], answer: 0, explain: 'Returns that are reinvested can themselves earn returns, which matters most over long periods.' },
    { q: 'Inflation generally…', options: ['Increases the purchasing power of cash', 'Reduces what a rupee can buy over time', 'Has no effect on savings', 'Only affects investors'], answer: 1, explain: 'Prices tend to rise, so the same amount buys less later.' },
    { q: 'A sensible step before investing is…', options: ['Borrowing to invest', 'Building an emergency fund and clearing costly debt', 'Ignoring your goals', 'Following tips'], answer: 1, explain: 'A safety net and high-interest debt clearance come before taking market risk.' },
    { q: 'The "Rule of 72" estimates…', options: ['Your tax', 'Roughly how many years to double at a given annual rate (72 ÷ rate)', 'Your credit score', 'Fund expenses'], answer: 1, explain: 'It is a rough rule of thumb, not a precise or guaranteed figure.' },
  ] },
  { id: 'market-knowledge', title: 'Market Knowledge', category: 'QUIZ', description: 'Indices, stocks and volatility.', questions: [
    { q: 'The Nifty 50 is…', options: ['A mutual fund', 'An index of 50 large companies listed on the NSE', 'A bank', 'A government bond'], answer: 1, explain: 'It tracks a basket of large listed companies; you cannot invest in the index directly, only in products that follow it.' },
    { q: 'The Sensex is an index of…', options: ['30 companies on the BSE', '500 companies on the NSE', 'All mutual funds', 'Government bonds'], answer: 0, explain: 'The S&P BSE Sensex tracks 30 large companies on the BSE.' },
    { q: 'A market index is used to…', options: ['Guarantee profits', 'Track how a basket of securities has performed', 'Set interest rates', 'Predict next year exactly'], answer: 1, explain: 'It summarises the movement of a group of securities.' },
    { q: 'Market capitalisation equals…', options: ['Profit × 10', 'Share price × number of shares', 'Revenue − cost', 'Debt + cash'], answer: 1, explain: 'It is the market value of a company\'s shares.' },
    { q: 'Volatility describes…', options: ['How much and how quickly prices change', 'A company\'s profit', 'A fund\'s fees', 'Trading hours'], answer: 0, explain: 'Higher volatility means larger and faster price swings.' },
  ] },
  { id: 'myth-fact', title: 'Myth vs Fact', category: 'QUIZ', description: 'Spot the common misconceptions.', questions: [
    { q: 'Mutual funds guarantee returns.', options: YN, answer: 0, explain: 'Mutual fund returns are not guaranteed and values can fall.' },
    { q: 'You need lakhs of rupees to start a SIP.', options: YN, answer: 0, explain: 'Many schemes allow SIPs to start with small amounts; check each scheme\'s terms.' },
    { q: 'A fund with a lower NAV is cheaper or better.', options: YN, answer: 0, explain: 'NAV is just a per-unit value; it says nothing about quality or future returns.' },
    { q: 'Past returns guarantee similar future returns.', options: YN, answer: 0, explain: 'Historical performance is not a promise.' },
    { q: 'Diversification can reduce risk but cannot remove it.', options: YN, answer: 1, explain: 'Spreading investments helps, but market risk remains.' },
    { q: 'Time in the market can help smooth out short-term ups and downs, but does not guarantee a gain.', options: YN, answer: 1, explain: 'A longer horizon gives more time to recover from falls; outcomes are still uncertain.' },
  ] },
];
export const CHALLENGES = [
  { id: 'sip-challenge', title: 'SIP Calculator Challenge', description: 'Estimate the result of a monthly investment, then check your guess against the maths.' },
  { id: 'compounding', title: 'Compounding Game', description: 'See how time changes the effect of compounding on the same monthly amount.' },
  { id: 'goal-planning', title: 'Goal Planning Challenge', description: 'Work out the monthly amount a goal would need, then compare it with the calculation.' },
];
