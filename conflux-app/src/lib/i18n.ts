// ===== i18n — Internationalization Framework =====
// Uses i18next + react-i18next.
// Locale files: src/locales/en.json (English), src/locales/zh.json (Chinese).
// C3: Fill in zh.json translation content.

import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "@/locales/en.json";
import zh from "@/locales/zh.json";

const resources = {
  en: { translation: en },
  zh: { translation: zh },
};

i18n
  .use(initReactI18next)
  .init({
    resources,
    lng: localStorage.getItem("conflux.lang") || "en",
    fallbackLng: "en",
    interpolation: {
      escapeValue: false, // React already escapes
    },
    react: {
      useSuspense: false,
    },
  });

// Persist language preference
i18n.on("languageChanged", (lng: string) => {
  localStorage.setItem("conflux.lang", lng);
});

export { i18n };
export default i18n;
