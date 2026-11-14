export interface IncomingPart {
  id: string;
  kind: 'row' | 'params' | 'meta' | 'entry' | 'array_item' | 'line';
  label: string;
  key?: string;
  value: unknown;
  defaultSelected: boolean;
}

export interface DualClipboardPayload {
  json: string;
  text: string;
  partCount: number;
}

export function isValidJsonString(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed) return false;
  try {
    JSON.parse(trimmed);
    return true;
  } catch {
    return false;
  }
}

function summarizeRecord(rec: unknown): string {
  if (rec === null || rec === undefined) return String(rec);
  if (typeof rec !== 'object' || Array.isArray(rec)) return String(rec);
  const entries = Object.entries(rec as Record<string, unknown>);
  if (entries.length === 0) return '{}';
  return entries
    .slice(0, 3)
    .map(([k, v]) => `${k}: ${String(v ?? '')}`)
    .join(' | ');
}

export function parseIncomingParts(raw: string): IncomingPart[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const obj = parsed as Record<string, unknown>;
      if (Array.isArray(obj.data)) {
        const parts: IncomingPart[] = [];
        obj.data.forEach((row, idx) => {
          parts.push({
            id: `row_${idx}`,
            kind: 'row',
            label: `Row ${idx + 1}: ${summarizeRecord(row)}`,
            value: row,
            defaultSelected: true,
          });
        });
        if (
          obj.parameters_applied &&
          typeof obj.parameters_applied === 'object' &&
          Object.keys(obj.parameters_applied as Record<string, unknown>).length > 0
        ) {
          parts.push({
            id: 'params',
            kind: 'params',
            label: `Parameters Applied (${Object.keys(obj.parameters_applied as Record<string, unknown>).length} keys)`,
            value: obj.parameters_applied,
            defaultSelected: false,
          });
        }
        if (obj.metadata && typeof obj.metadata === 'object') {
          parts.push({
            id: 'meta',
            kind: 'meta',
            label: `Metadata (${String((obj.metadata as Record<string, unknown>).tab_id ?? 'info')})`,
            value: obj.metadata,
            defaultSelected: false,
          });
        }
        if (parts.length > 0) return parts;
      }
      return Object.entries(obj).map(([k, v], idx) => ({
        id: `entry_${idx}_${k}`,
        kind: 'entry',
        key: k,
        label: `${k}: ${typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v ?? '')}`,
        value: v,
        defaultSelected: true,
      }));
    }
    if (Array.isArray(parsed)) {
      return parsed.map((item, idx) => ({
        id: `item_${idx}`,
        kind: 'array_item',
        label: `[${idx + 1}] ${summarizeRecord(item)}`,
        value: item,
        defaultSelected: true,
      }));
    }
  } catch {
    // plain text fallback
  }

  return trimmed
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0)
    .map((line, idx) => ({
      id: `line_${idx}`,
      kind: 'line' as const,
      label: line,
      value: line,
      defaultSelected: true,
    }));
}

function objectToReadableLines(obj: Record<string, unknown>): string {
  return Object.entries(obj)
    .map(([k, v]) => {
      const valStr =
        v !== null && typeof v === 'object' ? JSON.stringify(v) : String(v ?? '');
      return `${k}: ${valStr}`;
    })
    .join(' | ');
}

