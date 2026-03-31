import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "./supabaseClient";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { MapContainer, TileLayer, CircleMarker, Popup, useMap } from "react-leaflet";
import { Map as MapIcon, MapPin } from "lucide-react";
import "leaflet/dist/leaflet.css";

function MapFlyTo({ center }) {
  const map = useMap();
  useEffect(() => {
    if (center) map.flyTo(center, Math.max(map.getZoom(), 15), { animate: true, duration: 0.5 });
  }, [center, map]);
  return null;
}

// Helper SHA-256 (natif navigateur)
async function sha256Hex(s) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
}

export default function AdminControleCoureurs() {
  const { t, i18n } = useTranslation();

  // --------- Barrière mot de passe ---------
  const [ok, setOk] = useState(() => sessionStorage.getItem("admin_ok") === "1");
  const [pw, setPw] = useState("");
  const [isAuthing, setIsAuthing] = useState(false);
  const HASH = import.meta.env.VITE_ADMIN_PW_HASH; // <= définir en env

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

  // Polling des contrôles pour la course sélectionnée (uniquement si logué)
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
    const g = gearOptions.find((x) => x.code === value);
    if (!g) return value; // texte libre ou ancienne valeur FR
    return currentLang === "fr" ? (g.label_fr || g.code) : (g.label_en || g.label_fr || g.code);
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

  // ---- Groupes par dossard (historique) ----
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
      });
    }

    // Tri par "dernier contrôle" décroissant dans chaque catégorie
    const stillKO = summaries
      .filter((s) => s.lastResult === "ko")
      .sort((a, b) => new Date(b.lastAt) - new Date(a.lastAt));

    const koThenOk = summaries
      .filter((s) => s.wentKoThenOk)
      .sort((a, b) => new Date(b.lastAt) - new Date(a.lastAt));

    const okDirect = summaries
      .filter((s) => s.lastResult === "ok" && !s.hasKO)
      .sort((a, b) => new Date(b.lastAt) - new Date(a.lastAt));

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

  const handleRowClick = (controleId) => setSelectedControleId(controleId);
  const handleMapIconClick = (e, controleId) => {
    e.stopPropagation();
    setSelectedControleId(controleId);
    setShowMap(true);
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
                <th className="border p-2">{t("admin.comment")}</th>
                <th className="border p-2">{t("admin.dateTime")}</th>
              </tr>
            </thead>
            <tbody>
              {bibGroups.stillKO.map((s) => (
                <tr
                  key={s.dossard}
                  className={`border-t cursor-pointer ${selectedControleId === s.last?.id ? "bg-orange-50" : "hover:bg-gray-50"}`}
                  onClick={() => s.last && handleRowClick(s.last.id)}
                >
                  <td className="border p-2">
                    ⚠️ {s.dossard}{" "}
                    <span className="text-xs text-gray-500">({marshals[s.lastMarshalId] || "?"})</span>
                    {s.last?.latitude != null && (
                      <button onClick={(e) => handleMapIconClick(e, s.last.id)} className="ml-1 text-blue-500 hover:text-blue-700 align-middle" title={t("admin.showMap")}>
                        <MapPin size={13} className="inline" />
                      </button>
                    )}
                  </td>
                  <td className="border p-2">{labelForGear(s.last?.materiel_manquant)}</td>
                  <td className="border p-2">{s.last?.commentaire || "-"}</td>
                  <td className="border p-2 whitespace-nowrap">{formatDate(s.lastAt)}</td>
                </tr>
              ))}
              {bibGroups.stillKO.length === 0 && (
                <tr>
                  <td colSpan="4" className="text-center p-2">
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
                <th className="border p-2">{t("admin.lastKOComment")}</th>
                <th className="border p-2">{t("admin.history")}</th>
              </tr>
            </thead>
            <tbody>
              {bibGroups.koThenOk.map((s) => (
                <tr
                  key={s.dossard}
                  className={`border-t cursor-pointer ${selectedControleId === s.last?.id ? "bg-orange-50" : "hover:bg-gray-50"}`}
                  onClick={() => s.last && handleRowClick(s.last.id)}
                >
                  <td className="border p-2">
                    ⚠️ {s.dossard}
                    {s.last?.latitude != null && (
                      <button onClick={(e) => handleMapIconClick(e, s.last.id)} className="ml-1 text-blue-500 hover:text-blue-700 align-middle" title={t("admin.showMap")}>
                        <MapPin size={13} className="inline" />
                      </button>
                    )}
                  </td>
                  <td className="border p-2 whitespace-nowrap">{formatDate(s.lastAt)}</td>
                  <td className="border p-2">{marshals[s.lastMarshalId] || "?"}</td>
                  <td className="border p-2">{labelForGear(s.lastKO?.materiel_manquant)}</td>
                  <td className="border p-2">{s.lastKO?.commentaire || "-"}</td>
                  <td className="border p-2">
                    {s.history.map(h => (h.resultat === "ok" ? "✅" : "❌")).join(" → ")}
                  </td>
                </tr>
              ))}
              {bibGroups.koThenOk.length === 0 && (
                <tr>
                  <td colSpan="6" className="text-center p-2">
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
                <th className="border p-2">{t("admin.history")}</th>
              </tr>
            </thead>
            <tbody>
              {bibGroups.okDirect.map((s) => (
                <tr
                  key={s.dossard}
                  className={`border-t cursor-pointer ${selectedControleId === s.last?.id ? "bg-orange-50" : "hover:bg-gray-50"}`}
                  onClick={() => s.last && handleRowClick(s.last.id)}
                >
                  <td className="border p-2">
                    {s.dossard}
                    {s.last?.latitude != null && (
                      <button onClick={(e) => handleMapIconClick(e, s.last.id)} className="ml-1 text-blue-500 hover:text-blue-700 align-middle" title={t("admin.showMap")}>
                        <MapPin size={13} className="inline" />
                      </button>
                    )}
                  </td>
                  <td className="border p-2 whitespace-nowrap">{formatDate(s.lastAt)}</td>
                  <td className="border p-2">{marshals[s.lastMarshalId] || "?"}</td>
                  <td className="border p-2">
                    {s.history.map(h => (h.resultat === "ok" ? "✅" : "❌")).join(" → ")}
                  </td>
                </tr>
              ))}
              {bibGroups.okDirect.length === 0 && (
                <tr>
                  <td colSpan="4" className="text-center p-2">{t("admin.noOKDirect")}</td>
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
