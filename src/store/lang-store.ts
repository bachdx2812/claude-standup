// Reactive language slice. Components that show translated chrome subscribe via
// `useLang`; toggling re-renders the tree so `t()` picks up the new language.

import { create } from "zustand";
import { getLang, setLangModule, type Lang } from "../lib/i18n";

interface LangStore {
  lang: Lang;
  setLang: (l: Lang) => void;
}

export const useLang = create<LangStore>((set) => ({
  lang: getLang(),
  setLang: (l) => {
    setLangModule(l);
    set({ lang: l });
  },
}));
