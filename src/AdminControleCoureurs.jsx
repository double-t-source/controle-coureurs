import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "./supabaseClient";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { MapContainer, TileLayer, CircleMarker, Popup, useMap } from "react-leaflet";
import { Map as MapIcon, MapPin, MessageSquare, Pencil, BarChart2 } from "lucide-react";
import "leaflet/dist/leaflet.css";

// react-leaflet's useMap() hook only works inside a MapContainer — this child component
// bridges that constraint so the parent can trigger map panning by changing `center`.
function MapFlyTo({ center }) {
  const map = useMap();
  useEffect(() => {
    if (center) map.flyTo(center, Math.max(map.getZoom(), 15), { animate: true, duration: 0.5 });
  }, [center, map]);
  return null;
}

// SHA-256 via Web Crypto API — browser-native, no library needed, safe for client-side hash comparison.
async function sha256Hex(s) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
}

// Extracted as its own component so it maintains its own edit state independently per row,
// avoiding re-renders of the full table when one cell enters edit mode.
function InternalCommentCell({ dossard, current, isEditing, editValue, setEditValue, setEditingDossard, savingDossard, saveInternalComment, t }) {
  if (isEditing) {
    return (
      <div onClick={(e) => e.stopPropagation()} className="min-w-[120px]">
        <textarea
          className="w-full border rounded p-1 text-xs resize-none focus:outline-none focus:ring-1 focus:ring-blue-400"
          rows={2}
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Escape") setEditingDossard(null); }}
          autoFocus
          placeholder={t("admin.internalCommentPlaceholder")}
        />
        <div className="flex gap-1 mt-0.5">
          <button
            onClick={() => saveInternalComment(dossard)}
            disabled={savingDossard === dossard}
            className="text-xs px-1.5 py-0.5 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
          >
            {savingDossard === dossard ? "…" : t("admin.save")}
          </button>
          <button
            onClick={() => setEditingDossard(null)}
            className="text-xs px-1.5 py-0.5 border rounded hover:bg-gray-50"
          >
            ✕
          </button>
        </div>
      </div>
    );
  }
  return (
    <div
      onClick={(e) => { e.stopPropagation(); setEditingDossard(dossard); setEditValue(current); }}
      className="cursor-pointer min-h-[1.5rem] flex items-start gap-1 group min-w-[80px]"
      title={t("admin.editInternalComment")}
    >
      {current ? (
        <span className="text-xs text-gray-700 flex-1 break-words">{current}</span>
      ) : (
        <span className="text-xs text-gray-300 group-hover:text-gray-500 italic flex-1">
          {t("admin.internalCommentEmpty")}
        </span>
      )}
      <Pencil size={10} className="text-gray-300 group-hover:text-gray-500 flex-shrink-0 mt-0.5" />
    </div>
  );
}

