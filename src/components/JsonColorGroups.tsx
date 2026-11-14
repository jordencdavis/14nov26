import React, { useMemo, useRef, useState } from 'react';

export interface JsonGroupTheme {
  name: string;
  accent: string;
  bg: string;
  badgeBg: string;
  border: string;
  keyColor: string;
}

export const JSON_GROUP_PALETTE: JsonGroupTheme[] = [
  {
    name: 'indigo',
    accent: '#4f46e5',
    bg: 'rgba(79, 70, 229, 0.08)',
    badgeBg: '#eef2ff',
    border: '#c7d2fe',
    keyColor: '#3730a3',
  },
  {
    name: 'emerald',
    accent: '#059669',
    bg: 'rgba(5, 150, 105, 0.08)',
    badgeBg: '#ecfdf5',
    border: '#a7f3d0',
    keyColor: '#065f46',
  },
  {
    name: 'amber',
    accent: '#d97706',
    bg: 'rgba(217, 119, 6, 0.09)',
    badgeBg: '#fffbeb',
    border: '#fde68a',
    keyColor: '#92400e',
  },
  {
    name: 'rose',
    accent: '#e11d48',
    bg: 'rgba(225, 29, 72, 0.08)',
    badgeBg: '#fff1f2',
    border: '#fecdd3',
    keyColor: '#9f1239',
  },
  {
    name: 'cyan',
    accent: '#0891b2',
    bg: 'rgba(8, 145, 178, 0.08)',
    badgeBg: '#ecfeff',
    border: '#a5f3fc',
    keyColor: '#155e75',
  },
  {
    name: 'violet',
    accent: '#7c3aed',
    bg: 'rgba(124, 58, 237, 0.08)',
    badgeBg: '#f5f3ff',
    border: '#ddd6fe',
    keyColor: '#5b21b6',
  },
  {
    name: 'teal',
    accent: '#0d9488',
    bg: 'rgba(13, 148, 136, 0.08)',
    badgeBg: '#f0fdfa',
    border: '#99f6e4',
    keyColor: '#115e59',
  },
  {
    name: 'orange',
    accent: '#ea580c',
    bg: 'rgba(234, 88, 12, 0.08)',
    badgeBg: '#fff7ed',
    border: '#fed7aa',
    keyColor: '#9a3412',
  },
];

export const getJsonGroupTheme = (groupIdx: number): JsonGroupTheme =>
  JSON_GROUP_PALETTE[Math.abs(groupIdx) % JSON_GROUP_PALETTE.length];

export const looksLikeJsonText = (raw: string): boolean => {
  const trimmed = raw.trim();
  return trimmed.startsWith('{') || trimmed.startsWith('[');
};

/**
 * Formats JSON cleanly with blank line breaks (`\n\n`) separating top-level groups
 * (and object items inside nested arrays) for clear visual grouping.
 */
export const formatJsonWithGroupBreaks = (raw: string): string => {
  const trimmed = raw.trim();
  if (!trimmed) return raw;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    const pretty = JSON.stringify(parsed, null, 2);
    const lines = pretty.split('\n');
    const out: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const prevLine = i > 0 ? lines[i - 1] : '';
      const prevTrim = prevLine.trimEnd();
      const curTrim = line.trim();

      // Blank line after opening root brace/bracket only if helpful? Keep tight at root start,
      // insert blank line break between sibling top-level groups (2-space indented starts)
      // and between object items inside arrays (`    {` right after `    },`).
      const isTopSiblingStart =
        /^  "[^"]+":/.test(line) || /^  [\[{]/.test(line);
      const isArrayObjItemStart =
        /^    \{$/.test(line) && /^    \},?$/.test(prevLine);

      if (
        i > 0 &&
        prevTrim.endsWith(',') &&
        (isTopSiblingStart || isArrayObjItemStart) &&
        curTrim !== '}' &&
        curTrim !== ']'
      ) {
        out.push('');
      }
      out.push(line);
    }

    return out.join('\n');
  } catch {
    return raw;
  }
};

export interface AnalyzedJsonLine {
  text: string;
  groupIdx: number;
  groupLabel?: string;
  isBlank: boolean;
}

/**
 * Computes per-line visual group assignment without shifting character positions,
 * so it can safely highlight both <pre> previews and <textarea> backdrops.
 */
