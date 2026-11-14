import { useCallback, useEffect, useRef, useState } from 'react';
import { OverlayEditModal, OverlayLayer } from './components/HelpAndOverlay';
import { formatJsonWithGroupBreaks } from './components/JsonColorGroups';
import { JsonGeneratorGui2 } from './components/JsonGeneratorGui2';
import { NoteToolGui1 } from './components/NoteToolGui1';
import { DEFAULT_CONFIGS } from './data/defaultConfigs';
import type {
  NoteToolProject,
  NoteWindowData,
  OutputHistoryEntry,
  TabConfigSchema,
  TabPageData,
  WorkspaceMode,
} from './types/app';
import { noteSlug, slugify, tabToText } from './utils/generators';
import {
  DEFAULT_OVERLAYS_TXT,
  type OverlayItem,
  type OverlayMap,
  parseOverlaysTxt,
  serializeOverlaysTxt,
} from './utils/helpContent';
import { createDefaultTab, createDefaultTabs, createEmptyWindow } from './utils/noteConstants';

const STORAGE_KEY_GUI1 = 'notetool_gui1_state_v1';
const STORAGE_KEY_GUI2_STORE = 'notetool_gui2_store_v1';
const STORAGE_KEY_HISTORY = 'notetool_gui2_history_v1';
const STORAGE_KEY_DOWNLOAD = 'notetool_last_download_v1';
const STORAGE_KEY_APP_NOTE = 'notetool_app_overview_note_v1';

const DEFAULT_APP_OVERVIEW_NOTE = `PYTHON PARAMETER & NOTE SUITE — App Overview

This dual-GUI engineering workspace connects two synchronized tools:

1. GUI1 (Note Tool):
   • Organize multi-tab parameter notes with up to 7 resizable note windows per tab.
   • Track project save directories, auto-save every 1 minute, and export .notetool / .txt files.
   • Send any active tab/window directly to GUI2 via ⚡ Generate Data.

2. GUI2 (Dynamic JSON Data Generator):
   • Generates structured JSON payloads from configurable form fields (config/*.json).
   • Manage window1–window7 data slots, preview output history, and dispatch JSON back into GUI1 windows.
   • Open JSON Creator Studio to build Config Fields or Custom Key-Value JSON snippets and save reusable templates.`;

interface SavedGui1State {
  projectName: string;
  saveDir: string;
  tabs: TabPageData[];
  activeTabIdx: number;
}

function buildWindowStoreFromGui1Tabs(
  tabs: TabPageData[]
): Record<string, Record<number, string>> {
  const store: Record<string, Record<number, string>> = {};
  for (const tab of tabs) {
    const slug = noteSlug(tab.tab_name);
    const winMap: Record<number, string> = {};
    tab.windows.forEach((w, idx) => {
      winMap[idx + 1] = w.content;
    });
    store[slug] = winMap;
  }
  return store;
}

function loadInitialGui1State(): SavedGui1State {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_GUI1);
    if (raw) {
      const parsed = JSON.parse(raw) as SavedGui1State;
      if (Array.isArray(parsed.tabs) && parsed.tabs.length > 0) {
        return {
          projectName: parsed.projectName || 'NoteTool_Project',
          saveDir: parsed.saveDir || 'workspace',
          tabs: parsed.tabs,
          activeTabIdx: Math.min(
            Math.max(0, parsed.activeTabIdx || 0),
            parsed.tabs.length - 1
          ),
        };
      }
    }
  } catch {
    // ignore invalid storage
  }
  return {
    projectName: 'NoteTool_Project',
    saveDir: 'workspace',
    tabs: createDefaultTabs(),
    activeTabIdx: 0,
  };
}

