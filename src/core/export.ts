/** Neutralizes spreadsheet formulas in textual fields imported from untrusted page content. */
export function toCsv(
  rows: readonly Record<string, unknown>[],
  columns = rows.length ? Object.keys(rows[0]) : [],
): string {
  const cell = (value: unknown) => {
    let text =
      value === undefined || value === null
        ? ""
        : typeof value === "object"
          ? JSON.stringify(value)
          : String(value);
    if (typeof value === "string" && /^[\s]*[=+@-]/.test(text))
      text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  };
  return (
    "\uFEFF" +
    [
      columns.map(cell).join(","),
      ...rows.map((row) =>
        columns.map((column) => cell(row[column])).join(","),
      ),
    ].join("\r\n")
  );
}