export const analyzeJsonLinesByGroup = (raw: string): AnalyzedJsonLine[] => {
  const lines = raw.split('\n');
  const results: AnalyzedJsonLine[] = [];

  let depth = 0;
  let currentTopGroup = -1;
  let nextTopGroup = 0;
  let currentSubGroup = -1;
  let currentLabel: string | undefined;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      results.push({ text: line, groupIdx: -1, isBlank: true });
      continue;
    }

    // Detect if this line closes back to depth 0 or closes a top-level group
    const leadingCloses = /^[}\]]+/.test(trimmed);
    if (depth === 1 && leadingCloses && trimmed.length <= 2) {
      // Closing root `}` or `]`
      results.push({ text: line, groupIdx: -1, isBlank: false });
      depth = 0;
      currentTopGroup = -1;
      currentLabel = undefined;
      continue;
    }

    // Start of a new top-level property or root-array item when at depth 1
    if (depth === 1) {
      const keyMatch = trimmed.match(/^"([^"]+)"\s*:/);
      currentTopGroup = nextTopGroup++;
      currentSubGroup = 0;
      currentLabel = keyMatch ? keyMatch[1] : `item ${currentTopGroup + 1}`;
    } else if (depth === 2 && /^\{$/.test(trimmed)) {
      // Nested object inside an array (e.g., fields: [ { ... }, { ... } ])
      currentSubGroup += 1;
    }

    const effectiveGroup =
      currentTopGroup >= 0
        ? currentTopGroup + (depth >= 2 && currentSubGroup > 1 ? currentSubGroup - 1 : 0)
        : -1;

    results.push({
      text: line,
      groupIdx: effectiveGroup,
      groupLabel: currentLabel,
      isBlank: false,
    });

    // Update brace/bracket depth safely respecting JSON strings
    let inString = false;
    let escaped = false;
    for (let c = 0; c < line.length; c++) {
      const ch = line[c];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === '\\' && inString) {
        escaped = true;
        continue;
      }
      if (ch === '"') {
        inString = !inString;
        continue;
      }
      if (!inString) {
        if (ch === '{' || ch === '[') depth += 1;
        else if (ch === '}' || ch === ']') depth = Math.max(0, depth - 1);
      }
    }
  }

  return results;
};

/**
 * Renders syntax-colored spans for a single JSON line using exact characters
 * (zero extra horizontal margin/padding/border so textarea alignment is exact).
 */
export const renderJsonLineTokens = (
  lineText: string,
  groupIdx: number
): React.ReactNode => {
  const theme = groupIdx >= 0 ? getJsonGroupTheme(groupIdx) : null;
  const parts: React.ReactNode[] = [];
  const tokenRegex =
    /("(?:\\.|[^"\\])*")(\s*:)?|(\btrue\b|\bfalse\b|\bnull\b)|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|([{}[\],:])/g;

  let lastIdx = 0;
  let match: RegExpExecArray | null;
  let k = 0;

  while ((match = tokenRegex.exec(lineText)) !== null) {
    if (match.index > lastIdx) {
      parts.push(
        <span key={`t_${k++}`}>{lineText.slice(lastIdx, match.index)}</span>
      );
    }

    const [full, strToken, colonPart, boolNullToken, numToken, punctToken] = match;
    if (strToken !== undefined) {
      if (colonPart !== undefined) {
        // Object key
        parts.push(
          <span
            key={`k_${k++}`}
            style={{
              color: theme ? theme.keyColor : '#1e293b',
              fontWeight: 700,
            }}
          >
            {strToken}
          </span>
        );
        parts.push(
          <span key={`c_${k++}`} style={{ color: '#475569' }}>
            {colonPart}
          </span>
        );
      } else {
        // String value
        parts.push(
          <span key={`s_${k++}`} style={{ color: '#15803d' }}>
            {strToken}
          </span>
        );
      }
    } else if (boolNullToken !== undefined) {
      parts.push(
        <span
          key={`b_${k++}`}
          style={{
            color: boolNullToken === 'null' ? '#7c3aed' : '#b45309',
            fontWeight: 600,
          }}
        >
          {boolNullToken}
        </span>
      );
    } else if (numToken !== undefined) {
      parts.push(
        <span key={`n_${k++}`} style={{ color: '#1d4ed8', fontWeight: 600 }}>
          {numToken}
        </span>
      );
    } else if (punctToken !== undefined) {
      parts.push(
        <span
          key={`p_${k++}`}
          style={{
            color:
              (punctToken === '{' ||
                punctToken === '}' ||
                punctToken === '[' ||
                punctToken === ']') &&
              theme
                ? theme.accent
                : '#64748b',
            fontWeight:
              punctToken === '{' ||
              punctToken === '}' ||
              punctToken === '[' ||
              punctToken === ']'
                ? 700
                : 400,
          }}
        >
          {punctToken}
        </span>
      );
    } else {
      parts.push(<span key={`u_${k++}`}>{full}</span>);
    }

    lastIdx = match.index + full.length;
  }

  if (lastIdx < lineText.length) {
    parts.push(<span key={`tail_${k++}`}>{lineText.slice(lastIdx)}</span>);
  }

  return parts.length > 0 ? parts : lineText;
};