export function jsonToSnippetText(rawJson: string): string {
  const trimmed = rawJson.trim();
  if (!trimmed) return '';
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return rawJson;
  }

  if (Array.isArray(parsed)) {
    return parsed
      .map((item) =>
        item && typeof item === 'object' && !Array.isArray(item)
          ? objectToReadableLines(item as Record<string, unknown>)
          : String(item ?? '')
      )
      .join('\n');
  }

  if (parsed && typeof parsed === 'object') {
    const obj = parsed as Record<string, unknown>;
    if (
      Array.isArray(obj.data) ||
      obj.metadata !== undefined ||
      obj.parameters_applied !== undefined
    ) {
      const blocks: string[] = [];
      if (obj.metadata && typeof obj.metadata === 'object') {
        blocks.push(
          '[Metadata]\n' +
            Object.entries(obj.metadata as Record<string, unknown>)
              .map(([k, v]) => `  ${k}: ${String(v ?? '')}`)
              .join('\n')
        );
      }
      if (
        obj.parameters_applied &&
        typeof obj.parameters_applied === 'object' &&
        Object.keys(obj.parameters_applied as Record<string, unknown>).length > 0
      ) {
        blocks.push(
          '[Parameters Applied]\n' +
            Object.entries(obj.parameters_applied as Record<string, unknown>)
              .map(
                ([k, v]) =>
                  `  ${k}: ${Array.isArray(v) ? v.join(', ') : String(v ?? '')}`
              )
              .join('\n')
        );
      }
      if (Array.isArray(obj.data)) {
        for (const row of obj.data) {
          if (row && typeof row === 'object' && !Array.isArray(row)) {
            blocks.push(objectToReadableLines(row as Record<string, unknown>));
          } else {
            blocks.push(String(row ?? ''));
          }
        }
      }
      return blocks.join('\n');
    }

    if (obj.notes !== undefined && Object.keys(obj).length === 1) {
      return Array.isArray(obj.notes)
        ? obj.notes.map((n) => String(n ?? '')).join('\n')
        : String(obj.notes ?? '');
    }

    return objectToReadableLines(obj);
  }

  return String(parsed ?? '');
}

function parseScalarValue(raw: string): unknown {
  const t = raw.trim();
  if (t === 'true') return true;
  if (t === 'false') return false;
  if (t === 'null') return null;
  if (/^-?\d+(\.\d+)?$/.test(t)) {
    const n = Number(t);
    if (Number.isFinite(n)) return n;
  }
  if (
    (t.startsWith('{') && t.endsWith('}')) ||
    (t.startsWith('[') && t.endsWith(']'))
  ) {
    try {
      return JSON.parse(t);
    } catch {
      return t;
    }
  }
  return t;
}

export function textToJsonString(rawText: string): string {
  const trimmed = rawText.trim();
  if (!trimmed) return '';
  try {
    const alreadyJson = JSON.parse(trimmed);
    return JSON.stringify(alreadyJson, null, 2);
  } catch {
    // convert structured or plain text into valid JSON
  }

  const lines = trimmed
    .split('\n')
    .map((l) => l.trim())
    .filter(
      (l) =>
        l.length > 0 &&
        !/^[═─█·]+$/.test(l) &&
        !l.startsWith('TAB :') &&
        !l.startsWith('PROJECT :') &&
        !l.startsWith('WINDOW') &&
        !l.startsWith('Generation Parameters Applied')
    );

  if (lines.length === 0) {
    return JSON.stringify({ notes: trimmed }, null, 2);
  }

  // Detect pipe-separated key:value records (e.g. "id: 1 | name: foo")
  const pipeRecords: Array<Record<string, unknown>> = [];
  let allPipeKeyVal = true;
  for (const line of lines) {
    if (!line.includes('|') || !line.includes(':')) {
      allPipeKeyVal = false;
      break;
    }
    const segs = line.split('|').map((s) => s.trim()).filter(Boolean);
    const rec: Record<string, unknown> = {};
    let validSegs = 0;
    for (const seg of segs) {
      const colonIdx = seg.indexOf(':');
      if (colonIdx > 0) {
        const k = seg.slice(0, colonIdx).trim();
        const v = seg.slice(colonIdx + 1).trim();
        if (k) {
          rec[k] = parseScalarValue(v);
          validSegs++;
        }
      }
    }
    if (validSegs === 0) {
      allPipeKeyVal = false;
      break;
    }
    pipeRecords.push(rec);
  }

  if (allPipeKeyVal && pipeRecords.length > 0) {
    return JSON.stringify(
      pipeRecords.length === 1 ? pipeRecords[0] : pipeRecords,
      null,
      2
    );
  }

  // Detect key: value lines
  const kvObj: Record<string, unknown> = {};
  let kvCount = 0;
  for (const line of lines) {
    const colonIdx = line.indexOf(':');
    if (colonIdx > 0 && colonIdx < 48) {
      const key = line.slice(0, colonIdx).trim();
      const val = line.slice(colonIdx + 1).trim();
      if (key && /^[a-zA-Z0-9_.\- ]+$/.test(key)) {
        kvObj[key.replace(/\s+/g, '_')] = parseScalarValue(val);
        kvCount++;
      }
    }
  }

  if (kvCount === lines.length && kvCount > 0) {
    return JSON.stringify(kvObj, null, 2);
  }

  return JSON.stringify(
    { notes: lines.length === 1 ? lines[0] : lines },
    null,
    2
  );
}

