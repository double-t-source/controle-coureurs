import { useEffect, useState } from "react";
import { supabase } from "./supabaseClient";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

export default function AdminControleCoureurs() {
  const [eventId, setEventId] = useState(() => localStorage.getItem("admin_event_id") || "");
  const [epreuve, setEpreuve] = useState(() => localStorage.getItem("admin_epreuve") || "");
  const [eventList, setEventList] = useState([]);
  const [controles, setControles] = useState([]);
  const [marshals, setMarshals] = useState({});
  const [connectionStatus, setConnectionStatus] = useState("checking");

  useEffect(() => {
    const checkConnection = async () => {
      const { error } = await supabase.from("events").select("id").limit(1);
      if (error) setConnectionStatus("offline");
      else setConnectionStatus("online");
    };
    checkConnection();
  }, []);

  useEffect(() => {
    const fetchEvents = async () => {
      const { data, error } = await supabase.from("events").select("id, name");
      if (!error && data) setEventList(data);
    };
    fetchEvents();
  }, []);

  useEffect(() => {
    const fetchMarshals = async () => {
      const { data, error } = await supabase.from("marshals").select("id, firstName, lastName");
      if (!error && data) {
        const mapping = {};
        data.forEach(m => { mapping[m.id] = `${m.firstName} ${m.lastName}`; });
        setMarshals(mapping);
      }
    };
    fetchMarshals();
  }, []);

  useEffect(() => {
    let interval;
    const fetchControles = async () => {
      if (eventId && epreuve) {
        const { data, error } = await supabase
          .from("controles")
          .select("*, marshal_id")
          .eq("events_id", eventId)
          .eq("epreuve", epreuve)
          .order("created_at", { ascending: false });

        if (!error && data) {
          setControles(data);
        }
      }
    };

    if (eventId && epreuve) {
      fetchControles();
      interval = setInterval(fetchControles, 5000);
    }

    return () => clearInterval(interval);
  }, [eventId, epreuve]);

  const handleEventChange = (e) => {
    setEventId(e.target.value);
    localStorage.setItem("admin_event_id", e.target.value);
  };

  const handleEpreuveChange = (e) => {
    setEpreuve(e.target.value);
    localStorage.setItem("admin_epreuve", e.target.value);
  };

  const getEventName = (id) => {
    const found = eventList.find(e => e.id.toString() === id);
    return found ? found.name : "";
  };

  const countByDossard = controles.reduce((acc, curr) => {
    acc[curr.dossard] = (acc[curr.dossard] || 0) + 1;
    return acc;
  }, {});

  const getAttentionEmoji = (dossard) => countByDossard[dossard] > 1 ? "⚠️ " : "";

  const formatDate = (timestamp) => new Date(timestamp).toLocaleString("fr-FR", {
    day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit"
  });

  const ko = controles.filter(c => c.resultat === "ko");
  const ok = controles.filter(c => c.resultat === "ok");

  const exportPDF = () => {
    const doc = new jsPDF();
    const now = new Date();
    const exportTime = now.toLocaleString("fr-FR");

    doc.setFontSize(14);
    doc.text(`Export des contrôles - ${getEventName(eventId)} - ${epreuve}`, 14, 20);
    doc.setFontSize(10);
    doc.text(`Date d'export : ${exportTime}`, 14, 27);
    doc.text(`Nombre total : ${controles.length}`, 14, 33);
    doc.text(`Nombre OK : ${ok.length}`, 14, 38);
    doc.text(`Nombre KO : ${ko.length}`, 14, 43);

    autoTable(doc, {
      startY: 50,
      head: [["Dossard", "Résultat", "Matériel manquant", "Commentaire", "Commissaire", "Date / Heure"]],
      body: controles.map(c => [
        c.dossard,
        c.resultat.toUpperCase(),
        c.materiel_manquant || "-",
        c.commentaire || "-",
        marshals[c.marshal_id] || "?",
        formatDate(c.created_at)
      ]),
    });

    doc.save(`controles_${getEventName(eventId)}_${epreuve}.pdf`);
  };

  return (
    <div className="p-4 max-w-4xl mx-auto">
      <div className="flex justify-between items-center mb-4">
        <h1 className="text-2xl font-bold">Tableau des Contrôles</h1>
        <div className={`text-sm font-medium px-2 py-1 rounded ${
          connectionStatus === 'online' ? 'bg-green-100 text-green-800' :
          connectionStatus === 'offline' ? 'bg-red-100 text-red-800' :
          'bg-yellow-100 text-yellow-800'
        }`}>
          {connectionStatus === 'online' && '✅ Connecté à la base de données'}
          {connectionStatus === 'offline' && '❌ Connexion échouée'}
          {connectionStatus === 'checking' && '⏳ Vérification...'}
        </div>
      </div>

      <div className="flex gap-4 mb-6 flex-wrap">
        <select value={eventId} onChange={handleEventChange} className="p-2 border rounded">
          <option value="">-- Choisir un évènement --</option>
          {eventList.map((e, i) => (
            <option key={i} value={e.id}>{e.name}</option>
          ))}
        </select>

        <select value={epreuve} onChange={handleEpreuveChange} className="p-2 border rounded">
          <option value="">-- Choisir une épreuve --</option>
          <option value="100M">100M</option>
          <option value="100K">100K</option>
          <option value="50K">50K</option>
          <option value="20K">20K</option>
        </select>
      </div>

      {eventId && epreuve && (
        <>
          <p className="text-sm text-gray-600 italic mb-4">
            {controles.length} contrôles enregistrés pour <strong>{getEventName(eventId)}</strong> – <strong>{epreuve}</strong>
          </p>

          <div className="mb-6">
            <h3 className="text-sm font-semibold mb-2">Statistiques par commissaire :</h3>
            <ul className="text-sm text-gray-800 list-disc list-inside">
              {Object.entries(controles.reduce((acc, curr) => {
                acc[curr.marshal_id] = (acc[curr.marshal_id] || 0) + 1;
                return acc;
              }, {})).sort((a, b) => b[1] - a[1]).map(([marshalId, count], idx) => (
                <li key={idx}>
                  {marshals[marshalId] || 'Non renseigné'} : {count} contrôles ({((count / controles.length) * 100).toFixed(1)}%)
                </li>
              ))}
            </ul>
          </div>

          <h2 className="text-lg font-semibold mb-2">Contrôles KO</h2>
          <table className="w-full mb-6 border text-sm">
            <thead className="sticky top-0 bg-white z-10">
              <tr className="bg-red-100">
                <th className="border p-2">Dossard</th>
                <th className="border p-2">Matériel manquant</th>
                <th className="border p-2">Commentaire</th>
                <th className="border p-2">Date / Heure</th>
              </tr>
            </thead>
            <tbody>
              {ko.map((c, idx) => (
                <tr key={idx} className="border-t">
                  <td className="border p-2">{getAttentionEmoji(c.dossard)}{c.dossard} <span className="text-xs text-gray-500">({marshals[c.marshal_id] || "?"})</span></td>
                  <td className="border p-2">{c.materiel_manquant}</td>
                  <td className="border p-2">{c.commentaire}</td>
                  <td className="border p-2 whitespace-nowrap">{formatDate(c.created_at)}</td>
                </tr>
              ))}
              {ko.length === 0 && (
                <tr><td colSpan="4" className="text-center p-2">Aucun contrôle KO</td></tr>
              )}
            </tbody>
          </table>

          <h2 className="text-lg font-semibold mb-2">Contrôles OK</h2>
          <table className="w-full border text-sm">
            <thead className="sticky top-0 bg-white z-10">
              <tr className="bg-green-100">
                <th className="border p-2">Dossard</th>
                <th className="border p-2">Date / Heure</th>
              </tr>
            </thead>
            <tbody>
              {ok.map((c, idx) => (
                <tr key={idx} className="border-t">
                  <td className="border p-2">{getAttentionEmoji(c.dossard)}{c.dossard} <span className="text-xs text-gray-500">({marshals[c.marshal_id] || "?"})</span></td>
                  <td className="border p-2 whitespace-nowrap">{formatDate(c.created_at)}</td>
                </tr>
              ))}
              {ok.length === 0 && (
                <tr><td colSpan="2" className="text-center p-2">Aucun contrôle OK</td></tr>
              )}
            </tbody>
          </table>

          <div className="mt-6">
            <button onClick={exportPDF} className="px-4 py-2 bg-blue-700 text-white rounded hover:bg-blue-800">
              📄 Exporter en PDF
            </button>
          </div>
        </>
      )}
    </div>
  );
}