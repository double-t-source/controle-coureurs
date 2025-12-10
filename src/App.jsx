import { useState } from "react";
import ControleCoureurs from "./ControleCoureurs";
import AdminControleCoureurs from "./AdminControleCoureurs";

export default function App() {
  const [page, setPage] = useState("controle");

  return (
    <div>
      <nav className="p-4 flex gap-4 bg-gray-100 mb-4">
        <button
          onClick={() => setPage("controle")}
          className={`py-2 px-4 rounded ${page === "controle" ? "bg-blue-600 text-white" : "bg-white border"}`}
        >
          Contrôle
        </button>
        <button
          onClick={() => setPage("admin")}
          className={`py-2 px-4 rounded ${page === "admin" ? "bg-blue-600 text-white" : "bg-white border"}`}
        >
          Récapitulatif PC Course
        </button>
      </nav>

      {page === "controle" && <ControleCoureurs />}
      {page === "admin" && <AdminControleCoureurs />}
    </div>
  );
}