export function serializeSelectedIncomingDual(
  parts: IncomingPart[],
  selectedSet: Set<string>
): DualClipboardPayload {
  const chosen = parts.filter((p) => selectedSet.has(p.id));
  if (chosen.length === 0) {
    return { json: '', text: '', partCount: 0 };
  }

  // Build JSON representation
  let jsonStr = '';
  if (chosen.every((p) => p.kind === 'line')) {
    const lineVals = chosen.map((p) => String(p.value));
    jsonStr = textToJsonString(lineVals.join('\n'));
  } else {
    const rows = chosen.filter((p) => p.kind === 'row').map((p) => p.value);
    const params = chosen.find((p) => p.kind === 'params')?.value;
    const meta = chosen.find((p) => p.kind === 'meta')?.value;

    if (chosen.every((p) => p.kind === 'row')) {
      jsonStr = JSON.stringify(rows.length === 1 ? rows[0] : rows, null, 2);
    } else if (rows.length > 0 || params !== undefined || meta !== undefined) {
      const out: Record<string, unknown> = {};
      if (meta !== undefined) out.metadata = meta;
      if (params !== undefined) out.parameters_applied = params;
      if (rows.length > 0) out.data = rows;
      jsonStr = JSON.stringify(out, null, 2);
    } else if (chosen.every((p) => p.kind === 'entry' && p.key)) {
      const out: Record<string, unknown> = {};
      for (const p of chosen) {
        if (p.key) out[p.key] = p.value;
      }
      jsonStr = JSON.stringify(out, null, 2);
    } else {
      const vals = chosen.map((p) => p.value);
      jsonStr = JSON.stringify(vals.length === 1 ? vals[0] : vals, null, 2);
    }
  }

  // Build Text representation
  const textStr = chosen
    .map((p) => {
      if (p.kind === 'line') return String(p.value);
      if (p.kind === 'entry' && p.key) {
        const val =
          typeof p.value === 'object' && p.value !== null
            ? JSON.stringify(p.value)
            : String(p.value ?? '');
        return `${p.key}: ${val}`;
      }
      if (p.kind === 'params' && p.value && typeof p.value === 'object') {
        return (
          '[Parameters Applied]\n' +
          Object.entries(p.value as Record<string, unknown>)
            .map(
              ([k, v]) =>
                `  ${k}: ${Array.isArray(v) ? v.join(', ') : String(v ?? '')}`
            )
            .join('\n')
        );
      }
      if (p.kind === 'meta' && p.value && typeof p.value === 'object') {
        return (
          '[Metadata]\n' +
          Object.entries(p.value as Record<string, unknown>)
            .map(([k, v]) => `  ${k}: ${String(v ?? '')}`)
            .join('\n')
        );
      }
      if (p.value && typeof p.value === 'object' && !Array.isArray(p.value)) {
        return objectToReadableLines(p.value as Record<string, unknown>);
      }
      return String(p.value ?? '');
    })
    .join('\n');

  return { json: jsonStr, text: textStr, partCount: chosen.length };
}

