export type Row = Record<string, string>;

export function parseCsv(text: string): Row[] {
  const records = parseRecords(text.replace(/^\uFEFF/, ""));
  const header = records.shift();
  if (!header) return [];
  return records
    .filter((record) => record.length > 1 || record[0] !== "")
    .map((record) => Object.fromEntries(header.map((name, index) => [name, record[index] ?? ""])));
}

function parseRecords(text: string): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      record.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i++;
      record.push(field);
      records.push(record);
      record = [];
      field = "";
    } else {
      field += char;
    }
  }
  if (field !== "" || record.length) {
    record.push(field);
    records.push(record);
  }
  return records;
}

function escape(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

export function formatCsv(columns: readonly string[], rows: readonly Row[]): string {
  const lines = [columns.join(",")];
  for (const row of rows) lines.push(columns.map((column) => escape(row[column] ?? "")).join(","));
  return lines.join("\n") + "\n";
}
