import i18n from "i18next";
import { initReactI18next } from "react-i18next";
// Optionnel : auto-détection de langue + persistance
import LanguageDetector from "i18next-browser-languagedetector";

// Import des JSON
import fr from "./locales/fr/translation.json";
import en from "./locales/en/translation.json";

i18n
  .use(LanguageDetector)            // optionnel mais pratique
  .use(initReactI18next)
  .init({
    resources: {
      fr: { translation: fr },
      en: { translation: en },
    },
    // Ordre de détection : d'abord localStorage, puis navigateur, etc.
    detection: {
      order: ["localStorage", "navigator", "htmlTag"],
      caches: ["localStorage"],
    },
    fallbackLng: "fr",
    supportedLngs: ["fr", "en"],
    interpolation: { escapeValue: false },
    // Évite d'avoir à gérer <Suspense> si tu ne charges pas à la volée
    react: { useSuspense: false }
  });

export default i18n;
