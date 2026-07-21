/**
 * LEGAL — the in-app Terms of Use, Privacy Policy and AI & Health notice.
 *
 * This copy is written to match what EvoForge ACTUALLY does (server-authoritative
 * XP/coins, owner-only RLS, AI via OpenAI, solo physique photos discarded, battle
 * photos in a private bucket, best-effort analytics with no PII in routes). It is
 * a general-purpose agreement: the operator should confirm the placeholders below
 * and that it satisfies the consumer- and data-protection law of the markets it
 * ships to before relying on it. Where local law grants a user more, that law wins
 * (stated in the Terms).
 */

/** Fill these in for your deployment. */
export const LEGAL = {
  appName: 'EvoForge',
  operator: 'the EvoForge team', // replace with your legal entity name
  contactEmail: 'support@evoforge.app', // replace with a monitored inbox
  lastUpdated: '21 July 2026',
  minimumAge: 16,
};

export interface LegalSection { heading: string; body: string }
export interface LegalDoc { id: 'terms' | 'privacy' | 'ai'; tab: string; title: string; intro: string; sections: LegalSection[] }

const A = LEGAL.appName;
const OP = LEGAL.operator;

export const LEGAL_DOCS: LegalDoc[] = [
  {
    id: 'terms',
    tab: 'TERMS',
    title: 'TERMS OF USE',
    intro: `Last updated ${LEGAL.lastUpdated}. By creating an account or using ${A}, you agree to these Terms. If you do not agree, please do not use the app.`,
    sections: [
      { heading: 'Who can use EvoForge', body: `You must be at least ${LEGAL.minimumAge} years old (or the minimum age of digital consent in your country) to use ${A}. If you are under that age, you may only use the app with the consent of a parent or guardian where the law allows it. You are responsible for keeping your account credentials secure.` },
      { heading: 'What EvoForge is', body: `${A} is a fitness role-playing app: you log training, nutrition and body data, and the app turns it into a game — levels, stats, a champion, battles and social features. It is a motivational tool, not a coaching, medical, or professional service.` },
      { heading: 'Your content and data', body: `You keep ownership of the workouts, photos, posts and other content you add. You grant ${OP} the permission needed to store and process that content to run the app for you — for example to compute your stats, run AI analysis you request, and show your posts to people you have chosen to share them with. You are responsible for the content you post and for having the right to post it.` },
      { heading: 'Acceptable use', body: `Do not use ${A} to harass, impersonate, or post content that is illegal, hateful, or infringes others’ rights. Do not attempt to break, overload, reverse-engineer, or gain unauthorised access to the service or other users’ data. We may suspend or remove accounts that break these rules or put other users at risk.` },
      { heading: 'Fair play', body: `XP, levels, coins and rankings are computed and verified on our servers from the activity you log. Attempting to fake activity, tamper with scoring, or otherwise game progression may result in stat resets or account termination.` },
      { heading: 'The service is provided “as is”', body: `We work hard to keep ${A} accurate and available, but we provide it without warranties of any kind. Stats, AI estimates and recommendations may be wrong or incomplete. To the fullest extent permitted by law, ${OP} is not liable for indirect or consequential loss arising from your use of the app. Nothing here limits liability that cannot be limited by law (including for death or personal injury caused by negligence).` },
      { heading: 'Ending your use', body: `You can delete your account at any time from Profile → Delete account, which removes your data as described in the Privacy Policy. We may end or suspend access if you breach these Terms or if we stop offering the service.` },
      { heading: 'Changes and governing law', body: `We may update these Terms; we will change the “last updated” date and, for material changes, tell you in the app. These Terms are governed by the laws of your place of residence to the extent its consumer-protection rules apply; otherwise by the laws of [operator’s jurisdiction — to be set by the operator]. Where your local law grants you rights these Terms would reduce, your local law prevails.` },
      { heading: 'Contact', body: `Questions about these Terms? Contact ${OP} at ${LEGAL.contactEmail}.` },
    ],
  },
  {
    id: 'privacy',
    tab: 'PRIVACY',
    title: 'PRIVACY POLICY',
    intro: `Last updated ${LEGAL.lastUpdated}. This explains what ${A} collects, why, who it is shared with, and the choices you have.`,
    sections: [
      { heading: 'What we collect', body: `Account data (your email and authentication details). Fitness data you log (workouts, sets, cardio, bodyweight, body-fat, nutrition and meals). Content you create (profile, posts, gym messages). Photos you choose to submit for analysis or battles. Limited product analytics (app sessions, which screens are used and for how long) to improve the app.` },
      { heading: 'How your data is isolated', body: `Every record is tied to your account, and our database enforces that you can only read and write your own data. Other users only ever see what you deliberately share — your public profile, posts, or gym membership — and only through controlled, server-side queries. We never expose one athlete’s private data to another.` },
      { heading: 'Photos', body: `Solo physique-scan photos are sent for AI analysis and then discarded — they are not stored on our servers. The one exception is a battle’s final-round photo, which is stored in a private area readable only by the two athletes in that match and is deleted when the match ends or is cancelled.` },
      { heading: 'AI processing', body: `Some features (physique and body-fat estimates, nutrition and meal analysis, plan generation, and battle assessment) send the relevant data or image to a third-party AI provider (OpenAI) to generate a result. That data is processed to return your result and is subject to the provider’s terms. See the AI & Health notice for more. We do not sell your data or use it to train third-party models beyond what is needed to deliver the feature.` },
      { heading: 'Analytics', body: `We record best-effort usage metrics (session length, page views and time on app) to understand what to improve. Page paths are normalised so that identifiers are stripped — analytics never records a name, email, photo, or other personal detail inside a route. This is aggregate product data, not advertising tracking.` },
      { heading: 'Who we share with', body: `Our infrastructure providers (for hosting, database, authentication and push notifications) and the AI provider named above, only as needed to run the features you use. We do not sell your personal data.` },
      { heading: 'Your rights', body: `You can access and correct most of your data directly in the app. You can delete your account and its data at any time from Profile → Delete account. Depending on where you live, you may also have rights to export your data or object to certain processing — contact ${LEGAL.contactEmail} and we will help. If you are in the EU/UK, our legal basis is your consent and the performance of our agreement with you.` },
      { heading: 'Retention & security', body: `We keep your data while your account is active and remove it when you delete your account, except where we must keep limited records to meet legal obligations. We protect data in transit and at rest, but no system is perfectly secure.` },
      { heading: 'Contact', body: `Privacy questions or requests: ${LEGAL.contactEmail}.` },
    ],
  },
  {
    id: 'ai',
    tab: 'AI & SAFETY',
    title: 'AI & HEALTH NOTICE',
    intro: `${A} uses artificial intelligence to power several features. This notice explains where, and the important limits on what those results mean.`,
    sections: [
      { heading: 'Where AI is used', body: `AI (provided by OpenAI) generates: physique and body-composition estimates from photos, body-fat estimates, nutrition and meal analysis (including photo and barcode scans), training-plan suggestions, plan scanning, and battle/damage assessment. Anywhere you see the AI tag, the content was produced or assisted by AI.` },
      { heading: 'AI results are estimates', body: `AI output is an automated estimate, not a measurement and not a fact. It can be inaccurate, inconsistent, or wrong — especially body-composition and calorie estimates. Treat every AI result as a rough guide, not a verdict, and use your own judgement.` },
      { heading: 'Not medical or professional advice', body: `${A} is not a medical device and does not provide medical, dietary, or professional fitness advice. Nothing in the app — including AI estimates, plans, targets and stats — is a substitute for a qualified professional. Consult a doctor before starting or changing a training or nutrition programme, especially if you have any health condition, are pregnant, or are recovering from injury.` },
      { heading: 'Train at your own risk', body: `You are responsible for how you train and eat. Stop and seek help if you feel unwell. ${OP} is not responsible for injury, illness, or other harm resulting from following AI suggestions or app content.` },
      { heading: 'What we send to the AI', body: `To produce a result we send the relevant input — for a physique estimate, your photo; for meal analysis, your meal photo or description; for a plan, your training data. Solo photos are analysed and then discarded (see Privacy Policy). You choose when to run an AI feature; if you would rather not use AI, you can skip those features and log everything manually.` },
      { heading: 'Transparency', body: `We label AI-generated content with an AI tag so you always know when a result came from a machine rather than a measurement or a human. This reflects our commitment to transparent AI use.` },
    ],
  },
];
