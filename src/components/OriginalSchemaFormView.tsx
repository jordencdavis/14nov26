import React, { useMemo, useState } from 'react';
import { JsonColorPre, formatJsonWithGroupBreaks } from './JsonColorGroups';
import type { ConfigField } from '../types/app';

interface OriginalSchemaFormViewProps {
  rawJson: string;
  fallbackTitle?: string;
  onChangeJson?: (nextJson: string) => void;
  compact?: boolean;
}

export const OriginalSchemaFormView: React.FC<OriginalSchemaFormViewProps> = ({
  rawJson,
  fallbackTitle = 'Configuration',
  onChangeJson,
  compact = false,
}) => {
  const [includedFields, setIncludedFields] = useState<Record<string, boolean>>({});
  const [localValues, setLocalValues] = useState<Record<string, unknown>>({});

  const parsedResult = useMemo(() => {
    try {
      const parsed = JSON.parse(rawJson) as unknown;
      return { ok: true as const, data: parsed, error: null };
    } catch (err) {
      return {
        ok: false as const,
        data: null,
        error: err instanceof Error ? err.message : 'Invalid JSON',
      };
    }
  }, [rawJson]);

  if (!parsedResult.ok || !parsedResult.data || typeof parsedResult.data !== 'object') {
    return (
      <div
        className="flex-1 p-3 border text-xs bg-amber-50/70"
        style={{ borderColor: '#fcd34d', color: '#92400e' }}
      >
        <div className="font-bold mb-1">⚠ Unable to render Original Tick-Box View</div>
        <div className="font-mono text-[11px]">
          {parsedResult.error ?? 'JSON root must be an object or schema.'}
        </div>
      </div>
    );
  }

  if (Array.isArray(parsedResult.data)) {
    return (
      <div
        className="flex-1 overflow-auto p-3 border text-xs bg-white space-y-1.5"
        style={{ borderColor: '#cbd5e1' }}
      >
        <div className="font-bold text-slate-900 mb-2">
          ⚙ {fallbackTitle} ({parsedResult.data.length} items)
        </div>
        {parsedResult.data.map((item, idx) => (
          <div
            key={idx}
            className="p-2 border border-slate-200 bg-slate-50 font-mono text-[11px]"
          >
            [{idx + 1}] {typeof item === 'object' ? JSON.stringify(item) : String(item)}
          </div>
        ))}
      </div>
    );
  }

  const record = parsedResult.data as Record<string, unknown>;
  const isSchema = Array.isArray(record.fields);
  const isSingleField =
    !isSchema && typeof record.id === 'string' && typeof record.type === 'string';

  if (isSchema || isSingleField) {
    const rawFields = isSchema
      ? (record.fields as ConfigField[])
      : ([record as unknown as ConfigField] as ConfigField[]);

    const seen = new Set<string>();
    const uniqueFields: ConfigField[] = [];
    for (const f of rawFields) {
      if (!f || typeof f !== 'object') continue;
      const fid = String(f.id ?? `field_${uniqueFields.length + 1}`);
      if (!seen.has(fid)) {
        seen.add(fid);
        uniqueFields.push({ ...f, id: fid, label: f.label || fid });
      }
    }

    const includedCount = uniqueFields.filter(
      (f) => includedFields[f.id] !== false
    ).length;

    const getFieldVal = (f: ConfigField): string | number | string[] => {
      if (f.id in localValues && !onChangeJson) {
        return localValues[f.id] as string | number | string[];
      }
      if (f.default !== undefined) return f.default;
      if (f.type === 'checkbox_group') return [];
      if (f.type === 'number') return f.min ?? 1;
      if (f.type === 'select') return f.options?.[0] ?? '';
      return '';
    };

    const commitFieldDefault = (
      fieldId: string,
      nextDefault: string | number | string[]
    ) => {
      if (!onChangeJson) {
        setLocalValues((prev) => ({ ...prev, [fieldId]: nextDefault }));
        return;
      }
      if (isSchema) {
        const nextFields = (record.fields as ConfigField[]).map((f) =>
          f && f.id === fieldId ? { ...f, default: nextDefault } : f
        );
        onChangeJson(JSON.stringify({ ...record, fields: nextFields }, null, 2));
      } else {
        onChangeJson(JSON.stringify({ ...record, default: nextDefault }, null, 2));
      }
    };

    const setAllIncluded = (val: boolean) => {
      const next: Record<string, boolean> = {};
      for (const f of uniqueFields) next[f.id] = val;
      setIncludedFields(next);
    };

    const titleText =
      typeof record.tab_title === 'string' && record.tab_title.trim()
        ? record.tab_title
        : isSingleField
          ? String(record.label ?? fallbackTitle)
          : fallbackTitle;

    return (
      <div
        className="flex-1 min-h-0 flex flex-col border bg-white overflow-hidden"
        style={{ borderColor: '#cbd5e1' }}
      >
        {/* Original Header Card */}
        <div
          className={`${compact ? 'p-2' : 'p-2.5'} border-b shrink-0`}
          style={{ backgroundColor: '#fcefef', borderColor: '#e2e8f0' }}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs font-bold" style={{ color: '#0f172a' }}>
              ⚙ {titleText} Parameters
            </div>
            {!onChangeJson && Object.keys(localValues).length > 0 && (
              <button
                type="button"
                onClick={() => setLocalValues({})}
                className="px-2 py-0.5 text-[10px] font-bold bg-white border border-slate-300 text-slate-600 cursor-pointer hover:bg-slate-100"
              >
                ↺ Reset Preview
              </button>
            )}
          </div>
          {typeof record.description === 'string' && record.description.trim() && (
            <div className="text-[11px] mt-0.5" style={{ color: '#475569' }}>
              {record.description}
            </div>
          )}
          <div className="flex flex-wrap items-center justify-between gap-2 mt-1.5 pt-1.5 border-t border-slate-200/80">
            <span className="text-[11px] font-semibold" style={{ color: '#0f766e' }}>
              ☑ Included in JSON: {includedCount} / {uniqueFields.length} items
            </span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setAllIncluded(true)}
                className="px-2 py-0.5 text-[11px] font-bold cursor-pointer hover:bg-emerald-100"
                style={{ backgroundColor: '#ecfdf5', color: '#047857' }}
                title="Tick all items to include"
              >
                ✓ Select All
              </button>
              <button
                type="button"
                onClick={() => setAllIncluded(false)}
                className="px-2 py-0.5 text-[11px] font-bold cursor-pointer hover:bg-slate-200"
                style={{ backgroundColor: '#f1f5f9', color: '#475569' }}
                title="Untick all items to exclude"
              >
                ☐ Clear All
              </button>
            </div>
          </div>
        </div>

        {/* Scrollable Fields Tick-Box Body */}
        <div
          className={`flex-1 overflow-y-auto ${compact ? 'p-2.5 space-y-3' : 'p-3 space-y-4'}`}
          style={{ backgroundColor: '#fff2f2' }}
        >
          {uniqueFields.length === 0 ? (
            <div className="py-6 text-center text-xs text-slate-500 bg-white border border-slate-200">
              No fields configured in this schema.
            </div>
          ) : (
            uniqueFields.map((field) => {
              const isIncluded = includedFields[field.id] !== false;
              const currentVal = getFieldVal(field);

              return (
                <div
                  key={field.id}
                  className={`pb-3 border-b border-slate-200/70 last:border-b-0 transition-opacity ${
                    isIncluded ? '' : 'opacity-60'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 mb-1.5 flex-wrap">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <input
                        type="checkbox"
                        checked={isIncluded}
                        onChange={() =>
                          setIncludedFields((prev) => ({
                            ...prev,
                            [field.id]: !isIncluded,
                          }))
                        }
                        className="accent-[#16a34a] cursor-pointer w-3.5 h-3.5 shrink-0"
                        title={
                          isIncluded
                            ? `Included — uncheck to exclude '${field.label}'`
                            : `Excluded — check to include '${field.label}'`
                        }
                      />
                      <span
                        onClick={() =>
                          setIncludedFields((prev) => ({
                            ...prev,
                            [field.id]: !isIncluded,
                          }))
                        }
                        className={`text-xs font-bold cursor-pointer select-none ${
                          isIncluded ? '' : 'line-through'
                        }`}
                        style={{ color: isIncluded ? '#0f172a' : '#64748b' }}
                      >
                        {field.label}
                      </span>
                      {!isIncluded && (
                        <span
                          className="px-1.5 py-0.5 text-[10px] font-bold"
                          style={{ backgroundColor: '#fef2f2', color: '#dc2626' }}
                        >
                          Excluded
                        </span>
                      )}
                      {field.help && (
                        <span className="text-[11px] italic" style={{ color: '#64748b' }}>
                          ({field.help})
                        </span>
                      )}
                    </div>

                    {field.type === 'checkbox_group' && (field.options ?? []).length > 0 && (
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          disabled={!isIncluded}
                          onClick={() =>
                            commitFieldDefault(field.id, [...(field.options ?? [])])
                          }
                          className="px-1.5 py-0.5 text-[10px] font-bold cursor-pointer disabled:opacity-40"
                          style={{ backgroundColor: '#ecfdf5', color: '#047857' }}
                        >
                          ✓ All
                        </button>
                        <button
                          type="button"
                          disabled={!isIncluded}
                          onClick={() => commitFieldDefault(field.id, [])}
                          className="px-1.5 py-0.5 text-[10px] font-bold cursor-pointer disabled:opacity-40"
                          style={{ backgroundColor: '#f1f5f9', color: '#475569' }}
                        >
                          ☐ None
                        </button>
                      </div>
                    )}
                  </div>

                  <div className={isIncluded ? '' : 'opacity-50 pointer-events-none'}>
                    {field.type === 'checkbox_group' && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-1.5 pt-1">
                        {(field.options ?? []).map((opt) => {
                          const selectedArr = Array.isArray(currentVal)
                            ? currentVal.map(String)
                            : [];
                          const checked = selectedArr.includes(opt);
                          return (
                            <label
                              key={opt}
                              className="flex items-center gap-2 text-xs cursor-pointer"
                              style={{ color: '#0f172a' }}
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                disabled={!isIncluded}
                                onChange={() => {
                                  const nextArr = checked
                                    ? selectedArr.filter((x) => x !== opt)
                                    : [...selectedArr, opt];
                                  commitFieldDefault(field.id, nextArr);
                                }}
                                className="accent-[#2563eb] cursor-pointer"
                              />
                              <span className="font-mono text-[11px] truncate">
                                {opt}
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    )}

                    {field.type === 'number' && (
                      <input
                        type="number"
                        disabled={!isIncluded}
                        min={field.min ?? 1}
                        max={field.max ?? 100000}
                        value={Number(currentVal ?? field.default ?? 1)}
                        onChange={(e) =>
                          commitFieldDefault(field.id, Number(e.target.value))
                        }
                        className="w-32 px-2.5 py-1 text-xs border bg-white disabled:bg-slate-100"
                        style={{ borderColor: '#cbd5e1', color: '#0f172a' }}
                      />
                    )}

                    {field.type === 'select' && (
                      <select
                        disabled={!isIncluded}
                        value={String(currentVal ?? field.default ?? field.options?.[0] ?? '')}
                        onChange={(e) => commitFieldDefault(field.id, e.target.value)}
                        className="w-full max-w-xs px-2.5 py-1 text-xs border bg-white disabled:bg-slate-100"
                        style={{ borderColor: '#cbd5e1', color: '#0f172a' }}
                      >
                        {(field.options ?? []).map((opt) => (
                          <option key={opt} value={opt}>
                            {opt}
                          </option>
                        ))}
                      </select>
                    )}

                    {field.type === 'text' && (
                      <input
                        type="text"
                        disabled={!isIncluded}
                        value={String(currentVal ?? field.default ?? '')}
                        onChange={(e) => commitFieldDefault(field.id, e.target.value)}
                        className="w-full max-w-sm px-2.5 py-1 text-xs border bg-white disabled:bg-slate-100"
                        style={{ borderColor: '#cbd5e1', color: '#0f172a' }}
                      />
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    );
  }

  // Generic Object JSON -> Interactive Key-Value / Tick-Box Original View
  const entries = Object.entries(record);
  const includedKeyCount = entries.filter(([k]) => includedFields[k] !== false).length;

  const commitObjectKey = (key: string, nextVal: unknown) => {
    if (!onChangeJson) {
      setLocalValues((prev) => ({ ...prev, [key]: nextVal }));
      return;
    }
    onChangeJson(JSON.stringify({ ...record, [key]: nextVal }, null, 2));
  };

  return (
    <div
      className="flex-1 min-h-0 flex flex-col border bg-white overflow-hidden"
      style={{ borderColor: '#cbd5e1' }}
    >
      <div
        className={`${compact ? 'p-2' : 'p-2.5'} border-b shrink-0`}
        style={{ backgroundColor: '#fcefef', borderColor: '#e2e8f0' }}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-xs font-bold" style={{ color: '#0f172a' }}>
            ⚙ {fallbackTitle} Properties
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => {
                const next: Record<string, boolean> = {};
                for (const [k] of entries) next[k] = true;
                setIncludedFields(next);
              }}
              className="px-2 py-0.5 text-[11px] font-bold cursor-pointer hover:bg-emerald-100"
              style={{ backgroundColor: '#ecfdf5', color: '#047857' }}
            >
              ✓ Select All
            </button>
            <button
              type="button"
              onClick={() => {
                const next: Record<string, boolean> = {};
                for (const [k] of entries) next[k] = false;
                setIncludedFields(next);
              }}
              className="px-2 py-0.5 text-[11px] font-bold cursor-pointer hover:bg-slate-200"
              style={{ backgroundColor: '#f1f5f9', color: '#475569' }}
            >
              ☐ Clear All
            </button>
          </div>
        </div>
        <div className="text-[11px] font-semibold mt-1" style={{ color: '#0f766e' }}>
          ☑ Included Keys: {includedKeyCount} / {entries.length}
        </div>
      </div>

      <div
        className={`flex-1 overflow-y-auto ${compact ? 'p-2.5 space-y-2.5' : 'p-3 space-y-3'}`}
        style={{ backgroundColor: '#fff2f2' }}
      >
        {entries.map(([key, rawVal]) => {
          const isIncluded = includedFields[key] !== false;
          const val = !onChangeJson && key in localValues ? localValues[key] : rawVal;

          return (
            <div
              key={key}
              className={`pb-2 border-b border-slate-200/70 last:border-b-0 ${
                isIncluded ? '' : 'opacity-60'
              }`}
            >
              <div className="flex items-center gap-1.5 mb-1">
                <input
                  type="checkbox"
                  checked={isIncluded}
                  onChange={() =>
                    setIncludedFields((prev) => ({ ...prev, [key]: !isIncluded }))
                  }
                  className="accent-[#16a34a] cursor-pointer w-3.5 h-3.5 shrink-0"
                />
                <span
                  onClick={() =>
                    setIncludedFields((prev) => ({ ...prev, [key]: !isIncluded }))
                  }
                  className={`text-xs font-bold font-mono cursor-pointer ${
                    isIncluded ? '' : 'line-through'
                  }`}
                  style={{ color: isIncluded ? '#0f172a' : '#64748b' }}
                >
                  {key}
                </span>
                {!isIncluded && (
                  <span
                    className="px-1.5 py-0.5 text-[10px] font-bold"
                    style={{ backgroundColor: '#fef2f2', color: '#dc2626' }}
                  >
                    Excluded
                  </span>
                )}
              </div>

              <div className={isIncluded ? 'pl-5' : 'pl-5 opacity-50 pointer-events-none'}>
                {typeof val === 'boolean' ? (
                  <label className="inline-flex items-center gap-2 text-xs cursor-pointer">
                    <input
                      type="checkbox"
                      checked={val}
                      disabled={!isIncluded}
                      onChange={(e) => commitObjectKey(key, e.target.checked)}
                      className="accent-[#2563eb] cursor-pointer"
                    />
                    <span className="font-mono text-[11px] text-slate-700">
                      {val ? 'true (Enabled)' : 'false (Disabled)'}
                    </span>
                  </label>
                ) : typeof val === 'number' ? (
                  <input
                    type="number"
                    disabled={!isIncluded}
                    value={val}
                    onChange={(e) => commitObjectKey(key, Number(e.target.value))}
                    className="w-32 px-2 py-1 text-xs border bg-white font-mono"
                    style={{ borderColor: '#cbd5e1', color: '#0f172a' }}
                  />
                ) : Array.isArray(val) ? (
                  <div className="space-y-1">
                    {val.map((item, idx) => (
                      <div
                        key={idx}
                        className="p-1.5 border border-slate-200 bg-white font-mono text-[11px] text-slate-800"
                      >
                        {typeof item === 'object' && item !== null ? (
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-0.5">
                            {Object.entries(item as Record<string, unknown>).map(([ik, iv]) => (
                              <div key={ik} className="truncate">
                                <span className="text-slate-500">{ik}:</span>{' '}
                                <span className="font-semibold">{String(iv)}</span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <span>
                            {idx + 1}. {String(item)}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                ) : typeof val === 'object' && val !== null ? (
                  <JsonColorPre
                    json={formatJsonWithGroupBreaks(JSON.stringify(val, null, 2))}
                    showGroupControls={Boolean(onChangeJson)}
                    onChangeJson={
                      onChangeJson
                        ? (nextSub) => {
                            try {
                              commitObjectKey(key, JSON.parse(nextSub));
                            } catch {
                              // ignore invalid intermediate JSON
                            }
                          }
                        : undefined
                    }
                    className="p-1.5 border border-slate-200 bg-white font-mono text-[11px] overflow-auto"
                  />
                ) : (
                  <input
                    type="text"
                    disabled={!isIncluded}
                    value={String(val ?? '')}
                    onChange={(e) => commitObjectKey(key, e.target.value)}
                    className="w-full max-w-md px-2 py-1 text-xs border bg-white font-mono"
                    style={{ borderColor: '#cbd5e1', color: '#0f172a' }}
                  />
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
