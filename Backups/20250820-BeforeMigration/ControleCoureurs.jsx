import { useEffect, useRef, useState } from "react";
import { supabase } from "./supabaseClient";

const ControleCoureurs = () => {
  const [step, setStep] = useState(1);
  const [eventInfo, setEventInfo] = useState({ event_id: "", epreuve: "", marshal_id: localStorage.getItem("marshal_id") || "" });
  const [eventList, setEventList] = useState([]);
  const [marshalList, setMarshalList] = useState([]);
  const [form, setForm] = useState({ dossard: "", resultat: "ok", materielManquant: "", commentaire: "" });
  const [submitted, setSubmitted] = useState(false);
  const [syncStatus, setSyncStatus] = useState("idle");
  const [dossardsControles, setDossardsControles] = useState([]);
  const [gearOptions, setGearOptions] = useState([]);
  const [duplicateInfo, setDuplicateInfo] = useState(null);
  const [marshalNames, setMarshalNames] = useState({});
  const dossardRef = useRef(null);
  const [locationList, setLocationList] = useState([]);
  const [selectedLocation, setSelectedLocation] = useState("");


  useEffect(() => {
    const fetchEvents = async () => {
      const { data } = await supabase.from("events").select("id, name, isLocked");
      if (data) setEventList(data);
    };
    const fetchGear = async () => {
      const { data } = await supabase.from("gear").select("name");
      if (data) setGearOptions(data.map((g) => g.name));
    };
    const fetchMarshals = async () => {
      const { data } = await supabase.from("marshals").select("id, firstName, lastName").eq("isActive", true).order("lastName", { ascending: true }); // Assuming you want only active marshals
      if (data) {
        const mapping = {};
        const list = data.map(m => {
          mapping[m.id] = `${m.firstName} ${m.lastName}`;
          return { id: m.id, label: `${m.firstName} ${m.lastName}` };
        });
        setMarshalList(list);
        setMarshalNames(mapping);
      }
    };
    const fetchLocations = async () => {
      const { data } = await supabase.from("locations").select("id, name").eq("isActive", true);
      if (data) setLocationList(data);
    };
    fetchEvents();
    fetchGear();
    fetchMarshals()
    fetchLocations();
  }, []);

  useEffect(() => {
    let interval;

    const fetchControles = async () => {
      if (eventInfo.event_id && eventInfo.epreuve) {
        const { data } = await supabase
          .from("controles")
          .select("dossard, marshal_id, created_at")
          .eq("events_id", eventInfo.event_id)
          .eq("epreuve", eventInfo.epreuve);
        if (data) setDossardsControles(data);
      }
    };

    if (eventInfo.event_id && eventInfo.epreuve) {
      fetchControles();
      interval = setInterval(fetchControles, 3000);
    }

    return () => clearInterval(interval);
  }, [eventInfo.event_id, eventInfo.epreuve]);

  useEffect(() => {
    if (step === 2 && dossardRef.current) dossardRef.current.focus();
  }, [step, submitted]);

  const handleEventChange = (e) => {
    const { name, value } = e.target;
    if (name === "marshal_id") localStorage.setItem("marshal_id", value);
    setEventInfo((prev) => ({ ...prev, [name]: value }));
  };

  const handleFormChange = (e) => {
    const { name, value } = e.target;
    if (name === "dossard" && value !== "" && !/^\d*$/.test(value)) return;
    setForm((prev) => ({ ...prev, [name]: value }));

    if (name === "dossard") {
      const found = dossardsControles.find(c => c.dossard === value);
      setDuplicateInfo(found || null);
    }
  };

  const handleClear = () => {
    setForm((prev) => ({ ...prev, dossard: "" }));
    dossardRef.current.focus();
    setDuplicateInfo(null);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    const selectedEvent = eventList.find(e => e.id.toString() === eventInfo.event_id);
    if (selectedEvent?.isLocked) {
      alert("Cet évènement est verrouillé. Vous ne pouvez plus enregistrer de contrôle.");
      return;
    }

    if (!eventInfo.event_id || !eventInfo.epreuve || !eventInfo.marshal_id) {
      alert("Merci de tout renseigner avant d'enregistrer un contrôle.");
      return;
    }
    if (!/^\d+$/.test(form.dossard)) {
      alert("Le numéro de dossard doit contenir uniquement des chiffres.");
      return;
    }

    const isDuplicate = dossardsControles.map(dc => dc.dossard).includes(form.dossard);
    if (isDuplicate && !window.confirm("⚠️ Ce dossard a déjà été contrôlé. Voulez-vous continuer ?")) return;

    const data = {
      events_id: eventInfo.event_id,
      epreuve: eventInfo.epreuve,
      location_id: selectedLocation,
      marshal_id: eventInfo.marshal_id,
      dossard: form.dossard,
      resultat: form.resultat,
      materiel_manquant: form.resultat === "ko" ? form.materielManquant : null,
      commentaire: form.commentaire,
    };

    setSyncStatus("syncing");
    const { error } = await supabase.from("controles").insert([data]);
    if (error) {
      alert("Erreur lors de l'enregistrement");
      setSyncStatus("error");
      return;
    }

    setDossardsControles((prev) => [...prev, { dossard: form.dossard, marshal_id: eventInfo.marshal_id, created_at: new Date().toISOString() }]);
    setSubmitted(true);
    setSyncStatus("success");
    navigator.vibrate && navigator.vibrate(30);
    setForm({ dossard: "", resultat: "ok", materielManquant: "", commentaire: "" });
    setTimeout(() => {
      setSubmitted(false);
      setTimeout(() => dossardRef.current?.focus(), 100);
    }, 500);
  };

  const getButtonClass = (selected, value) => selected === value ? (value === "ok" ? "bg-green-600 text-white" : "bg-red-600 text-white") : "bg-gray-300 text-gray-600";

  const selectedMarshal = marshalList.find(m => m.id.toString() === eventInfo.marshal_id);
  const selectedEvent = eventList.find(e => e.id.toString() === eventInfo.event_id);

  const headerText = selectedEvent && eventInfo.epreuve && selectedMarshal
    ? `Contrôle Matériel Obligatoire sur le ${eventInfo.epreuve} du ${selectedEvent.name} par ${selectedMarshal.label}`
    : "";

  return (
    <div className="p-2 max-w-md mx-auto h-[100dvh] flex flex-col justify-center">
      {step === 1 ? (
        <div className="space-y-3">
          <h1 className="text-xl font-bold mb-4">Sélection de l'évènement</h1>
          <select name="event_id" value={eventInfo.event_id} onChange={handleEventChange} className="w-full p-3 border rounded-md">
            <option value="">-- Évènement --</option>
            {[...eventList]
              .sort((a, b) => (a.isLocked === b.isLocked) ? 0 : a.isLocked ? 1 : -1)
              .map((event, idx) => (
                <option key={idx} value={event.id}>{event.isLocked ? "🔒 " : ""}{event.name}</option>
              ))}
          </select>
          <select name="epreuve" value={eventInfo.epreuve} onChange={handleEventChange} className="w-full p-3 border rounded-md">
            <option value="">-- Épreuve --</option>
            <option value="100M">100M</option>
            <option value="100K">100K</option>
            <option value="50K">50K</option>
            <option value="20K">20K</option>
          </select>
          <select name="marshal_id" value={eventInfo.marshal_id} onChange={handleEventChange} className="w-full p-3 border rounded-md" required>
            <option value="">-- Commissaire --</option>
            {marshalList.map((m, idx) => <option key={idx} value={m.id}>{m.label}</option>)}
          </select>
          <select name="location_id" value={selectedLocation} onChange={(e) => setSelectedLocation(e.target.value)} className="w-full p-3 border rounded-md"            >
              <option value="">-- Lieu de contrôle --</option>
              {locationList.map((loc) => (<option key={loc.id} value={loc.id}>{loc.name}</option>))}
            </select>
          <button className="w-full bg-blue-600 text-white py-3 rounded" onClick={() => setStep(2)} disabled={!eventInfo.marshal_id}>Commencer</button>
        </div>
      ) : (
        <div className="flex flex-col justify-center h-full">
          {headerText && (
            <p className="text-center text-sm text-gray-700 mb-4 font-medium">{headerText}</p>
          )}
          {selectedEvent?.isLocked && (
            <p className="text-center text-red-600 mb-4 font-semibold">
              🔒 Cet évènement est verrouillé. La saisie est désactivée.
            </p>
          )}
          {submitted && (
            <div className="fixed inset-0 bg-white/80 flex items-center justify-center text-3xl font-bold text-green-600 z-50">✅ Enregistré</div>
          )}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="flex items-center gap-2">
              <input
                ref={dossardRef}
                type="tel"
                inputMode="numeric"
                pattern="[0-9]*"
                name="dossard"
                placeholder="Numéro de dossard"
                value={form.dossard}
                onChange={handleFormChange}
                required
                disabled={selectedEvent?.isLocked}
                className={`w-full p-3 text-lg border rounded-md ${duplicateInfo ? 'border-red-500' : ''}`}
              />
              <button type="button" onClick={handleClear} className="text-sm px-3 py-2 bg-gray-200 rounded">Effacer</button>
            </div>
            {duplicateInfo && (
              <p className="text-sm text-red-600">Déjà contrôlé à {new Date(duplicateInfo.created_at).toLocaleTimeString("fr-FR", { hour: '2-digit', minute: '2-digit' })}</p>
            )}
            <div className="grid grid-cols-2 gap-4">
              <button type="button" onClick={() => setForm({ ...form, resultat: "ok" })} className={`p-4 rounded font-bold text-xl ${getButtonClass(form.resultat, "ok")}`} disabled={selectedEvent?.isLocked}>✅ OK</button>
              <button type="button" onClick={() => setForm({ ...form, resultat: "ko" })} className={`p-4 rounded font-bold text-xl ${getButtonClass(form.resultat, "ko")}`} disabled={selectedEvent?.isLocked}>❌ KO</button>
            </div>
            {form.resultat === "ko" && (
              <select name="materielManquant" value={form.materielManquant} onChange={handleFormChange} className="w-full p-3 border rounded-md" disabled={selectedEvent?.isLocked}>
                <option value="">-- Matériel manquant --</option>
                {gearOptions.map((item, idx) => <option key={idx} value={item}>{item}</option>)}
                <option value="autre">Autre (commentaire)</option>
              </select>
            )}
            <textarea name="commentaire" placeholder="Commentaire (facultatif)" value={form.commentaire} onChange={handleFormChange} className="w-full p-3 border rounded-md" disabled={selectedEvent?.isLocked} />
            <button type="submit" className="w-full bg-blue-600 text-white py-3 rounded text-lg" disabled={selectedEvent?.isLocked}>Envoyer</button>
            <div className="mt-6">
              <h3 className="text-sm font-semibold mb-2">10 derniers dossards contrôlés</h3>
              <ul className="text-sm text-gray-700 space-y-1">
                {[...dossardsControles]
                  .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
                  .slice(0, 10)
                  .map((c, idx) => (
                    <li key={idx}>
                      <span className="font-mono">{c.dossard}</span>
                      <span className="text-xs text-gray-500"> — {marshalNames[c.marshal_id] || "?"} à {new Date(c.created_at).toLocaleTimeString("fr-FR", { hour: '2-digit', minute: '2-digit' })}</span>
                    </li>
                  ))}
              </ul>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

export default ControleCoureurs;