export interface JsonGroupItem {
  id: string;
  label: string;
  kind: 'object_key' | 'array_item';
  keyOrIndex: string | number;
  value: unknown;
}

export const extractJsonGroups = (raw: string): {
  valid: boolean;
  rootType: 'object' | 'array' | 'primitive' | 'invalid';
  groups: JsonGroupItem[];
} => {
  const trimmed = raw.trim();
  if (!trimmed) return { valid: false, rootType: 'invalid', groups: [] };
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (Array.isArray(parsed)) {
      return {
        valid: true,
        rootType: 'array',
        groups: parsed.map((item, idx) => {
          const itemLabel =
            item && typeof item === 'object' && !Array.isArray(item)
              ? String(
                  (item as Record<string, unknown>).label ??
                    (item as Record<string, unknown>).id ??
                    (item as Record<string, unknown>).name ??
                    `[${idx}]`
                )
              : `[${idx}]`;
          return {
            id: `arr_${idx}`,
            label: itemLabel,
            kind: 'array_item',
            keyOrIndex: idx,
            value: item,
          };
        }),
      };
    }
    if (parsed && typeof parsed === 'object') {
      const entries = Object.entries(parsed as Record<string, unknown>);
      return {
        valid: true,
        rootType: 'object',
        groups: entries.map(([k, v]) => ({
          id: `obj_${k}`,
          label: k,
          kind: 'object_key',
          keyOrIndex: k,
          value: v,
        })),
      };
    }
    return { valid: true, rootType: 'primitive', groups: [] };
  } catch {
    return { valid: false, rootType: 'invalid', groups: [] };
  }
};

export const deleteJsonGroup = (
  raw: string,
  keyOrIndex: string | number
): string => {
  try {
    const parsed = JSON.parse(raw.trim()) as unknown;
    if (Array.isArray(parsed) && typeof keyOrIndex === 'number') {
      const next = parsed.filter((_, idx) => idx !== keyOrIndex);
      return formatJsonWithGroupBreaks(JSON.stringify(next, null, 2));
    }
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const next = { ...(parsed as Record<string, unknown>) };
      delete next[String(keyOrIndex)];
      return formatJsonWithGroupBreaks(JSON.stringify(next, null, 2));
    }
  } catch {
    // ignore
  }
  return raw;
};

