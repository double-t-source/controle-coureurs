import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "./supabaseClient";

const EARTH_RADIUS_M = 6371000;
function distanceMeters(lat1, lng1, lat2, lng2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
// Nearest-point matching stands in for real geofencing: each checkpoint is just a
// lat/lng, and we pick whichever is closest to the marshal's captured position.
function findNearestLocation(coords, locations) {
  let best = null;
  for (const location of locations) {
    if (location.latitude == null || location.longitude == null) continue;
    const distance = distanceMeters(coords.lat, coords.lng, location.latitude, location.longitude);
    if (!best || distance < best.distance) best = { location, distance };
  }
  return best;
}

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
    commentaire: "",
  });
  const [selectedGearCodes, setSelectedGearCodes] = useState(new Set());
  const [autreSelected, setAutreSelected] = useState(false);
  const [autreText, setAutreText] = useState("");

  const [isPacer, setIsPacer] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [syncStatus, setSyncStatus] = useState("idle");
  const [dossardsControles, setDossardsControles] = useState([]);
  const [gearOptions, setGearOptions] = useState([]);
  const [duplicateInfo, setDuplicateInfo] = useState(null);
  const [koError, setKoError] = useState(false);
  const [marshalNames, setMarshalNames] = useState({});
  const dossardRef = useRef(null);
  const lastPrefilledBib = useRef(null);
  const [raceLocationList, setRaceLocationList] = useState([]);
  const [selectedLocation, setSelectedLocation] = useState("");
  const [showCompetitionDrawer, setShowCompetitionDrawer] = useState(false);
  const [competitionPulse, setCompetitionPulse] = useState(false);
  const prevCompetitionRankRef = useRef(null);

  // Geolocation
  // "idle" | "requesting" | "granted" | "matched" | "suggested" | "denied" | "unavailable"
  const [geoStatus, setGeoStatus] = useState("idle");
  const [geoRadiusM, setGeoRadiusM] = useState(250);
  const [capturedCoords, setCapturedCoords] = useState(null);
  const [matchedLocation, setMatchedLocation] = useState(null); // { location, distance }
  const [manualOverride, setManualOverride] = useState(false);

  // Initial fetch
  useEffect(() => {
    const fetchEvents = async () => {
      const { data } = await supabase.from("events").select("id, name, isLocked, geolocation_mode");
      if (data) setEventList(data);
    };
    const fetchGeoRadius = async () => {
      const { data } = await supabase.from("app_settings").select("geo_radius_m").eq("id", 1).single();
      if (data?.geo_radius_m) setGeoRadiusM(data.geo_radius_m);
    };
    fetchEvents();
    fetchGeoRadius();
  }, []);

  // Priming permission request when the event is picked, before the race (and its
  // checkpoints) are known — the actual nearest-checkpoint match happens once the race
  // is selected, see the race_id effect below.
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
    setCapturedCoords(null);
    setMatchedLocation(null);
    setManualOverride(false);
    if (mode !== "no" && eventInfo.event_id) {
      requestGeo();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventInfo.event_id]);

  // Capture the marshal's position once per race selection (locked for the session) and
  // match it against that race's checkpoints. A stale/no-longer-relevant match never
  // lingers across races since raceLocationList/matchedLocation are reset first.
  const relocate = (locations) => {
    if (!navigator.geolocation) {
      setGeoStatus("unavailable");
      return;
    }
    setGeoStatus("requesting");
    setManualOverride(false);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setCapturedCoords(coords);
        const nearest = findNearestLocation(coords, locations);
        setMatchedLocation(nearest);
        if (!nearest) {
          setGeoStatus("granted");
        } else if (nearest.distance <= geoRadiusM) {
          setSelectedLocation(String(nearest.location.id));
          setGeoStatus("matched");
        } else {
          setGeoStatus("suggested");
        }
      },
      () => setGeoStatus("denied"),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  // Load the checkpoints for the selected race and (re)run the auto-detection now that
  // they're known — this is what actually resolves/locks a named location for the session.
  useEffect(() => {
    const fetchRaceLocations = async () => {
      if (!eventInfo.race_id) {
        setRaceLocationList([]);
        return;
      }
      const { data } = await supabase
        .from("race_locations")
        .select("locations(id, name, latitude, longitude, isActive)")
        .eq("race_id", eventInfo.race_id);
      const locations = (data || []).map((r) => r.locations).filter((l) => l && l.isActive);
      setRaceLocationList(locations);
      setSelectedLocation("");
      setCapturedCoords(null);
      setMatchedLocation(null);
      setManualOverride(false);

      const mode = eventList.find((e) => e.id.toString() === eventInfo.event_id)?.geolocation_mode || "no";
      if (mode !== "no" && (geoStatus === "granted" || geoStatus === "matched" || geoStatus === "suggested")) {
        relocate(locations);
      }
    };
    fetchRaceLocations();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventInfo.race_id]);

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
        .select("id, name, range_min, range_max, has_pacers, competition_mode")
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
  // Polls a bit faster (2 s) when competition mode is on for a livelier leaderboard.
  useEffect(() => {
    let interval;
    const fetchControles = async () => {
      if (eventInfo.race_id) {
        const { data } = await supabase
          .from("controles")
          .select("dossard, marshal_id, created_at, resultat, materiel_manquant, location_id")
          .eq("race_id", eventInfo.race_id);
        if (data) setDossardsControles(data);
      }
    };

    if (eventInfo.race_id) {
      fetchControles();
      const race = raceList.find((r) => r.id.toString() === eventInfo.race_id);
      const pollMs = race?.competition_mode ? 2000 : 3000;
      interval = setInterval(fetchControles, pollMs);
    }
    return () => clearInterval(interval);
  }, [eventInfo.race_id, raceList]);

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

  // When the marshal enters a bib that was last checked KO, pre-select the still-missing chips
  // so they only need to deselect items that are now present (rather than re-selecting everything).
  // Deliberately omits dossardsControles from deps: we only want this to fire on bib change,
  // not on every 3-second poll, to avoid resetting the marshal's in-progress chip selection.
  useEffect(() => {
    const target = isPacer && form.dossard ? "P" + form.dossard : form.dossard;
    if (!target || target === lastPrefilledBib.current) return;

    const bibChecks = dossardsControles
      .filter(c => c.dossard === target)
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    if (bibChecks.length === 0) return;

    const lastCheck = bibChecks[bibChecks.length - 1];
    lastPrefilledBib.current = target;

    if (lastCheck.resultat === "ko" && lastCheck.materiel_manquant) {
      const codes = lastCheck.materiel_manquant.split(",").map(s => s.trim()).filter(Boolean);
      setSelectedGearCodes(new Set(codes));
      setForm(prev => ({ ...prev, resultat: "ko" }));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.dossard, isPacer]);

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
    if (name === "commentaire" && value.trim()) {
      setKoError(false);
    }
  };

  const handleClear = () => {
    setForm((prev) => ({ ...prev, dossard: "" }));
    lastPrefilledBib.current = null;
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
  const locationsById = Object.fromEntries(raceLocationList.map((l) => [l.id, l.name]));
  const showManualLocationSelect =
    geoMode === "no" ||
    geoStatus === "idle" ||
    geoStatus === "requesting" ||
    geoStatus === "denied" ||
    geoStatus === "unavailable" ||
    // "granted" with no match means there was nothing to match against (no checkpoint
    // for this race has coordinates yet) — without this, the marshal would have no way
    // to name the checkpoint at all.
    (geoStatus === "granted" && !matchedLocation) ||
    manualOverride;
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

  // Items that are CURRENTLY still missing = materiel_manquant of the last check, only when that last check was KO.
  // If the last check was OK (even partially), nothing is flagged anymore.
  const previousKOItems = (() => {
    if (!form.dossard) return [];
    const bibChecks = dossardsControles
      .filter(c => c.dossard === effectiveDossard)
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    if (bibChecks.length === 0) return [];
    const lastCheck = bibChecks[bibChecks.length - 1];
    if (lastCheck.resultat !== "ko" || !lastCheck.materiel_manquant) return [];
    return lastCheck.materiel_manquant.split(",").map(s => s.trim()).filter(Boolean);
  })();

  // Mode compétition (super-admin, par course) : classement en temps réel du nombre de
  // contrôles saisis par commissaire sur la course en cours, dérivé de dossardsControles
  // (déjà rafraîchi toutes les 3 s), sans appel réseau supplémentaire.
  // Même règle de comptage que les statistiques du panel admin : pour un dossard recontrôlé
  // plusieurs fois, seul le premier contrôle compte, puis chaque contrôle suivant dont le
  // résultat diffère du précédent — deux contrôles identiques d'affilée ne comptent qu'une fois.
  const competitionModeEnabled = !!selectedRace?.competition_mode;
  const competitionLeaderboard = competitionModeEnabled
    ? (() => {
        const byDossard = new Map();
        for (const c of dossardsControles) {
          if (!byDossard.has(c.dossard)) byDossard.set(c.dossard, []);
          byDossard.get(c.dossard).push(c);
        }
        const counts = {};
        for (const arr0 of byDossard.values()) {
          const arr = [...arr0].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
          arr.forEach((c, i) => {
            if (i === 0 || c.resultat !== arr[i - 1].resultat) {
              counts[c.marshal_id] = (counts[c.marshal_id] || 0) + 1;
            }
          });
        }
        return Object.entries(counts)
          .map(([marshalId, count]) => ({ marshalId, count, name: marshalNames[marshalId] || "?" }))
          .sort((a, b) => b.count - a.count);
      })()
    : [];
  const myCompetitionRank = competitionLeaderboard.findIndex((e) => e.marshalId === eventInfo.marshal_id) + 1;
  const myCompetitionCount = competitionLeaderboard.find((e) => e.marshalId === eventInfo.marshal_id)?.count ?? 0;
  const competitionLeaderCount = competitionLeaderboard[0]?.count ?? 0;

  // Visual tier of the mini leaderboard bar: medal + colors follow the marshal's current rank
  // so a glance at the (already-live-polled) bar tells them where they stand without opening it.
  const competitionTier =
    myCompetitionRank === 1
      ? { medal: "🥇 ", classes: "bg-amber-100 border-amber-300 text-amber-900" }
      : myCompetitionRank === 2
      ? { medal: "🥈 ", classes: "bg-slate-200 border-slate-300 text-slate-800" }
      : myCompetitionRank === 3
      ? { medal: "🥉 ", classes: "bg-orange-100 border-orange-300 text-orange-800" }
      : myCompetitionRank > 3
      ? { medal: "", classes: "bg-blue-50 border-blue-200 text-blue-800" }
      : { medal: "🏆 ", classes: "bg-gray-50 border-gray-200 text-gray-500" };

  // How far the marshal is from moving up one place — controls behind the marshal directly
  // above them, or (for the leader) controls of lead before being caught by 2nd place.
  const competitionGapLabel = (() => {
    if (myCompetitionRank === 0) return null;
    if (myCompetitionRank === 1) {
      const second = competitionLeaderboard[1];
      if (!second) return null;
      const gap = myCompetitionCount - second.count;
      return gap > 0 ? t("competition.gapLead", { gap }) : t("competition.gapTiedLead");
    }
    const above = competitionLeaderboard[myCompetitionRank - 2];
    if (!above) return null;
    const gap = above.count - myCompetitionCount;
    return gap > 0
      ? t("competition.gapChase", { gap, rank: myCompetitionRank - 1 })
      : t("competition.gapTied", { rank: myCompetitionRank - 1 });
  })();

  // Briefly flash the bar whenever the marshal's own rank changes, so a climb/drop in the
  // live standings is noticeable even if they're not staring at it when the poll lands.
  useEffect(() => {
    if (!competitionModeEnabled) return;
    const prev = prevCompetitionRankRef.current;
    prevCompetitionRankRef.current = myCompetitionRank;
    if (prev !== null && prev !== myCompetitionRank && myCompetitionRank > 0) {
      setCompetitionPulse(true);
      const timeout = setTimeout(() => setCompetitionPulse(false), 900);
      return () => clearTimeout(timeout);
    }
  }, [myCompetitionRank, competitionModeEnabled]);

  const toggleGear = (code) => {
    setSelectedGearCodes((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
    setKoError(false);
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
    if (form.resultat === "ko" && selectedGearCodes.size === 0 && !(autreSelected && autreText.trim()) && !form.commentaire.trim()) {
      setKoError(true);
      return;
    }

    const isDuplicate = dossardsControles.map((dc) => dc.dossard).includes(effectiveDossard);
    if (isDuplicate && !window.confirm(t("dupConfirm"))) return;

    // Position is captured once per race session (see the race_id effect / relocate()),
    // not re-queried on every submit — reuse whatever was locked in for this checkpoint.
    if (geoMode === "mandatory" && !capturedCoords) {
      alert(t("geo.mandatoryBlocked"));
      return;
    }

    const gearCodes = [...selectedGearCodes];
    if (autreSelected && autreText.trim()) gearCodes.push(autreText.trim());
    const data = {
      race_id: eventInfo.race_id,
      location_id: selectedLocation || null,
      marshal_id: eventInfo.marshal_id,
      dossard: effectiveDossard,
      resultat: form.resultat,
      materiel_manquant: form.resultat === "ko" && gearCodes.length > 0 ? gearCodes.join(",") : null,
      commentaire: form.commentaire,
      latitude: capturedCoords?.lat ?? null,
      longitude: capturedCoords?.lng ?? null,
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
      { dossard: effectiveDossard, marshal_id: eventInfo.marshal_id, created_at: new Date().toISOString(), resultat: form.resultat, materiel_manquant: data.materiel_manquant, location_id: data.location_id },
    ]);
    setSubmitted(true);
    setSyncStatus("success");
    // Short haptic pulse — marshals use phones and gloves, tactile feedback helps confirm submission.
    navigator.vibrate && navigator.vibrate(30);
    lastPrefilledBib.current = null;
    setForm({ dossard: "", resultat: "ok", commentaire: "" });
    setSelectedGearCodes(new Set());
    setAutreSelected(false);
    setAutreText("");
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

          {geoMode !== "no" && !manualOverride && (
            <div
              className={`p-3 rounded border text-sm ${
                geoStatus === "denied" || geoStatus === "unavailable"
                  ? "bg-red-50 border-red-300 text-red-700"
                  : geoStatus === "matched"
                  ? "bg-green-50 border-green-300 text-green-700"
                  : geoStatus === "suggested"
                  ? "bg-orange-50 border-orange-300 text-orange-800"
                  : "bg-blue-50 border-blue-200 text-blue-700"
              }`}
            >
              {geoStatus === "idle" && t("geo.permissionInfo")}
              {geoStatus === "requesting" && t("geo.requesting")}
              {geoStatus === "granted" && (eventInfo.race_id ? t("geo.noMatchSelectManually") : t("geo.granted"))}
              {geoStatus === "matched" && matchedLocation && (
                <div className="flex items-center justify-between gap-2">
                  <span>📍 {t("geo.matchedAt", { name: matchedLocation.location.name })}</span>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button type="button" onClick={() => relocate(raceLocationList)} className="text-xs underline">
                      🔄
                    </button>
                    <button type="button" onClick={() => setManualOverride(true)} className="text-xs underline">
                      {t("geo.wrongLocation")}
                    </button>
                  </div>
                </div>
              )}
              {geoStatus === "suggested" && matchedLocation && (
                <div className="space-y-2">
                  <p>
                    📍 {t("geo.suggestedAt", { name: matchedLocation.location.name, distance: Math.round(matchedLocation.distance) })}
                  </p>
                  {selectedLocation === String(matchedLocation.location.id) ? (
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-medium">✓ {t("geo.confirmed")}</span>
                      <button type="button" onClick={() => relocate(raceLocationList)} className="text-xs underline">
                        🔄 {t("geo.relocate")}
                      </button>
                    </div>
                  ) : (
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setSelectedLocation(String(matchedLocation.location.id))}
                        className="px-3 py-1 bg-orange-600 text-white rounded text-xs"
                      >
                        {t("geo.confirmLocation")}
                      </button>
                      <button type="button" onClick={() => setManualOverride(true)} className="px-3 py-1 border rounded text-xs">
                        {t("geo.chooseOther")}
                      </button>
                    </div>
                  )}
                </div>
              )}
              {(geoStatus === "denied" || geoStatus === "unavailable") && (
                <>
                  <p>{geoMode === "mandatory" ? t("geo.mandatoryBlocked") : t("geo.denied")}</p>
                  {geoStatus === "denied" && (
                    <button onClick={() => relocate(raceLocationList)} className="mt-2 px-3 py-1 bg-blue-600 text-white rounded text-xs">
                      {t("geo.allowBtn")}
                    </button>
                  )}
                </>
              )}
            </div>
          )}

          {showManualLocationSelect && (
            <div>
              {manualOverride && geoMode !== "no" && (
                <div className="flex justify-end mb-1">
                  <button
                    type="button"
                    onClick={() => { setManualOverride(false); relocate(raceLocationList); }}
                    className="text-xs text-blue-600 underline"
                  >
                    🔄 {t("geo.relocate")}
                  </button>
                </div>
              )}
              <select
                name="location_id"
                value={selectedLocation}
                onChange={(e) => setSelectedLocation(e.target.value)}
                className="w-full p-3 border rounded-md"
              >
                <option value="">-- {t("location")} --</option>
                {raceLocationList.map((loc) => (
                  <option key={loc.id} value={loc.id}>
                    {loc.name}
                  </option>
                ))}
              </select>
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
          {showCompetitionDrawer && (
            <div
              className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center"
              onClick={() => setShowCompetitionDrawer(false)}
            >
              <div
                className="bg-white w-full sm:max-w-sm sm:rounded-2xl rounded-t-2xl p-4 max-h-[75vh] overflow-y-auto shadow-2xl"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-base font-bold">🏆 {t("competition.title")}</h2>
                  <button
                    onClick={() => setShowCompetitionDrawer(false)}
                    className="text-gray-400 hover:text-gray-600 text-xl leading-none"
                    aria-label={t("clear")}
                  >
                    ×
                  </button>
                </div>
                {competitionLeaderboard.length === 0 ? (
                  <p className="text-sm text-gray-500">{t("competition.empty")}</p>
                ) : (
                  <ul className="space-y-2">
                    {competitionLeaderboard.map((entry, idx) => {
                      const rank = idx + 1;
                      const isMe = entry.marshalId === eventInfo.marshal_id;
                      const medal = rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : `#${rank}`;
                      const pct = competitionLeaderCount > 0 ? Math.max(6, (entry.count / competitionLeaderCount) * 100) : 0;
                      return (
                        <li
                          key={entry.marshalId}
                          className={`flex items-center gap-2 p-1.5 rounded ${isMe ? "bg-amber-50 ring-1 ring-amber-300" : ""}`}
                        >
                          <span className="w-6 text-center text-sm flex-shrink-0">{medal}</span>
                          <span className={`flex-1 text-sm truncate ${isMe ? "font-semibold text-amber-800" : "text-gray-700"}`}>
                            {entry.name}
                            {isMe && ` (${t("competition.you")})`}
                          </span>
                          <div className="flex items-center gap-1.5 flex-shrink-0 w-28">
                            <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                              <div className="h-full bg-amber-500 rounded-full" style={{ width: `${pct}%` }} />
                            </div>
                            <span className="text-xs font-medium text-gray-600 w-6 text-right">{entry.count}</span>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </div>
          )}

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
                {duplicateInfo.location_id && locationsById[duplicateInfo.location_id] && ` · ${locationsById[duplicateInfo.location_id]}`}
              </p>
            )}
            {isBibOutOfRange && <p className="text-sm text-red-600">{t("bibOutOfRange")}</p>}

            {previousKOItems.length > 0 && (
              <div className="bg-orange-50 border border-orange-200 rounded p-2 text-sm">
                <p className="font-medium text-orange-800 mb-1.5">{t("prevKOMissing")}</p>
                <div className="flex flex-wrap gap-1.5">
                  {previousKOItems.map(code => {
                    const g = gearOptions.find(x => x.code === code);
                    return (
                      <span key={code} className="px-2 py-0.5 bg-orange-200 text-orange-800 rounded-full text-xs font-medium">
                        {g ? labelFor(g) : code}
                      </span>
                    );
                  })}
                </div>
              </div>
            )}

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
                <div
                  className={`flex flex-wrap gap-2 p-2 border rounded-md max-h-40 overflow-y-auto ${
                    koError && selectedGearCodes.size === 0 && !(autreSelected && autreText.trim()) && !form.commentaire.trim()
                      ? "border-red-500"
                      : "border-gray-300"
                  }`}
                >
                  {gearOptions.map((g) => (
                    <button
                      key={g.code}
                      type="button"
                      onClick={() => toggleGear(g.code)}
                      disabled={selectedEvent?.isLocked}
                      className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors flex-shrink-0 ${
                        selectedGearCodes.has(g.code)
                          ? "bg-red-600 text-white border-red-600"
                          : "bg-gray-100 text-gray-700 border-gray-300 hover:bg-gray-200"
                      }`}
                    >
                      {labelFor(g)}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => {
                      setAutreSelected((prev) => !prev);
                      setAutreText("");
                      setKoError(false);
                    }}
                    disabled={selectedEvent?.isLocked}
                    className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors flex-shrink-0 ${
                      autreSelected
                        ? "bg-red-600 text-white border-red-600"
                        : "bg-gray-100 text-gray-700 border-gray-300 hover:bg-gray-200"
                    }`}
                  >
                    {t("other")}
                  </button>
                </div>

                {autreSelected && (
                  <input
                    placeholder={t("other")}
                    value={autreText}
                    onChange={(e) => {
                      setAutreText(e.target.value);
                      if (e.target.value.trim()) setKoError(false);
                    }}
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
              className={`w-full p-3 border rounded-md ${koError && !form.commentaire.trim() ? "border-red-500" : ""}`}
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

            {competitionModeEnabled && (
              <button
                type="button"
                onClick={() => setShowCompetitionDrawer(true)}
                className={`w-full flex flex-col items-center justify-center py-1.5 rounded-md border text-xs font-semibold transition-all duration-300 active:scale-[0.98] ${
                  competitionTier.classes
                } ${competitionPulse ? "ring-2 ring-offset-1 ring-amber-400 scale-[1.02]" : ""}`}
              >
                <span className="flex items-center gap-1.5">
                  <span>
                    {competitionTier.medal}
                    {myCompetitionRank > 0
                      ? t("competition.badgeRanked", { rank: myCompetitionRank, count: myCompetitionCount })
                      : t("competition.badgeUnranked")}
                  </span>
                  <span aria-hidden="true">›</span>
                </span>
                {competitionGapLabel && (
                  <span className="text-[10px] font-normal opacity-80">{competitionGapLabel}</span>
                )}
              </button>
            )}

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
                        {c.location_id && locationsById[c.location_id] && ` · ${locationsById[c.location_id]}`}
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
