// Pinned to en-US: the server and the reader's browser must render the same text, whatever either machine's locale.
const LOCALE = "en-US";

export const usd = (n: number) =>
  Number(n).toLocaleString(LOCALE, { style: "currency", currency: "USD" });

export const num = (n: number) => Number(n).toLocaleString(LOCALE);

/** Render YYYY-MM-DD as DD-MM-YYYY: parse string not Date to avoid UTC shift, fixed locale for consistency. */
export const day = (isoDay: string) => {
  const [year, month, dayOfMonth] = isoDay.split("-");

  return `${dayOfMonth}-${month}-${year}`;
};

/** A timestamp as day-month-year plus a 24-hour clock, for the same reasons. */
export const stamp = (iso: string) => {
  const t = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");

  return (
    `${pad(t.getDate())}-${pad(t.getMonth() + 1)}-${t.getFullYear()} ` +
    `${pad(t.getHours())}:${pad(t.getMinutes())}`
  );
};