export const insertJsonGroup = (
  raw: string,
  opts: {
    keyName?: string;
    valueRaw?: string;
    afterKeyOrIndex?: string | number | null;
  }
): string => {
  const trimmed = raw.trim();
  let parsedValue: unknown = opts.valueRaw ?? '';
  if (typeof opts.valueRaw === 'string') {
    const tv = opts.valueRaw.trim();
    if (tv === '') parsedValue = '';
    else if (tv === 'true') parsedValue = true;
    else if (tv === 'false') parsedValue = false;
    else if (tv === 'null') parsedValue = null;
    else if (/^-?\d+(\.\d+)?$/.test(tv)) parsedValue = Number(tv);
    else if (
      (tv.startsWith('{') && tv.endsWith('}')) ||
      (tv.startsWith('[') && tv.endsWith(']'))
    ) {
      try {
        parsedValue = JSON.parse(tv);
      } catch {
        parsedValue = opts.valueRaw;
      }
    } else {
      parsedValue = opts.valueRaw;
    }
  }

  if (!trimmed) {
    const key = opts.keyName?.trim() || 'new_group';
    return formatJsonWithGroupBreaks(
      JSON.stringify({ [key]: parsedValue || { enabled: true } }, null, 2)
    );
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (Array.isArray(parsed)) {
      const itemToInsert =
        opts.valueRaw !== undefined && opts.valueRaw.trim() !== ''
          ? parsedValue
          : {
              id: `item_${parsed.length + 1}`,
              label: `Item ${parsed.length + 1}`,
              value: '',
            };
      const next = [...parsed];
      if (typeof opts.afterKeyOrIndex === 'number') {
        next.splice(opts.afterKeyOrIndex + 1, 0, itemToInsert);
      } else {
        next.push(itemToInsert);
      }
      return formatJsonWithGroupBreaks(JSON.stringify(next, null, 2));
    }

    if (parsed && typeof parsed === 'object') {
      const record = parsed as Record<string, unknown>;
      const baseKey = opts.keyName?.trim() || 'new_group';
      let uniqueKey = baseKey;
      let suffix = 2;
      while (Object.prototype.hasOwnProperty.call(record, uniqueKey)) {
        uniqueKey = `${baseKey}_${suffix++}`;
      }
      const valToSet =
        opts.valueRaw !== undefined
          ? parsedValue
          : { enabled: true, note: '' };

      const entries = Object.entries(record);
      if (
        opts.afterKeyOrIndex !== undefined &&
        opts.afterKeyOrIndex !== null
      ) {
        const idx = entries.findIndex(([k]) => k === String(opts.afterKeyOrIndex));
        if (idx >= 0) {
          entries.splice(idx + 1, 0, [uniqueKey, valToSet]);
          return formatJsonWithGroupBreaks(
            JSON.stringify(Object.fromEntries(entries), null, 2)
          );
        }
      }
      entries.push([uniqueKey, valToSet]);
      return formatJsonWithGroupBreaks(
        JSON.stringify(Object.fromEntries(entries), null, 2)
      );
    }
  } catch {
    // Fallback if invalid JSON: append line break + property stub
    return `${raw.replace(/\s*$/, '')}\n\n"${opts.keyName?.trim() || 'new_group'}": {}`;
  }

  return raw;
};

interface JsonColorPreProps {
  json: string;
  className?: string;
  style?: React.CSSProperties;
  onChangeJson?: (nextJson: string) => void;
  showGroupControls?: boolean;
}

/**
 * Renders read-only (or group-editable) JSON inside a `<pre>` with distinct
 * group colors, blank line breaks between groups, and optional Insert / Delete controls.
 */
