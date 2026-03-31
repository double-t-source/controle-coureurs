export default function LangSegmented({ value, onChange }) {
  return (
    <fieldset aria-label="Language" className="select-none">
      <legend className="sr-only">Language</legend>
      <div className="inline-flex items-center gap-1 rounded-full border bg-white p-1 shadow">
        {["fr", "en"].map((lang) => {
          const active = value === lang;
          return (
            <label
              key={lang}
              className={[
                "cursor-pointer rounded-full px-3 py-1 text-sm font-medium transition",
                active ? "bg-blue-600 text-white shadow" : "text-gray-600 hover:bg-gray-100",
              ].join(" ")}
            >
              <input
                type="radio"
                name="language"
                value={lang}
                checked={active}
                onChange={() => onChange(lang)}
                className="sr-only"
              />
              {lang.toUpperCase()}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
