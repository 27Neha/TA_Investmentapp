import type { TranslationKey } from './en';
// DRAFT translations — require human review before release (legal/risk text especially).
const mr: Partial<Record<TranslationKey, string>> = {
  'common.continue': 'पुढे जा', 'common.back': 'मागे', 'common.loading': 'कृपया प्रतीक्षा करा…', 'common.retry': 'पुन्हा प्रयत्न करा',
  'common.error.network': 'TechArtha शी संपर्क होऊ शकला नाही. कनेक्शन तपासून पुन्हा प्रयत्न करा.',
  'lang.title': 'तुमची भाषा निवडा',
  'welcome.headline': 'वित्त, सोपे.', 'welcome.sub': 'स्पष्टतेने उद्दिष्टे आखा आणि म्युच्युअल फंड जाणून घ्या.',
  'welcome.login': 'लॉग इन', 'welcome.signup': 'खाते तयार करा',
  'signup.title': 'तुमचे खाते तयार करा', 'signup.fullName': 'पूर्ण नाव', 'signup.email': 'ईमेल', 'signup.mobile': 'मोबाईल नंबर',
  'signup.dob': 'जन्मतारीख (YYYY-MM-DD)', 'signup.password': 'पासवर्ड', 'signup.confirm': 'पासवर्डची खात्री करा',
  'verify.title': 'तुमचा ईमेल सत्यापित करा', 'verify.code': '6 अंकी कोड', 'verify.resend': 'कोड पुन्हा पाठवा',
  'login.title': 'पुन्हा स्वागत', 'login.email': 'ईमेल', 'login.password': 'पासवर्ड', 'login.submit': 'लॉग इन',
  'login.forgot': 'पासवर्ड विसरलात?', 'login.show': 'दाखवा', 'login.hide': 'लपवा',
  'forgot.title': 'पासवर्ड रीसेट करा', 'forgot.send': 'कोड पाठवा', 'forgot.verify': 'कोड सत्यापित करा',
  'forgot.newPassword': 'नवीन पासवर्ड', 'forgot.reset': 'पासवर्ड अपडेट करा',
  'tabs.home': 'होम', 'tabs.explore': 'एक्सप्लोर', 'tabs.goals': 'उद्दिष्टे', 'tabs.portfolio': 'पोर्टफोलिओ', 'tabs.profile': 'प्रोफाइल',
  'soon.title': 'लवकरच येत आहे', 'profile.logout': 'लॉग आउट', 'profile.language': 'भाषा',
};
export default mr;
