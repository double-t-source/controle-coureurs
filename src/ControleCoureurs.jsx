import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "./supabaseClient";

const ControleCoureurs = () => {
  const { t, i18n } = useTranslation();

  const currentLang = (i18n.resolvedLanguage || i18n.language).slice(0, 2);
  const labelFor = (g) =>
    currentLang === "fr" ? (g.label_fr || g.code) : (g.label_en || g.label_fr || g.code);

  const [step, setStep] = useState(1);
  const [eventInfo, setEventInfo] = useState({
    event_id: "",
    race_id: "",
    marshal_id: localStorage.getItem("marshal_id") || "",
  });
  const [eventList, setEventList] = useState([]);
  const [raceList, setRaceList] = useState([]);
  const [marshalList, setMarshalList] = useState([]);

  const [form, setForm] = useState({
    dossard: "",
    resultat: "ok",
    materielManquant: "", // valeur stockée en base (toujours FR ici)
    commentaire: "",
  });
  const [materielCode, setMaterielCode] = useState(""); // code sélectionné dans la liste (ou "__autre__")

  const [submitted, setSubmitted] = useState(false);
  const [syncStatus, setSyncStatus] = useState("idle");
  const [dossardsControles, setDossardsControles] = useState([]);
  const [gearOptions, setGearOptions] = useState([]);
  const [duplicateInfo, setDuplicateInfo] = useState(null);
  const [marshalNames, setMarshalNames] = useState({});
  const dossardRef = useRef(null);
  const [locationList, setLocationList] = useState([]);
  const [selectedLocation, setSelectedLocation] = useState("");

  // Initial fetch
  useEffect(() => {
    const fetchEvents = async () => {
      const { data } = await supabase.from("events").select("id, name, isLocked");
      if (data) setEventList(data);
    };
    const fetchGear = async () => {
      const { data } = await supabase.from("gear").select("code,label_fr,label_en").order("label_fr");
      if (data) setGearOptions(data);
    };
    const fetchMarshals = async () => {
      const { data } = await supabase
        .from("marshals")
        .select("id, firstName, lastName")
        .eq("isActive", true)
        .order("lastName", { ascending: true });
      if (data) {
        const mapping = {};
        const list = data.map((m) => {
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
    fetchMarshals();
    fetchLocations();
  }, []);

  // Charger les courses (races) après sélection d'évènement (inclut range_min / range_max)
  useEffect(() => {
    const fetchRaces = async () => {
      if (!eventInfo.event_id) {
        setRaceList([]);
        return;
      }
      const { data } = await supabase
        .from("races")
        .select("id, name, range_min, range_max")
        .eq("event_id", eventInfo.event_id)
        .order("name", { ascending: true });
      if (data) setRaceList(data);
    };
    // reset de la course si on change d'évènement
    setEventInfo((prev) => ({ ...prev, race_id: "" }));
    fetchRaces();
  }, [eventInfo.event_id]);

  // Polling des contrôles pour la course sélectionnée
  useEffect(() => {
    let interval;
    const fetchControles = async () => {
      if (eventInfo.race_id) {
        const { data } = await supabase
          .from("controles")
          .select("dossard, marshal_id, created_at")
          .eq("race_id", eventInfo.race_id);
        if (data) setDossardsControles(data);
      }
    };

    if (eventInfo.race_id) {
      fetchControles();
      interval = setInterval(fetchControles, 3000);
    }
    return () => clearInterval(interval);
  }, [eventInfo.race_id]);

  useEffect(() => {
    if (step === 2 && dossardRef.current) dossardRef.current.focus();
  }, [step, submitted]);

  const handleEventChange = (e) => {
    const { name, value } = e.target;
    if (name === "marshal_id") localStorage.setItem("marshal_id", value);

    setEventInfo((prev) => {
      if (name === "event_id") {
        return { ...prev, event_id: value, race_id: "" };
      }
      return { ...prev, [name]: value };
    });
  };

  const handleFormChange = (e) => {
    const { name, value } = e.target;
    if (name === "dossard" && value !== "" && !/^\d*$/.test(value)) return;
    setForm((prev) => ({ ...prev, [name]: value }));

    if (name === "dossard") {
      const found = dossardsControles.find((c) => c.dossard === value);
      setDuplicateInfo(found || null);
    }
  };

  const handleClear = () => {
    setForm((prev) => ({ ...prev, dossard: "" }));
    dossardRef.current?.focus();
    setDuplicateInfo(null);
  };

  // Sélections courantes
  const selectedMarshal = marshalList.find((m) => m.id.toString() === eventInfo.marshal_id);
  const selectedEvent = eventList.find((e) => e.id.toString() === eventInfo.event_id);
  const selectedRace = raceList.find((r) => r.id.toString() === eventInfo.race_id);

  // Plage autorisée pour la course sélectionnée
  const allowedMin = selectedRace?.range_min ?? null;
  const allowedMax = selectedRace?.range_max ?? null;
  const bibNumber = form.dossard === "" ? null : parseInt(form.dossard, 10);
  const isBibOutOfRange =
    bibNumber != null &&
    allowedMin != null &&
    allowedMax != null &&
    (bibNumber < allowedMin || bibNumber > allowedMax);

  // Sélection du matériel (on stocke le FR en base pour compatibilité admin)
  const handleGearSelect = (e) => {
    const code = e.target.value;
    setMaterielCode(code);
    if (code === "__autre__") {
      setForm((prev) => ({ ...prev, materielManquant: "" }));
    } else {
      const g = gearOptions.find((x) => x.code === code);
      setForm((prev) => ({ ...prev, materielManquant: g ? (g.label_fr || g.code) : "" }));
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    const curEvent = selectedEvent;
    if (curEvent?.isLocked) {
      alert(t("lockedEvent"));
      return;
    }

    if (!eventInfo.event_id || !eventInfo.race_id || !eventInfo.marshal_id) {
      alert(t("requiredMsg"));
      return;
    }
    if (!/^\d+$/.test(form.dossard)) {
      alert(t("bibDigits"));
      return;
    }
    // Vérif de la plage
    if (allowedMin != null && allowedMax != null) {
      const n = parseInt(form.dossard, 10);
      if (Number.isNaN(n) || n < allowedMin || n > allowedMax) {
        alert(t("bibOutOfRange"));
        return;
      }
    }

    const isDuplicate = dossardsControles.map((dc) => dc.dossard).includes(form.dossard);
    if (isDuplicate && !window.confirm(t("dupConfirm"))) return;

    const data = {
      race_id: eventInfo.race_id,
      location_id: selectedLocation || null,
      marshal_id: eventInfo.marshal_id,
      dossard: form.dossard,
      resultat: form.resultat,
      // On garde la compat actuelle : si KO, on envoie le FR dans materiel_manquant
      materiel_manquant: form.resultat === "ko" ? (materielCode === "__autre__" ? form.materielManquant : form.materielManquant) : null,
      commentaire: form.commentaire,
    };

    setSyncStatus("syncing");
    const { error } = await supabase.from("controles").insert([data]);
    if (error) {
      alert("Erreur lors de l'enregistrement");
      setSyncStatus("error");
      return;
    }

    setDossardsControles((prev) => [
      ...prev,
      { dossard: form.dossard, marshal_id: eventInfo.marshal_id, created_at: new Date().toISOString() },
    ]);
    setSubmitted(true);
    setSyncStatus("success");
    navigator.vibrate && navigator.vibrate(30);
    setForm({ dossard: "", resultat: "ok", materielManquant: "", commentaire: "" });
    setMaterielCode("");
    setTimeout(() => {
      setSubmitted(false);
      setTimeout(() => dossardRef.current?.focus(), 100);
    }, 500);
  };

  const getButtonClass = (selected, value) =>
    selected === value ? (value === "ok" ? "bg-green-600 text-white" : "bg-red-600 text-white") : "bg-gray-300 text-gray-600";

  const headerText =
    selectedEvent && selectedRace && selectedMarshal
      ? t("header", { race: selectedRace.name, event: selectedEvent.name, marshal: selectedMarshal.label })
      : "";

  return (
    <div className="p-2 max-w-md mx-auto h-[100dvh] flex flex-col justify-center">
      {/* Header : logo */}
      <header className="mb-4 flex flex-col items-center gap-2 pt-3">
        <img
          src="https://res.cloudinary.com/utmb-world/image/upload/q_auto/f_auto/c_fill,g_auto/if_w_gt_240/c_scale,w_240/if_end/v1/worldseries/logo_UTMB_WS_e023c5f3f6.png"
          alt="Logo"
          className="h-10 w-auto"
        />
      </header>

      {step === 1 ? (
        <div className="space-y-3">
          <h1 className="text-xl font-bold mb-4">{t("titleSelectEvent")}</h1>

          <select name="event_id" value={eventInfo.event_id} onChange={handleEventChange} className="w-full p-3 border rounded-md">
            <option value="">-- {t("event")} --</option>
            {[...eventList]
              .sort((a, b) => (a.isLocked === b.isLocked ? 0 : a.isLocked ? 1 : -1))
              .map((event) => (
                <option key={event.id} value={event.id}>
                  {event.isLocked ? "🔒 " : ""}
                  {event.name}
                </option>
              ))}
          </select>

          <select
            name="race_id"
            value={eventInfo.race_id}
            onChange={handleEventChange}
            className="w-full p-3 border rounded-md"
            disabled={!eventInfo.event_id}
          >
            <option value="">{eventInfo.event_id ? `-- ${t("race")} --` : t("titleSelectEvent")}</option>
            {raceList.map((race) => (
              <option key={race.id} value={race.id}>
                {race.name}
              </option>
            ))}
          </select>

          <select
            name="marshal_id"
            value={eventInfo.marshal_id}
            onChange={handleEventChange}
            className="w-full p-3 border rounded-md"
            required
          >
            <option value="">-- {t("marshal")} --</option>
            {marshalList.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>

          <select
            name="location_id"
            value={selectedLocation}
            onChange={(e) => setSelectedLocation(e.target.value)}
            className="w-full p-3 border rounded-md"
          >
            <option value="">-- {t("location")} --</option>
            {locationList.map((loc) => (
              <option key={loc.id} value={loc.id}>
                {loc.name}
              </option>
            ))}
          </select>

          <button
            className="w-full bg-blue-600 text-white py-3 rounded"
            onClick={() => setStep(2)}
            disabled={!eventInfo.marshal_id || !eventInfo.race_id}
          >
            {t("start")}
          </button>
        </div>
      ) : (
        <div className="flex flex-col justify-center h-full">
          {headerText && <p className="text-center text-sm text-gray-700 mb-4 font-medium">{headerText}</p>}

          {selectedEvent?.isLocked && (
            <p className="text-center text-red-600 mb-4 font-semibold">🔒 {t("lockedEvent")}</p>
          )}

          {submitted && (
            <div className="fixed inset-0 bg-white/80 flex items-center justify-center text-3xl font-bold text-green-600 z-50">
              {t("saved")}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="flex items-center gap-2">
              <input
                ref={dossardRef}
                type="tel"
                inputMode="numeric"
                pattern="[0-9]*"
                name="dossard"
                placeholder={t("bib")}
                value={form.dossard}
                onChange={handleFormChange}
                required
                disabled={selectedEvent?.isLocked}
                className={`w-full p-3 text-lg border rounded-md ${
                  duplicateInfo || isBibOutOfRange ? "border-red-500" : ""
                }`}
              />
              <button type="button" onClick={handleClear} className="text-sm px-3 py-2 bg-gray-200 rounded">
                {t("clear")}
              </button>
            </div>

            {/* Affichage plage autorisée & messages */}
            {selectedRace && allowedMin != null && allowedMax != null && (
              <p className="text-xs text-gray-600">
                {t("allowedRange", { min: allowedMin, max: allowedMax })}
              </p>
            )}
            {duplicateInfo && (
              <p className="text-sm text-red-600">
                {t("alreadyAt", {
                  time: new Date(duplicateInfo.created_at).toLocaleTimeString(i18n.language, {
                    hour: "2-digit",
                    minute: "2-digit",
                  }),
                })} — {marshalNames[duplicateInfo.marshal_id] || "?"}
              </p>
            )}
            {isBibOutOfRange && <p className="text-sm text-red-600">{t("bibOutOfRange")}</p>}

            <div className="grid grid-cols-2 gap-4">
              <button
                type="button"
                onClick={() => setForm({ ...form, resultat: "ok" })}
                className={`p-4 rounded font-bold text-xl ${getButtonClass(form.resultat, "ok")}`}
                disabled={selectedEvent?.isLocked}
              >
                ✅ {t("ok")}
              </button>
              <button
                type="button"
                onClick={() => setForm({ ...form, resultat: "ko" })}
                className={`p-4 rounded font-bold text-xl ${getButtonClass(form.resultat, "ko")}`}
                disabled={selectedEvent?.isLocked}
              >
                ❌ {t("ko")}
              </button>
            </div>

            {form.resultat === "ko" && (
              <>
                <select
                  name="materielCode"
                  value={materielCode}
                  onChange={handleGearSelect}
                  className="w-full p-3 border rounded-md"
                  disabled={selectedEvent?.isLocked}
                >
                  <option value="">{`-- ${t("missingGear")} --`}</option>
                  {gearOptions.map((g) => (
                    <option key={g.code} value={g.code}>
                      {labelFor(g)}
                    </option>
                  ))}
                  <option value="__autre__">{t("other")}</option>
                </select>

                {materielCode === "__autre__" && (
                  <input
                    name="materielManquant"
                    placeholder={t("other")}
                    value={form.materielManquant}
                    onChange={handleFormChange}
                    className="w-full p-3 border rounded-md"
                    disabled={selectedEvent?.isLocked}
                  />
                )}
              </>
            )}

            <textarea
              name="commentaire"
              placeholder={t("comment")}
              value={form.commentaire}
              onChange={handleFormChange}
              className="w-full p-3 border rounded-md"
              disabled={selectedEvent?.isLocked}
            />

            <button
              type="submit"
              className="w-full bg-blue-600 text-white py-3 rounded text-lg"
              disabled={selectedEvent?.isLocked}
            >
              {t("send")}
            </button>

            <div className="mt-6">
              <h3 className="text-sm font-semibold mb-2">{t("last10")}</h3>
              <ul className="text-sm text-gray-700 space-y-1">
                {[...dossardsControles]
                  .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
                  .slice(0, 10)
                  .map((c, idx) => (
                    <li key={idx}>
                      <span className="font-mono">{c.dossard}</span>
                      <span className="text-xs text-gray-500">
                        {" "}
                        — {marshalNames[c.marshal_id] || "?"}{" "}
                        {t("alreadyAt", {
                          time: new Date(c.created_at).toLocaleTimeString(i18n.language, {
                            hour: "2-digit",
                            minute: "2-digit",
                          }),
                        })}
                      </span>
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