export default function AdminControleCoureurs() {
  const { t, i18n } = useTranslation();

  // Auth is sessionStorage-based: survives a page refresh but clears when the tab is closed.
  // The password is never stored — only its SHA-256 hash (set as a build-time env var) is compared.
  const [ok, setOk] = useState(() => sessionStorage.getItem("admin_ok") === "1");
  const [pw, setPw] = useState("");
  const [isAuthing, setIsAuthing] = useState(false);
  const HASH = import.meta.env.VITE_ADMIN_PW_HASH;

  const tryLogin = async (e) => {
    e.preventDefault();
    if (!HASH) {
      alert(t("admin.authHashMissingAlert"));
      return;
    }
    try {
      setIsAuthing(true);
      const hashInput = await sha256Hex(pw);
      if (hashInput === HASH) {
        sessionStorage.setItem("admin_ok", "1");
        setOk(true);
        setPw("");
      } else {
        alert(t("admin.authWrongPw"));
      }
    } finally {
      setIsAuthing(false);
    }
  };
  // -----------------------------------------

  // Sélections
  const [eventId, setEventId] = useState(() => localStorage.getItem("admin_event_id") || "");
  const [raceId, setRaceId] = useState(() => localStorage.getItem("admin_race_id") || "");

  // Données
  const [eventList, setEventList] = useState([]);
  const [raceList, setRaceList] = useState([]);
  const [controles, setControles] = useState([]);
  const [marshals, setMarshals] = useState({});
  const [gearOptions, setGearOptions] = useState([]);

  // Statut connexion
  const [connectionStatus, setConnectionStatus] = useState("checking"); // 'online' | 'offline' | 'checking'

  // Map panel
  const [showMap, setShowMap] = useState(false);
  const [selectedControleId, setSelectedControleId] = useState(null);

  // Recherche dossard
  const [searchBib, setSearchBib] = useState("");

  // Commentaires internes (par dossard)
  const [internalComments, setInternalComments] = useState({});
  const [editingDossard, setEditingDossard] = useState(null);
  const [editValue, setEditValue] = useState("");
  const [savingDossard, setSavingDossard] = useState(null);

  // Bilan modal
  const [bilanModalOpen, setBilanModalOpen] = useState(false);
  const [bilanMode, setBilanMode] = useState("pdf");
  const [bilanEmail, setBilanEmail] = useState("");
  const [bilanLoading, setBilanLoading] = useState(false);
  const [bilanData, setBilanData] = useState(null);
  const [bilanSending, setBilanSending] = useState(false);
  const [bilanSendResult, setBilanSendResult] = useState(null);

  // Vérif connexion DB (uniquement si logué)
  useEffect(() => {
    if (!ok) return;
    const checkConnection = async () => {
      const { error } = await supabase.from("events").select("id").limit(1);
      setConnectionStatus(error ? "offline" : "online");
    };
    checkConnection();
  }, [ok]);

  // Charger évènements (uniquement si logué)
  useEffect(() => {
    if (!ok) return;
    const fetchEvents = async () => {
      const { data, error } = await supabase.from("events").select("id, name, isLocked, date");
      if (!error && data) setEventList(data);
    };
    fetchEvents();
  }, [ok]);

  // Charger équipements (uniquement si logué)
  useEffect(() => {
    if (!ok) return;
    const fetchGear = async () => {
      const { data, error } = await supabase.from("gear").select("code, label_fr, label_en");
      if (!error && data) setGearOptions(data);
    };
    fetchGear();
  }, [ok]);

  // Charger commissaires (uniquement si logué)
  useEffect(() => {
    if (!ok) return;
    const fetchMarshals = async () => {
      const { data, error } = await supabase
        .from("marshals")
        .select("id, firstName, lastName")
        .order("lastName", { ascending: true });
      if (!error && data) {
        const mapping = {};
        data.forEach((m) => (mapping[m.id] = `${m.firstName} ${m.lastName}`));
        setMarshals(mapping);
      }
    };
    fetchMarshals();
  }, [ok]);

  // Charger courses (races) quand event change (uniquement si logué)
  useEffect(() => {
    if (!ok) return;
    const fetchRaces = async () => {
      if (!eventId) {
        setRaceList([]);
        setRaceId("");
        localStorage.removeItem("admin_race_id");
        return;
      }
      const { data, error } = await supabase
        .from("races")
        .select("id, name")
        .eq("event_id", eventId)
        .order("name", { ascending: true });
      if (!error && data) {
        setRaceList(data);
        // Si la race sélectionnée n'appartient pas au nouvel event, reset
        if (!data.find((r) => r.id.toString() === raceId)) {
          setRaceId("");
          localStorage.removeItem("admin_race_id");
        }
      }
    };
    fetchRaces();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ok, eventId]);

  // Poll checks for the selected race every 5 s so the dashboard stays live during an event.
  // Slightly less frequent than the marshal UI (3 s) since the admin view is read-only.
  useEffect(() => {
    if (!ok) return;
    let interval;
    const fetchControles = async () => {
      if (!raceId) return;
      const { data, error } = await supabase
        .from("controles")
        .select("*, marshal_id")
        .eq("race_id", raceId)
        .order("created_at", { ascending: false });
      if (!error && data) setControles(data);
    };

    if (raceId) {
      fetchControles();
      interval = setInterval(fetchControles, 5000);
    }
    return () => clearInterval(interval);
  }, [ok, raceId]);

  // Internal comments are admin-only notes stored in a separate table — marshals never see them.
  // They are keyed by (race_id, dossard) so notes survive if a check record is corrected.
  useEffect(() => {
    if (!ok || !raceId) { setInternalComments({}); return; }
    const fetchInternalComments = async () => {
      const { data, error } = await supabase
        .from("commentaires_internes")
        .select("dossard, texte")
        .eq("race_id", raceId);
      if (!error && data) {
        const map = {};
        data.forEach((r) => (map[r.dossard] = r.texte));
        setInternalComments(map);
      }
    };
    fetchInternalComments();
  }, [ok, raceId]);

  // Handlers sélection
  const handleEventChange = (e) => {
    const val = e.target.value;
    setEventId(val);
    localStorage.setItem("admin_event_id", val);
    // Reset course à chaque changement d’évènement
    setRaceId("");
    localStorage.removeItem("admin_race_id");
    setControles([]);
  };

  const handleRaceChange = (e) => {
    const val = e.target.value;
    setRaceId(val);
    setSelectedControleId(null);
    setSearchBib("");
    if (val) localStorage.setItem("admin_race_id", val);
    else localStorage.removeItem("admin_race_id");
  };

  // Helpers d’affichage
  const getEventName = (id) => eventList.find((e) => e.id.toString() === id)?.name || "";
  const getRaceName = (id) => raceList.find((r) => r.id.toString() === id)?.name || "";

  const countByDossard = controles.reduce((acc, curr) => {
    acc[curr.dossard] = (acc[curr.dossard] || 0) + 1;
    return acc;
  }, {});
  const getAttentionEmoji = (dossard) => (countByDossard[dossard] > 1 ? "⚠️ " : "");

  const currentLang = (i18n.resolvedLanguage || i18n.language).slice(0, 2);
  const labelForGear = (value) => {
    if (!value) return "-";
    return value.split(",").map((code) => {
      const trimmed = code.trim();
      const g = gearOptions.find((x) => x.code === trimmed);
      if (!g) return trimmed;
      return currentLang === "fr" ? (g.label_fr || g.code) : (g.label_en || g.label_fr || g.code);
    }).join(", ");
  };

  const formatDate = (timestamp) =>
    new Date(timestamp).toLocaleString(i18n.language, {
      day: "2-digit",
      month: "2-digit",
      year: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });

  const controlesKO = controles.filter((c) => c.resultat === "ko");
  const controlesOK = controles.filter((c) => c.resultat === "ok");

  // Classify each bib into one of three categories based on its full history:
  //   stillKO   — last check was KO (runner still has a gear problem)
  //   koThenOk  — was KO at some point but the last check is OK (resolved)
  //   okDirect  — only ever checked OK (no gear issues at all)
  // Sorting within each category: numeric bib order, with "P" (pacer) bibs after the runner number.
  const bibGroups = (() => {
    const map = new Map();
    for (const c of controles) {
      const key = c.dossard;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(c);
    }

    const summaries = [];
    for (const [dossard, arr] of map.entries()) {
      arr.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
      const last = arr[arr.length - 1];
      const hasKO = arr.some((x) => x.resultat === "ko");
      const hasOK = arr.some((x) => x.resultat === "ok");
      const lastKO = [...arr].reverse().find((x) => x.resultat === "ko") || null;
      const allKOCodes = arr
        .filter(x => x.resultat === "ko" && x.materiel_manquant)
        .flatMap(x => x.materiel_manquant.split(",").map(s => s.trim()).filter(Boolean));
      const allMissingGear = [...new Set(allKOCodes)].join(",");

      summaries.push({
        dossard,
        history: arr,                 // tous les contrôles (triés)
        last,                         // dernier contrôle
        lastAt: last.created_at,
        lastMarshalId: last.marshal_id,
        lastResult: last.resultat,    // "ok" | "ko"
        hasKO,
        hasOK,
        wentKoThenOk: hasKO && last.resultat === "ok",
        lastKO,                       // le dernier KO (si existe)
        allMissingGear,               // union de tous les items KO (tous passages)
      });
    }

    // Tri par numéro de dossard (ordre numérique), pacer après son coureur
    const bibSort = (a, b) => {
      const na = parseInt(a.dossard.replace(/^P/, ""), 10) || 0;
      const nb = parseInt(b.dossard.replace(/^P/, ""), 10) || 0;
      if (na !== nb) return na - nb;
      return a.dossard.startsWith("P") ? 1 : -1;
    };

    const stillKO = summaries.filter((s) => s.lastResult === "ko").sort(bibSort);
    const koThenOk = summaries.filter((s) => s.wentKoThenOk).sort(bibSort);
    const okDirect = summaries.filter((s) => s.lastResult === "ok" && !s.hasKO).sort(bibSort);

    return { stillKO, koThenOk, okDirect };
  })();

  // Export PDF
  const exportPDF = () => {
    const doc = new jsPDF();
    const now = new Date();
    const exportTime = now.toLocaleString(i18n.language);
    const eventName = getEventName(eventId);
    const raceName = getRaceName(raceId);

    doc.setFontSize(14);
    doc.text(t("admin.exportTitle", { event: eventName, race: raceName }), 14, 20);
    doc.setFontSize(10);
    doc.text(t("admin.exportDate", { date: exportTime }), 14, 27);
    doc.text(t("admin.totalCount", { count: controles.length }), 14, 33);
    doc.text(t("admin.okCount", { count: controlesOK.length }), 14, 38);
    doc.text(t("admin.koCount", { count: controlesKO.length }), 14, 43);

    autoTable(doc, {
      startY: 50,
      head: [[t("admin.pdfBib"), t("admin.pdfResult"), t("admin.pdfMissingGear"), t("admin.pdfComment"), t("admin.pdfMarshal"), t("admin.pdfDateTime")]],
      body: controles.map((c) => [
        c.dossard,
        c.resultat?.toUpperCase() || "-",
        labelForGear(c.materiel_manquant),
        c.commentaire || "-",
        marshals[c.marshal_id] || "?",
        formatDate(c.created_at),
      ]),
      styles: { fontSize: 9 },
      headStyles: { fillColor: [240, 240, 240] },
    });

    const safe = (s) => (s || "").toString().trim().replace(/[^\w-]+/g, "_");
    doc.save(`controles_${safe(eventName)}_${safe(raceName)}.pdf`);
  };

  // Map derived values
  const geoControles = controles.filter((c) => c.latitude != null && c.longitude != null);
  const mapCenter = geoControles.length > 0
    ? [
        geoControles.reduce((s, c) => s + c.latitude, 0) / geoControles.length,
        geoControles.reduce((s, c) => s + c.longitude, 0) / geoControles.length,
      ]
    : [46.5, 2.3];
  const mapZoom = geoControles.length > 0 ? 13 : 6;
  const selectedControle = controles.find((c) => c.id === selectedControleId);
  const flyToCenter = selectedControle?.latitude != null
    ? [selectedControle.latitude, selectedControle.longitude]
    : null;

  const saveInternalComment = async (dossard) => {
    setSavingDossard(dossard);
    const { error } = await supabase
      .from("commentaires_internes")
      .upsert(
        { race_id: parseInt(raceId), dossard, texte: editValue, updated_at: new Date().toISOString() },
        { onConflict: "race_id,dossard" }
      );
    if (!error) {
      setInternalComments((prev) => ({ ...prev, [dossard]: editValue }));
      setEditingDossard(null);
    }
    setSavingDossard(null);
  };

  const openBilanModal = async () => {
    setBilanModalOpen(true);
    setBilanData(null);
    setBilanSendResult(null);
    setBilanLoading(true);

    let controlesToUse = controles;

    // When no race is selected, aggregate across all races of the event for a full-event summary.
    if (!raceId && eventId) {
      const raceIds = raceList.map((r) => r.id);
      if (raceIds.length > 0) {
        const { data, error } = await supabase
          .from("controles")
          .select("*, marshal_id")
          .in("race_id", raceIds)
          .order("created_at", { ascending: false });
        if (!error && data) controlesToUse = data;
      } else {
        controlesToUse = [];
      }
    }

    const isMultiRace = !raceId;
    const raceNameMap = {};
    if (isMultiRace) raceList.forEach((r) => (raceNameMap[r.id] = r.name));

    const total = controlesToUse.length;
    const okCount = controlesToUse.filter((c) => c.resultat === "ok").length;
    const koCount = controlesToUse.filter((c) => c.resultat === "ko").length;
    const geoCount = controlesToUse.filter((c) => c.latitude != null && c.longitude != null).length;

    const raceStats = {};
    if (isMultiRace) {
      for (const c of controlesToUse) {
        if (!raceStats[c.race_id]) raceStats[c.race_id] = { name: raceNameMap[c.race_id] || "?", total: 0, ok: 0, ko: 0 };
        raceStats[c.race_id].total++;
        if (c.resultat === "ok") raceStats[c.race_id].ok++;
        else raceStats[c.race_id].ko++;
      }
    }
    const byRace = Object.values(raceStats).sort((a, b) => a.name.localeCompare(b.name));

    const marshalStats = {};
    for (const c of controlesToUse) {
      if (!marshalStats[c.marshal_id]) marshalStats[c.marshal_id] = { total: 0, ok: 0, ko: 0 };
      marshalStats[c.marshal_id].total++;
      if (c.resultat === "ok") marshalStats[c.marshal_id].ok++;
      else marshalStats[c.marshal_id].ko++;
    }
    const byMarshal = Object.entries(marshalStats)
      .map(([id, s]) => ({ name: marshals[id] || "?", ...s }))
      .sort((a, b) => b.total - a.total);

    const bibMap = new Map();
    for (const c of controlesToUse) {
      if (!bibMap.has(c.dossard)) bibMap.set(c.dossard, { dossard: c.dossard, race_id: c.race_id, history: [] });
      bibMap.get(c.dossard).history.push(c);
    }

    const bibSort = (a, b) => {
      const na = parseInt(a.dossard.replace(/^P/, ""), 10) || 0;
      const nb = parseInt(b.dossard.replace(/^P/, ""), 10) || 0;
      if (na !== nb) return na - nb;
      return a.dossard.startsWith("P") ? 1 : -1;
    };

    const stillKO = [];
    const koThenOk = [];

    for (const [, group] of bibMap) {
      const arr = group.history.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
      const last = arr[arr.length - 1];
      const hasKO = arr.some((x) => x.resultat === "ko");
      const raceName = isMultiRace ? (raceNameMap[group.race_id] || "?") : null;

      const allKOCodesBilan = arr
        .filter(x => x.resultat === "ko" && x.materiel_manquant)
        .flatMap(x => x.materiel_manquant.split(",").map(s => s.trim()).filter(Boolean));
      const allMissingGearBilan = labelForGear([...new Set(allKOCodesBilan)].join(","));

      const historyStr = arr.map(h => {
        if (h.resultat === "ok") return "✅";
        const gear = h.materiel_manquant ? ` (${labelForGear(h.materiel_manquant)})` : "";
        return `❌${gear}`;
      }).join(" → ");
      const historyStrPdf = arr.map(h => {
        if (h.resultat === "ok") return "OK";
        const gear = h.materiel_manquant ? ` (${h.materiel_manquant.split(",").map(c => {
          const g = gearOptions.find(x => x.code === c.trim());
          return g ? (currentLang === "fr" ? (g.label_fr || g.code) : (g.label_en || g.label_fr || g.code)) : c;
        }).join("+")})` : "";
        return `KO${gear}`;
      }).join(" > ");

      if (last.resultat === "ko") {
        stillKO.push({
          dossard: group.dossard,
          raceName,
          missingGear: allMissingGearBilan,
          comment: last.commentaire || "",
          marshalName: marshals[last.marshal_id] || "?",
          date: last.created_at,
        });
      } else if (hasKO) {
        koThenOk.push({
          dossard: group.dossard,
          raceName,
          lastKOMissingGear: allMissingGearBilan,
          lastKOComment: "",
          marshalName: marshals[last.marshal_id] || "?",
          lastOkDate: last.created_at,
          historyStr,
          historyStrPdf,
        });
      }
    }

    stillKO.sort(bibSort);
    koThenOk.sort(bibSort);

    setBilanData({ total, okCount, koCount, geoCount, byRace, byMarshal, stillKO, koThenOk });
    setBilanLoading(false);
  };

  const exportBilanPDF = (data) => {
    const doc = new jsPDF();
    const exportTime = new Date().toLocaleString(i18n.language);
    const eventName = getEventName(eventId);
    const scopeLabel = raceId ? getRaceName(raceId) : t("admin.bilanScopeAllRaces");
    const isMultiRace = !raceId;
    const pct = (n) => (data.total ? `${((n / data.total) * 100).toFixed(1)}%` : "0%");
    const safe = (s) => (s || "").toString().trim().replace(/[^\w-]+/g, "_");

    let y = 20;
    doc.setFontSize(15);
    doc.setFont("helvetica", "bold");
    doc.text(`${t("admin.bilanPdfTitle")} — ${eventName} — ${scopeLabel}`, 14, y, { maxWidth: 180 });
    y += 10;

    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    doc.text(t("admin.exportDate", { date: exportTime }), 14, y);
    y += 8;

    doc.setFontSize(11);
    doc.setFont("helvetica", "bold");
    doc.text(t("admin.bilanStatTitle"), 14, y);
    y += 5;

    autoTable(doc, {
      startY: y,
      head: [[t("admin.bilanTotal"), "OK", "KO", t("admin.bilanGeo"), t("admin.bilanNonGeo")]],
      body: [[
        data.total,
        `${data.okCount} (${pct(data.okCount)})`,
        `${data.koCount} (${pct(data.koCount)})`,
        `${data.geoCount} (${pct(data.geoCount)})`,
        `${data.total - data.geoCount} (${pct(data.total - data.geoCount)})`,
      ]],
      styles: { fontSize: 9 },
      headStyles: { fillColor: [240, 240, 240], textColor: [50, 50, 50] },
    });
    y = doc.lastAutoTable.finalY + 8;

    if (isMultiRace && data.byRace.length > 0) {
      doc.setFontSize(11);
      doc.setFont("helvetica", "bold");
      doc.text(t("admin.bilanByRace"), 14, y);
      y += 5;
      autoTable(doc, {
        startY: y,
        head: [[t("admin.bilanRaceName"), t("admin.bilanTotal"), "OK", "KO"]],
        body: data.byRace.map((r) => [r.name, r.total, r.ok, r.ko]),
        styles: { fontSize: 9 },
        headStyles: { fillColor: [240, 240, 240], textColor: [50, 50, 50] },
      });
      y = doc.lastAutoTable.finalY + 8;
    }

    doc.setFontSize(11);
    doc.setFont("helvetica", "bold");
    doc.text(t("admin.bilanByMarshal"), 14, y);
    y += 5;
    autoTable(doc, {
      startY: y,
      head: [[t("admin.bilanMarshalName"), t("admin.bilanTotal"), "OK", "KO"]],
      body: data.byMarshal.map((m) => [m.name, m.total, m.ok, m.ko]),
      styles: { fontSize: 9 },
      headStyles: { fillColor: [240, 240, 240], textColor: [50, 50, 50] },
    });
    y = doc.lastAutoTable.finalY + 8;

    doc.setFontSize(11);
    doc.setFont("helvetica", "bold");
    doc.text(`${t("admin.bilanStillKO")} (${data.stillKO.length})`, 14, y);
    y += 5;
    const koHead = isMultiRace
      ? [t("admin.bib"), t("admin.bilanRaceName"), t("admin.missingGear"), t("admin.comment"), t("admin.bilanMarshalName"), t("admin.dateTime")]
      : [t("admin.bib"), t("admin.missingGear"), t("admin.comment"), t("admin.bilanMarshalName"), t("admin.dateTime")];
    autoTable(doc, {
      startY: y,
      head: [koHead],
      body: data.stillKO.map((s) => {
        const row = [s.dossard];
        if (isMultiRace) row.push(s.raceName || "?");
        row.push(s.missingGear || "-", s.comment || "-", s.marshalName, formatDate(s.date));
        return row;
      }),
      styles: { fontSize: 8 },
      headStyles: { fillColor: [254, 226, 226], textColor: [50, 50, 50] },
    });
    y = doc.lastAutoTable.finalY + 8;

    doc.setFontSize(11);
    doc.setFont("helvetica", "bold");
    doc.text(`${t("admin.bilanKOThenOK")} (${data.koThenOk.length})`, 14, y);
    y += 5;
    const koOkHead = isMultiRace
      ? [t("admin.bib"), t("admin.bilanRaceName"), t("admin.lastKOMaterial"), t("admin.bilanMarshalName"), t("admin.bilanLastOkDate"), t("admin.history")]
      : [t("admin.bib"), t("admin.lastKOMaterial"), t("admin.bilanMarshalName"), t("admin.bilanLastOkDate"), t("admin.history")];
    autoTable(doc, {
      startY: y,
      head: [koOkHead],
      body: data.koThenOk.map((s) => {
        const row = [s.dossard];
        if (isMultiRace) row.push(s.raceName || "?");
        row.push(s.lastKOMissingGear || "-", s.marshalName, formatDate(s.lastOkDate), s.historyStrPdf);
        return row;
      }),
      styles: { fontSize: 8 },
      headStyles: { fillColor: [254, 243, 199], textColor: [50, 50, 50] },
    });

    doc.save(`bilan_${safe(eventName)}_${safe(scopeLabel)}.pdf`);
  };

  const buildBilanHtml = (data) => {
    const exportTime = new Date().toLocaleString(i18n.language);
    const eventName = getEventName(eventId);
    const scopeLabel = raceId ? getRaceName(raceId) : t("admin.bilanScopeAllRaces");
    const isMultiRace = !raceId;
    const pct = (n) => (data.total ? `${((n / data.total) * 100).toFixed(1)}%` : "0%");
    const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const th = (s) => `<th style="background:#f0f0f0;padding:5px 12px;border:1px solid #ddd;white-space:nowrap;">${esc(s)}</th>`;
    const td = (s) => `<td style="padding:5px 12px;border:1px solid #ddd;text-align:center;">${esc(String(s ?? "-"))}</td>`;
    const tdL = (s) => `<td style="padding:5px 12px;border:1px solid #ddd;">${esc(String(s ?? "-"))}</td>`;

    let body = `
      <h2 style="color:#444;margin:16px 0 6px;font-size:15px;">Statistiques générales</h2>
      <table style="border-collapse:collapse;font-size:13px;margin-bottom:16px;">
        <tr>${th("Total")}${th("✅ OK")}${th("❌ KO")}${th("📍 Géolocalisés")}${th("Non géolocalisés")}</tr>
        <tr>${td(data.total)}${td(`${data.okCount} (${pct(data.okCount)})`)}${td(`${data.koCount} (${pct(data.koCount)})`)}${td(`${data.geoCount} (${pct(data.geoCount)})`)}${td(`${data.total - data.geoCount} (${pct(data.total - data.geoCount)})`)}</tr>
      </table>`;

    if (isMultiRace && data.byRace.length > 0) {
      body += `
        <h2 style="color:#444;margin:16px 0 6px;font-size:15px;">Répartition par course</h2>
        <table style="border-collapse:collapse;font-size:13px;margin-bottom:16px;">
          <tr>${th("Course")}${th("Total")}${th("✅ OK")}${th("❌ KO")}</tr>
          ${data.byRace.map((r) => `<tr>${tdL(r.name)}${td(r.total)}${td(r.ok)}${td(r.ko)}</tr>`).join("")}
        </table>`;
    }

    body += `
      <h2 style="color:#444;margin:16px 0 6px;font-size:15px;">Répartition par commissaire</h2>
      <table style="border-collapse:collapse;font-size:13px;margin-bottom:16px;">
        <tr>${th("Commissaire")}${th("Total")}${th("✅ OK")}${th("❌ KO")}</tr>
        ${data.byMarshal.map((m) => `<tr>${tdL(m.name)}${td(m.total)}${td(m.ok)}${td(m.ko)}</tr>`).join("")}
      </table>`;

    body += `<h2 style="color:#c0392b;margin:16px 0 6px;font-size:15px;">⚠️ KO restants (${data.stillKO.length})</h2>`;
    if (data.stillKO.length === 0) {
      body += `<p style="color:#888;font-size:13px;">Aucun KO restant.</p>`;
    } else {
      const raceCol = isMultiRace ? th("Course") : "";
      body += `
        <table style="border-collapse:collapse;font-size:13px;width:100%;margin-bottom:16px;">
          <tr style="background:#fdf0f0;">${th("Dossard")}${raceCol}${th("Matériel manquant")}${th("Commentaire")}${th("Commissaire")}${th("Date/Heure")}</tr>
          ${data.stillKO.map((s) => `<tr>${tdL(s.dossard)}${isMultiRace ? tdL(s.raceName) : ""}${tdL(s.missingGear || "—")}${tdL(s.comment || "—")}${tdL(s.marshalName)}${tdL(formatDate(s.date))}</tr>`).join("")}
        </table>`;
    }

    body += `<h2 style="color:#b45309;margin:16px 0 6px;font-size:15px;">🔁 KO recontrôlés OK (${data.koThenOk.length})</h2>`;
    if (data.koThenOk.length === 0) {
      body += `<p style="color:#888;font-size:13px;">Aucun dossard KO recontrôlé OK.</p>`;
    } else {
      const raceCol = isMultiRace ? th("Course") : "";
      body += `
        <table style="border-collapse:collapse;font-size:13px;width:100%;margin-bottom:16px;">
          <tr style="background:#fffbeb;">${th("Dossard")}${raceCol}${th("Dernier KO — Matériel")}${th("Commissaire")}${th("Date repassage OK")}${th("Historique")}</tr>
          ${data.koThenOk.map((s) => `<tr>${tdL(s.dossard)}${isMultiRace ? tdL(s.raceName) : ""}${tdL(s.lastKOMissingGear || "—")}${tdL(s.marshalName)}${tdL(formatDate(s.lastOkDate))}${tdL(s.historyStr)}</tr>`).join("")}
        </table>`;
    }

    return `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="font-family:Arial,sans-serif;max-width:720px;margin:0 auto;padding:20px;color:#333;">
  <h1 style="font-size:20px;color:#1a1a2e;border-bottom:2px solid #eee;padding-bottom:10px;margin-bottom:6px;">
    📊 Bilan — ${esc(eventName)} — ${esc(scopeLabel)}
  </h1>
  <p style="color:#888;font-size:13px;margin-top:0;">Généré le ${esc(exportTime)}</p>
  ${body}
  <hr style="border:none;border-top:1px solid #eee;margin-top:32px;">
  <p style="color:#bbb;font-size:11px;">Bilan généré via Contrôle Coureurs</p>
</body></html>`;
  };

  const sendBilanEmail = async () => {
    if (!bilanEmail.trim()) {
      alert(t("admin.bilanEmailRequired"));
      return;
    }
    setBilanSending(true);
    setBilanSendResult(null);
    try {
      const html = buildBilanHtml(bilanData);
      const eventName = getEventName(eventId);
      const scopeLabel = raceId ? getRaceName(raceId) : t("admin.bilanScopeAllRaces");
      const { error } = await supabase.functions.invoke("send-bilan", {
        body: { to: bilanEmail.trim(), subject: `[Bilan] ${eventName} — ${scopeLabel}`, html },
      });
      if (error) throw error;
      setBilanSendResult({ success: true, msg: t("admin.bilanSendSuccess", { email: bilanEmail.trim() }) });
    } catch (err) {
      console.error(err);
      setBilanSendResult({ success: false, msg: t("admin.bilanSendError") });
    } finally {
      setBilanSending(false);
    }
  };

  const handleRowClick = (controleId) => setSelectedControleId(controleId);
  const handleMapIconClick = (e, controleId) => {
    e.stopPropagation();
    setSelectedControleId(controleId);
    setShowMap(true);
  };

  const bibFilter = searchBib.trim();
  const matchesBibFilter = (dossard) =>
    !bibFilter || dossard.includes(bibFilter) || dossard.replace(/^P/, "").includes(bibFilter);
  const filteredGroups = {
    stillKO: bibGroups.stillKO.filter((s) => matchesBibFilter(s.dossard)),
    koThenOk: bibGroups.koThenOk.filter((s) => matchesBibFilter(s.dossard)),
    okDirect: bibGroups.okDirect.filter((s) => matchesBibFilter(s.dossard)),
  };

  // Icône de commentaire commissaire avec tooltip au survol
  const CommentTooltip = ({ history }) => {
    const comments = history.filter((h) => h.commentaire?.trim());
    if (comments.length === 0) return <span className="text-gray-300 text-xs">—</span>;
    return (
      <div className="relative group inline-flex items-center justify-center">
        <button className="flex items-center gap-0.5 text-blue-500 hover:text-blue-700">
          <MessageSquare size={14} />
          {comments.length > 1 && (
            <span className="text-xs font-bold leading-none">{comments.length}</span>
          )}
        </button>
        <div className="pointer-events-none absolute z-30 hidden group-hover:block bottom-full left-1/2 -translate-x-1/2 mb-1 w-64 bg-gray-800 text-white text-xs rounded p-2 shadow-xl text-left whitespace-normal">
          {comments.map((h, i) => (
            <div key={h.id} className={i > 0 ? "mt-1.5 pt-1.5 border-t border-gray-600" : ""}>
              <div className="opacity-60 mb-0.5">{formatDate(h.created_at)}</div>
              <div className="break-words">{h.commentaire}</div>
            </div>
          ))}
        </div>
      </div>
    );
  };


  return (
    <div className={`p-4 ${showMap ? "" : "max-w-4xl mx-auto"}`}>
      <div className="flex justify-between items-center mb-4 flex-wrap gap-2">
        <h1 className="text-2xl font-bold">{t("admin.title")}</h1>
        <div className="flex items-center gap-3 flex-wrap">
          <div
            className={`text-sm font-medium px-2 py-1 rounded ${
              connectionStatus === "online"
                ? "bg-green-100 text-green-800"
                : connectionStatus === "offline"
                ? "bg-red-100 text-red-800"
                : "bg-yellow-100 text-yellow-800"
            }`}
          >
            {connectionStatus === "online" && t("admin.dbOnline")}
            {connectionStatus === "offline" && t("admin.dbOffline")}
            {connectionStatus === "checking" && t("admin.dbChecking")}
          </div>
          {ok && eventId && (
            <button
              onClick={openBilanModal}
              className="text-sm px-3 py-1 border rounded flex items-center gap-1 hover:bg-gray-50"
            >
              <BarChart2 size={14} />
              {t("admin.bilan")}
            </button>
          )}
          {ok && raceId && (
            <button
              onClick={() => setShowMap((v) => !v)}
              className={`text-sm px-3 py-1 border rounded flex items-center gap-1 ${showMap ? "bg-blue-600 text-white border-blue-600" : "hover:bg-gray-50"}`}
            >
              <MapIcon size={14} />
              {showMap ? t("admin.hideMap") : t("admin.showMap")}
            </button>
          )}
          <button
            onClick={() => {
              sessionStorage.removeItem("admin_ok");
              setOk(false);
            }}
            className="text-sm px-3 py-1 border rounded hover:bg-gray-50"
          >
            {t("admin.logout")}
          </button>
        </div>
      </div>

      <div className={showMap ? "flex gap-4 items-start" : ""}>
      <div className={showMap ? "flex-1 min-w-0" : ""}>

      <div className="flex gap-4 mb-6 flex-wrap">
        <select value={eventId} onChange={handleEventChange} className="p-2 border rounded">
          <option value="">{t("admin.chooseEvent")}</option>
          {[...eventList]
            .sort((a, b) => {
              if (a.isLocked !== b.isLocked) return a.isLocked ? 1 : -1;
              return (b.date || "") > (a.date || "") ? 1 : -1;
            })
            .map((e) => (
              <option key={e.id} value={e.id}>
                {e.isLocked ? "🔒 " : ""}{e.name}
              </option>
            ))}
        </select>

        <select
          value={raceId}
          onChange={handleRaceChange}
          className="p-2 border rounded"
          disabled={!eventId}
        >
          <option value="">{eventId ? t("admin.chooseRace") : t("admin.selectEventFirst")}</option>
          {raceList.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      </div>

      {eventId && raceId && (
        <>
          <p className="text-sm text-gray-600 italic mb-4">
            {t("admin.controlsRecorded", { count: controles.length })} <strong>{getEventName(eventId)}</strong> –{" "}
            <strong>{getRaceName(raceId)}</strong>
          </p>

          {/* Recherche dossard */}
          <div className="mb-6">
            <div className="relative max-w-xs">
              <input
                type="search"
                inputMode="numeric"
                value={searchBib}
                onChange={(e) => setSearchBib(e.target.value.trim())}
                placeholder={t("admin.searchBibPlaceholder")}
                className="w-full border rounded p-2 pr-8 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
              {searchBib && (
                <button
                  onClick={() => setSearchBib("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-lg leading-none"
                  aria-label={t("admin.searchClear")}
                >
                  ×
                </button>
              )}
            </div>
          </div>

          {/* Statistiques par commissaire */}
          <div className="mb-6">
            <h3 className="text-sm font-semibold mb-2">{t("admin.statsByMarshal")}</h3>
            <ul className="text-sm text-gray-800 list-disc list-inside">
              {Object.entries(
                controles.reduce((acc, curr) => {
                  acc[curr.marshal_id] = (acc[curr.marshal_id] || 0) + 1;
                  return acc;
                }, {})
              )
                .sort((a, b) => b[1] - a[1])
                .map(([marshalId, count]) => (
                  <li key={marshalId}>
                    {marshals[marshalId] || t("admin.unknownMarshal")} : {count} {t("admin.controls")} (
                    {((count / controles.length) * 100).toFixed(1)}%)
                  </li>
                ))}
            </ul>
          </div>

          {/* 1) KO persistants */}
          <h2 className="text-lg font-semibold mb-2">{t("admin.stillKOTitle")}</h2>
          <table className="w-full mb-6 border text-sm">
            <thead className="sticky top-0 bg-white z-10">
              <tr className="bg-red-100">
                <th className="border p-2">{t("admin.bib")}</th>
                <th className="border p-2">{t("admin.missingGear")}</th>
                <th className="border p-2 w-8" title={t("admin.comment")}><MessageSquare size={14} className="mx-auto" /></th>
                <th className="border p-2">{t("admin.internalComment")}</th>
                <th className="border p-2">{t("admin.dateTime")}</th>
              </tr>
            </thead>
            <tbody>
              {filteredGroups.stillKO.map((s) => (
                <tr
                  key={s.dossard}
                  className={`border-t cursor-pointer ${selectedControleId === s.last?.id ? "bg-orange-50" : s.dossard.startsWith("P") ? "bg-purple-50/60 hover:bg-purple-50" : "hover:bg-gray-50"}`}
                  onClick={() => s.last && handleRowClick(s.last.id)}
                >
                  <td className="border p-2">
                    {s.dossard.startsWith("P") ? (
                      <span className="text-xs bg-purple-100 text-purple-700 rounded px-1 py-0.5 font-medium mr-1">{t("admin.pacerBadge")}</span>
                    ) : "⚠️ "}
                    {s.dossard}{" "}
                    <span className="text-xs text-gray-500">({marshals[s.lastMarshalId] || "?"})</span>
                    {s.last?.latitude != null && (
                      <button onClick={(e) => handleMapIconClick(e, s.last.id)} className="ml-1 text-blue-500 hover:text-blue-700 align-middle" title={t("admin.showMap")}>
                        <MapPin size={13} className="inline" />
                      </button>
                    )}
                  </td>
                  <td className="border p-2">
                    <div className="relative group inline-block w-full">
                      <span>{labelForGear(s.last?.materiel_manquant)}</span>
                      {s.history.filter(h => h.resultat === "ko").length > 1 && (
                        <div className="pointer-events-none absolute z-30 hidden group-hover:block bottom-full left-0 mb-1 w-72 bg-gray-800 text-white text-xs rounded p-2 shadow-xl text-left whitespace-normal">
                          {s.history.filter(h => h.resultat === "ko").map((h, i) => (
                            <div key={h.id} className={i > 0 ? "mt-1.5 pt-1.5 border-t border-gray-600" : ""}>
                              <div className="opacity-60 mb-0.5">{formatDate(h.created_at)} — {marshals[h.marshal_id] || "?"}</div>
                              <div>{h.materiel_manquant ? labelForGear(h.materiel_manquant) : "—"}</div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </td>
                  <td className="border p-2 text-center"><CommentTooltip history={s.history} /></td>
                  <td className="border p-2"><InternalCommentCell dossard={s.dossard} current={internalComments[s.dossard] || ""} isEditing={editingDossard === s.dossard} editValue={editValue} setEditValue={setEditValue} setEditingDossard={setEditingDossard} savingDossard={savingDossard} saveInternalComment={saveInternalComment} t={t} /></td>
                  <td className="border p-2 whitespace-nowrap">{formatDate(s.lastAt)}</td>
                </tr>
              ))}
              {filteredGroups.stillKO.length === 0 && (
                <tr>
                  <td colSpan="5" className="text-center p-2">
                    {t("admin.noKORemaining")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          {/* 2) KO recontrôlés OK */}
          <h2 className="text-lg font-semibold mb-2">{t("admin.koThenOkTitle")}</h2>
          <table className="w-full mb-6 border text-sm">
            <thead className="sticky top-0 bg-white z-10">
              <tr className="bg-amber-100">
                <th className="border p-2">{t("admin.bib")}</th>
                <th className="border p-2">{t("admin.lastOkControl")}</th>
                <th className="border p-2">{t("admin.marshal")}</th>
                <th className="border p-2">{t("admin.lastKOMaterial")}</th>
                <th className="border p-2 w-8" title={t("admin.lastKOComment")}><MessageSquare size={14} className="mx-auto" /></th>
                <th className="border p-2">{t("admin.internalComment")}</th>
                <th className="border p-2">{t("admin.history")}</th>
              </tr>
            </thead>
            <tbody>
              {filteredGroups.koThenOk.map((s) => (
                <tr
                  key={s.dossard}
                  className={`border-t cursor-pointer ${selectedControleId === s.last?.id ? "bg-orange-50" : s.dossard.startsWith("P") ? "bg-purple-50/60 hover:bg-purple-50" : "hover:bg-gray-50"}`}
                  onClick={() => s.last && handleRowClick(s.last.id)}
                >
                  <td className="border p-2">
                    {s.dossard.startsWith("P") ? (
                      <span className="text-xs bg-purple-100 text-purple-700 rounded px-1 py-0.5 font-medium mr-1">{t("admin.pacerBadge")}</span>
                    ) : "⚠️ "}
                    {s.dossard}
                    {s.last?.latitude != null && (
                      <button onClick={(e) => handleMapIconClick(e, s.last.id)} className="ml-1 text-blue-500 hover:text-blue-700 align-middle" title={t("admin.showMap")}>
                        <MapPin size={13} className="inline" />
                      </button>
                    )}
                  </td>
                  <td className="border p-2 whitespace-nowrap">{formatDate(s.lastAt)}</td>
                  <td className="border p-2">{marshals[s.lastMarshalId] || "?"}</td>
                  <td className="border p-2">{labelForGear(s.allMissingGear)}</td>
                  <td className="border p-2 text-center"><CommentTooltip history={s.history} /></td>
                  <td className="border p-2"><InternalCommentCell dossard={s.dossard} current={internalComments[s.dossard] || ""} isEditing={editingDossard === s.dossard} editValue={editValue} setEditValue={setEditValue} setEditingDossard={setEditingDossard} savingDossard={savingDossard} saveInternalComment={saveInternalComment} t={t} /></td>
                  <td className="border p-2 text-xs">
                    {s.history.map(h => {
                      if (h.resultat === "ok") return "✅";
                      const gear = h.materiel_manquant ? ` (${labelForGear(h.materiel_manquant)})` : "";
                      return `❌${gear}`;
                    }).join(" → ")}
                  </td>
                </tr>
              ))}
              {filteredGroups.koThenOk.length === 0 && (
                <tr>
                  <td colSpan="7" className="text-center p-2">
                    {t("admin.noKOThenOk")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          {/* 3) OK directs */}
          <h2 className="text-lg font-semibold mb-2">{t("admin.okDirectTitle")}</h2>
          <table className="w-full border text-sm">
            <thead className="sticky top-0 bg-white z-10">
              <tr className="bg-green-100">
                <th className="border p-2">{t("admin.bib")}</th>
                <th className="border p-2">{t("admin.lastControl")}</th>
                <th className="border p-2">{t("admin.marshal")}</th>
                <th className="border p-2">{t("admin.internalComment")}</th>
                <th className="border p-2">{t("admin.history")}</th>
              </tr>
            </thead>
            <tbody>
              {filteredGroups.okDirect.map((s) => (
                <tr
                  key={s.dossard}
                  className={`border-t cursor-pointer ${selectedControleId === s.last?.id ? "bg-orange-50" : s.dossard.startsWith("P") ? "bg-purple-50/60 hover:bg-purple-50" : "hover:bg-gray-50"}`}
                  onClick={() => s.last && handleRowClick(s.last.id)}
                >
                  <td className="border p-2">
                    {s.dossard.startsWith("P") && (
                      <span className="text-xs bg-purple-100 text-purple-700 rounded px-1 py-0.5 font-medium mr-1">{t("admin.pacerBadge")}</span>
                    )}
                    {s.dossard}
                    {s.last?.latitude != null && (
                      <button onClick={(e) => handleMapIconClick(e, s.last.id)} className="ml-1 text-blue-500 hover:text-blue-700 align-middle" title={t("admin.showMap")}>
                        <MapPin size={13} className="inline" />
                      </button>
                    )}
                  </td>
                  <td className="border p-2 whitespace-nowrap">{formatDate(s.lastAt)}</td>
                  <td className="border p-2">{marshals[s.lastMarshalId] || "?"}</td>
                  <td className="border p-2"><InternalCommentCell dossard={s.dossard} current={internalComments[s.dossard] || ""} isEditing={editingDossard === s.dossard} editValue={editValue} setEditValue={setEditValue} setEditingDossard={setEditingDossard} savingDossard={savingDossard} saveInternalComment={saveInternalComment} t={t} /></td>
                  <td className="border p-2">
                    {s.history.map(h => (h.resultat === "ok" ? "✅" : "❌")).join(" → ")}
                  </td>
                </tr>
              ))}
              {filteredGroups.okDirect.length === 0 && (
                <tr>
                  <td colSpan="5" className="text-center p-2">{t("admin.noOKDirect")}</td>
                </tr>
              )}
            </tbody>
          </table>

          <div className="mt-6 flex gap-2">
            <button onClick={exportPDF} className="px-4 py-2 bg-blue-700 text-white rounded hover:bg-blue-800">
              {t("admin.exportPDF")}
            </button>
            <button
              onClick={() => {
                sessionStorage.removeItem("admin_ok");
                setOk(false);
              }}
              className="px-4 py-2 border rounded hover:bg-gray-50"
            >
              {t("admin.logout")}
            </button>
          </div>
        </>
      )}

      </div>{/* end flex-1 content */}

      {/* -------- Map panel -------- */}
      {showMap && raceId && (
        <div className="w-[420px] flex-shrink-0 sticky top-4 border rounded overflow-hidden bg-white" style={{ height: "calc(100vh - 7rem)" }}>
          <div className="flex items-center gap-2 p-2 bg-gray-50 border-b text-sm font-medium">
            <MapPin size={14} />
            {t("admin.mapTitle")}
          </div>
          {geoControles.length === 0 ? (
            <div className="p-4 text-sm text-gray-400">{t("admin.noGeoData")}</div>
          ) : (
            <MapContainer key={raceId} center={mapCenter} zoom={mapZoom} style={{ height: "calc(100% - 2.25rem)", width: "100%" }}>
              <TileLayer
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                attribution="&copy; OpenStreetMap contributors"
              />
              <MapFlyTo center={flyToCenter} />
              {geoControles.map((c) => (
                <CircleMarker
                  key={c.id}
                  center={[c.latitude, c.longitude]}
                  radius={c.id === selectedControleId ? 10 : 7}
                  pathOptions={{
                    color: c.id === selectedControleId ? "#ea580c" : "#2563eb",
                    fillColor: c.id === selectedControleId ? "#ea580c" : "#2563eb",
                    fillOpacity: 0.75,
                  }}
                  eventHandlers={{ click: () => setSelectedControleId(c.id) }}
                >
                  <Popup>
                    <div className="text-sm space-y-0.5">
                      <div><strong>{t("admin.bib")}: {c.dossard}</strong></div>
                      <div>{c.resultat?.toUpperCase()}</div>
                      <div>{marshals[c.marshal_id] || "?"}</div>
                      <div>{formatDate(c.created_at)}</div>
                    </div>
                  </Popup>
                </CircleMarker>
              ))}
            </MapContainer>
          )}
        </div>
      )}
      </div>{/* end showMap flex wrapper */}

      {/* -------- Modale bilan -------- */}
      {bilanModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-lg p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <h2 className="text-lg font-semibold">
              {t("admin.bilanModalTitle", {
                event: getEventName(eventId),
                scope: raceId ? getRaceName(raceId) : t("admin.bilanScopeAllRaces"),
              })}
            </h2>

            {bilanLoading && (
              <p className="text-sm text-gray-500">{t("admin.bilanLoading")}</p>
            )}

            {!bilanLoading && bilanData && (
              <>
                {/* Aperçu statistiques */}
                <div className="bg-gray-50 rounded p-3 text-sm space-y-1.5 border">
                  <div className="flex justify-between">
                    <span className="text-gray-600">{t("admin.bilanTotal")}</span>
                    <strong>{bilanData.total}</strong>
                  </div>
                  <div className="flex justify-between text-green-700">
                    <span>✅ OK</span>
                    <strong>
                      {bilanData.okCount}
                      {bilanData.total > 0 && (
                        <span className="font-normal text-green-600 ml-1">
                          ({((bilanData.okCount / bilanData.total) * 100).toFixed(1)}%)
                        </span>
                      )}
                    </strong>
                  </div>
                  <div className="flex justify-between text-red-700">
                    <span>❌ KO</span>
                    <strong>
                      {bilanData.koCount}
                      {bilanData.total > 0 && (
                        <span className="font-normal text-red-600 ml-1">
                          ({((bilanData.koCount / bilanData.total) * 100).toFixed(1)}%)
                        </span>
                      )}
                    </strong>
                  </div>
                  <div className="flex justify-between text-blue-700">
                    <span>📍 {t("admin.bilanGeo")}</span>
                    <strong>
                      {bilanData.geoCount}
                      {bilanData.total > 0 && (
                        <span className="font-normal text-blue-600 ml-1">
                          ({((bilanData.geoCount / bilanData.total) * 100).toFixed(1)}%)
                        </span>
                      )}
                    </strong>
                  </div>
                  <div className="border-t pt-1.5 flex gap-4 text-xs text-gray-500">
                    <span>⚠️ KO restants : <strong className="text-gray-700">{bilanData.stillKO.length}</strong></span>
                    <span>🔁 KO → OK : <strong className="text-gray-700">{bilanData.koThenOk.length}</strong></span>
                  </div>
                </div>

                {/* Choix du format */}
                <div className="space-y-2">
                  <p className="text-sm font-medium">{t("admin.bilanChooseFormat")}</p>
                  <div className="flex gap-4">
                    <label className="flex items-center gap-2 cursor-pointer text-sm">
                      <input
                        type="radio"
                        name="bilanMode"
                        value="pdf"
                        checked={bilanMode === "pdf"}
                        onChange={() => setBilanMode("pdf")}
                      />
                      {t("admin.bilanPDF")}
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer text-sm">
                      <input
                        type="radio"
                        name="bilanMode"
                        value="email"
                        checked={bilanMode === "email"}
                        onChange={() => setBilanMode("email")}
                      />
                      {t("admin.bilanEmail")}
                    </label>
                  </div>
                </div>

                {bilanMode === "email" && (
                  <input
                    type="email"
                    value={bilanEmail}
                    onChange={(e) => setBilanEmail(e.target.value)}
                    placeholder={t("admin.bilanEmailPlaceholder")}
                    className="w-full border rounded p-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                  />
                )}

                {bilanSendResult && (
                  <p className={`text-sm ${bilanSendResult.success ? "text-green-600" : "text-red-600"}`}>
                    {bilanSendResult.msg}
                  </p>
                )}

                <div className="flex gap-2 justify-end pt-1">
                  <button
                    onClick={() => setBilanModalOpen(false)}
                    className="px-3 py-1.5 border rounded text-sm hover:bg-gray-50"
                  >
                    {t("admin.bilanCancel")}
                  </button>
                  <button
                    onClick={bilanMode === "pdf" ? () => exportBilanPDF(bilanData) : sendBilanEmail}
                    disabled={bilanSending}
                    className="px-3 py-1.5 bg-blue-700 text-white rounded text-sm hover:bg-blue-800 disabled:opacity-50 flex items-center gap-1"
                  >
                    {bilanSending
                      ? t("admin.bilanSending")
                      : bilanMode === "pdf"
                      ? t("admin.exportPDF")
                      : t("admin.bilanSend")}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
      {/* ------------------------------ */}

      {/* -------- Overlay d'auth tant que non connecté -------- */}
      {!ok && (
        <div className="fixed inset-0 z-50 bg-white/90 backdrop-blur-sm grid place-items-center p-4">
          <form onSubmit={tryLogin} className="w-full max-w-xs space-y-3 border rounded-lg bg-white p-5 shadow">
            <h1 className="text-lg font-semibold">{t("admin.authTitle")}</h1>
            <p className="text-sm text-gray-600">{t("admin.authDesc")}</p>
            <input
              type="password"
              className="w-full border rounded p-2"
              placeholder={t("admin.authPlaceholder")}
              value={pw}
              onChange={(e) => setPw(e.target.value)}
              autoFocus
              disabled={isAuthing}
            />
            <button className="w-full bg-blue-600 text-white rounded p-2 disabled:opacity-60" disabled={isAuthing}>
              {isAuthing ? t("admin.authChecking") : t("admin.authEnter")}
            </button>
            {!HASH && (
              <p className="text-xs text-red-600 mt-2">
                {t("admin.authHashMissing")}
              </p>
            )}
          </form>
        </div>
      )}
      {/* ------------------------------------------------------ */}
    </div>
  );
}
