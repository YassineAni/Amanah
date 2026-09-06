// Minimal i18n for the ELDER screens. Her language comes from her Person record
// (lang: "ar"). Other personas stay in English. Add a language = add a dict below.
import type { Lang } from "./api";

export type Strings = {
   dir: "rtl" | "ltr";
   evening: string;
   greeting: (name: string) => string;
   yoursToTell: string;
   readThis: string;
   readMyDay: string;
   today: string;
   tomorrow: string;
   noVisit: string;
   notAssigned: string;
   tellAboutToday: string;
   whatIShared: string;
   signOut: string;
   // record sheet
   listening: string;
   readyToReview: string;
   takeYourTime: (name: string) => string;
   doesThisFeelRight: string;
   showEnglishFirst: string;
   emphasiseArabic: string;
   hearThis: string;
   yourRecording: string;
   howWasToday: string;
   moodGood: string;
   moodOk: string;
   moodHard: string;
   shareWith: string;
   visCircle: string;
   visFamily: string;
   visCoordinator: string;
   visMoodOnly: string;
   saveWords: string;
   transcribing: string;
   imFinished: string;
   recording: string;
   loadingExample: string;
   micError: string;
   transcribeError: string;
   exampleError: string;
   // accessibility sheet
   a11yTitle: string;
   textSize: string;
   sizeNormal: string;
   sizeLarge: string;
   sizeLarger: string;
   magnifier: string;
   magnifierHint: string;
   // share sheet
   alwaysSee: string;
   nothingShared: string;
   largerType: string;
   higherContrast: string;
   readAloud: string;
   visCircleShort: string;
   visFamilyShort: string;
   visCoordShort: string;
   visMoodShort: string;
};

const en: Strings = {
   dir: "ltr",
   evening: "Your evening",
   greeting: (n) => `Good evening, ${n}.`,
   yoursToTell: "Your day is yours to tell, in your own time.",
   readThis: "Read this to me",
   readMyDay: "Read my day to me",
   today: "Today",
   tomorrow: "Tomorrow",
   noVisit: "No visit planned.",
   notAssigned: "Not assigned yet",
   tellAboutToday: "Tell me about today",
   whatIShared: "What I’ve shared",
   signOut: "Sign out",
   listening: "I’m listening",
   readyToReview: "A few words, ready to review",
   takeYourTime: (n) => `Take your time, ${n}.`,
   doesThisFeelRight: "Does this feel right?",
   showEnglishFirst: "Show English first",
   emphasiseArabic: "إبراز العربية",
   hearThis: "Hear this",
   yourRecording: "Your recording",
   howWasToday: "How was today?",
   moodGood: "Good",
   moodOk: "Steady",
   moodHard: "Hard",
   shareWith: "Share this with",
   visCircle: "My care circle",
   visFamily: "Family only",
   visCoordinator: "Coordinator only",
   visMoodOnly: "Mood only (keep note private)",
   saveWords: "Save these words",
   transcribing: "Transcribing…",
   imFinished: "I’m finished",
   recording: "Recording…",
   loadingExample: "Loading example…",
   micError: "Microphone access is needed to record your words.",
   transcribeError: "Transcription didn’t work. Please try again.",
   exampleError: "Could not load the example.",
   a11yTitle: "Accessibility",
   textSize: "Text size",
   sizeNormal: "Normal",
   sizeLarge: "Large",
   sizeLarger: "Larger",
   magnifier: "Magnifier",
   magnifierHint: "A lens follows the pointer and enlarges what’s under it.",
   alwaysSee: "You always see everything you’ve said, and who else can see it.",
   nothingShared: "Nothing shared yet.",
   largerType: "Larger type",
   higherContrast: "Higher contrast",
   readAloud: "Read aloud",
   visCircleShort: "Care circle",
   visFamilyShort: "Family",
   visCoordShort: "Coordinator",
   visMoodShort: "Mood only",
};

const ar: Strings = {
   dir: "rtl",
   evening: "مساؤكِ",
   greeting: (n) => `مساء الخير يا ${n}.`,
   yoursToTell: "يومكِ لكِ، تحكينه كما تشائين وفي وقتكِ.",
   readThis: "اقرأ لي هذا",
   readMyDay: "اقرأ لي يومي",
   today: "اليوم",
   tomorrow: "غداً",
   noVisit: "لا توجد زيارة.",
   notAssigned: "لم يُحدَّد بعد",
   tellAboutToday: "أخبريني عن يومكِ",
   whatIShared: "ما شاركتُه",
   signOut: "تسجيل الخروج",
   listening: "أنا أستمع",
   readyToReview: "بضع كلمات، جاهزة للمراجعة",
   takeYourTime: (n) => `خذي وقتكِ يا ${n}.`,
   doesThisFeelRight: "هل هذا صحيح؟",
   showEnglishFirst: "إظهار الإنجليزية أولاً",
   emphasiseArabic: "إبراز العربية",
   hearThis: "استمعي لهذا",
   yourRecording: "تسجيلكِ",
   howWasToday: "كيف كان يومكِ؟",
   moodGood: "جيّد",
   moodOk: "لا بأس",
   moodHard: "صعب",
   shareWith: "شارِكي هذا مع",
   visCircle: "دائرة الرعاية",
   visFamily: "العائلة فقط",
   visCoordinator: "المنسّق فقط",
   visMoodOnly: "المزاج فقط (تبقى الكلمات خاصة)",
   saveWords: "احفظي هذه الكلمات",
   transcribing: "جارٍ التدوين…",
   imFinished: "انتهيت",
   recording: "يجري التسجيل…",
   loadingExample: "جارٍ تحميل المثال…",
   micError: "نحتاج إذن استخدام الميكروفون لتسجيل كلماتكِ.",
   transcribeError: "لم ينجح التدوين. حاولي مرة أخرى من فضلكِ.",
   exampleError: "تعذّر تحميل المثال.",
   a11yTitle: "إمكانية الوصول",
   textSize: "حجم الخط",
   sizeNormal: "عادي",
   sizeLarge: "كبير",
   sizeLarger: "أكبر",
   magnifier: "المكبِّر",
   magnifierHint: "عدسة تتبع المؤشّر وتكبّر ما تحته.",
   alwaysSee: "ترين دائماً كل ما قلتِه، ومَن يستطيع رؤيته.",
   nothingShared: "لم تتم مشاركة أي شيء بعد.",
   largerType: "خط أكبر",
   higherContrast: "تباين أعلى",
   readAloud: "القراءة بصوت",
   visCircleShort: "دائرة الرعاية",
   visFamilyShort: "العائلة",
   visCoordShort: "المنسّق",
   visMoodShort: "المزاج فقط",
};

const DICTS: Record<Lang, Strings> = { ar, fr: en, en };

export function strings(lang: Lang): Strings {
   return DICTS[lang] ?? en;
}