export const JsonColorPre: React.FC<JsonColorPreProps> = ({
  json,
  className = '',
  style,
  onChangeJson,
  showGroupControls = false,
}) => {
  const [insertingAfter, setInsertingAfter] = useState<string | number | null | false>(false);
  const [newKeyInput, setNewKeyInput] = useState('');
  const [newValInput, setNewValInput] = useState('');

  const { valid, rootType, groups } = useMemo(() => extractJsonGroups(json), [json]);
  const analyzedLines = useMemo(
    () => analyzeJsonLinesByGroup(valid ? formatJsonWithGroupBreaks(json) : json),
    [json, valid]
  );

  // If valid and has groups, render visual color-coded group cards inside <pre> or line-colored <pre>
  if (!valid || groups.length === 0) {
    return (
      <pre
        className={className}
        style={{
          fontFamily: "'Consolas', 'Courier New', monospace",
          ...style,
        }}
      >
        {analyzedLines.map((line, idx) => {
          const theme = line.groupIdx >= 0 ? getJsonGroupTheme(line.groupIdx) : null;
          return (
            <div
              key={idx}
              style={{
                minHeight: '1.35em',
                backgroundColor: theme ? theme.bg : undefined,
                boxShadow: theme ? `inset 3px 0 0 ${theme.accent}` : undefined,
                paddingLeft: theme ? '6px' : undefined,
              }}
            >
              {line.isBlank ? '\u00A0' : renderJsonLineTokens(line.text, line.groupIdx)}
            </div>
          );
        })}

        {showGroupControls && onChangeJson && (
          <div className="mt-2 select-none" style={{ fontFamily: 'system-ui, sans-serif' }}>
            {insertingAfter === null ? (
              <div className="p-1.5 bg-white border border-emerald-300 flex flex-wrap items-center gap-1">
                {rootType !== 'array' && (
                  <input
                    type="text"
                    value={newKeyInput}
                    onChange={(e) => setNewKeyInput(e.target.value)}
                    placeholder="key"
                    className="px-1.5 py-0.5 border border-slate-300 text-[11px] font-mono w-24"
                  />
                )}
                <input
                  type="text"
                  value={newValInput}
                  onChange={(e) => setNewValInput(e.target.value)}
                  placeholder='value or {"k":1}'
                  className="px-1.5 py-0.5 border border-slate-300 text-[11px] font-mono flex-1 min-w-[110px]"
                />
                <button
                  type="button"
                  onClick={() => {
                    onChangeJson(
                      insertJsonGroup(json, {
                        keyName: newKeyInput,
                        valueRaw: newValInput,
                      })
                    );
                    setInsertingAfter(false);
                  }}
                  className="px-1.5 py-0.5 text-[10px] font-bold text-white bg-emerald-600 cursor-pointer"
                >
                  Insert
                </button>
                <button
                  type="button"
                  onClick={() => setInsertingAfter(false)}
                  className="px-1.5 py-0.5 text-[10px] font-bold bg-slate-100 text-slate-600 cursor-pointer"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setNewKeyInput('');
                  setNewValInput('');
                  setInsertingAfter(null);
                }}
                className="px-2 py-0.5 text-[10px] font-bold bg-emerald-50 border border-emerald-300 text-emerald-800 cursor-pointer hover:bg-emerald-100"
              >
                + Insert Group
              </button>
            )}
          </div>
        )}
      </pre>
    );
  }

  return (
    <pre
      className={className}
      style={{
        fontFamily: "'Consolas', 'Courier New', monospace",
        ...style,
      }}
    >
      <div className="text-slate-500 font-bold leading-snug">
        {rootType === 'array' ? '[' : '{'}
      </div>

      {groups.map((grp, idx) => {
        const theme = getJsonGroupTheme(idx);
        const isLast = idx === groups.length - 1;
        const formattedSub = JSON.stringify(grp.value, null, 2);
        const formattedLines = formattedSub.split('\n');

        return (
          <React.Fragment key={grp.id}>
            <div
              className="my-1.5 rounded-none"
              style={{
                backgroundColor: theme.bg,
                borderLeft: `3px solid ${theme.accent}`,
                paddingLeft: '7px',
                paddingTop: '3px',
                paddingBottom: '3px',
                paddingRight: '4px',
              }}
            >
              {showGroupControls && onChangeJson && (
                <div className="flex items-center justify-between gap-2 mb-0.5 select-none">
                  <span
                    className="text-[10px] font-bold px-1"
                    style={{
                      backgroundColor: theme.badgeBg,
                      color: theme.keyColor,
                      border: `1px solid ${theme.border}`,
                      fontFamily: 'system-ui, sans-serif',
                    }}
                  >
                    {grp.label}
                  </span>
                  <div
                    className="flex items-center gap-1"
                    style={{ fontFamily: 'system-ui, sans-serif' }}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setNewKeyInput('');
                        setNewValInput('');
                        setInsertingAfter(grp.keyOrIndex);
                      }}
                      className="px-1 py-0 text-[10px] font-bold bg-white border border-slate-300 text-slate-700 cursor-pointer hover:bg-slate-100"
                      title={`Insert new group after ${grp.label}`}
                    >
                      + Insert
                    </button>
                    <button
                      type="button"
                      onClick={() => onChangeJson(deleteJsonGroup(json, grp.keyOrIndex))}
                      className="px-1 py-0 text-[10px] font-bold bg-white border border-red-200 text-red-600 cursor-pointer hover:bg-red-50"
                      title={`Delete ${grp.label}`}
                    >
                      ✕ Delete
                    </button>
                  </div>
                </div>
              )}

              {formattedLines.map((subLine, sIdx) => {
                const isFirstSub = sIdx === 0;
                const isLastSub = sIdx === formattedLines.length - 1;
                const prefix =
                  isFirstSub && grp.kind === 'object_key'
                    ? `  "${grp.label}": `
                    : isFirstSub
                      ? '  '
                      : '  ';
                const suffix = isLastSub && !isLast ? ',' : '';
                const displayLine = `${prefix}${subLine}${suffix}`;
                return (
                  <div key={sIdx} style={{ minHeight: '1.35em' }}>
                    {renderJsonLineTokens(displayLine, idx)}
                  </div>
                );
              })}
            </div>

            {showGroupControls &&
              onChangeJson &&
              insertingAfter === grp.keyOrIndex && (
                <div
                  className="my-1 p-1.5 bg-white border border-blue-300 flex flex-wrap items-center gap-1 select-none"
                  style={{ fontFamily: 'system-ui, sans-serif' }}
                >
                  {rootType === 'object' && (
                    <input
                      type="text"
                      value={newKeyInput}
                      onChange={(e) => setNewKeyInput(e.target.value)}
                      placeholder="key"
                      className="px-1.5 py-0.5 border border-slate-300 text-[11px] font-mono w-24"
                    />
                  )}
                  <input
                    type="text"
                    value={newValInput}
                    onChange={(e) => setNewValInput(e.target.value)}
                    placeholder='value or {"k":1}'
                    className="px-1.5 py-0.5 border border-slate-300 text-[11px] font-mono flex-1 min-w-[110px]"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      onChangeJson(
                        insertJsonGroup(json, {
                          keyName: newKeyInput,
                          valueRaw: newValInput,
                          afterKeyOrIndex: grp.keyOrIndex,
                        })
                      );
                      setInsertingAfter(false);
                    }}
                    className="px-1.5 py-0.5 text-[10px] font-bold text-white bg-blue-600 cursor-pointer"
                  >
                    Add
                  </button>
                  <button
                    type="button"
                    onClick={() => setInsertingAfter(false)}
                    className="px-1.5 py-0.5 text-[10px] font-bold bg-slate-100 text-slate-600 cursor-pointer"
                  >
                    Cancel
                  </button>
                </div>
              )}

            {/* Clear visual blank line break between groups */}
            {!isLast && <div style={{ height: '0.75em' }}>{'\u00A0'}</div>}
          </React.Fragment>
        );
      })}

      <div className="text-slate-500 font-bold leading-snug">
        {rootType === 'array' ? ']' : '}'}
      </div>
    </pre>
  );
};