export function mergeJsonStrings(existingRaw: string, incomingRaw: string): string {
  const existingTrimmed = existingRaw.trim();
  const incomingTrimmed = incomingRaw.trim();
  if (!incomingTrimmed) return existingRaw;

  let incomingParsed: unknown;
  try {
    incomingParsed = JSON.parse(incomingTrimmed);
  } catch {
    incomingParsed = JSON.parse(textToJsonString(incomingTrimmed));
  }

  if (!existingTrimmed) {
    return JSON.stringify(incomingParsed, null, 2);
  }

  let existingParsed: unknown;
  try {
    existingParsed = JSON.parse(existingTrimmed);
  } catch {
    // Existing window content was plain text; convert to structured JSON and merge
    existingParsed = JSON.parse(textToJsonString(existingTrimmed));
  }

  if (Array.isArray(existingParsed)) {
    if (Array.isArray(incomingParsed)) {
      return JSON.stringify([...existingParsed, ...incomingParsed], null, 2);
    }
    if (
      incomingParsed &&
      typeof incomingParsed === 'object' &&
      Array.isArray((incomingParsed as Record<string, unknown>).data)
    ) {
      return JSON.stringify(
        [...existingParsed, ...((incomingParsed as Record<string, unknown>).data as unknown[])],
        null,
        2
      );
    }
    return JSON.stringify([...existingParsed, incomingParsed], null, 2);
  }

  if (existingParsed && typeof existingParsed === 'object') {
    const existingObj = existingParsed as Record<string, unknown>;

    if (Array.isArray(existingObj.data)) {
      let incomingRows: unknown[] = [];
      let incomingMeta: Record<string, unknown> | undefined;
      let incomingParams: Record<string, unknown> | undefined;

      if (Array.isArray(incomingParsed)) {
        incomingRows = incomingParsed;
      } else if (incomingParsed && typeof incomingParsed === 'object') {
        const incObj = incomingParsed as Record<string, unknown>;
        if (Array.isArray(incObj.data)) {
          incomingRows = incObj.data;
        } else if (!incObj.metadata && !incObj.parameters_applied) {
          incomingRows = [incObj];
        }
        if (incObj.metadata && typeof incObj.metadata === 'object') {
          incomingMeta = incObj.metadata as Record<string, unknown>;
        }
        if (
          incObj.parameters_applied &&
          typeof incObj.parameters_applied === 'object'
        ) {
          incomingParams = incObj.parameters_applied as Record<string, unknown>;
        }
      } else {
        incomingRows = [{ value: incomingParsed }];
      }

      const nextData = [...existingObj.data, ...incomingRows];
      const nextObj: Record<string, unknown> = { ...existingObj, data: nextData };
      if (existingObj.metadata && typeof existingObj.metadata === 'object') {
        nextObj.metadata = {
          ...(existingObj.metadata as Record<string, unknown>),
          ...(incomingMeta ?? {}),
          record_count: nextData.length,
        };
      } else if (incomingMeta) {
        nextObj.metadata = { ...incomingMeta, record_count: nextData.length };
      }
      if (incomingParams) {
        nextObj.parameters_applied = {
          ...((existingObj.parameters_applied as Record<string, unknown>) ?? {}),
          ...incomingParams,
        };
      }
      return JSON.stringify(nextObj, null, 2);
    }

    if (Array.isArray(incomingParsed)) {
      return JSON.stringify([existingObj, ...incomingParsed], null, 2);
    }

    if (incomingParsed && typeof incomingParsed === 'object') {
      const incObj = incomingParsed as Record<string, unknown>;
      if (Array.isArray(incObj.data)) {
        return JSON.stringify(
          {
            ...existingObj,
            ...incObj,
            data: incObj.data,
          },
          null,
          2
        );
      }

      // If existing and incoming are two records sharing keys (e.g. Row 1 + Row 2), keep both in an array
      const existingKeys = Object.keys(existingObj);
      const incKeys = Object.keys(incObj);
      const overlaps = incKeys.filter((k) => existingKeys.includes(k));
      if (
        overlaps.length > 0 &&
        existingKeys.length > 0 &&
        overlaps.length >= Math.min(existingKeys.length, incKeys.length) * 0.5 &&
        !existingObj.notes
      ) {
        return JSON.stringify([existingObj, incObj], null, 2);
      }

      if (
        existingObj.notes !== undefined &&
        incObj.notes !== undefined
      ) {
        const a = Array.isArray(existingObj.notes)
          ? existingObj.notes
          : [existingObj.notes];
        const b = Array.isArray(incObj.notes) ? incObj.notes : [incObj.notes];
        return JSON.stringify(
          { ...existingObj, ...incObj, notes: [...a, ...b] },
          null,
          2
        );
      }

      return JSON.stringify({ ...existingObj, ...incObj }, null, 2);
    }
  }

  return JSON.stringify([existingParsed, incomingParsed], null, 2);
}
