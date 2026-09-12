// Seeded demo utterances — only reachable inside a circle where is_demo = true.
export const utterances = [
  { id: "u1", label: "A calm evening", spoken_lang: "ar",
    transcript: "اليوم كان هادئًا. تمشيت قليلًا في الحديقة.",
    translation: "Today was calm. I walked a little in the garden." },
  { id: "u2", label: "A hard night", spoken_lang: "ar",
    transcript: "لم أنم جيدًا. ظهري يؤلمني منذ الصباح.",
    translation: "I did not sleep well. My back has hurt since the morning." },
  { id: "u3", label: "Visitors came", spoken_lang: "ar",
    transcript: "جاء الأحفاد لزيارتي. كان يومًا جميلًا.",
    translation: "The grandchildren came to visit. It was a lovely day." },
] as const;
