import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "./supabaseClient";

// Two-step UX: step 1 = select context (event / race / marshal), step 2 = enter checks.
// The context is kept in state so the marshal doesn't re-select it between each bib entry.
const ControleCoureurs = () => {
  const { t, i18n } = useTranslation();

  const currentLang = (i18n.resolvedLanguage || i18n.language).slice(0, 2);
  const labelFor = (g) =>
    currentLang === "fr" ? (g.label_fr || g.code) : (g.label_en || g.label_fr || g.code);

  const [step, setStep] = useState(1);
  const [eventInfo, setEventInfo] = useState({
    event_id: "",
    race_id: "",
    // Persist marshal_id so returning marshals find their name pre-selected on reload.
    marshal_id: localStorage.getItem("marshal_id") || "",
  });
  const [eventList, setEventList] = useState([]);
  const [raceList, setRaceList] = useState([]);
  const [marshalList, setMarshalList] = useState([]);

  const [form, setForm] = useState({
    dossard: "",
    resultat: "ok",
    // Stores the gear code (language-neutral) that goes into the DB, or free text when "other" is chosen.
    materielManquant: "",
    commentaire: "",
  });
  // Tracks the dropdown selection separately: either a gear code or "__autre__" for free-text entry.
  const [materielCode, setMaterielCode] = useState("");

  const [isPacer, setIsPacer] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [syncStatus, setSyncStatus] = useState("idle");
  const [dossardsControles, setDossardsControles] = useState([]);
  const [gearOptions, setGearOptions] = useState([]);
  const [duplicateInfo, setDuplicateInfo] = useState(null);
  const [koError, setKoError] = useState(false);
  const [marshalNames, setMarshalNames] = useState({});
  const dossardRef = useRef(null);
  const [locationList, setLocationList] = useState([]);
  const [selectedLocation, setSelectedLocation] = useState("");

  // Geolocation
  // "idle" | "requesting" | "granted" | "denied" | "unavailable"
  const [geoStatus, setGeoStatus] = useState("idle");

  // Initial fetch
  useEffect(() => {
    const fetchEvents = async () => {
      const { data } = await supabase.from("events").select("id, name, isLocked, geolocation_mode");
      if (data) setEventList(data);
    };
    const fetchLocations = async () => {
      const { data } = await supabase.from("locations").select("id, name").eq("isActive", true);
      if (data) setLocationList(data);
    };
    fetchEvents();
    fetchLocations();
  }, []);

  const requestGeo = () => {
    if (!navigator.geolocation) {
      setGeoStatus("unavailable");
      return;
    }
    setGeoStatus("requesting");
    navigator.geolocation.getCurrentPosition(
      () => setGeoStatus("granted"),
      () => setGeoStatus("denied"),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  // Trigger geo permission when event with geo mode is selected
  useEffect(() => {
    const mode = eventList.find((e) => e.id.toString() === eventInfo.event_id)?.geolocation_mode || "no";
    setGeoStatus("idle");
    if (mode !== "no" && eventInfo.event_id) {
      requestGeo();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventInfo.event_id]);

  // Charger les courses, commissaires et équipements après sélection d'évènement
  useEffect(() => {
    const fetchEventData = async () => {
      if (!eventInfo.event_id) {
        setRaceList([]);
        setMarshalList([]);
        setMarshalNames({});
        setGearOptions([]);
        return;
      }

      const { data: raceData } = await supabase
        .from("races")
        .select("id, name, range_min, range_max, has_pacers")
        .eq("event_id", eventInfo.event_id)
        .order("name", { ascending: true });
      if (raceData) setRaceList(raceData);

      const { data: assignments } = await supabase
        .from("marshal_event_assignments")
        .select("marshal_id")
        .eq("event_id", eventInfo.event_id);
      const marshalIds = (assignments || []).map((a) => a.marshal_id);
      if (marshalIds.length > 0) {
        const { data: marshalsData } = await supabase
          .from("marshals")
          .select("id, firstName, lastName")
          .eq("isActive", true)
          .in("id", marshalIds)
          .order("lastName", { ascending: true });
        if (marshalsData) {
          const mapping = {};
          const list = marshalsData.map((m) => {
            mapping[m.id] = `${m.firstName} ${m.lastName}`;
            return { id: m.id, label: `${m.firstName} ${m.lastName}` };
          });
          setMarshalList(list);
          setMarshalNames(mapping);
        }
      } else {
        setMarshalList([]);
        setMarshalNames({});
      }

      const { data: eventGearRows } = await supabase
        .from("event_gear")
        .select("gear_id")
        .eq("event_id", eventInfo.event_id);
      const gearIds = (eventGearRows || []).map((r) => r.gear_id);
      if (gearIds.length > 0) {
        const { data: gearData } = await supabase
          .from("gear")
          .select("code, label_fr, label_en")
          .in("id", gearIds)
          .order("label_fr", { ascending: true });
        if (gearData) setGearOptions(gearData);
      } else {
        setGearOptions([]);
      }
    };

    setEventInfo((prev) => ({ ...prev, race_id: "" }));
    setRaceList([]);
    setMarshalList([]);
    setGearOptions([]);
    setIsPacer(false);
    fetchEventData();
  }, [eventInfo.event_id]);

  // Poll checks for the selected race every 3 s so that all marshals at a control point
  // see each other's entries in real-time without a page refresh.
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
    if (!form.dossard) return;
    const effective = isPacer ? "P" + form.dossard : form.dossard;
    const found = dossardsControles.find((c) => c.dossard === effective);
    setDuplicateInfo(found || null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPacer]);

  useEffect(() => {
    if (step === 2 && dossardRef.current) dossardRef.current.focus();
  }, [step, submitted]);

  const handleEventChange = (e) => {
    const { name, value } = e.target;
    // Persist marshal selection so the dropdown is pre-filled on next page load.
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
      const effective = isPacer ? "P" + value : value;
      const found = value ? dossardsControles.find((c) => c.dossard === effective) : null;
      setDuplicateInfo(found || null);
    }
    if ((name === "commentaire" && value.trim()) || (name === "materielManquant" && value.trim())) {
      setKoError(false);
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

  const geoMode = selectedEvent?.geolocation_mode || "no";
  // Block the "Start" button entirely when geolocation is mandatory but denied — avoids silent data loss.
  const geoBlocked = geoMode === "mandatory" && (geoStatus === "denied" || geoStatus === "unavailable");
  const raceHasPacers = selectedRace?.has_pacers ?? false;
  // Pacers get a "P" prefix so they're distinguishable from runners with the same number.
  const effectiveDossard = isPacer && form.dossard ? "P" + form.dossard : form.dossard;

  // Bib range guard — races with range_min/range_max configured reject out-of-range bibs
  // at the UI level before they even reach Supabase, preventing mis-entries across races.
  const allowedMin = selectedRace?.range_min ?? null;
  const allowedMax = selectedRace?.range_max ?? null;
  const bibNumber = form.dossard === "" ? null : parseInt(form.dossard, 10);
  const isBibOutOfRange =
    bibNumber != null &&
    allowedMin != null &&
    allowedMax != null &&
    (bibNumber < allowedMin || bibNumber > allowedMax);

  // Sélection du matériel (on stocke le FR en base pour compatibilité admin)
  // Store the gear code (not the label) so the admin view can translate it on the fly
  // regardless of what language the marshal was using at check time.
  const handleGearSelect = (e) => {
    const code = e.target.value;
    setMaterielCode(code);
    if (code === "__autre__") {
      setForm((prev) => ({ ...prev, materielManquant: "" }));
    } else {
      const g = gearOptions.find((x) => x.code === code);
      setForm((prev) => ({ ...prev, materielManquant: g ? g.code : "" }));
      if (code) setKoError(false);
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
    // Vérif de la plage (sur la partie numérique uniquement)
    if (allowedMin != null && allowedMax != null) {
      const n = parseInt(form.dossard, 10);
      if (Number.isNaN(n) || n < allowedMin || n > allowedMax) {
        alert(t("bibOutOfRange"));
        return;
      }
    }

    // KO without any details is useless for race officials — require at least one of these.
    if (form.resultat === "ko" && !form.materielManquant.trim() && !form.commentaire.trim()) {
      setKoError(true);
      return;
    }

    const isDuplicate = dossardsControles.map((dc) => dc.dossard).includes(effectiveDossard);
    if (isDuplicate && !window.confirm(t("dupConfirm"))) return;

    // Capture geolocation if needed
    let coords = null;
    if (geoMode !== "no" && navigator.geolocation) {
      coords = await new Promise((resolve) => {
        navigator.geolocation.getCurrentPosition(
          (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
          () => resolve(null),
          { enableHighAccuracy: true, timeout: 8000 }
        );
      });
      if (geoMode === "mandatory" && !coords) {
        alert(t("geo.mandatoryBlocked"));
        return;
      }
    }

    const data = {
      race_id: eventInfo.race_id,
      location_id: selectedLocation || null,
      marshal_id: eventInfo.marshal_id,
      dossard: effectiveDossard,
      resultat: form.resultat,
      materiel_manquant: form.resultat === "ko" ? form.materielManquant : null,
      commentaire: form.commentaire,
      latitude: coords?.lat ?? null,
      longitude: coords?.lng ?? null,
    };

    setSyncStatus("syncing");
    const { error } = await supabase.from("controles").insert([data]);
    if (error) {
      alert("Erreur lors de l'enregistrement");
      setSyncStatus("error");
      return;
    }

    // Optimistically append to local list so the duplicate warning fires immediately on the next bib.
    setDossardsControles((prev) => [
      ...prev,
      { dossard: effectiveDossard, marshal_id: eventInfo.marshal_id, created_at: new Date().toISOString() },
    ]);
    setSubmitted(true);
    setSyncStatus("success");
    // Short haptic pulse — marshals use phones and gloves, tactile feedback helps confirm submission.
    navigator.vibrate && navigator.vibrate(30);
    setForm({ dossard: "", resultat: "ok", materielManquant: "", commentaire: "" });
    setMaterielCode("");
    setKoError(false);
    setIsPacer(false);
    setTimeout(() => setSubmitted(false), 500);
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

          {!(geoMode !== "no" && geoStatus === "granted") && (
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
          )}

          {geoMode !== "no" && (
            <div className={`p-3 rounded border text-sm ${geoStatus === "denied" || geoStatus === "unavailable" ? "bg-red-50 border-red-300 text-red-700" : geoStatus === "granted" ? "bg-green-50 border-green-300 text-green-700" : "bg-blue-50 border-blue-200 text-blue-700"}`}>
              {geoStatus === "idle" && t("geo.permissionInfo")}
              {geoStatus === "requesting" && t("geo.requesting")}
              {geoStatus === "granted" && t("geo.granted")}
              {(geoStatus === "denied" || geoStatus === "unavailable") && (
                <>
                  <p>{geoMode === "mandatory" ? t("geo.mandatoryBlocked") : t("geo.denied")}</p>
                  {geoStatus === "denied" && (
                    <button onClick={requestGeo} className="mt-2 px-3 py-1 bg-blue-600 text-white rounded text-xs">
                      {t("geo.allowBtn")}
                    </button>
                  )}
                </>
              )}
            </div>
          )}

          <button
            className="w-full bg-blue-600 text-white py-3 rounded disabled:opacity-50"
            onClick={() => setStep(2)}
            disabled={!selectedMarshal || !eventInfo.race_id || geoBlocked}
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
              <div className="relative flex-1">
                {isPacer && (
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 font-bold text-lg text-purple-700 pointer-events-none select-none">P</span>
                )}
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
                  className={`w-full p-3 text-lg border rounded-md ${isPacer ? "pl-8 border-purple-400" : ""} ${
                    duplicateInfo || isBibOutOfRange ? "border-red-500" : ""
                  }`}
                />
              </div>
              <button type="button" onClick={handleClear} className="text-sm px-3 py-2 bg-gray-200 rounded">
                {t("clear")}
              </button>
              {raceHasPacers && (
                <button
                  type="button"
                  onClick={() => setIsPacer((p) => !p)}
                  disabled={selectedEvent?.isLocked}
                  className={`text-sm px-3 py-2 rounded flex-shrink-0 font-medium transition-colors ${
                    isPacer ? "bg-purple-600 text-white" : "bg-gray-200 text-gray-600"
                  }`}
                >
                  {t("pacer")}
                </button>
              )}
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
                onClick={() => { setForm({ ...form, resultat: "ok" }); setKoError(false); }}
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
                  className={`w-full p-3 border rounded-md ${koError && !form.materielManquant.trim() && !form.commentaire.trim() ? "border-red-500" : ""}`}
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

            {koError && (
              <p className="text-sm text-red-600 font-medium">{t("koRequiredMsg")}</p>
            )}

            <textarea
              name="commentaire"
              placeholder={t("comment")}
              value={form.commentaire}
              onChange={handleFormChange}
              className={`w-full p-3 border rounded-md ${koError && !form.commentaire.trim() && !form.materielManquant.trim() ? "border-red-500" : ""}`}
              disabled={selectedEvent?.isLocked}
            />

            <button
              type="submit"
              onClick={() => dossardRef.current?.focus()}
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
                    <li key={idx} className="flex items-center gap-1">
                      {c.dossard.startsWith("P") && (
                        <span className="text-xs bg-purple-100 text-purple-700 rounded px-1 py-0.5 font-medium flex-shrink-0">
                          {t("pacer")}
                        </span>
                      )}
                      <span className="font-mono">{c.dossard}</span>
                      <span className="text-xs text-gray-500">
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