interface ColoredJsonTextareaProps
  extends Omit<
    React.TextareaHTMLAttributes<HTMLTextAreaElement>,
    'value' | 'onChange'
  > {
  value: string;
  onChangeValue?: (nextValue: string) => void;
  textareaRefExternal?: React.RefCallback<HTMLTextAreaElement | null>;
  enableGroupToolbar?: boolean;
  textColor?: string;
  backdropBgColor?: string;
  lineHeightPx?: number;
  paddingPx?: number;
  bordered?: boolean;
  containerClassName?: string;
}

/**
 * Drop-in `<textarea>` enhanced with:
 * 1) Live synchronized per-group color highlighting & syntax colors behind the caret
 * 2) Visual group color chips with 1-click Delete, + Insert Group, and Insert Line Break
 * 3) Graceful plain-text fallback when content is non-JSON notes
 */
export const ColoredJsonTextarea: React.FC<ColoredJsonTextareaProps> = ({
  value,
  onChangeValue,
  textareaRefExternal,
  enableGroupToolbar = true,
  textColor = '#0f172a',
  backdropBgColor = '#f8fafc',
  lineHeightPx = 18,
  paddingPx = 10,
  bordered = true,
  containerClassName = '',
  className = '',
  style,
  readOnly,
  onScroll,
  ...restProps
}) => {
  const innerTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const backdropRef = useRef<HTMLPreElement | null>(null);
  const [showInsertForm, setShowInsertForm] = useState(false);
  const [insertKey, setInsertKey] = useState('');
  const [insertVal, setInsertVal] = useState('');

  const isJson = useMemo(() => looksLikeJsonText(value), [value]);
  const { valid, rootType, groups } = useMemo(
    () =>
      isJson
        ? extractJsonGroups(value)
        : { valid: false, rootType: 'invalid' as const, groups: [] },
    [isJson, value]
  );
  const analyzedLines = useMemo(
    () => (isJson ? analyzeJsonLinesByGroup(value) : []),
    [isJson, value]
  );

  const syncScroll = (ta: HTMLTextAreaElement) => {
    if (backdropRef.current) {
      backdropRef.current.scrollTop = ta.scrollTop;
      backdropRef.current.scrollLeft = ta.scrollLeft;
    }
  };

  const handleInsertLineBreak = () => {
    if (!onChangeValue || readOnly) return;
    const ta = innerTextareaRef.current;
    if (ta && typeof ta.selectionStart === 'number') {
      const start = ta.selectionStart;
      const end = ta.selectionEnd ?? start;
      const next = `${value.slice(0, start)}\n\n${value.slice(end)}`;
      onChangeValue(next);
      window.setTimeout(() => {
        if (innerTextareaRef.current) {
          innerTextareaRef.current.focus();
          innerTextareaRef.current.setSelectionRange(start + 2, start + 2);
        }
      }, 0);
      return;
    }
    onChangeValue(formatJsonWithGroupBreaks(value));
  };

  const computedFont =
    (style?.fontFamily as string | undefined) ||
    "'Consolas', 'Courier New', monospace";
  const computedFontSize = (style?.fontSize as string | undefined) || '12px';

  return (
    <div
      className={`flex flex-col min-h-0 flex-1 ${containerClassName}`}
    >
      {enableGroupToolbar && !readOnly && onChangeValue && isJson && (
        <div
          className="flex flex-wrap items-center justify-between gap-1 px-2 py-1 border border-b-0 border-slate-200 bg-white shrink-0"
          style={{ fontFamily: 'system-ui, -apple-system, Segoe UI, sans-serif' }}
        >
          <div className="flex flex-wrap items-center gap-1 min-w-0 flex-1">
            {groups.length > 0 ? (
              groups.map((grp, idx) => {
                const theme = getJsonGroupTheme(idx);
                return (
                  <span
                    key={grp.id}
                    className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-bold border"
                    style={{
                      backgroundColor: theme.badgeBg,
                      borderColor: theme.border,
                      color: theme.keyColor,
                    }}
                  >
                    <span
                      className="inline-block w-1.5 h-1.5 rounded-full"
                      style={{ backgroundColor: theme.accent }}
                    />
                    <span className="truncate max-w-[90px]">{grp.label}</span>
                    <button
                      type="button"
                      onClick={() =>
                        onChangeValue(deleteJsonGroup(value, grp.keyOrIndex))
                      }
                      className="text-red-600 hover:text-red-800 font-bold cursor-pointer leading-none ml-0.5"
                      title={`Delete JSON group "${grp.label}"`}
                    >
                      ✕
                    </button>
                  </span>
                );
              })
            ) : (
              <span className="text-[10px] text-slate-400 font-semibold">
                {valid ? 'Empty JSON container' : 'Editing JSON'}
              </span>
            )}
          </div>

          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => setShowInsertForm((v) => !v)}
              className="px-1.5 py-0.5 text-[10px] font-bold bg-emerald-50 border border-emerald-300 text-emerald-800 cursor-pointer hover:bg-emerald-100"
              title="Insert new JSON group/key"
            >
              + Insert
            </button>
            <button
              type="button"
              onClick={handleInsertLineBreak}
              className="px-1.5 py-0.5 text-[10px] font-bold bg-amber-50 border border-amber-300 text-amber-900 cursor-pointer hover:bg-amber-100"
              title="Insert blank line break at cursor"
            >
              ↵ Line Break
            </button>
            {valid && (
              <button
                type="button"
                onClick={() => onChangeValue(formatJsonWithGroupBreaks(value))}
                className="px-1.5 py-0.5 text-[10px] font-bold bg-blue-50 border border-blue-200 text-blue-700 cursor-pointer hover:bg-blue-100"
                title="Format JSON with blank line breaks between every group"
              >
                ¶ Format Groups
              </button>
            )}
          </div>
        </div>
      )}

      {showInsertForm && !readOnly && onChangeValue && isJson && (
        <div
          className="flex flex-wrap items-center gap-1 px-2 py-1 border border-b-0 border-emerald-300 bg-emerald-50/70 shrink-0"
          style={{ fontFamily: 'system-ui, sans-serif' }}
        >
          {rootType !== 'array' && (
            <input
              type="text"
              value={insertKey}
              onChange={(e) => setInsertKey(e.target.value)}
              placeholder="group key name"
              className="px-1.5 py-0.5 text-[11px] font-mono border border-slate-300 bg-white w-28"
            />
          )}
          <input
            type="text"
            value={insertVal}
            onChange={(e) => setInsertVal(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                onChangeValue(
                  insertJsonGroup(value, {
                    keyName: insertKey,
                    valueRaw: insertVal,
                  })
                );
                setInsertKey('');
                setInsertVal('');
                setShowInsertForm(false);
              }
            }}
            placeholder='value (e.g. {"enabled": true} or text)'
            className="px-1.5 py-0.5 text-[11px] font-mono border border-slate-300 bg-white flex-1 min-w-[140px]"
          />
          <button
            type="button"
            onClick={() => {
              onChangeValue(
                insertJsonGroup(value, {
                  keyName: insertKey,
                  valueRaw: insertVal,
                })
              );
              setInsertKey('');
              setInsertVal('');
              setShowInsertForm(false);
            }}
            className="px-2 py-0.5 text-[10px] font-bold text-white bg-emerald-600 cursor-pointer"
          >
            Insert Group
          </button>
          <button
            type="button"
            onClick={() => setShowInsertForm(false)}
            className="px-1.5 py-0.5 text-[10px] font-bold bg-white border border-slate-300 text-slate-600 cursor-pointer"
          >
            Cancel
          </button>
        </div>
      )}

      <div
        className="relative flex-1 min-h-0 flex"
        style={{
          backgroundColor:
            (style?.backgroundColor as string | undefined) || backdropBgColor,
        }}
      >
        {isJson && (
          <pre
            ref={backdropRef}
            aria-hidden="true"
            className="absolute inset-0 m-0 pointer-events-none select-none overflow-y-scroll overflow-x-auto box-border"
            style={{
              fontFamily: computedFont,
              fontSize: computedFontSize,
              fontWeight: style?.fontWeight,
              fontStyle: style?.fontStyle,
              lineHeight: `${lineHeightPx}px`,
              padding: `${paddingPx}px`,
              borderWidth: bordered ? '1px' : '0px',
              borderStyle: 'solid',
              borderColor: 'transparent',
              whiteSpace:
                style?.whiteSpace === 'pre' ? 'pre' : 'pre-wrap',
              wordBreak: style?.wordBreak || 'normal',
              overflowWrap: 'break-word',
              tabSize: 2,
              color: textColor,
              scrollbarColor: 'transparent transparent',
            }}
          >
            {analyzedLines.map((line, idx) => {
              const theme =
                line.groupIdx >= 0 ? getJsonGroupTheme(line.groupIdx) : null;
              return (
                <div
                  key={idx}
                  style={{
                    minHeight: `${lineHeightPx}px`,
                    backgroundColor: theme ? theme.bg : undefined,
                    boxShadow: theme
                      ? `inset 3px 0 0 ${theme.accent}`
                      : undefined,
                  }}
                >
                  {line.isBlank
                    ? '\u00A0'
                    : renderJsonLineTokens(line.text, line.groupIdx)}
                </div>
              );
            })}
          </pre>
        )}

        <textarea
          {...restProps}
          ref={(el) => {
            innerTextareaRef.current = el;
            textareaRefExternal?.(el);
          }}
          readOnly={readOnly}
          value={value}
          onChange={(e) => {
            onChangeValue?.(e.target.value);
            syncScroll(e.currentTarget);
          }}
          onScroll={(e) => {
            syncScroll(e.currentTarget);
            onScroll?.(e);
          }}
          className={`relative z-10 flex-1 w-full h-full focus:outline-none box-border ${
            bordered ? 'border' : 'border-0'
          } ${isJson ? 'overflow-y-scroll overflow-x-auto' : ''} ${className}`}
          style={{
            ...style,
            fontFamily: computedFont,
            fontSize: computedFontSize,
            lineHeight: `${lineHeightPx}px`,
            padding: `${paddingPx}px`,
            borderWidth: bordered ? '1px' : '0px',
            tabSize: 2,
            backgroundColor: isJson
              ? 'transparent'
              : (style?.backgroundColor as string | undefined) ||
                backdropBgColor,
            color: isJson ? 'transparent' : textColor,
            caretColor: textColor,
            whiteSpace: style?.whiteSpace === 'pre' ? 'pre' : 'pre-wrap',
            overflowWrap: 'break-word',
          }}
        />
      </div>
    </div>
  );
};
