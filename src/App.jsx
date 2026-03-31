import { useState } from "react";
import { useTranslation } from "react-i18next";
import ControleCoureurs from "./ControleCoureurs";
import AdminControleCoureurs from "./AdminControleCoureurs";
import SuperAdminPanel from "./SuperAdminPanel";
import LangSegmented from "./LangSegmented";

export default function App() {
  const [page, setPage] = useState("controle");
  const { t, i18n } = useTranslation();

  const currentLang = (i18n.resolvedLanguage || i18n.language).slice(0, 2);
  const handleLangChange = (lang) => {
    i18n.changeLanguage(lang);
    localStorage.setItem("lang", lang);
  };

  return (
    <div>
      <nav className="p-4 flex items-center gap-4 bg-gray-100 mb-4 flex-wrap">
        <button
          onClick={() => setPage("controle")}
          className={`py-2 px-4 rounded ${page === "controle" ? "bg-blue-600 text-white" : "bg-white border"}`}
        >
          {t("nav.control")}
        </button>
        <button
          onClick={() => setPage("admin")}
          className={`py-2 px-4 rounded ${page === "admin" ? "bg-blue-600 text-white" : "bg-white border"}`}
        >
          {t("nav.admin")}
        </button>
        <button
          onClick={() => setPage("superadmin")}
          className={`py-2 px-4 rounded ${page === "superadmin" ? "bg-purple-600 text-white" : "bg-white border"}`}
        >
          {t("nav.superAdmin")}
        </button>
        <div className="ml-auto">
          <LangSegmented value={currentLang} onChange={handleLangChange} />
        </div>
      </nav>

      {page === "controle" && <ControleCoureurs />}
      {page === "admin" && <AdminControleCoureurs />}
      {page === "superadmin" && <SuperAdminPanel />}
    </div>
  );
}
