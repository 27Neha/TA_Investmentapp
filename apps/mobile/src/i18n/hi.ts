import type { TranslationKey } from './en';
// DRAFT translations — require human review before release (legal/risk text especially).
const hi: Partial<Record<TranslationKey, string>> = {
  'common.continue': 'आगे बढ़ें', 'common.back': 'वापस', 'common.loading': 'कृपया प्रतीक्षा करें…', 'common.retry': 'फिर कोशिश करें',
  'common.error.network': 'TechArtha से संपर्क नहीं हो सका। अपना कनेक्शन जाँचकर फिर कोशिश करें।',
  'lang.title': 'अपनी भाषा चुनें',
  'welcome.headline': 'वित्त, सरल।', 'welcome.sub': 'स्पष्टता के साथ लक्ष्य बनाएँ और म्यूचुअल फंड जानें।',
  'welcome.login': 'लॉग इन', 'welcome.signup': 'खाता बनाएँ',
  'signup.title': 'अपना खाता बनाएँ', 'signup.fullName': 'पूरा नाम', 'signup.email': 'ईमेल', 'signup.mobile': 'मोबाइल नंबर',
  'signup.dob': 'जन्म तिथि (YYYY-MM-DD)', 'signup.password': 'पासवर्ड', 'signup.confirm': 'पासवर्ड की पुष्टि करें',
  'verify.title': 'अपना ईमेल सत्यापित करें', 'verify.code': '6 अंकों का कोड', 'verify.resend': 'कोड दोबारा भेजें',
  'login.title': 'वापसी पर स्वागत है', 'login.email': 'ईमेल', 'login.password': 'पासवर्ड', 'login.submit': 'लॉग इन',
  'login.forgot': 'पासवर्ड भूल गए?', 'login.show': 'दिखाएँ', 'login.hide': 'छिपाएँ',
  'forgot.title': 'पासवर्ड रीसेट करें', 'forgot.send': 'कोड भेजें', 'forgot.verify': 'कोड सत्यापित करें',
  'forgot.newPassword': 'नया पासवर्ड', 'forgot.reset': 'पासवर्ड अपडेट करें',
  'tabs.home': 'होम', 'tabs.explore': 'एक्सप्लोर', 'tabs.goals': 'लक्ष्य', 'tabs.portfolio': 'पोर्टफोलियो', 'tabs.profile': 'प्रोफ़ाइल',
  'soon.title': 'जल्द आ रहा है', 'profile.logout': 'लॉग आउट', 'profile.language': 'भाषा',
};
export default hi;