export default function App() {
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>('split');

  // ── GUI1 State ─────────────────────────────────────────────────────────────
  const [gui1State, setGui1State] = useState<SavedGui1State>(() =>
    loadInitialGui1State()
  );
  const [gui1Status, setGui1Status] = useState<string>(
    'Ready — Ctrl+S Save | Ctrl+O Load | Ctrl+N New | Double-click tab to rename'
  );
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState<boolean>(false);
  const [lastAutoSaveTime, setLastAutoSaveTime] = useState<string | null>(null);
  const [autoSavePulse, setAutoSavePulse] = useState<boolean>(false);

  // ── Overlay Helper Mode (backed by help/component_overlays.txt) ─────────────
  const [overlayMode, setOverlayMode] = useState<boolean>(false);
  const [overlaysMap, setOverlaysMap] = useState<OverlayMap>(() =>
    parseOverlaysTxt(DEFAULT_OVERLAYS_TXT)
  );
  const [editingOverlayId, setEditingOverlayId] = useState<string | null>(null);

  // ── App Overview Popup Note ────────────────────────────────────────────────
  const [showAppNoteModal, setShowAppNoteModal] = useState<boolean>(false);
  const [appNoteText, setAppNoteText] = useState<string>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_APP_NOTE);
      if (saved && saved.trim()) return saved;
    } catch {
      // ignore
    }
    return DEFAULT_APP_OVERVIEW_NOTE;
  });
  const [appNoteDraft, setAppNoteDraft] = useState<string>(appNoteText);
  const [isEditingAppNote, setIsEditingAppNote] = useState<boolean>(false);

  // ── GUI2 State (Synced to GUI1 Master Tabs) ────────────────────────────────
  const [configs, setConfigs] = useState<Record<string, TabConfigSchema>>(DEFAULT_CONFIGS);
  const [configOrder, setConfigOrder] = useState<string[]>(Object.keys(DEFAULT_CONFIGS));
  const [gui2TabSlug, setGui2TabSlug] = useState<string>(() => {
    const activeTab = gui1State.tabs[gui1State.activeTabIdx] ?? gui1State.tabs[0];
    return activeTab ? noteSlug(activeTab.tab_name) : 'parameter';
  });
  const [gui2TabName, setGui2TabName] = useState<string>(() => {
    const activeTab = gui1State.tabs[gui1State.activeTabIdx] ?? gui1State.tabs[0];
    return activeTab?.tab_name ?? 'Parameter';
  });
  const [gui2WindowId, setGui2WindowId] = useState<number>(() => {
    const activeTab = gui1State.tabs[gui1State.activeTabIdx];
    const focused = (activeTab?.focused_index ?? 0) + 1;
    return Math.max(1, focused);
  });
  const [currentRequestId, setCurrentRequestId] = useState<string | null>(null);
  const [gui2Status, setGui2Status] = useState<string>(
    'Ready. Synced with GUI1 master tabs; choose parameters or edit windows.'
  );
  const [gui2StatusTone, setGui2StatusTone] = useState<
    'neutral' | 'accent' | 'success' | 'danger'
  >('neutral');

  const [windowDataStore, setWindowDataStore] = useState<
    Record<string, Record<number, string>>
  >(() => buildWindowStoreFromGui1Tabs(gui1State.tabs));

  const gui1StateRef = useRef(gui1State);
  gui1StateRef.current = gui1State;

  const [history, setHistory] = useState<OutputHistoryEntry[]>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_HISTORY);
      return raw ? (JSON.parse(raw) as OutputHistoryEntry[]) : [];
    } catch {
      return [];
    }
  });

  const [dispatchNotice, setDispatchNotice] = useState<{
    title: string;
    lines: string[];
  } | null>(null);

  const [lastDownloadDir, setLastDownloadDir] = useState<string>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_DOWNLOAD);
      if (raw) {
        const parsed = JSON.parse(raw) as { dir?: string };
        if (parsed.dir) return parsed.dir;
      }
    } catch {
      // ignore
    }
    return gui1State.saveDir || 'workspace';
  });

  const [lastDownloadFileName, setLastDownloadFileName] = useState<string>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_DOWNLOAD);
      if (raw) {
        const parsed = JSON.parse(raw) as { fileName?: string };
        if (parsed.fileName) return parsed.fileName;
      }
    } catch {
      // ignore
    }
    return '';
  });

  // Persist GUI1 & GUI2 state
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_GUI1, JSON.stringify(gui1State));
    } catch {
      // ignore quota
    }
  }, [gui1State]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_GUI2_STORE, JSON.stringify(windowDataStore));
    } catch {
      // ignore quota
    }
  }, [windowDataStore]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_HISTORY, JSON.stringify(history));
    } catch {
      // ignore quota
    }
  }, [history]);

  const saveFilesToServer = useCallback(
    async (
      directory: string,
      files: Array<{ fileName: string; content: string }>
    ): Promise<{ directory: string; fullPathLabel: string; savedFiles: string[] }> => {
      const res = await fetch('/api/save-files', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ directory, files }),
      });
      if (!res.ok) {
        const errBody = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(errBody.error || `Save failed (${res.status})`);
      }
      return (await res.json()) as {
        directory: string;
        fullPathLabel: string;
        savedFiles: string[];
      };
    },
    []
  );

  // Ref for 1-minute auto-save timer so typing never resets the 60s cadence
  const latestAutoSaveRef = useRef({
    gui1State,
    hasUnsavedChanges,
  });
  latestAutoSaveRef.current = { gui1State, hasUnsavedChanges };

  const pulseTimeoutRef = useRef<number | null>(null);
  const triggerAutoSavePulse = useCallback(() => {
    setAutoSavePulse(false);
    window.requestAnimationFrame(() => {
      setAutoSavePulse(true);
    });
    if (pulseTimeoutRef.current !== null) {
      window.clearTimeout(pulseTimeoutRef.current);
    }
    pulseTimeoutRef.current = window.setTimeout(() => {
      setAutoSavePulse(false);
    }, 3600);
  }, []);

  const performAutoSave = useCallback(
    async (force = false) => {
      const { gui1State: snapshot, hasUnsavedChanges: dirty } = latestAutoSaveRef.current;
      if (!force && !dirty) return;

      const cleanProject =
        snapshot.projectName.trim().replace(/\.notetool$/i, '') || 'NoteTool_Project';
      const cleanDir = snapshot.saveDir.trim() || 'workspace';

      const payload: NoteToolProject = {
        version: 3,
        saved: new Date().toISOString(),
        project_name: cleanProject,
        save_dir: cleanDir,
        tabs: snapshot.tabs,
      };

      const files: Array<{ fileName: string; content: string }> = [
        {
          fileName: `${cleanProject}.notetool`,
          content: JSON.stringify(payload, null, 2),
        },
        ...snapshot.tabs.map((t) => ({
          fileName: `${noteSlug(t.tab_name)}.txt`,
          content: tabToText(t),
        })),
      ];

      try {
        const res = await saveFilesToServer(cleanDir, files);
        const timeLabel = new Date().toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        });
        setHasUnsavedChanges(false);
        setLastAutoSaveTime(timeLabel);
        triggerAutoSavePulse();
        setGui1Status(
          `🟢 Auto-saved at ${timeLabel} → ${res.fullPathLabel}/${cleanProject}.notetool`
        );
      } catch {
        // Keep dirty flag true if disk write failed so next 1m cycle retries
      }
    },
    [saveFilesToServer, triggerAutoSavePulse]
  );

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      void performAutoSave(false);
    }, 60_000);

    return () => {
      window.clearInterval(intervalId);
      if (pulseTimeoutRef.current !== null) {
        window.clearTimeout(pulseTimeoutRef.current);
      }
    };
  }, [performAutoSave]);

  // Fetch config/*.json and output history from server
  const loadConfigsFromServer = useCallback(async () => {
    try {
      const res = await fetch('/api/configs');
      if (!res.ok) return;
      const data = (await res.json()) as {
        configs?: Record<string, TabConfigSchema>;
        order?: string[];
      };
      if (data.configs && Object.keys(data.configs).length > 0) {
        setConfigs(data.configs);
        setConfigOrder(data.order ?? Object.keys(data.configs));
      }
    } catch {
      // keep fallback DEFAULT_CONFIGS
    }
  }, []);

  const loadHistoryFromServer = useCallback(async () => {
    try {
      const res = await fetch('/api/outputs');
      if (!res.ok) return;
      const data = (await res.json()) as { entries?: OutputHistoryEntry[] };
      if (Array.isArray(data.entries) && data.entries.length > 0) {
        setHistory((prev) => {
          const seen = new Set(prev.map((e) => e.file));
          const merged = [...prev];
          for (const item of data.entries!) {
            if (!seen.has(item.file)) merged.push(item);
          }
          return merged.slice(0, 100);
        });
      }
    } catch {
      // ignore
    }
  }, []);

  const loadOverlaysFromServer = useCallback(async () => {
    try {
      const res = await fetch('/api/help/overlays');
      if (!res.ok) return;
      const data = (await res.json()) as { content?: string };
      if (typeof data.content === 'string') {
        const parsed = parseOverlaysTxt(data.content);
        if (Object.keys(parsed).length > 0) {
          setOverlaysMap(parsed);
        }
      }
    } catch {
      // keep default fallback
    }
  }, []);

  const handleSaveOverlay = useCallback(
    async (componentId: string, updated: OverlayItem) => {
      const nextMap: OverlayMap = {
        ...overlaysMap,
        [componentId]: updated,
      };
      const serialized = serializeOverlaysTxt(nextMap);
      const res = await fetch('/api/help/overlays', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: serialized }),
      });
      if (!res.ok) {
        throw new Error(`Failed to save overlay (${res.status})`);
      }
      setOverlaysMap(nextMap);
    },
    [overlaysMap]
  );

  useEffect(() => {
    void loadConfigsFromServer();
    void loadHistoryFromServer();
    void loadOverlaysFromServer();
  }, [loadConfigsFromServer, loadHistoryFromServer, loadOverlaysFromServer]);

  useEffect(() => {
    if (!dispatchNotice && !showAppNoteModal) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (showAppNoteModal) {
          setShowAppNoteModal(false);
          setIsEditingAppNote(false);
        } else if (dispatchNotice) {
          setDispatchNotice(null);
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [dispatchNotice, showAppNoteModal]);

  // ── GUI1 Handlers ──────────────────────────────────────────────────────────
  const updateGui1Status = useCallback((msg: string) => {
    setGui1Status(msg);
  }, []);

  const handleSelectTab = (idx: number) => {
    const targetTab = gui1StateRef.current.tabs[idx];
    if (targetTab) {
      const targetSlug = noteSlug(targetTab.tab_name);
      setGui2TabSlug(targetSlug);
      setGui2TabName(targetTab.tab_name);
      setGui2WindowId(Math.max(1, (targetTab.focused_index ?? 0) + 1));
      setWindowDataStore((prev) => {
        const existing = prev[targetSlug] ?? {};
        const nextMap: Record<number, string> = { ...existing };
        let changed = !prev[targetSlug];
        targetTab.windows.forEach((w, wi) => {
          const wid = wi + 1;
          if (nextMap[wid] === undefined || (w.content && !nextMap[wid])) {
            nextMap[wid] = w.content;
            changed = true;
          }
        });
        return changed ? { ...prev, [targetSlug]: nextMap } : prev;
      });
    }
    setGui1State((prev) => ({ ...prev, activeTabIdx: idx }));
  };

  const handleAddTab = (name: string) => {
    const newTab = createDefaultTab(name, gui1StateRef.current.tabs.length);
    const newSlug = noteSlug(name);
    setGui1State((prev) => {
      const nextTabs = [...prev.tabs, newTab];
      return {
        ...prev,
        tabs: nextTabs,
        activeTabIdx: nextTabs.length - 1,
      };
    });
    setWindowDataStore((prev) => {
      const winMap: Record<number, string> = {};
      newTab.windows.forEach((w, idx) => {
        winMap[idx + 1] = w.content;
      });
      return { ...prev, [newSlug]: winMap };
    });
    setGui2TabSlug(newSlug);
    setGui2TabName(name);
    setGui2WindowId(1);
    setHasUnsavedChanges(true);
    updateGui1Status(`✦ Tab '${name}' added & synced to GUI2`);
  };

  const handleCloseTab = (idx: number) => {
    const currentTabs = gui1StateRef.current.tabs;
    if (currentTabs.length <= 1) return;
    const closedTab = currentTabs[idx];
    const closedName = closedTab?.tab_name ?? 'Tab';
    const nextTabs = currentTabs.filter((_, i) => i !== idx);
    const nextActive = Math.min(gui1StateRef.current.activeTabIdx, nextTabs.length - 1);
    const nextActiveTab = nextTabs[nextActive];

    setGui1State((prev) => ({
      ...prev,
      tabs: nextTabs,
      activeTabIdx: nextActive,
    }));

    if (closedTab) {
      const closedSlug = noteSlug(closedTab.tab_name);
      const stillUsed = nextTabs.some((t) => noteSlug(t.tab_name) === closedSlug);
      if (!stillUsed) {
        setWindowDataStore((prev) => {
          const next = { ...prev };
          delete next[closedSlug];
          return next;
        });
      }
    }

    if (nextActiveTab) {
      setGui2TabSlug(noteSlug(nextActiveTab.tab_name));
      setGui2TabName(nextActiveTab.tab_name);
      setGui2WindowId(Math.max(1, (nextActiveTab.focused_index ?? 0) + 1));
    }

    updateGui1Status(`✕ Tab '${closedName}' closed`);
    setHasUnsavedChanges(true);
  };

  const handleRenameTab = (idx: number, newName: string) => {
    const current = gui1StateRef.current;
    const oldTab = current.tabs[idx];
    if (!oldTab) return;
    const oldName = oldTab.tab_name;
    const oldSlug = noteSlug(oldName);
    const newSlug = noteSlug(newName);
    const nextTabs = current.tabs.map((t, i) =>
      i === idx ? { ...t, tab_name: newName } : t
    );

    setGui1State((prev) => ({
      ...prev,
      tabs: prev.tabs.map((t, i) => (i === idx ? { ...t, tab_name: newName } : t)),
    }));

    setWindowDataStore((prev) => {
      const next = { ...prev };
      const carried = prev[oldSlug] ?? {};
      const syncedMap: Record<number, string> = { ...carried };
      oldTab.windows.forEach((w, wi) => {
        if (syncedMap[wi + 1] === undefined) {
          syncedMap[wi + 1] = w.content;
        }
      });
      const oldSlugStillUsed = nextTabs.some(
        (t, i) => i !== idx && noteSlug(t.tab_name) === oldSlug
      );
      if (!oldSlugStillUsed && oldSlug !== newSlug) {
        delete next[oldSlug];
      }
      next[newSlug] = syncedMap;
      return next;
    });

    if (idx === current.activeTabIdx) {
      setGui2TabSlug(newSlug);
      setGui2TabName(newName);
    }

    updateGui1Status(`✎ Renamed '${oldName}' → '${newName}'`);
    setHasUnsavedChanges(true);
  };

  const handleToggleOrient = (tabIdx: number) => {
    setGui1State((prev) => ({
      ...prev,
      tabs: prev.tabs.map((t, i) =>
        i === tabIdx
          ? {
              ...t,
              orient: t.orient === 'vertical' ? 'horizontal' : 'vertical',
            }
          : t
      ),
    }));
    setHasUnsavedChanges(true);
  };

  const handleAddWindow = (
    tabIdx: number,
    content = '',
    meta?: NoteWindowData['meta']
  ) => {
    const targetTab = gui1StateRef.current.tabs[tabIdx];
    const nextWinId = targetTab ? targetTab.windows.length + 1 : 1;
    setGui1State((prev) => ({
      ...prev,
      tabs: prev.tabs.map((t, i) => {
        if (i !== tabIdx) return t;
        const win = createEmptyWindow(t.id, t.windows.length);
        if (content) win.content = content;
        if (meta) win.meta = { ...meta };
        return {
          ...t,
          windows: [...t.windows, win],
          focused_index: t.windows.length,
        };
      }),
    }));
    if (targetTab) {
      const slug = noteSlug(targetTab.tab_name);
      setWindowDataStore((prev) => ({
        ...prev,
        [slug]: {
          ...(prev[slug] ?? {}),
          [nextWinId]: content,
        },
      }));
      if (tabIdx === gui1StateRef.current.activeTabIdx) {
        setGui2WindowId(nextWinId);
      }
    }
    setHasUnsavedChanges(true);
  };

  const handleFocusWindow = useCallback((tabIdx: number, winIdx: number) => {
    setGui1State((prev) => ({
      ...prev,
      tabs: prev.tabs.map((t, i) =>
        i === tabIdx ? { ...t, focused_index: winIdx } : t
      ),
    }));
    setGui2WindowId(Math.max(1, winIdx + 1));
  }, []);

  const handleRenameWindow = useCallback(
    (tabIdx: number, winIdx: number, newName: string) => {
      const trimmed = newName.trim();
      const targetTab = gui1StateRef.current.tabs[tabIdx];
      const oldLabel =
        targetTab?.windows[winIdx]?.name?.trim() || `Window ${winIdx + 1}`;
      const nextLabel = trimmed || `Window ${winIdx + 1}`;
      setGui1State((prev) => ({
        ...prev,
        tabs: prev.tabs.map((t, i) => {
          if (i !== tabIdx) return t;
          return {
            ...t,
            windows: t.windows.map((w, wi) =>
              wi === winIdx ? { ...w, name: trimmed || undefined } : w
            ),
          };
        }),
      }));
      updateGui1Status(`✎ Renamed '${oldLabel}' → '${nextLabel}'`);
      setHasUnsavedChanges(true);
    },
    []
  );

  const handleDeleteWindow = useCallback((tabIdx: number, winIdx: number) => {
    const current = gui1StateRef.current;
    const targetTab = current.tabs[tabIdx];
    if (!targetTab || targetTab.windows.length <= 1) return;

    const deletedLabel =
      targetTab.windows[winIdx]?.name?.trim() || `Window ${winIdx + 1}`;
    const remainingWins = targetTab.windows.filter((_, wi) => wi !== winIdx);
    const prevFocused = targetTab.focused_index;
    const nextFocused = Math.max(
      0,
      Math.min(
        prevFocused > winIdx
          ? prevFocused - 1
          : prevFocused === winIdx
            ? winIdx
            : prevFocused,
        remainingWins.length - 1
      )
    );

    setGui1State((prev) => ({
      ...prev,
      tabs: prev.tabs.map((t, i) => {
        if (i !== tabIdx) return t;
        const nextWins = t.windows.filter((_, wi) => wi !== winIdx);
        if (nextWins.length === 0) return t;
        const nextFocus = Math.max(
          0,
          Math.min(
            t.focused_index > winIdx ? t.focused_index - 1 : t.focused_index,
            nextWins.length - 1
          )
        );
        return {
          ...t,
          windows: nextWins,
          focused_index: nextFocus,
        };
      }),
    }));

    const slug = noteSlug(targetTab.tab_name);
    setWindowDataStore((prev) => {
      const prevMap = prev[slug] ?? {};
      const nextWinMap: Record<number, string> = {};
      remainingWins.forEach((w, idx) => {
        const oldWid = idx >= winIdx ? idx + 2 : idx + 1;
        nextWinMap[idx + 1] = prevMap[oldWid] ?? w.content;
      });
      return {
        ...prev,
        [slug]: nextWinMap,
      };
    });

    if (tabIdx === current.activeTabIdx) {
      setGui2WindowId(Math.max(1, nextFocused + 1));
    }

    updateGui1Status(`🗑 Deleted '${deletedLabel}' from '${targetTab.tab_name}'`);
    setHasUnsavedChanges(true);
  }, []);

  const handleGui2DeleteWindow = useCallback(
    (tabSlug: string, winId: number) => {
      const current = gui1StateRef.current;
      const activeTab = current.tabs[current.activeTabIdx];
      const tabIdx =
        activeTab && noteSlug(activeTab.tab_name) === tabSlug
          ? current.activeTabIdx
          : current.tabs.findIndex((t) => noteSlug(t.tab_name) === tabSlug);
      if (tabIdx !== -1 && winId >= 1) {
        handleDeleteWindow(tabIdx, winId - 1);
      }
    },
    [handleDeleteWindow]
  );

  const handleUpdateWindowContent = useCallback(
    (tabIdx: number, winIdx: number, content: string) => {
      const targetTab = gui1StateRef.current.tabs[tabIdx];
      setGui1State((prev) => ({
        ...prev,
        tabs: prev.tabs.map((t, i) => {
          if (i !== tabIdx) return t;
          return {
            ...t,
            windows: t.windows.map((w, wi) =>
              wi === winIdx ? { ...w, content, text_content: undefined } : w
            ),
          };
        }),
      }));
      if (targetTab) {
        const slug = noteSlug(targetTab.tab_name);
        setWindowDataStore((prev) => ({
          ...prev,
          [slug]: {
            ...(prev[slug] ?? {}),
            [winIdx + 1]: content,
          },
        }));
      }
      setHasUnsavedChanges(true);
    },
    []
  );

  const handleUpdateWindowDual = useCallback(
    (
      tabIdx: number,
      winIdx: number,
      patch: { content?: string; text_content?: string | null }
    ) => {
      const targetTab = gui1StateRef.current.tabs[tabIdx];
      setGui1State((prev) => ({
        ...prev,
        tabs: prev.tabs.map((t, i) => {
          if (i !== tabIdx) return t;
          return {
            ...t,
            windows: t.windows.map((w, wi) => {
              if (wi !== winIdx) return w;
              const nextContent =
                patch.content !== undefined ? patch.content : w.content;
              const nextText =
                patch.text_content === null
                  ? undefined
                  : patch.text_content !== undefined
                    ? patch.text_content
                    : w.text_content;
              return { ...w, content: nextContent, text_content: nextText };
            }),
          };
        }),
      }));
      if (targetTab && patch.content !== undefined) {
        const slug = noteSlug(targetTab.tab_name);
        setWindowDataStore((prev) => ({
          ...prev,
          [slug]: {
            ...(prev[slug] ?? {}),
            [winIdx + 1]: patch.content!,
          },
        }));
      }
      setHasUnsavedChanges(true);
    },
    []
  );

  const handleUpdateWindowMeta = useCallback(
    (tabIdx: number, winIdx: number, patch: Partial<NoteWindowData['meta']>) => {
      setGui1State((prev) => ({
        ...prev,
        tabs: prev.tabs.map((t, i) => {
          if (i !== tabIdx) return t;
          return {
            ...t,
            windows: t.windows.map((w, wi) =>
              wi === winIdx ? { ...w, meta: { ...w.meta, ...patch } } : w
            ),
          };
        }),
      }));
      setHasUnsavedChanges(true);
    },
    []
  );

  const handleClearWindowIncoming = useCallback(
    (tabIdx: number, winIdx: number) => {
      setGui1State((prev) => ({
        ...prev,
        tabs: prev.tabs.map((t, i) => {
          if (i !== tabIdx) return t;
          return {
            ...t,
            windows: t.windows.map((w, wi) =>
              wi === winIdx ? { ...w, incoming_data: undefined } : w
            ),
          };
        }),
      }));
    },
    []
  );

  const handleClearTab = (tabIdx: number) => {
    const targetTab = gui1StateRef.current.tabs[tabIdx];
    const tabName = targetTab?.tab_name ?? '';
    setGui1State((prev) => ({
      ...prev,
      tabs: prev.tabs.map((t, i) =>
        i === tabIdx
          ? {
              ...t,
              windows: t.windows.map((w) => ({
                ...w,
                content: '',
                text_content: undefined,
              })),
            }
          : t
      ),
    }));
    if (targetTab) {
      const slug = noteSlug(targetTab.tab_name);
      const clearedMap: Record<number, string> = {};
      targetTab.windows.forEach((_, wi) => {
        clearedMap[wi + 1] = '';
      });
      setWindowDataStore((prev) => ({
        ...prev,
        [slug]: clearedMap,
      }));
    }
    updateGui1Status(`🗑 Cleared: ${tabName}`);
    setHasUnsavedChanges(true);
  };

  const handleNewProject = (name: string, dir: string) => {
    const defaultTabs = createDefaultTabs();
    setGui1State({
      projectName: name,
      saveDir: dir,
      tabs: defaultTabs,
      activeTabIdx: 0,
    });
    setWindowDataStore(buildWindowStoreFromGui1Tabs(defaultTabs));
    setGui2TabSlug(noteSlug(defaultTabs[0].tab_name));
    setGui2TabName(defaultTabs[0].tab_name);
    setGui2WindowId(1);
    setHasUnsavedChanges(true);
    updateGui1Status(`🆕 New project '${name}' — ${dir}`);
  };

  const handleLoadProject = (project: NoteToolProject) => {
    const nextTabs = project.tabs.length > 0 ? project.tabs : createDefaultTabs();
    const loadedNameBase =
      project.project_name.trim().replace(/\.(notetool|txt)$/i, '') || 'NoteTool_Project';
    const nextDownloadDir = project.save_dir?.trim() || lastDownloadDir || 'workspace';
    const nextDownloadName = `${loadedNameBase}.txt`;

    setGui1State({
      projectName: project.project_name,
      saveDir: project.save_dir,
      tabs: nextTabs,
      activeTabIdx: 0,
    });
    setWindowDataStore(buildWindowStoreFromGui1Tabs(nextTabs));
    setGui2TabSlug(noteSlug(nextTabs[0].tab_name));
    setGui2TabName(nextTabs[0].tab_name);
    setGui2WindowId(Math.max(1, (nextTabs[0].focused_index ?? 0) + 1));
    setLastDownloadDir(nextDownloadDir);
    setLastDownloadFileName(nextDownloadName);
    try {
      localStorage.setItem(
        STORAGE_KEY_DOWNLOAD,
        JSON.stringify({ dir: nextDownloadDir, fileName: nextDownloadName })
      );
    } catch {
      // ignore quota
    }
    setHasUnsavedChanges(false);
    updateGui1Status(`📂 Loaded → ${project.project_name}.notetool`);
  };

  const handleSetSaveDir = (dir: string) => {
    setGui1State((prev) => ({ ...prev, saveDir: dir }));
    setHasUnsavedChanges(true);
    updateGui1Status(`📁 Default dir → ${dir}`);
  };

  const handleSaveDownloadedTxt = useCallback(
    async (
      targetDir: string,
      targetFileName: string,
      content: string,
      alsoDownloadBrowser: boolean
    ) => {
      const cleanDir = targetDir.trim() || 'workspace';
      const rawName = targetFileName.trim() || 'original_form.txt';
      const cleanFileName = rawName.includes('.') ? rawName : `${rawName}.txt`;

      const res = await saveFilesToServer(cleanDir, [
        { fileName: cleanFileName, content },
      ]);

      setLastDownloadDir(res.directory);
      setLastDownloadFileName(cleanFileName);
      try {
        localStorage.setItem(
          STORAGE_KEY_DOWNLOAD,
          JSON.stringify({ dir: res.directory, fileName: cleanFileName })
        );
      } catch {
        // ignore quota
      }

      if (alsoDownloadBrowser) {
        const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = cleanFileName;
        a.click();
        URL.revokeObjectURL(url);
      }

      setGui2Status(`✅ Saved ${cleanFileName} → ${res.fullPathLabel}/${cleanFileName}`);
      setGui2StatusTone('success');
      updateGui1Status(`💾 Saved export → ${res.fullPathLabel}/${cleanFileName}`);
    },
    [saveFilesToServer, updateGui1Status]
  );

  const handleSaveProject = async (
    targetDir: string,
    targetName: string,
    alsoDownload: boolean,
    makeDefaultDir = true
  ) => {
    const cleanName =
      targetName.trim().replace(/\.notetool$/i, '') || 'NoteTool_Project';
    const cleanDir = targetDir.trim() || 'workspace';

    const payload: NoteToolProject = {
      version: 3,
      saved: new Date().toISOString(),
      project_name: cleanName,
      save_dir: makeDefaultDir ? cleanDir : gui1State.saveDir,
      tabs: gui1State.tabs,
    };
    const jsonContent = JSON.stringify(payload, null, 2);

    const res = await saveFilesToServer(cleanDir, [
      { fileName: `${cleanName}.notetool`, content: jsonContent },
    ]);

    setGui1State((prev) => ({
      ...prev,
      projectName: cleanName,
      saveDir: makeDefaultDir ? res.directory : prev.saveDir,
    }));
    setHasUnsavedChanges(false);

    if (alsoDownload) {
      const blob = new Blob([jsonContent], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${cleanName}.notetool`;
      a.click();
      URL.revokeObjectURL(url);
    }

    updateGui1Status(
      `✅ Saved → ${res.fullPathLabel}/${cleanName}.notetool${makeDefaultDir ? ` (Default dir: ${res.directory})` : ''}`
    );
  };

  const handleSaveAll = async (
    targetDir: string,
    baseName: string,
    alsoDownloadCombined: boolean,
    makeDefaultDir = true
  ) => {
    const cleanBase =
      baseName.trim().replace(/\.txt$/i, '') || gui1State.projectName || 'note_tool';
    const cleanDir = targetDir.trim() || 'workspace';
    const combinedFileName = cleanBase.endsWith('_all_tabs')
      ? `${cleanBase}.txt`
      : `${cleanBase}_all_tabs.txt`;
    const combinedContent = gui1State.tabs.map((t) => tabToText(t)).join('\n\n');

    const filesToSave: Array<{ fileName: string; content: string }> = [
      ...gui1State.tabs.map((t) => ({
        fileName: `${noteSlug(t.tab_name)}.txt`,
        content: tabToText(t),
      })),
      {
        fileName: combinedFileName,
        content: combinedContent,
      },
    ];

    const res = await saveFilesToServer(cleanDir, filesToSave);

    setGui1State((prev) => ({
      ...prev,
      saveDir: makeDefaultDir ? res.directory : prev.saveDir,
    }));
    setHasUnsavedChanges(false);

    if (alsoDownloadCombined) {
      const blob = new Blob([combinedContent], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = combinedFileName;
      a.click();
      URL.revokeObjectURL(url);
    }

    updateGui1Status(
      `💾 Saved All (${gui1State.tabs.length} tabs + ${combinedFileName}) → ${res.fullPathLabel}${makeDefaultDir ? ` (Default dir: ${res.directory})` : ''}`
    );
  };

  // ── IPC: GUI1 → GUI2 (⚡ Generate Data) ───────────────────────────────────
  const handleLaunchGeneratorFromGui1 = () => {
    const activeTab = gui1State.tabs[gui1State.activeTabIdx];
    if (!activeTab) return;

    const reqId = `req_${Date.now()}`;
    const winNum = (activeTab.focused_index ?? 0) + 1;
    const tabSlug = noteSlug(activeTab.tab_name);

    setCurrentRequestId(reqId);
    setGui2TabSlug(tabSlug);
    setGui2TabName(activeTab.tab_name);
    setGui2WindowId(winNum);

    const syncedMap: Record<number, string> = {};
    activeTab.windows.forEach((w, idx) => {
      syncedMap[idx + 1] = w.content;
    });
    setWindowDataStore((prev) => ({
      ...prev,
      [tabSlug]: {
        ...(prev[tabSlug] ?? {}),
        ...syncedMap,
      },
    }));

    setGui2Status(
      `📥 Received from GUI1: Tab '${activeTab.tab_name}' -> window${winNum}`
    );
    setGui2StatusTone('accent');
    updateGui1Status(
      `⚡ Context dispatched to active GUI2: '${activeTab.tab_name}' (Window ${winNum})`
    );

    if (workspaceMode === 'gui1') {
      setWorkspaceMode('gui2');
    }
  };

  // ── GUI2 Handlers ──────────────────────────────────────────────────────────
  const handleGui2SwitchTab = (tabSlug: string, tabId?: string) => {
    setGui2TabSlug(tabSlug);
    const matchedIdx = tabId
      ? gui1StateRef.current.tabs.findIndex((t) => t.id === tabId)
      : gui1StateRef.current.tabs.findIndex(
          (t) => noteSlug(t.tab_name) === tabSlug
        );
    const resolvedIdx =
      matchedIdx !== -1
        ? matchedIdx
        : gui1StateRef.current.tabs.findIndex(
            (t) => noteSlug(t.tab_name) === tabSlug
          );
    if (resolvedIdx !== -1) {
      const matchedTab = gui1StateRef.current.tabs[resolvedIdx];
      setGui1State((prev) => ({ ...prev, activeTabIdx: resolvedIdx }));
      setGui2TabName(matchedTab.tab_name);
      setGui2WindowId(Math.max(1, (matchedTab.focused_index ?? 0) + 1));
      setWindowDataStore((prev) => {
        const existing = prev[tabSlug] ?? {};
        const nextMap: Record<number, string> = { ...existing };
        let changed = !prev[tabSlug];
        matchedTab.windows.forEach((w, wi) => {
          const wid = wi + 1;
          if (nextMap[wid] === undefined || (w.content && !nextMap[wid])) {
            nextMap[wid] = w.content;
            changed = true;
          }
        });
        return changed ? { ...prev, [tabSlug]: nextMap } : prev;
      });
    } else {
      const cfg = configs[tabSlug];
      setGui2TabName(
        cfg?.tab_title ??
          tabSlug
            .split('_')
            .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
            .join(' ')
      );
    }
  };

  const handleUpdateWindowData = (tabSlug: string, winId: number, jsonStr: string) => {
    setWindowDataStore((prev) => ({
      ...prev,
      [tabSlug]: {
        ...(prev[tabSlug] ?? {}),
        [winId]: jsonStr,
      },
    }));
    setHasUnsavedChanges(true);
  };

  const handleClearAllGui2Windows = (tabSlug: string) => {
    setWindowDataStore((prev) => ({
      ...prev,
      [tabSlug]: {},
    }));
    setGui2Status(`🗑 Cleared all windows in '${gui2TabName}'.`);
    setGui2StatusTone('neutral');
  };

  const handleSaveConfig = async (tabSlug: string, cfg: TabConfigSchema) => {
    setConfigs((prev) => ({ ...prev, [tabSlug]: cfg }));
    setGui2Status(`✅ Saved & reloaded config/${tabSlug}.json — columns updated!`);
    setGui2StatusTone('success');
    try {
      await fetch(`/api/configs/${encodeURIComponent(tabSlug)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cfg),
      });
    } catch {
      // offline fallback already updated in state
    }
  };

  const handleCreateStarterConfig = async (tabSlug: string, cfg: TabConfigSchema) => {
    setConfigs((prev) => ({ ...prev, [tabSlug]: cfg }));
    setConfigOrder((prev) => (prev.includes(tabSlug) ? prev : [...prev, tabSlug]));
    setGui2Status(`🔄 Created starter configuration at config/${tabSlug}.json`);
    setGui2StatusTone('accent');
    try {
      await fetch('/api/configs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tabId: tabSlug, config: cfg }),
      });
    } catch {
      // offline fallback already updated in state
    }
  };

  const recordOutput = async (
    fileName: string,
    content: string,
    tabSlug: string,
    windowVal: number | string,
    records: number
  ) => {
    const entry: OutputHistoryEntry = {
      timestamp: new Date().toISOString(),
      file: fileName,
      request_id: currentRequestId,
      tab: tabSlug,
      window: windowVal,
      records,
      json_preview: content,
    };
    setHistory((prev) => [entry, ...prev].slice(0, 100));
    try {
      await fetch('/api/outputs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileName, content, historyEntry: entry }),
      });
    } catch {
      // ignore if static
    }
  };

  // ── IPC: GUI2 → GUI1 (Send Single Window) ──────────────────────────────────
  const handleSendSingleWindow = async (
    tabSlug: string,
    winId: number,
    jsonStr: string,
    recordCount: number
  ) => {
    const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 15);
    const fileName = `${gui1State.projectName}_${tabSlug}_w${winId}_${stamp}.json`;
    await recordOutput(fileName, jsonStr, tabSlug, winId, recordCount);

    let matchedTabName = gui2TabName;
    setGui1State((prev) => {
      const active = prev.tabs[prev.activeTabIdx];
      const matchesSlug = (t: (typeof prev.tabs)[number]) =>
        noteSlug(t.tab_name) === tabSlug.toLowerCase() ||
        slugify(t.tab_name) === tabSlug.toLowerCase() ||
        t.tab_name.toLowerCase() === gui2TabName.toLowerCase();
      let targetIdx =
        active && matchesSlug(active)
          ? prev.activeTabIdx
          : prev.tabs.findIndex(matchesSlug);
      if (targetIdx === -1) targetIdx = prev.activeTabIdx;
      const targetTab = prev.tabs[targetIdx];
      if (!targetTab) return prev;
      matchedTabName = targetTab.tab_name;

      const winIdx = Math.max(0, Math.min(winId - 1, targetTab.windows.length - 1));
      const nextTabs = prev.tabs.map((t, i) => {
        if (i !== targetIdx) return t;
        return {
          ...t,
          focused_index: winIdx,
          windows: t.windows.map((w, wi) =>
            wi === winIdx ? { ...w, incoming_data: jsonStr } : w
          ),
        };
      });

      return { ...prev, tabs: nextTabs, activeTabIdx: targetIdx };
    });
    setHasUnsavedChanges(true);

    setGui2Status(
      `✅ Sent to GUI1 Incoming Tray -> Tab '${matchedTabName}', window${winId}`
    );
    setGui2StatusTone('success');
    updateGui1Status(
      `📥 Incoming GUI2 data ready in Tab '${matchedTabName}' (Window ${winId}) — select parts to paste or copy`
    );
    setDispatchNotice({
      title: 'Incoming Data Ready in GUI1',
      lines: [
        `Target Tab: ${matchedTabName}`,
        `Target Window: window${winId} (Incoming Tray)`,
        `Records: ${recordCount}`,
        `Saved: output/${fileName}`,
      ],
    });
  };

  // ── IPC: GUI2 → GUI1 (Send ALL Windows) ───────────────────────────────────
  const handleSendAllWindows = async (
    tabSlug: string,
    allWindows: Record<number, string>
  ) => {
    const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 15);
    const batchFile = `${gui1State.projectName}_${tabSlug}_all_windows_${stamp}.json`;

    const combinedObj: Record<string, unknown> = {
      project_id: gui1State.projectName,
      tab_id: tabSlug,
      tab_name: gui2TabName,
      timestamp: new Date().toISOString(),
      windows: Object.fromEntries(
        Object.entries(allWindows).map(([wid, str]) => {
          try {
            return [`window${wid}`, JSON.parse(str)];
          } catch {
            return [`window${wid}`, str];
          }
        })
      ),
    };

    const batchJson = formatJsonWithGroupBreaks(
      JSON.stringify(combinedObj, null, 2)
    );
    await recordOutput(
      batchFile,
      batchJson,
      tabSlug,
      `1-${Object.keys(allWindows).length}`,
      Object.keys(allWindows).length
    );

    let matchedTabName = gui2TabName;
    setGui1State((prev) => {
      const active = prev.tabs[prev.activeTabIdx];
      const matchesSlug = (t: (typeof prev.tabs)[number]) =>
        noteSlug(t.tab_name) === tabSlug.toLowerCase() ||
        slugify(t.tab_name) === tabSlug.toLowerCase() ||
        t.tab_name.toLowerCase() === gui2TabName.toLowerCase();
      let targetIdx =
        active && matchesSlug(active)
          ? prev.activeTabIdx
          : prev.tabs.findIndex(matchesSlug);
      if (targetIdx === -1) targetIdx = prev.activeTabIdx;
      const targetTab = prev.tabs[targetIdx];
      if (!targetTab) return prev;
      matchedTabName = targetTab.tab_name;

      const nextTabs = prev.tabs.map((t, i) => {
        if (i !== targetIdx) return t;
        return {
          ...t,
          windows: t.windows.map((w, wi) => {
            const replacement = allWindows[wi + 1];
            return replacement !== undefined
              ? { ...w, incoming_data: replacement }
              : w;
          }),
        };
      });

      return { ...prev, tabs: nextTabs, activeTabIdx: targetIdx };
    });
    setHasUnsavedChanges(true);

    setGui2Status(
      `✅ Sent ALL 7 windows to GUI1 Incoming Trays for Tab '${matchedTabName}'!`
    );
    setGui2StatusTone('success');
    updateGui1Status(
      `📥 Incoming GUI2 data ready across windows in Tab '${matchedTabName}' — select parts to paste or copy`
    );
    setDispatchNotice({
      title: 'All Windows Ready in GUI1 Incoming Trays',
      lines: [
        `Target Tab: ${matchedTabName}`,
        `Windows Updated: window1 - window7 (Incoming Tray)`,
        `Saved: output/${batchFile}`,
      ],
    });
  };

  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden bg-slate-100">
      {/* ── DUAL-GUI SUITE SWITCHER BAR ── */}
      <header
        className={`relative flex flex-wrap items-center justify-between gap-2 px-4 py-1.5 text-white shrink-0 transition-colors ${
          autoSavePulse ? 'header-autosave-blink' : ''
        }`}
        style={{ backgroundColor: autoSavePulse ? '#16a34a' : '#000000' }}
      >
        <OverlayLayer
          id="suite_header"
          enabled={overlayMode}
          item={overlaysMap.suite_header}
          fallbackTitle="Suite Header & Mode Switcher"
          onEdit={setEditingOverlayId}
          align="top-left"
        />

        <div className="flex items-center gap-3">
          <span
            role="button"
            tabIndex={0}
            onClick={() => {
              setAppNoteDraft(appNoteText);
              setIsEditingAppNote(false);
              setShowAppNoteModal(true);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                setAppNoteDraft(appNoteText);
                setIsEditingAppNote(false);
                setShowAppNoteModal(true);
              }
            }}
            title="Click to view or edit what this app does"
            className="text-xs font-bold tracking-wide text-blue-300 cursor-pointer hover:text-blue-200 underline decoration-dotted underline-offset-4"
          >
            PYTHON PARAMETER &amp; NOTE SUITE
          </span>
          <span className="text-[11px] text-slate-400 hidden sm:inline">
            GUI1 (note_tool) ⇄ IPC Bridge ⇄ GUI2 (json_generator)
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setOverlayMode((v) => !v)}
            title="Toggle click-editable helper overlays on every component"
            className="relative z-40 px-2.5 py-1 text-xs font-bold cursor-pointer border transition-colors"
            style={{
              backgroundColor: overlayMode ? '#d97706' : '#111827',
              borderColor: overlayMode ? '#fcd34d' : '#334155',
              color: overlayMode ? '#ffffff' : '#cbd5e1',
            }}
          >
            🏷 Overlays: {overlayMode ? 'ON' : 'OFF'}
          </button>

          <button
            type="button"
            onClick={() => void performAutoSave(true)}
            title="Auto-saves every 1 minute when changes are made. Click to save now."
            className="px-2.5 py-1 text-xs font-semibold cursor-pointer border transition-colors"
            style={{
              backgroundColor: autoSavePulse
                ? '#15803d'
                : hasUnsavedChanges
                  ? '#1f2937'
                  : '#111827',
              borderColor: autoSavePulse
                ? '#86efac'
                : hasUnsavedChanges
                  ? '#f59e0b'
                  : '#334155',
              color: autoSavePulse
                ? '#ffffff'
                : hasUnsavedChanges
                  ? '#fcd34d'
                  : '#cbd5e1',
            }}
          >
            {autoSavePulse && lastAutoSaveTime
              ? `🟢 Auto-Saved ${lastAutoSaveTime}`
              : hasUnsavedChanges
                ? '● Auto-Save (1m)'
                : lastAutoSaveTime
                  ? `✓ Auto-Saved ${lastAutoSaveTime}`
                  : '✓ Auto-Save (1m)'}
          </button>

          <div className="flex items-center gap-1 bg-slate-900 p-0.5 border border-slate-800">
            <button
              type="button"
              onClick={() => setWorkspaceMode('gui1')}
              className={`px-3 py-1 text-xs font-semibold cursor-pointer transition-colors ${
                workspaceMode === 'gui1'
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              📝 GUI1: Note Tool
            </button>
            <button
              type="button"
              onClick={() => setWorkspaceMode('split')}
              className={`px-3 py-1 text-xs font-semibold cursor-pointer transition-colors ${
                workspaceMode === 'split'
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              ◫ Split Dual-View
            </button>
            <button
              type="button"
              onClick={() => setWorkspaceMode('gui2')}
              className={`px-3 py-1 text-xs font-semibold cursor-pointer transition-colors ${
                workspaceMode === 'gui2'
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              ⚡ GUI2: JSON Generator
            </button>
          </div>
        </div>
      </header>

      {/* ── MAIN WORKSPACE ── */}
      <main className="flex-1 min-h-0 flex flex-col xl:flex-row overflow-hidden">
        {(workspaceMode === 'gui1' || workspaceMode === 'split') && (
          <section
            className={
              workspaceMode === 'split'
                ? 'w-full xl:w-1/2 h-1/2 xl:h-full min-w-0 border-b-2 xl:border-b-0 xl:border-r-2 border-slate-300'
                : 'w-full h-full min-w-0'
            }
          >
            <NoteToolGui1
              projectName={gui1State.projectName}
              saveDir={gui1State.saveDir}
              tabs={gui1State.tabs}
              activeTabIdx={gui1State.activeTabIdx}
              statusMessage={gui1Status}
              hasUnsavedChanges={hasUnsavedChanges}
              lastAutoSaveTime={lastAutoSaveTime}
              autoSavePulse={autoSavePulse}
              overlayMode={overlayMode}
              overlaysMap={overlaysMap}
              onEditOverlay={setEditingOverlayId}
              onSelectTab={handleSelectTab}
              onAddTab={handleAddTab}
              onCloseTab={handleCloseTab}
              onRenameTab={handleRenameTab}
              onToggleOrient={handleToggleOrient}
              onAddWindow={handleAddWindow}
              onDeleteWindow={handleDeleteWindow}
              onRenameWindow={handleRenameWindow}
              onFocusWindow={handleFocusWindow}
              onUpdateWindowContent={handleUpdateWindowContent}
              onUpdateWindowDual={handleUpdateWindowDual}
              onUpdateWindowMeta={handleUpdateWindowMeta}
              onClearWindowIncoming={handleClearWindowIncoming}
              onClearTab={handleClearTab}
              onNewProject={handleNewProject}
              onLoadProject={handleLoadProject}
              onSetSaveDir={handleSetSaveDir}
              onSaveProject={handleSaveProject}
              onSaveAll={handleSaveAll}
              onLaunchGenerator={handleLaunchGeneratorFromGui1}
              onStatus={updateGui1Status}
            />
          </section>
        )}

        {(workspaceMode === 'gui2' || workspaceMode === 'split') && (
          <section
            className={
              workspaceMode === 'split'
                ? 'w-full xl:w-1/2 h-1/2 xl:h-full min-w-0'
                : 'w-full h-full min-w-0'
            }
          >
            <JsonGeneratorGui2
              configs={configs}
              configOrder={configOrder}
              masterTabs={gui1State.tabs.map((t) => ({
                id: t.id,
                slug: noteSlug(t.tab_name),
                title: t.tab_name,
                windowCount: t.windows.length,
                windowNames: t.windows.map(
                  (w, wi) => w.name?.trim() || `Window ${wi + 1}`
                ),
              }))}
              projectId={gui1State.projectName}
              activeTabId={gui1State.tabs[gui1State.activeTabIdx]?.id}
              activeTabSlug={gui2TabSlug}
              selectedTabName={gui2TabName}
              selectedWindowId={gui2WindowId}
              currentRequestId={currentRequestId}
              windowDataStore={windowDataStore}
              statusText={gui2Status}
              statusTone={gui2StatusTone}
              history={history}
              overlayMode={overlayMode}
              overlaysMap={overlaysMap}
              onEditOverlay={setEditingOverlayId}
              onSwitchTab={handleGui2SwitchTab}
              onSelectTargetWindow={setGui2WindowId}
              onDeleteWindow={handleGui2DeleteWindow}
              onUpdateWindowData={handleUpdateWindowData}
              onClearAllWindows={handleClearAllGui2Windows}
              onReloadConfigs={loadConfigsFromServer}
              onSaveConfig={handleSaveConfig}
              onCreateStarterConfig={handleCreateStarterConfig}
              defaultDownloadDir={lastDownloadDir}
              defaultDownloadFileName={lastDownloadFileName}
              onDownloadTxtWithLocation={handleSaveDownloadedTxt}
              onSendSingleWindow={handleSendSingleWindow}
              onSendAllWindows={handleSendAllWindows}
            />
          </section>
        )}
      </main>

      {/* ── IPC DISPATCH CONFIRMATION MODAL ── */}
      {dispatchNotice && (
        <div
          onClick={() => setDispatchNotice(null)}
          className="fixed inset-0 z-50 bg-slate-900/35 flex items-center justify-center p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-white border border-slate-300 shadow-2xl w-full max-w-md p-5"
          >
            <h3 className="text-sm font-bold text-slate-900 mb-2">
              ✅ {dispatchNotice.title}
            </h3>
            <ul className="space-y-1 text-xs text-slate-700 mb-4 font-mono bg-slate-50 p-3 border border-slate-200">
              {dispatchNotice.lines.map((line) => (
                <li key={line}>• {line}</li>
              ))}
            </ul>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDispatchNotice(null)}
                className="px-3 py-1.5 text-xs font-semibold bg-slate-100 text-slate-700 cursor-pointer hover:bg-slate-200"
              >
                Cancel
              </button>
              {workspaceMode === 'gui2' && (
                <button
                  type="button"
                  onClick={() => {
                    setDispatchNotice(null);
                    setWorkspaceMode('gui1');
                  }}
                  className="px-3 py-1.5 text-xs font-bold text-white cursor-pointer"
                  style={{ backgroundColor: '#1a4fb5' }}
                >
                  View in GUI1
                </button>
              )}
              <button
                type="button"
                onClick={() => setDispatchNotice(null)}
                className="px-3 py-1.5 text-xs font-bold text-white cursor-pointer"
                style={{ backgroundColor: '#16a34a' }}
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── CLICK-EDITABLE COMPONENT OVERLAY MODAL ── */}
      {editingOverlayId && (
        <OverlayEditModal
          componentId={editingOverlayId}
          item={
            overlaysMap[editingOverlayId] ?? {
              title: editingOverlayId,
              description: '',
            }
          }
          defaultItem={parseOverlaysTxt(DEFAULT_OVERLAYS_TXT)[editingOverlayId]}
          onSave={handleSaveOverlay}
          onClose={() => setEditingOverlayId(null)}
        />
      )}

      {/* ── EDITABLE APP OVERVIEW POPUP NOTE MODAL ── */}
      {showAppNoteModal && (
        <div
          onClick={() => {
            setShowAppNoteModal(false);
            setIsEditingAppNote(false);
          }}
          className="fixed inset-0 z-50 bg-slate-900/45 flex items-center justify-center p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-white border border-slate-300 shadow-2xl w-full max-w-lg p-5"
          >
            <div className="flex items-center justify-between gap-2 pb-2.5 border-b border-slate-200 mb-3">
              <div>
                <h3 className="text-sm font-bold text-slate-900">
                  📝 What This App Does — Overview Note
                </h3>
                <p className="text-[11px] text-slate-500">
                  Click Edit Note to customize this summary (saved locally in your browser).
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowAppNoteModal(false);
                  setIsEditingAppNote(false);
                }}
                className="px-2 py-1 text-xs font-semibold bg-slate-100 text-slate-700 cursor-pointer hover:bg-slate-200"
              >
                ✕
              </button>
            </div>

            {isEditingAppNote ? (
              <textarea
                rows={11}
                autoFocus
                value={appNoteDraft}
                onChange={(e) => setAppNoteDraft(e.target.value)}
                className="w-full border border-slate-300 bg-slate-50 p-3 text-xs text-slate-800 leading-relaxed mb-3 focus:outline-none focus:border-blue-500 resize-y"
              />
            ) : (
              <div
                onDoubleClick={() => {
                  setAppNoteDraft(appNoteText);
                  setIsEditingAppNote(true);
                }}
                title="Double-click or click Edit Note to modify text"
                className="w-full border border-amber-200 bg-amber-50/70 p-3.5 text-xs text-slate-800 leading-relaxed whitespace-pre-wrap max-h-80 overflow-y-auto mb-3 select-text"
              >
                {appNoteText}
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                {isEditingAppNote && (
                  <button
                    type="button"
                    onClick={() => setAppNoteDraft(DEFAULT_APP_OVERVIEW_NOTE)}
                    className="px-2.5 py-1.5 text-xs font-semibold bg-slate-100 text-slate-700 cursor-pointer hover:bg-slate-200"
                  >
                    ↺ Reset Default
                  </button>
                )}
              </div>
              <div className="flex items-center gap-2">
                {isEditingAppNote ? (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        setAppNoteDraft(appNoteText);
                        setIsEditingAppNote(false);
                      }}
                      className="px-3 py-1.5 text-xs font-semibold bg-slate-100 text-slate-700 cursor-pointer hover:bg-slate-200"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const next = appNoteDraft.trim() || DEFAULT_APP_OVERVIEW_NOTE;
                        setAppNoteText(next);
                        setAppNoteDraft(next);
                        try {
                          localStorage.setItem(STORAGE_KEY_APP_NOTE, next);
                        } catch {
                          // ignore quota
                        }
                        setIsEditingAppNote(false);
                      }}
                      className="px-3 py-1.5 text-xs font-bold text-white cursor-pointer"
                      style={{ backgroundColor: '#16a34a' }}
                    >
                      💾 Save Note
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        setAppNoteDraft(appNoteText);
                        setIsEditingAppNote(true);
                      }}
                      className="px-3 py-1.5 text-xs font-bold text-white cursor-pointer"
                      style={{ backgroundColor: '#2563eb' }}
                    >
                      ✎ Edit Note
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setShowAppNoteModal(false);
                        setIsEditingAppNote(false);
                      }}
                      className="px-3 py-1.5 text-xs font-semibold bg-slate-100 text-slate-700 cursor-pointer hover:bg-slate-200"
                    >
                      Close
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
