import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "./supabaseClient";

async function sha256Hex(s) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
}

// ─── Events & Races Tab ────────────────────────────────────────────────────

function EventsRacesTab({ t, events, races, onRefreshEvents, onRefreshRaces }) {
  const [expandedId, setExpandedId] = useState(null);
  const [editingEventId, setEditingEventId] = useState(null);
  const [editEventName, setEditEventName] = useState("");
  const [editGeoMode, setEditGeoMode] = useState("no");
  const [addingEvent, setAddingEvent] = useState(false);
  const [newEventName, setNewEventName] = useState("");
  const [newGeoMode, setNewGeoMode] = useState("no");

  const [editingRaceId, setEditingRaceId] = useState(null);
  const [editRaceForm, setEditRaceForm] = useState({ name: "", range_min: "", range_max: "" });
  const [addingRaceForId, setAddingRaceForId] = useState(null);
  const [newRaceForm, setNewRaceForm] = useState({ name: "", range_min: "", range_max: "" });
  const [raceError, setRaceError] = useState("");
  const [saveError, setSaveError] = useState("");

  const racesFor = (eventId) => races.filter(r => r.event_id === eventId);

  const toggleExpand = (id) => setExpandedId(prev => (prev === id ? null : id));

  // ── Event CRUD ──
  const startAddEvent = () => { setAddingEvent(true); setNewEventName(""); setNewGeoMode("no"); setSaveError(""); };
  const cancelAddEvent = () => { setAddingEvent(false); setNewEventName(""); };

  const addEvent = async () => {
    const name = newEventName.trim();
    if (!name) return;
    const { error } = await supabase.from("events").insert({ name, isLocked: false, geolocation_mode: newGeoMode });
    if (error) { setSaveError(t("superAdmin.saveError")); return; }
    setAddingEvent(false);
    setNewEventName("");
    onRefreshEvents();
  };

  const startEditEvent = (ev) => {
    setEditingEventId(ev.id);
    setEditEventName(ev.name);
    setEditGeoMode(ev.geolocation_mode || "no");
    setSaveError("");
  };

  const saveEvent = async (id) => {
    const name = editEventName.trim();
    if (!name) return;
    const { error } = await supabase.from("events").update({ name, geolocation_mode: editGeoMode }).eq("id", id);
    if (error) { setSaveError(t("superAdmin.saveError")); return; }
    setEditingEventId(null);
    onRefreshEvents();
  };

  const toggleLock = async (id, current) => {
    await supabase.from("events").update({ isLocked: !current }).eq("id", id);
    onRefreshEvents();
  };

  const deleteEvent = async (ev) => {
    const count = racesFor(ev.id).length;
    const msg = count > 0
      ? t("superAdmin.deleteEventConfirmWithRaces", { name: ev.name, count })
      : t("superAdmin.deleteEventConfirm", { name: ev.name });
    if (!window.confirm(msg)) return;
    // Delete races first to avoid FK violations
    if (count > 0) await supabase.from("races").delete().eq("event_id", ev.id);
    await supabase.from("events").delete().eq("id", ev.id);
    if (expandedId === ev.id) setExpandedId(null);
    onRefreshEvents();
    onRefreshRaces();
  };

  // ── Race CRUD ──
  const startAddRace = (eventId) => {
    setAddingRaceForId(eventId);
    setNewRaceForm({ name: "", range_min: "", range_max: "" });
    setRaceError("");
  };

  const cancelAddRace = () => { setAddingRaceForId(null); setRaceError(""); };

  const addRace = async (eventId) => {
    const name = newRaceForm.name.trim();
    if (!name) return;
    const min = Number(newRaceForm.range_min);
    const max = Number(newRaceForm.range_max);
    if (newRaceForm.range_min && newRaceForm.range_max && min >= max) {
      setRaceError(t("superAdmin.rangeMinMaxError"));
      return;
    }
    const { error } = await supabase.from("races").insert({
      event_id: eventId,
      name,
      range_min: newRaceForm.range_min ? min : null,
      range_max: newRaceForm.range_max ? max : null,
    });
    if (error) { setRaceError(t("superAdmin.saveError")); return; }
    setAddingRaceForId(null);
    onRefreshRaces();
  };

  const startEditRace = (race) => {
    setEditingRaceId(race.id);
    setEditRaceForm({ name: race.name, range_min: race.range_min ?? "", range_max: race.range_max ?? "" });
    setRaceError("");
  };

  const saveRace = async (race) => {
    const name = editRaceForm.name.trim();
    if (!name) return;
    const min = Number(editRaceForm.range_min);
    const max = Number(editRaceForm.range_max);
    if (editRaceForm.range_min && editRaceForm.range_max && min >= max) {
      setRaceError(t("superAdmin.rangeMinMaxError"));
      return;
    }
    const { error } = await supabase.from("races").update({
      name,
      range_min: editRaceForm.range_min ? min : null,
      range_max: editRaceForm.range_max ? max : null,
    }).eq("id", race.id);
    if (error) { setRaceError(t("superAdmin.saveError")); return; }
    setEditingRaceId(null);
    onRefreshRaces();
  };

  const deleteRace = async (race) => {
    const { count } = await supabase
      .from("controles")
      .select("id", { count: "exact", head: true })
      .eq("race_id", race.id);
    const msg = count > 0
      ? t("superAdmin.deleteRaceWithControles", { name: race.name, count })
      : t("superAdmin.deleteRaceConfirm", { name: race.name });
    if (!window.confirm(msg)) return;
    await supabase.from("races").delete().eq("id", race.id);
    onRefreshRaces();
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-lg font-semibold">{t("superAdmin.tabEventsRaces")}</h2>
        <button
          onClick={startAddEvent}
          className="px-3 py-1 bg-blue-600 text-white rounded text-sm hover:bg-blue-700"
        >
          + {t("superAdmin.addEvent")}
        </button>
      </div>

      {saveError && <p className="text-xs text-red-600 mb-3">{saveError}</p>}

      {addingEvent && (
        <div className="flex gap-2 mb-4 p-3 bg-blue-50 rounded border flex-wrap">
          <input
            className="border rounded p-2 flex-1 text-sm min-w-40"
            placeholder={t("superAdmin.eventName")}
            value={newEventName}
            onChange={e => setNewEventName(e.target.value)}
            onKeyDown={e => e.key === "Enter" && addEvent()}
            autoFocus
          />
          <select
            className="border rounded p-2 text-sm"
            value={newGeoMode}
            onChange={e => setNewGeoMode(e.target.value)}
          >
            <option value="no">{t("superAdmin.geoModeNo")}</option>
            <option value="optional">{t("superAdmin.geoModeOptional")}</option>
            <option value="mandatory">{t("superAdmin.geoModeMandatory")}</option>
          </select>
          <button onClick={addEvent} className="px-3 py-1 bg-green-600 text-white rounded text-sm">
            {t("superAdmin.save")}
          </button>
          <button onClick={cancelAddEvent} className="px-3 py-1 border rounded text-sm">
            {t("superAdmin.cancel")}
          </button>
        </div>
      )}

      {events.length === 0 && !addingEvent && (
        <p className="text-sm text-gray-400">{t("superAdmin.noEvents")}</p>
      )}

      <div className="space-y-2">
        {events.map(ev => (
          <div key={ev.id} className="border rounded overflow-hidden">
            {/* Event row */}
            <div className="flex items-center gap-2 p-3 bg-white">
              <button
                onClick={() => toggleExpand(ev.id)}
                className="text-gray-400 hover:text-gray-600 w-5 text-center flex-shrink-0"
                aria-label="expand"
              >
                {expandedId === ev.id ? "▾" : "▸"}
              </button>

              {editingEventId === ev.id ? (
                <>
                  <input
                    className="border rounded p-1 flex-1 text-sm min-w-32"
                    value={editEventName}
                    onChange={e => setEditEventName(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && saveEvent(ev.id)}
                    autoFocus
                  />
                  <select
                    className="border rounded p-1 text-xs"
                    value={editGeoMode}
                    onChange={e => setEditGeoMode(e.target.value)}
                  >
                    <option value="no">{t("superAdmin.geoModeNo")}</option>
                    <option value="optional">{t("superAdmin.geoModeOptional")}</option>
                    <option value="mandatory">{t("superAdmin.geoModeMandatory")}</option>
                  </select>
                  <button onClick={() => saveEvent(ev.id)} className="px-2 py-1 bg-green-600 text-white rounded text-xs">
                    {t("superAdmin.save")}
                  </button>
                  <button onClick={() => setEditingEventId(null)} className="px-2 py-1 border rounded text-xs">
                    {t("superAdmin.cancel")}
                  </button>
                </>
              ) : (
                <>
                  <span className="flex-1 font-medium text-sm">{ev.name}</span>
                  <span className={`text-xs px-2 py-0.5 rounded flex-shrink-0 ${ev.isLocked ? "bg-red-100 text-red-700" : "bg-green-100 text-green-700"}`}>
                    {ev.isLocked ? `🔒 ${t("superAdmin.eventLocked")}` : `🔓 ${t("superAdmin.eventUnlocked")}`}
                  </span>
                  {(ev.geolocation_mode && ev.geolocation_mode !== "no") && (
                    <span className={`text-xs px-2 py-0.5 rounded flex-shrink-0 ${ev.geolocation_mode === "mandatory" ? "bg-orange-100 text-orange-700" : "bg-blue-100 text-blue-700"}`}>
                      📍 {t(`superAdmin.geoMode${ev.geolocation_mode.charAt(0).toUpperCase() + ev.geolocation_mode.slice(1)}`)}
                    </span>
                  )}
                  <button
                    onClick={() => toggleLock(ev.id, ev.isLocked)}
                    className="px-2 py-1 border rounded text-xs hover:bg-gray-50 flex-shrink-0"
                  >
                    {ev.isLocked ? t("superAdmin.unlockEvent") : t("superAdmin.lockEvent")}
                  </button>
                  <button
                    onClick={() => startEditEvent(ev)}
                    className="px-2 py-1 border rounded text-xs hover:bg-gray-50 flex-shrink-0"
                  >
                    {t("superAdmin.edit")}
                  </button>
                  <button
                    onClick={() => deleteEvent(ev)}
                    className="px-2 py-1 border rounded text-xs text-red-600 hover:bg-red-50 flex-shrink-0"
                  >
                    {t("superAdmin.delete")}
                  </button>
                </>
              )}
            </div>

            {/* Races sub-section */}
            {expandedId === ev.id && (
              <div className="border-t bg-gray-50 p-3">
                <div className="flex justify-between items-center mb-3">
                  <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    {t("superAdmin.racesTitle", { name: ev.name })}
                  </span>
                  <button
                    onClick={() => startAddRace(ev.id)}
                    className="px-2 py-1 bg-blue-600 text-white rounded text-xs hover:bg-blue-700"
                  >
                    + {t("superAdmin.addRace")}
                  </button>
                </div>

                {raceError && <p className="text-xs text-red-600 mb-2">{raceError}</p>}

                {addingRaceForId === ev.id && (
                  <div className="flex gap-2 mb-3 flex-wrap bg-blue-50 p-2 rounded border">
                    <input
                      className="border rounded p-1 text-sm flex-1 min-w-28"
                      placeholder={t("superAdmin.raceName")}
                      value={newRaceForm.name}
                      onChange={e => setNewRaceForm(f => ({ ...f, name: e.target.value }))}
                      autoFocus
                    />
                    <input
                      className="border rounded p-1 text-sm w-24"
                      type="number"
                      placeholder={t("superAdmin.raceMin")}
                      value={newRaceForm.range_min}
                      onChange={e => setNewRaceForm(f => ({ ...f, range_min: e.target.value }))}
                    />
                    <input
                      className="border rounded p-1 text-sm w-24"
                      type="number"
                      placeholder={t("superAdmin.raceMax")}
                      value={newRaceForm.range_max}
                      onChange={e => setNewRaceForm(f => ({ ...f, range_max: e.target.value }))}
                    />
                    <button onClick={() => addRace(ev.id)} className="px-2 py-1 bg-green-600 text-white rounded text-xs">
                      {t("superAdmin.save")}
                    </button>
                    <button onClick={cancelAddRace} className="px-2 py-1 border rounded text-xs">
                      {t("superAdmin.cancel")}
                    </button>
                  </div>
                )}

                {racesFor(ev.id).length === 0 && addingRaceForId !== ev.id && (
                  <p className="text-xs text-gray-400">{t("superAdmin.noRaces")}</p>
                )}

                <div className="space-y-1">
                  {racesFor(ev.id).map(race => (
                    <div key={race.id} className="flex items-center gap-2 bg-white rounded border p-2 flex-wrap">
                      {editingRaceId === race.id ? (
                        <>
                          <input
                            className="border rounded p-1 text-sm flex-1 min-w-28"
                            value={editRaceForm.name}
                            onChange={e => setEditRaceForm(f => ({ ...f, name: e.target.value }))}
                            autoFocus
                          />
                          <input
                            className="border rounded p-1 text-sm w-24"
                            type="number"
                            placeholder={t("superAdmin.raceMin")}
                            value={editRaceForm.range_min}
                            onChange={e => setEditRaceForm(f => ({ ...f, range_min: e.target.value }))}
                          />
                          <input
                            className="border rounded p-1 text-sm w-24"
                            type="number"
                            placeholder={t("superAdmin.raceMax")}
                            value={editRaceForm.range_max}
                            onChange={e => setEditRaceForm(f => ({ ...f, range_max: e.target.value }))}
                          />
                          <button onClick={() => saveRace(race)} className="px-2 py-1 bg-green-600 text-white rounded text-xs">
                            {t("superAdmin.save")}
                          </button>
                          <button onClick={() => setEditingRaceId(null)} className="px-2 py-1 border rounded text-xs">
                            {t("superAdmin.cancel")}
                          </button>
                        </>
                      ) : (
                        <>
                          <span className="flex-1 text-sm">{race.name}</span>
                          <span className="text-xs text-gray-400">
                            {race.range_min != null && race.range_max != null
                              ? `${race.range_min} – ${race.range_max}`
                              : "—"}
                          </span>
                          <button
                            onClick={() => startEditRace(race)}
                            className="px-2 py-1 border rounded text-xs hover:bg-gray-50"
                          >
                            {t("superAdmin.edit")}
                          </button>
                          <button
                            onClick={() => deleteRace(race)}
                            className="px-2 py-1 border rounded text-xs text-red-600 hover:bg-red-50"
                          >
                            {t("superAdmin.delete")}
                          </button>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Gear Tab ─────────────────────────────────────────────────────────────

function GearTab({ t, gear, onRefresh }) {
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({ code: "", label_fr: "", label_en: "" });
  const [adding, setAdding] = useState(false);
  const [newForm, setNewForm] = useState({ code: "", label_fr: "", label_en: "" });
  const [error, setError] = useState("");

  const startEdit = (g) => {
    setEditingId(g.id);
    setEditForm({ code: g.code, label_fr: g.label_fr || "", label_en: g.label_en || "" });
    setError("");
  };

  const saveGear = async (id) => {
    if (!editForm.code.trim()) return;
    const { error: err } = await supabase.from("gear").update({
      code: editForm.code.trim(),
      label_fr: editForm.label_fr.trim(),
      label_en: editForm.label_en.trim(),
    }).eq("id", id);
    if (err) {
      setError(err.code === "23505" ? t("superAdmin.gearCodeDuplicate") : t("superAdmin.saveError"));
      return;
    }
    setEditingId(null);
    onRefresh();
  };

  const addGear = async () => {
    if (!newForm.code.trim()) return;
    const { error: err } = await supabase.from("gear").insert({
      code: newForm.code.trim(),
      label_fr: newForm.label_fr.trim(),
      label_en: newForm.label_en.trim(),
    });
    if (err) {
      setError(err.code === "23505" ? t("superAdmin.gearCodeDuplicate") : t("superAdmin.saveError"));
      return;
    }
    setAdding(false);
    setNewForm({ code: "", label_fr: "", label_en: "" });
    onRefresh();
  };

  const deleteGear = async (g) => {
    if (!window.confirm(t("superAdmin.deleteGearConfirm", { code: g.code }))) return;
    await supabase.from("gear").delete().eq("id", g.id);
    onRefresh();
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-lg font-semibold">{t("superAdmin.tabGear")}</h2>
        <button
          onClick={() => { setAdding(true); setNewForm({ code: "", label_fr: "", label_en: "" }); setError(""); }}
          className="px-3 py-1 bg-blue-600 text-white rounded text-sm hover:bg-blue-700"
        >
          + {t("superAdmin.addGear")}
        </button>
      </div>

      {error && <p className="text-xs text-red-600 mb-3">{error}</p>}

      <table className="w-full border text-sm">
        <thead>
          <tr className="bg-gray-100">
            <th className="border p-2 text-left">{t("superAdmin.gearCode")}</th>
            <th className="border p-2 text-left">{t("superAdmin.gearLabelFr")}</th>
            <th className="border p-2 text-left">{t("superAdmin.gearLabelEn")}</th>
            <th className="border p-2 w-32">{t("superAdmin.actions")}</th>
          </tr>
        </thead>
        <tbody>
          {adding && (
            <tr className="border-t bg-blue-50">
              <td className="border p-1">
                <input className="border rounded p-1 w-full text-sm" placeholder={t("superAdmin.gearCode")} value={newForm.code} onChange={e => setNewForm(f => ({ ...f, code: e.target.value }))} autoFocus />
              </td>
              <td className="border p-1">
                <input className="border rounded p-1 w-full text-sm" placeholder={t("superAdmin.gearLabelFr")} value={newForm.label_fr} onChange={e => setNewForm(f => ({ ...f, label_fr: e.target.value }))} />
              </td>
              <td className="border p-1">
                <input className="border rounded p-1 w-full text-sm" placeholder={t("superAdmin.gearLabelEn")} value={newForm.label_en} onChange={e => setNewForm(f => ({ ...f, label_en: e.target.value }))} />
              </td>
              <td className="border p-1 whitespace-nowrap text-center">
                <button onClick={addGear} className="px-2 py-1 bg-green-600 text-white rounded text-xs mr-1">{t("superAdmin.save")}</button>
                <button onClick={() => setAdding(false)} className="px-2 py-1 border rounded text-xs">{t("superAdmin.cancel")}</button>
              </td>
            </tr>
          )}

          {gear.map(g => (
            <tr key={g.id} className="border-t">
              {editingId === g.id ? (
                <>
                  <td className="border p-1"><input className="border rounded p-1 w-full text-sm" value={editForm.code} onChange={e => setEditForm(f => ({ ...f, code: e.target.value }))} autoFocus /></td>
                  <td className="border p-1"><input className="border rounded p-1 w-full text-sm" value={editForm.label_fr} onChange={e => setEditForm(f => ({ ...f, label_fr: e.target.value }))} /></td>
                  <td className="border p-1"><input className="border rounded p-1 w-full text-sm" value={editForm.label_en} onChange={e => setEditForm(f => ({ ...f, label_en: e.target.value }))} /></td>
                  <td className="border p-1 whitespace-nowrap text-center">
                    <button onClick={() => saveGear(g.id)} className="px-2 py-1 bg-green-600 text-white rounded text-xs mr-1">{t("superAdmin.save")}</button>
                    <button onClick={() => setEditingId(null)} className="px-2 py-1 border rounded text-xs">{t("superAdmin.cancel")}</button>
                  </td>
                </>
              ) : (
                <>
                  <td className="border p-2 font-mono">{g.code}</td>
                  <td className="border p-2">{g.label_fr}</td>
                  <td className="border p-2">{g.label_en}</td>
                  <td className="border p-2 whitespace-nowrap text-center">
                    <button onClick={() => startEdit(g)} className="px-2 py-1 border rounded text-xs mr-1 hover:bg-gray-50">{t("superAdmin.edit")}</button>
                    <button onClick={() => deleteGear(g)} className="px-2 py-1 border rounded text-xs text-red-600 hover:bg-red-50">{t("superAdmin.delete")}</button>
                  </td>
                </>
              )}
            </tr>
          ))}

          {gear.length === 0 && !adding && (
            <tr><td colSpan="4" className="text-center p-4 text-gray-400 text-sm">{t("superAdmin.noGear")}</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

// ─── Marshals Tab ──────────────────────────────────────────────────────────

function MarshalsTab({ t, marshals, onRefresh }) {
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({ firstName: "", lastName: "" });
  const [adding, setAdding] = useState(false);
  const [newForm, setNewForm] = useState({ firstName: "", lastName: "" });
  const [error, setError] = useState("");

  const startEdit = (m) => {
    setEditingId(m.id);
    setEditForm({ firstName: m.firstName, lastName: m.lastName });
    setError("");
  };

  const saveMarshal = async (id) => {
    if (!editForm.firstName.trim() || !editForm.lastName.trim()) return;
    const { error: err } = await supabase.from("marshals").update({
      firstName: editForm.firstName.trim(),
      lastName: editForm.lastName.trim(),
    }).eq("id", id);
    if (err) { setError(t("superAdmin.saveError")); return; }
    setEditingId(null);
    onRefresh();
  };

  const addMarshal = async () => {
    if (!newForm.firstName.trim() || !newForm.lastName.trim()) return;
    const { error: err } = await supabase.from("marshals").insert({
      firstName: newForm.firstName.trim(),
      lastName: newForm.lastName.trim(),
      isActive: true,
    });
    if (err) { setError(t("superAdmin.saveError")); return; }
    setAdding(false);
    setNewForm({ firstName: "", lastName: "" });
    onRefresh();
  };

  const toggleActive = async (m) => {
    await supabase.from("marshals").update({ isActive: !m.isActive }).eq("id", m.id);
    onRefresh();
  };

  const deleteMarshal = async (m) => {
    const fullName = `${m.firstName} ${m.lastName}`;
    if (!window.confirm(t("superAdmin.deleteMarshalConfirm", { name: fullName }))) return;
    await supabase.from("marshals").delete().eq("id", m.id);
    onRefresh();
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-lg font-semibold">{t("superAdmin.tabMarshals")}</h2>
        <button
          onClick={() => { setAdding(true); setNewForm({ firstName: "", lastName: "" }); setError(""); }}
          className="px-3 py-1 bg-blue-600 text-white rounded text-sm hover:bg-blue-700"
        >
          + {t("superAdmin.addMarshal")}
        </button>
      </div>

      {error && <p className="text-xs text-red-600 mb-3">{error}</p>}

      <table className="w-full border text-sm">
        <thead>
          <tr className="bg-gray-100">
            <th className="border p-2 text-left">{t("superAdmin.marshalLastName")}</th>
            <th className="border p-2 text-left">{t("superAdmin.marshalFirstName")}</th>
            <th className="border p-2 text-center w-24">{t("superAdmin.marshalActive")}</th>
            <th className="border p-2 w-36">{t("superAdmin.actions")}</th>
          </tr>
        </thead>
        <tbody>
          {adding && (
            <tr className="border-t bg-blue-50">
              <td className="border p-1">
                <input className="border rounded p-1 w-full text-sm" placeholder={t("superAdmin.marshalLastName")} value={newForm.lastName} onChange={e => setNewForm(f => ({ ...f, lastName: e.target.value }))} autoFocus />
              </td>
              <td className="border p-1">
                <input className="border rounded p-1 w-full text-sm" placeholder={t("superAdmin.marshalFirstName")} value={newForm.firstName} onChange={e => setNewForm(f => ({ ...f, firstName: e.target.value }))} />
              </td>
              <td className="border p-1 text-center text-xs text-gray-400">{t("superAdmin.marshalActive")}</td>
              <td className="border p-1 whitespace-nowrap text-center">
                <button onClick={addMarshal} className="px-2 py-1 bg-green-600 text-white rounded text-xs mr-1">{t("superAdmin.save")}</button>
                <button onClick={() => setAdding(false)} className="px-2 py-1 border rounded text-xs">{t("superAdmin.cancel")}</button>
              </td>
            </tr>
          )}

          {marshals.map(m => (
            <tr key={m.id} className={`border-t ${!m.isActive ? "opacity-50" : ""}`}>
              {editingId === m.id ? (
                <>
                  <td className="border p-1"><input className="border rounded p-1 w-full text-sm" value={editForm.lastName} onChange={e => setEditForm(f => ({ ...f, lastName: e.target.value }))} autoFocus /></td>
                  <td className="border p-1"><input className="border rounded p-1 w-full text-sm" value={editForm.firstName} onChange={e => setEditForm(f => ({ ...f, firstName: e.target.value }))} /></td>
                  <td className="border p-1"></td>
                  <td className="border p-1 whitespace-nowrap text-center">
                    <button onClick={() => saveMarshal(m.id)} className="px-2 py-1 bg-green-600 text-white rounded text-xs mr-1">{t("superAdmin.save")}</button>
                    <button onClick={() => setEditingId(null)} className="px-2 py-1 border rounded text-xs">{t("superAdmin.cancel")}</button>
                  </td>
                </>
              ) : (
                <>
                  <td className="border p-2 font-medium">{m.lastName}</td>
                  <td className="border p-2">{m.firstName}</td>
                  <td className="border p-2 text-center">
                    <button
                      onClick={() => toggleActive(m)}
                      className={`text-xs px-2 py-0.5 rounded ${m.isActive ? "bg-green-100 text-green-700 hover:bg-green-200" : "bg-gray-100 text-gray-500 hover:bg-gray-200"}`}
                    >
                      {m.isActive ? t("superAdmin.marshalActive") : t("superAdmin.marshalInactive")}
                    </button>
                  </td>
                  <td className="border p-2 whitespace-nowrap text-center">
                    <button onClick={() => startEdit(m)} className="px-2 py-1 border rounded text-xs mr-1 hover:bg-gray-50">{t("superAdmin.edit")}</button>
                    <button onClick={() => deleteMarshal(m)} className="px-2 py-1 border rounded text-xs text-red-600 hover:bg-red-50">{t("superAdmin.delete")}</button>
                  </td>
                </>
              )}
            </tr>
          ))}

          {marshals.length === 0 && !adding && (
            <tr><td colSpan="4" className="text-center p-4 text-gray-400 text-sm">{t("superAdmin.noMarshals")}</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

// ─── Main Component ────────────────────────────────────────────────────────

export default function SuperAdminPanel() {
  const { t } = useTranslation();
  const HASH = import.meta.env.VITE_SUPERADMIN_PW_HASH;

  const [ok, setOk] = useState(() => sessionStorage.getItem("superadmin_ok") === "1");
  const [pw, setPw] = useState("");
  const [isAuthing, setIsAuthing] = useState(false);
  const [activeTab, setActiveTab] = useState("events");

  const [events, setEvents] = useState([]);
  const [races, setRaces] = useState([]);
  const [gear, setGear] = useState([]);
  const [marshals, setMarshals] = useState([]);
  const [loadError, setLoadError] = useState("");

  const tryLogin = async (e) => {
    e.preventDefault();
    if (!HASH) { alert(t("superAdmin.authHashMissingAlert")); return; }
    try {
      setIsAuthing(true);
      const hash = await sha256Hex(pw);
      if (hash === HASH) {
        sessionStorage.setItem("superadmin_ok", "1");
        setOk(true);
        setPw("");
      } else {
        alert(t("superAdmin.authWrongPw"));
      }
    } finally {
      setIsAuthing(false);
    }
  };

  const logout = () => {
    sessionStorage.removeItem("superadmin_ok");
    setOk(false);
  };

  const fetchEvents = async () => {
    const { data, error } = await supabase.from("events").select("id, name, isLocked, geolocation_mode").order("name");
    if (error) { setLoadError(t("superAdmin.loadError")); return; }
    setEvents(data || []);
  };

  const fetchRaces = async () => {
    const { data, error } = await supabase.from("races").select("id, event_id, name, range_min, range_max").order("name");
    if (error) { setLoadError(t("superAdmin.loadError")); return; }
    setRaces(data || []);
  };

  const fetchGear = async () => {
    const { data, error } = await supabase.from("gear").select("id, code, label_fr, label_en").order("label_fr");
    if (error) { setLoadError(t("superAdmin.loadError")); return; }
    setGear(data || []);
  };

  const fetchMarshals = async () => {
    const { data, error } = await supabase.from("marshals").select("id, firstName, lastName, isActive").order("lastName");
    if (error) { setLoadError(t("superAdmin.loadError")); return; }
    setMarshals(data || []);
  };

  useEffect(() => {
    if (!ok) return;
    fetchEvents();
    fetchRaces();
    fetchGear();
    fetchMarshals();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ok]);

  const TABS = ["events", "gear", "marshals"];
  const tabLabel = { events: "tabEventsRaces", gear: "tabGear", marshals: "tabMarshals" };

  return (
    <div className="p-4 max-w-4xl mx-auto">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">{t("superAdmin.title")}</h1>
        {ok && (
          <button onClick={logout} className="text-sm px-3 py-1 border rounded hover:bg-gray-50">
            {t("superAdmin.logout")}
          </button>
        )}
      </div>

      {ok && (
        <>
          {loadError && <p className="text-sm text-red-600 mb-4">{loadError}</p>}

          {/* Tab bar */}
          <div className="flex gap-1 mb-6 border-b">
            {TABS.map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition ${
                  activeTab === tab
                    ? "border-blue-600 text-blue-600"
                    : "border-transparent text-gray-500 hover:text-gray-700"
                }`}
              >
                {t(`superAdmin.${tabLabel[tab]}`)}
              </button>
            ))}
          </div>

          {activeTab === "events" && (
            <EventsRacesTab
              t={t}
              events={events}
              races={races}
              onRefreshEvents={fetchEvents}
              onRefreshRaces={fetchRaces}
            />
          )}
          {activeTab === "gear" && (
            <GearTab t={t} gear={gear} onRefresh={fetchGear} />
          )}
          {activeTab === "marshals" && (
            <MarshalsTab t={t} marshals={marshals} onRefresh={fetchMarshals} />
          )}
        </>
      )}

      {/* Auth overlay */}
      {!ok && (
        <div className="fixed inset-0 z-50 bg-white/90 backdrop-blur-sm grid place-items-center p-4">
          <form onSubmit={tryLogin} className="w-full max-w-xs space-y-3 border rounded-lg bg-white p-5 shadow">
            <h1 className="text-lg font-semibold">{t("superAdmin.authTitle")}</h1>
            <p className="text-sm text-gray-600">{t("superAdmin.authDesc")}</p>
            <input
              type="password"
              className="w-full border rounded p-2"
              placeholder={t("superAdmin.authPlaceholder")}
              value={pw}
              onChange={e => setPw(e.target.value)}
              autoFocus
              disabled={isAuthing}
            />
            <button className="w-full bg-blue-600 text-white rounded p-2 disabled:opacity-60" disabled={isAuthing}>
              {isAuthing ? t("superAdmin.authChecking") : t("superAdmin.authEnter")}
            </button>
            {!HASH && (
              <p className="text-xs text-red-600 mt-2">{t("superAdmin.authHashMissing")}</p>
            )}
          </form>
        </div>
      )}
    </div>
  );
}
