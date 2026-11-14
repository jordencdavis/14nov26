import React, { useEffect, useRef, useState } from 'react';
import { OverlayLayer, TextHelpModal } from './HelpAndOverlay';
import {
  DEFAULT_FONT_SIZE,
  DEFAULT_WIN_HEIGHT,
  DEFAULT_WIN_WIDTH,
  MIN_WIN_HEIGHT,
} from '../utils/noteConstants';
import {
  noteSlug,
  tabToText,
} from '../utils/generators';
import {
  isValidJsonString,
  jsonToSnippetText,
  mergeJsonStrings,
  parseIncomingParts,
  serializeSelectedIncomingDual,
  textToJsonString,
  type DualClipboardPayload,
} from '../utils/incomingBridge';
import { DEFAULT_GUI1_HELP_TXT, type OverlayMap } from '../utils/helpContent';
import type { NoteToolProject, NoteWindowData, TabPageData, WrapMode } from '../types/app';

interface NoteToolGui1Props {
  projectName: string;
  saveDir: string;
  tabs: TabPageData[];
  activeTabIdx: number;
  statusMessage: string;
  hasUnsavedChanges: boolean;
  lastAutoSaveTime: string | null;
  autoSavePulse: boolean;
  overlayMode: boolean;
  overlaysMap: OverlayMap;
  onEditOverlay: (id: string) => void;
  onSelectTab: (idx: number) => void;
  onAddTab: (name: string) => void;
  onCloseTab: (idx: number) => void;
  onRenameTab: (idx: number, newName: string) => void;
  onToggleOrient: (tabIdx: number) => void;
  onAddWindow: (tabIdx: number, content?: string, meta?: NoteWindowData['meta']) => void;
  onDeleteWindow: (tabIdx: number, winIdx: number) => void;
  onRenameWindow: (tabIdx: number, winIdx: number, newName: string) => void;
  onFocusWindow: (tabIdx: number, winIdx: number) => void;
  onUpdateWindowContent: (tabIdx: number, winIdx: number, content: string) => void;
  onUpdateWindowDual: (
    tabIdx: number,
    winIdx: number,
    patch: { content?: string; text_content?: string | null }
  ) => void;
  onUpdateWindowMeta: (
    tabIdx: number,
    winIdx: number,
    patch: Partial<NoteWindowData['meta']>
  ) => void;
  onClearWindowIncoming: (tabIdx: number, winIdx: number) => void;
  onClearTab: (tabIdx: number) => void;
  onNewProject: (name: string, dir: string) => void;
  onLoadProject: (project: NoteToolProject) => void;
  onSetSaveDir: (dir: string) => void;
  onSaveProject: (
    dir: string,
    name: string,
    alsoDownload: boolean,
    makeDefaultDir?: boolean
  ) => Promise<void>;
  onSaveAll: (
    dir: string,
    baseName: string,
    alsoDownloadCombined: boolean,
    makeDefaultDir?: boolean
  ) => Promise<void>;
  onLaunchGenerator: () => void;
  onStatus: (msg: string) => void;
}

interface LocalDirFileWritable {
  write: (data: string) => Promise<void>;
  close: () => Promise<void>;
}

interface LocalDirFileHandle {
  createWritable: () => Promise<LocalDirFileWritable>;
}

interface LocalDirHandle {
  name: string;
  getFileHandle: (name: string, opts?: { create?: boolean }) => Promise<LocalDirFileHandle>;
}

const STORAGE_KEY_COMPUTER_DIR = 'notetool_computer_dir_label_v1';

function suggestDirFromProjectName(name: string): string {
  const clean = name
    .trim()
    .replace(/\.notetool$/i, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return clean || 'my_project';
}



const FONT_COLORS = [
  '#1a1a2e',
  '#1a4fb5',
  '#0f766e',
  '#15803d',
  '#7c3aed',
  '#b45309',
  '#dc2626',
  '#475569',
];

export const NoteToolGui1: React.FC<NoteToolGui1Props> = ({
  projectName,
  saveDir,
  tabs,
  activeTabIdx,
  statusMessage,
  hasUnsavedChanges,
  lastAutoSaveTime,
  autoSavePulse,
  overlayMode,
  overlaysMap,
  onEditOverlay,
  onSelectTab,
  onAddTab,
  onCloseTab,
  onRenameTab,
  onToggleOrient,
  onAddWindow,
  onDeleteWindow,
  onRenameWindow,
  onFocusWindow,
  onUpdateWindowContent,
  onUpdateWindowDual,
  onUpdateWindowMeta,
  onClearWindowIncoming,
  onClearTab,
  onNewProject,
  onLoadProject,
  onSetSaveDir,
  onSaveProject,
  onSaveAll,
  onLaunchGenerator,
  onStatus,
}) => {
  const activeTab = tabs[activeTabIdx] ?? tabs[0];
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const dirInputRef = useRef<HTMLInputElement | null>(null);
  const pendingDirApplyRef = useRef<boolean>(false);
  const pendingComputerSaveRef = useRef<
    | {
        kind: 'save_project' | 'save_all';
        dir: string;
        name: string;
        makeDefaultDir: boolean;
      }
    | {
        kind: 'download_all_tab';
        fileName: string;
        computerDir: string;
      }
    | null
  >(null);
  const windowRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const textareaRefs = useRef<Record<string, HTMLTextAreaElement | null>>({});
  const textTextareaRefs = useRef<Record<string, HTMLTextAreaElement | null>>({});
  const cursorPosByWinRef = useRef<Record<string, { start: number; end: number }>>({});
  const textCursorPosByWinRef = useRef<Record<string, { start: number; end: number }>>({});
  const dualClipboardRef = useRef<DualClipboardPayload | null>(null);

  // Modals & Popovers
  const [dialog, setDialog] = useState<
    | null
    | {
        type: 'new_project';
        name: string;
        dir: string;
        dirSyncedToName: boolean;
        makeDefaultDir: boolean;
        computerDir: string;
      }
    | { type: 'set_dir'; dir: string; computerDir: string }
    | { type: 'add_tab'; name: string }
    | { type: 'rename_tab'; idx: number; name: string }
    | { type: 'close_tab'; idx: number; name: string }
    | { type: 'clear_tab'; idx: number; name: string }
    | { type: 'clear_window'; winIdx: number }
    | { type: 'delete_window'; winIdx: number }
    | {
        type: 'save_project';
        dir: string;
        name: string;
        makeDefaultDir: boolean;
        computerDir: string;
        error?: string;
      }
    | {
        type: 'save_all_txt';
        dir: string;
        name: string;
        makeDefaultDir: boolean;
        computerDir: string;
        error?: string;
      }
    | {
        type: 'download_all_tab';
        fileName: string;
        computerDir: string;
        error?: string;
      }
    | { type: 'warning'; title: string; message: string }
  >(null);
  const [computerDirHandle, setComputerDirHandle] = useState<LocalDirHandle | null>(null);
  const [computerDirLabel, setComputerDirLabel] = useState<string>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY_COMPUTER_DIR) || '';
    } catch {
      return '';
    }
  });
  const [computerPickerNotice, setComputerPickerNotice] = useState<string | null>(null);
  const [computerDirConfirmed, setComputerDirConfirmed] = useState<boolean>(false);
  const [awaitingComputerSavePick, setAwaitingComputerSavePick] = useState<boolean>(false);
  const [iframeDirRestricted, setIframeDirRestricted] = useState<boolean>(false);
  const [editingWinName, setEditingWinName] = useState<{
    winId: string;
    value: string;
  } | null>(null);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [helpOpen, setHelpOpen] = useState<boolean>(false);

  const [colorPickerWin, setColorPickerWin] = useState<number | null>(null);
  const [originalFormModal, setOriginalFormModal] = useState<{
    activeTab: 'all' | number;
  } | null>(null);
  const [viewAllOriginalOpen, setViewAllOriginalOpen] = useState<boolean>(false);
  const [viewAllSearch, setViewAllSearch] = useState<string>('');
  const [viewAllHideEmpty, setViewAllHideEmpty] = useState<boolean>(false);
  const [viewAllMode, setViewAllMode] = useState<'sections' | 'combined'>('sections');
  const [viewAllCopiedWinKey, setViewAllCopiedWinKey] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    winIdx: number;
    x: number;
    y: number;
  } | null>(null);
  const [inlineOriginalByWin, setInlineOriginalByWin] = useState<
    Record<string, boolean>
  >({});
  const isWinOriginalView = (winId: string) => inlineOriginalByWin[winId] ?? true;
  const [incomingSelectionByWin, setIncomingSelectionByWin] = useState<
    Record<string, string[]>
  >({});
  const [incomingCollapsedByWin, setIncomingCollapsedByWin] = useState<
    Record<string, boolean>
  >({});
  const [incomingFormatByWin, setIncomingFormatByWin] = useState<
    Record<string, 'json' | 'text'>
  >({});
  const [incomingCopiedWinId, setIncomingCopiedWinId] = useState<string | null>(null);
  const prevIncomingRawByWinRef = useRef<Record<string, string>>({});
  const [copiedBlinkBtn, setCopiedBlinkBtn] = useState<
    'current' | 'all' | 'view_all' | null
  >(null);
  const copyBlinkTimeoutRef = useRef<number | null>(null);

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
  };

  const triggerCopyBlink = (btn: 'current' | 'all' | 'view_all') => {
    setCopiedBlinkBtn(null);
    window.requestAnimationFrame(() => {
      setCopiedBlinkBtn(btn);
    });
    if (copyBlinkTimeoutRef.current !== null) {
      window.clearTimeout(copyBlinkTimeoutRef.current);
    }
    copyBlinkTimeoutRef.current = window.setTimeout(() => {
      setCopiedBlinkBtn(null);
    }, 1400);
  };

  useEffect(() => {
    return () => {
      if (copyBlinkTimeoutRef.current !== null) {
        window.clearTimeout(copyBlinkTimeoutRef.current);
      }
    };
  }, []);

  // Initialize multi-selection whenever new incoming GUI2 data arrives for a window
  useEffect(() => {
    if (!activeTab) return;
    const updates: Record<string, string[]> = {};
    const expandUpdates: Record<string, boolean> = {};
    let hasUpdates = false;
    let hasExpandUpdates = false;

    for (const win of activeTab.windows) {
      const raw = win.incoming_data ?? '';
      if (prevIncomingRawByWinRef.current[win.id] !== raw) {
        prevIncomingRawByWinRef.current[win.id] = raw;
        if (raw.trim()) {
          const parts = parseIncomingParts(raw);
          updates[win.id] = parts.filter((p) => p.defaultSelected).map((p) => p.id);
          expandUpdates[win.id] = false;
          hasUpdates = true;
          hasExpandUpdates = true;
        }
      }
    }

    if (hasUpdates) {
      setIncomingSelectionByWin((prev) => ({ ...prev, ...updates }));
    }
    if (hasExpandUpdates) {
      setIncomingCollapsedByWin((prev) => ({ ...prev, ...expandUpdates }));
    }
  }, [activeTab]);

  // Drag resizing state
  const dragRef = useRef<{
    winIdx: number;
    orient: 'vertical' | 'horizontal';
    startCoord: number;
    startSize: number;
  } | null>(null);

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      const d = dragRef.current;
      if (!d) return;
      if (d.orient === 'vertical') {
        const nextH = Math.max(MIN_WIN_HEIGHT, d.startSize + (e.clientY - d.startCoord));
        onUpdateWindowMeta(activeTabIdx, d.winIdx, { height: Math.round(nextH) });
      } else {
        const nextW = Math.max(220, d.startSize + (e.clientX - d.startCoord));
        onUpdateWindowMeta(activeTabIdx, d.winIdx, { win_width: Math.round(nextW) });
      }
    };
    const onMouseUp = () => {
      dragRef.current = null;
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [activeTabIdx, onUpdateWindowMeta]);

  useEffect(() => {
    const closeMenu = () => {
      setContextMenu(null);
      setColorPickerWin(null);
    };
    window.addEventListener('click', closeMenu);
    return () => window.removeEventListener('click', closeMenu);
  }, []);

  const persistComputerDirLabel = (label: string) => {
    setComputerDirLabel(label);
    try {
      localStorage.setItem(STORAGE_KEY_COMPUTER_DIR, label);
    } catch {
      // ignore
    }
  };

  const applyPickedComputerFolderName = (folderName: string, applyToDefaultDir: boolean) => {
    const cleanFolder = folderName.trim() || 'Selected_Folder';
    persistComputerDirLabel(cleanFolder);
    setDialog((prev) => {
      if (!prev) return prev;
      if (
        prev.type === 'set_dir' ||
        prev.type === 'new_project' ||
        prev.type === 'save_project' ||
        prev.type === 'save_all_txt'
      ) {
        return {
          ...prev,
          computerDir: cleanFolder,
          ...(applyToDefaultDir
            ? {
                dir: cleanFolder,
                ...(prev.type === 'new_project' ? { dirSyncedToName: false } : {}),
              }
            : {}),
        };
      }
      if (prev.type === 'download_all_tab') {
        return {
          ...prev,
          computerDir: cleanFolder,
        };
      }
      return prev;
    });
  };

  const closeDialog = () => {
    pendingComputerSaveRef.current = null;
    setAwaitingComputerSavePick(false);
    setIframeDirRestricted(false);
    setDialog(null);
  };

  const writeFilesToComputerDir = async (
    files: Array<{ fileName: string; content: string }>,
    overrideHandle?: LocalDirHandle | null
  ): Promise<boolean> => {
    const targetHandle = overrideHandle ?? computerDirHandle;
    if (!targetHandle) return false;
    for (const f of files) {
      const fh = await targetHandle.getFileHandle(f.fileName, { create: true });
      const writable = await fh.createWritable();
      await writable.write(f.content);
      await writable.close();
    }
    return true;
  };

  const executeSaveProject = async (opts: {
    dir: string;
    name: string;
    alsoDownload: boolean;
    makeDefaultDir: boolean;
    computerDir: string;
    overrideHandle?: LocalDirHandle | null;
  }) => {
    const cleanBase =
      opts.name.trim().replace(/\.notetool$/i, '') || 'NoteTool_Project';
    setIsSaving(true);
    try {
      if (opts.computerDir.trim()) {
        persistComputerDirLabel(opts.computerDir.trim());
      }
      const targetHandle = opts.overrideHandle ?? computerDirHandle;
      if (targetHandle) {
        const projectPayload: NoteToolProject = {
          version: 3,
          saved: new Date().toISOString(),
          project_name: cleanBase,
          save_dir: opts.makeDefaultDir ? opts.dir.trim() : saveDir,
          tabs,
        };
        await writeFilesToComputerDir(
          [
            {
              fileName: `${cleanBase}.notetool`,
              content: JSON.stringify(projectPayload, null, 2),
            },
          ],
          targetHandle
        );
      }
      await onSaveProject(
        opts.dir,
        opts.name,
        opts.alsoDownload,
        opts.makeDefaultDir
      );
      setAwaitingComputerSavePick(false);
      pendingComputerSaveRef.current = null;
      setDialog(null);
    } catch (err) {
      setDialog((prev) =>
        prev && prev.type === 'save_project' ? { ...prev, error: String(err) } : prev
      );
    } finally {
      setIsSaving(false);
    }
  };

  const executeSaveAll = async (opts: {
    dir: string;
    name: string;
    alsoDownload: boolean;
    makeDefaultDir: boolean;
    computerDir: string;
    overrideHandle?: LocalDirHandle | null;
  }) => {
    const cleanBase =
      opts.name.trim().replace(/\.txt$/i, '') || projectName || 'note_tool';
    const combinedFileName = cleanBase.endsWith('_all_tabs')
      ? `${cleanBase}.txt`
      : `${cleanBase}_all_tabs.txt`;
    setIsSaving(true);
    try {
      if (opts.computerDir.trim()) {
        persistComputerDirLabel(opts.computerDir.trim());
      }
      const targetHandle = opts.overrideHandle ?? computerDirHandle;
      if (targetHandle) {
        const combinedContent = tabs.map((t) => tabToText(t)).join('\n\n');
        const filesToWrite = [
          ...tabs.map((t) => ({
            fileName: `${noteSlug(t.tab_name)}.txt`,
            content: tabToText(t),
          })),
          {
            fileName: combinedFileName,
            content: combinedContent,
          },
        ];
        await writeFilesToComputerDir(filesToWrite, targetHandle);
      }
      await onSaveAll(
        opts.dir,
        opts.name,
        opts.alsoDownload,
        opts.makeDefaultDir
      );
      setAwaitingComputerSavePick(false);
      pendingComputerSaveRef.current = null;
      setDialog(null);
    } catch (err) {
      setDialog((prev) =>
        prev && prev.type === 'save_all_txt' ? { ...prev, error: String(err) } : prev
      );
    } finally {
      setIsSaving(false);
    }
  };

  const executeDownloadAllTab = async (opts: {
    fileName: string;
    computerDir: string;
    overrideHandle?: LocalDirHandle | null;
  }) => {
    if (!activeTab) return;
    const trimmedName =
      opts.fileName.trim() || `${noteSlug(activeTab.tab_name)}_all_windows.txt`;
    const finalName = trimmedName.includes('.') ? trimmedName : `${trimmedName}.txt`;
    const { content } = buildCombinedTabExport(activeTab);

    setIsSaving(true);
    try {
      if (opts.computerDir.trim()) {
        persistComputerDirLabel(opts.computerDir.trim());
      }
      const targetHandle = opts.overrideHandle ?? computerDirHandle;
      let wroteDirect = false;
      if (targetHandle) {
        wroteDirect = await writeFilesToComputerDir(
          [{ fileName: finalName, content }],
          targetHandle
        );
      }
      if (!wroteDirect) {
        const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = finalName;
        a.click();
        URL.revokeObjectURL(url);
      }
      onStatus(
        wroteDirect
          ? `💻 Saved "${finalName}" directly to computer folder "${targetHandle?.name}"`
          : `⬇ Downloaded "${finalName}" (${activeTab.windows.length} combined window(s))`
      );
      closeDialog();
    } catch (err) {
      setDialog((prev) =>
        prev && prev.type === 'download_all_tab'
          ? { ...prev, error: String(err) }
          : prev
      );
    } finally {
      setIsSaving(false);
    }
  };

  const triggerSaveAndDownloadWithDirPicker = (
    pending:
      | {
          kind: 'save_project' | 'save_all';
          dir: string;
          name: string;
          makeDefaultDir: boolean;
        }
      | {
          kind: 'download_all_tab';
          fileName: string;
          computerDir: string;
        }
  ) => {
    setComputerPickerNotice(null);
    setIframeDirRestricted(false);
    pendingDirApplyRef.current = false;
    pendingComputerSaveRef.current = pending;
    setAwaitingComputerSavePick(true);

    const winWithPicker = window as unknown as {
      showDirectoryPicker?: (opts?: { mode?: string }) => Promise<LocalDirHandle>;
    };
    const pickerFn = winWithPicker.showDirectoryPicker;

    if (typeof pickerFn !== 'function') {
      setIframeDirRestricted(true);
      setComputerPickerNotice(
        'Native directory picker ("Select Folder") is unavailable in this browser view. Click "Download Now" or open in a full desktop Chrome/Edge tab.'
      );
      return;
    }

    void (async () => {
      try {
        const handle = await pickerFn({ mode: 'readwrite' });
        setComputerDirHandle(handle);
        setComputerDirConfirmed(true);
        setIframeDirRestricted(false);
        applyPickedComputerFolderName(handle.name, false);
        onStatus(`💻 Selected computer directory "${handle.name}" — saving & downloading...`);
        if (pending.kind === 'download_all_tab') {
          await executeDownloadAllTab({
            fileName: pending.fileName,
            computerDir: handle.name,
            overrideHandle: handle,
          });
        } else {
          const nextOpts = {
            ...pending,
            alsoDownload: true,
            computerDir: handle.name,
            overrideHandle: handle,
          };
          if (pending.kind === 'save_project') {
            await executeSaveProject(nextOpts);
          } else {
            await executeSaveAll(nextOpts);
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.toLowerCase().includes('abort')) {
          pendingComputerSaveRef.current = null;
          setAwaitingComputerSavePick(false);
          setComputerPickerNotice('Folder selection cancelled.');
          return;
        }
        // Embedded preview iframes throw SecurityError for showDirectoryPicker.
        // Do NOT open <input webkitdirectory> because Chrome labels its button "Upload".
        setIframeDirRestricted(true);
        setComputerPickerNotice(
          'Embedded preview blocks Chrome\'s "Select Folder" dialog. Open the app in a new tab to choose any folder, or download directly below.'
        );
      }
    })();
  };

  const handleComputerFolderPicked = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    const applyToDefault = pendingDirApplyRef.current;
    e.target.value = '';
    if (!files || files.length === 0) return;

    const firstFile = files[0] as File & { webkitRelativePath?: string };
    const relPath = firstFile.webkitRelativePath || '';
    const folderName = relPath.includes('/')
      ? relPath.split('/')[0]
      : firstFile.name || 'Selected_Folder';

    setComputerDirConfirmed(true);
    setIframeDirRestricted(false);
    applyPickedComputerFolderName(folderName, applyToDefault);

    const pending = pendingComputerSaveRef.current;
    if (pending) {
      pendingComputerSaveRef.current = null;
      setAwaitingComputerSavePick(false);
      onStatus(`💻 Selected computer directory "${folderName}" — saving & downloading...`);
      if (pending.kind === 'download_all_tab') {
        await executeDownloadAllTab({
          fileName: pending.fileName,
          computerDir: folderName,
        });
      } else {
        const nextOpts = {
          ...pending,
          alsoDownload: true,
          computerDir: folderName,
        };
        if (pending.kind === 'save_project') {
          await executeSaveProject(nextOpts);
        } else {
          await executeSaveAll(nextOpts);
        }
      }
      return;
    }

    setAwaitingComputerSavePick(false);
    setComputerPickerNotice(
      `💻 Selected computer folder "${folderName}". Click "Save & Download to Computer" to save.`
    );
    onStatus(`💻 Selected computer directory: ${folderName}`);
  };

  const handleBrowseComputerDirectory = (applyToDefaultDir = false) => {
    setComputerPickerNotice(null);
    setIframeDirRestricted(false);
    pendingComputerSaveRef.current = null;
    setAwaitingComputerSavePick(false);
    pendingDirApplyRef.current = applyToDefaultDir;

    const winWithPicker = window as unknown as {
      showDirectoryPicker?: (opts?: { mode?: string }) => Promise<LocalDirHandle>;
    };
    const pickerFn = winWithPicker.showDirectoryPicker;

    if (typeof pickerFn !== 'function') {
      setIframeDirRestricted(true);
      setComputerPickerNotice(
        'Native directory picker ("Select Folder") is unavailable in this browser view. Type a folder label or open in a full desktop Chrome/Edge tab.'
      );
      return;
    }

    void (async () => {
      try {
        const handle = await pickerFn({ mode: 'readwrite' });
        setComputerDirHandle(handle);
        setComputerDirConfirmed(true);
        setIframeDirRestricted(false);
        applyPickedComputerFolderName(handle.name, applyToDefaultDir);
        onStatus(`💻 Linked computer folder: ${handle.name}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.toLowerCase().includes('abort')) return;
        // Embedded preview iframes block showDirectoryPicker with SecurityError;
        // avoid triggering <input webkitdirectory> because Chrome labels it "Upload".
        setIframeDirRestricted(true);
        setComputerPickerNotice(
          'Embedded preview blocks Chrome\'s "Select Folder" dialog. Open the app in a new tab to pick a directory directly.'
        );
      }
    })();
  };

  const openSetDirDialog = () => {
    setComputerPickerNotice(null);
    setIframeDirRestricted(false);
    pendingComputerSaveRef.current = null;
    setAwaitingComputerSavePick(false);
    const suggested = suggestDirFromProjectName(projectName);
    setDialog({
      type: 'set_dir',
      dir: saveDir === 'workspace' ? suggested : saveDir || suggested,
      computerDir: computerDirLabel || suggested,
    });
  };

  const openNewProjectDialog = () => {
    setComputerPickerNotice(null);
    setIframeDirRestricted(false);
    pendingComputerSaveRef.current = null;
    setAwaitingComputerSavePick(false);
    setDialog({
      type: 'new_project',
      name: 'my_project',
      dir: 'my_project',
      dirSyncedToName: true,
      makeDefaultDir: true,
      computerDir: computerDirLabel || 'my_project',
    });
  };

  const openSaveProjectDialog = () => {
    setComputerPickerNotice(null);
    setIframeDirRestricted(false);
    pendingComputerSaveRef.current = null;
    setAwaitingComputerSavePick(false);
    setComputerDirConfirmed(false);
    const suggested = suggestDirFromProjectName(projectName);
    const initialDir = !saveDir || saveDir === 'workspace' ? suggested : saveDir;
    setDialog({
      type: 'save_project',
      dir: initialDir,
      name: projectName || 'NoteTool_Project',
      makeDefaultDir: true,
      computerDir: computerDirLabel || initialDir,
    });
  };

  const openSaveAllDialog = () => {
    setComputerPickerNotice(null);
    setIframeDirRestricted(false);
    pendingComputerSaveRef.current = null;
    setAwaitingComputerSavePick(false);
    setComputerDirConfirmed(false);
    const suggested = suggestDirFromProjectName(projectName);
    const initialDir = !saveDir || saveDir === 'workspace' ? suggested : saveDir;
    setDialog({
      type: 'save_all_txt',
      dir: initialDir,
      name: projectName || 'note_tool',
      makeDefaultDir: true,
      computerDir: computerDirLabel || initialDir,
    });
  };

  const openDownloadAllTabDialog = (page: TabPageData) => {
    setComputerPickerNotice(null);
    setIframeDirRestricted(false);
    pendingComputerSaveRef.current = null;
    setAwaitingComputerSavePick(false);
    setComputerDirConfirmed(false);
    const suggested = suggestDirFromProjectName(projectName);
    setDialog({
      type: 'download_all_tab',
      fileName: `${noteSlug(page.tab_name)}_all_windows.txt`,
      computerDir: computerDirHandle?.name || computerDirLabel || suggested,
    });
  };

  // Keyboard shortcuts matching note_tool.py + Esc to close popups/modals
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (dialog && !isSaving) {
          e.preventDefault();
          closeDialog();
        } else if (viewAllOriginalOpen) {
          e.preventDefault();
          setViewAllOriginalOpen(false);
        } else if (originalFormModal) {
          e.preventDefault();
          setOriginalFormModal(null);
        } else if (contextMenu || colorPickerWin !== null) {
          e.preventDefault();
          setContextMenu(null);
          setColorPickerWin(null);
        }
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        openSaveProjectDialog();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'o') {
        e.preventDefault();
        fileInputRef.current?.click();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        openNewProjectDialog();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  const scrollToWindow = (winIdx: number) => {
    if (!activeTab) return;
    const win = activeTab.windows[winIdx];
    if (!win) return;
    onFocusWindow(activeTabIdx, winIdx);
    const cardEl = windowRefs.current[win.id];
    const taEl = isWinOriginalView(win.id)
      ? textTextareaRefs.current[win.id]
      : textareaRefs.current[win.id];
    cardEl?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
    taEl?.focus();
  };

  const handleLoadProjectFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const text = await file.text();
      const raw = JSON.parse(text) as Record<string, unknown>;
      const rawTabs = raw.tabs;
      let parsedTabsList: Array<Record<string, unknown>> = [];
      if (Array.isArray(rawTabs)) {
        parsedTabsList = rawTabs as Array<Record<string, unknown>>;
      } else if (rawTabs && typeof rawTabs === 'object') {
        const obj = rawTabs as Record<string, Record<string, unknown>>;
        parsedTabsList = Object.keys(obj)
          .sort((a, b) => Number(a) - Number(b))
          .map((k) => obj[k]);
      }

      const normalizedTabs: TabPageData[] = parsedTabsList.map((td, idx) => {
        const rawWins = Array.isArray(td.windows) ? td.windows : [];
        const windows: NoteWindowData[] = rawWins.map((w: Record<string, unknown>, wIdx: number) => {
          const m = (w.meta as Partial<NoteWindowData['meta']>) || {};
          return {
            id: `tab_${idx}_win_${wIdx}_${Date.now()}`,
            name:
              typeof w.name === 'string' && w.name.trim()
                ? w.name.trim()
                : undefined,
            content: String(w.content ?? ''),
            text_content:
              typeof w.text_content === 'string' ? w.text_content : undefined,
            meta: {
              font_size: Number(m.font_size ?? DEFAULT_FONT_SIZE),
              font_color: String(m.font_color ?? '#1a1a2e'),
              bold: Boolean(m.bold),
              italic: Boolean(m.italic),
              height: Number(m.height ?? DEFAULT_WIN_HEIGHT),
              win_width: Number(m.win_width ?? DEFAULT_WIN_WIDTH),
              wrap: (m.wrap as WrapMode) || 'word',
            },
          };
        });
        return {
          id: `tab_${idx}_${Date.now()}`,
          tab_name: String(td.tab_name ?? `Tab ${idx + 1}`),
          orient: td.orient === 'horizontal' ? 'horizontal' : 'vertical',
          windows,
          focused_index: 0,
        };
      });

      const projName =
        typeof raw.project_name === 'string' && raw.project_name.trim()
          ? raw.project_name
          : file.name.replace(/\.(notetool|json)$/i, '');

      onLoadProject({
        version: 3,
        saved: String(raw.saved ?? new Date().toISOString()),
        project_name: projName,
        save_dir: String(raw.save_dir ?? saveDir),
        tabs: normalizedTabs,
      });
    } catch (err) {
      setDialog({
        type: 'warning',
        title: 'Load Error',
        message: `Failed to parse project file: ${String(err)}`,
      });
    }
  };

  const downloadSingleTxt = (page: TabPageData) => {
    const content = tabToText(page);
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${noteSlug(page.tab_name)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const recordCursorPos = (winId: string, ta: HTMLTextAreaElement) => {
    cursorPosByWinRef.current[winId] = {
      start: ta.selectionStart ?? ta.value.length,
      end: ta.selectionEnd ?? ta.value.length,
    };
  };

  const recordTextCursorPos = (winId: string, ta: HTMLTextAreaElement) => {
    textCursorPosByWinRef.current[winId] = {
      start: ta.selectionStart ?? ta.value.length,
      end: ta.selectionEnd ?? ta.value.length,
    };
  };

  const getEditableOriginalText = (win: NoteWindowData, _wIdx: number) => {
    if (win.text_content !== undefined) return win.text_content;
    if (!win.content.trim()) return '';
    return jsonToSnippetText(win.content);
  };

  const downloadWindowFile = (
    win: NoteWindowData,
    wIdx: number,
    isTextView: boolean
  ) => {
    if (!activeTab) return;
    const raw = isTextView
      ? getEditableOriginalText(win, wIdx)
      : win.content.trim()
        ? win.content
        : (win.text_content ?? '');
    if (!raw.trim()) {
      onStatus(`⚠ Window ${wIdx + 1} is empty — nothing to download`);
      return;
    }
    const isJson = !isTextView && isValidJsonString(raw);
    const ext = isJson ? 'json' : 'txt';
    const mime = isJson
      ? 'application/json;charset=utf-8'
      : 'text/plain;charset=utf-8';
    const blob = new Blob([raw], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${noteSlug(activeTab.tab_name)}_window${wIdx + 1}.${ext}`;
    a.click();
    URL.revokeObjectURL(url);
    onStatus(
      `⬇ Downloaded Window ${wIdx + 1} (${ext.toUpperCase()}) from '${activeTab.tab_name}'`
    );
  };

  const buildCombinedTabExport = (page: TabPageData) => {
    const combinedPage: TabPageData = {
      ...page,
      windows: page.windows.map((w, idx) => {
        const isText = isWinOriginalView(w.id);
        const body = isText
          ? getEditableOriginalText(w, idx)
          : w.content.trim() || w.text_content?.trim() || '';
        return { ...w, content: body };
      }),
    };
    return {
      fileName: `${noteSlug(page.tab_name)}_all_windows.txt`,
      content: tabToText(combinedPage),
    };
  };

  const applyDualToWindow = (
    winIdx: number,
    incomingJson: string,
    incomingText: string,
    targetView: 'json' | 'text',
    explicitSelStart?: number,
    explicitSelEnd?: number
  ) => {
    if (!activeTab) return;
    const win = activeTab.windows[winIdx];
    if (!win) return;

    if (targetView === 'text') {
      const currentText = getEditableOriginalText(win, winIdx);
      const ta = textTextareaRefs.current[win.id];
      const savedPos = textCursorPosByWinRef.current[win.id];
      const rawStart = explicitSelStart ?? savedPos?.start ?? ta?.selectionStart ?? currentText.length;
      const rawEnd = explicitSelEnd ?? savedPos?.end ?? ta?.selectionEnd ?? currentText.length;
      const clampedStart = Math.max(0, Math.min(rawStart, currentText.length));
      const clampedEnd = Math.max(clampedStart, Math.min(rawEnd, currentText.length));

      const needsLeadingNewline =
        clampedStart > 0 &&
        clampedStart === currentText.length &&
        currentText[clampedStart - 1] !== '\n' &&
        !incomingText.startsWith('\n');
      const insertedText = (needsLeadingNewline ? '\n' : '') + incomingText;
      const nextText =
        currentText.slice(0, clampedStart) + insertedText + currentText.slice(clampedEnd);

      const isAllReplaced =
        clampedStart === 0 && clampedEnd === currentText.length && currentText.length > 0;
      const nextJson = isAllReplaced
        ? incomingJson
        : mergeJsonStrings(win.content, incomingJson);

      onUpdateWindowDual(activeTabIdx, winIdx, {
        content: nextJson,
        text_content: nextText,
      });

      const nextCursor = clampedStart + insertedText.length;
      textCursorPosByWinRef.current[win.id] = { start: nextCursor, end: nextCursor };
      window.setTimeout(() => {
        const targetTa = textTextareaRefs.current[win.id];
        if (targetTa) {
          targetTa.focus();
          targetTa.setSelectionRange(nextCursor, nextCursor);
        }
      }, 0);
      return;
    }

    // targetView === 'json'
    const ta = textareaRefs.current[win.id];
    const savedPos = cursorPosByWinRef.current[win.id];
    const rawStart = explicitSelStart ?? savedPos?.start ?? ta?.selectionStart ?? win.content.length;
    const rawEnd = explicitSelEnd ?? savedPos?.end ?? ta?.selectionEnd ?? win.content.length;
    const clampedStart = Math.max(0, Math.min(rawStart, win.content.length));
    const clampedEnd = Math.max(clampedStart, Math.min(rawEnd, win.content.length));
    const isAllReplaced =
      clampedStart === 0 && clampedEnd === win.content.length && win.content.length > 0;

    if (isAllReplaced || !win.content.trim() || isValidJsonString(win.content)) {
      const nextJson = isAllReplaced
        ? incomingJson
        : mergeJsonStrings(win.content, incomingJson);
      // Clear manual text_content so Original/Text View auto-renders cleanly from the valid JSON
      onUpdateWindowDual(activeTabIdx, winIdx, {
        content: nextJson,
        text_content: null,
      });
      const nextCursor = nextJson.length;
      cursorPosByWinRef.current[win.id] = { start: nextCursor, end: nextCursor };
      window.setTimeout(() => {
        const targetTa = textareaRefs.current[win.id];
        if (targetTa) {
          targetTa.focus();
          targetTa.setSelectionRange(nextCursor, nextCursor);
        }
      }, 0);
      return;
    }

    // Existing JSON View content is plain/mixed text (not valid JSON): insert JSON at cursor,
    // and keep Text/Original View clean by inserting incomingText into text_content.
    const needsLeadingNewline =
      clampedStart > 0 &&
      win.content[clampedStart - 1] !== '\n' &&
      !incomingJson.startsWith('\n');
    const insertedJson = (needsLeadingNewline ? '\n' : '') + incomingJson;
    const nextContent =
      win.content.slice(0, clampedStart) + insertedJson + win.content.slice(clampedEnd);

    const existingText = win.text_content ?? win.content;
    const textPos = Math.max(0, Math.min(clampedStart, existingText.length));
    const textEnd = Math.max(textPos, Math.min(clampedEnd, existingText.length));
    const needsTextNl =
      textPos > 0 &&
      existingText[textPos - 1] !== '\n' &&
      !incomingText.startsWith('\n');
    const insertedText = (needsTextNl ? '\n' : '') + incomingText;
    const nextText =
      existingText.slice(0, textPos) + insertedText + existingText.slice(textEnd);

    onUpdateWindowDual(activeTabIdx, winIdx, {
      content: nextContent,
      text_content: nextText,
    });
    const nextCursor = clampedStart + insertedJson.length;
    cursorPosByWinRef.current[win.id] = { start: nextCursor, end: nextCursor };
    window.setTimeout(() => {
      const targetTa = textareaRefs.current[win.id];
      if (targetTa) {
        targetTa.focus();
        targetTa.setSelectionRange(nextCursor, nextCursor);
      }
    }, 0);
  };

  const handleWindowPaste = (
    e: React.ClipboardEvent<HTMLTextAreaElement>,
    winIdx: number,
    targetView: 'json' | 'text'
  ) => {
    const pastedRaw = e.clipboardData?.getData('text/plain') ?? '';
    if (!pastedRaw.trim()) return;
    e.preventDefault();

    const selStart = e.currentTarget.selectionStart ?? e.currentTarget.value.length;
    const selEnd = e.currentTarget.selectionEnd ?? e.currentTarget.value.length;

    const cached = dualClipboardRef.current;
    const trimmed = pastedRaw.trim();
    let incomingJson = '';
    let incomingText = '';

    if (
      cached &&
      (trimmed === cached.json.trim() || trimmed === cached.text.trim())
    ) {
      incomingJson = cached.json;
      incomingText = cached.text;
    } else if (isValidJsonString(pastedRaw)) {
      try {
        incomingJson = JSON.stringify(JSON.parse(trimmed), null, 2);
      } catch {
        incomingJson = pastedRaw;
      }
      incomingText = jsonToSnippetText(pastedRaw);
    } else {
      incomingText = pastedRaw;
      incomingJson = textToJsonString(pastedRaw);
    }

    applyDualToWindow(
      winIdx,
      incomingJson,
      incomingText,
      targetView,
      selStart,
      selEnd
    );
    onStatus(
      `📋 Auto-formatted paste into ${targetView === 'text' ? 'Original/Text View' : 'JSON View'} & synced other format in Window ${winIdx + 1}`
    );
  };

  const insertIntoWindow = (winIdx: number, snippet: string) => {
    if (!activeTab) return;
    const win = activeTab.windows[winIdx];
    if (!win) return;
    const isTextView = isWinOriginalView(win.id);
    if (isTextView) {
      const currentText = getEditableOriginalText(win, winIdx);
      const ta = textTextareaRefs.current[win.id];
      const savedPos = textCursorPosByWinRef.current[win.id];
      const start = savedPos?.start ?? ta?.selectionStart ?? currentText.length;
      const end = savedPos?.end ?? ta?.selectionEnd ?? currentText.length;
      const clampedStart = Math.max(0, Math.min(start, currentText.length));
      const clampedEnd = Math.max(clampedStart, Math.min(end, currentText.length));
      const nextText =
        currentText.slice(0, clampedStart) + snippet + currentText.slice(clampedEnd);
      onUpdateWindowDual(activeTabIdx, winIdx, { text_content: nextText });
      const nextCursor = clampedStart + snippet.length;
      textCursorPosByWinRef.current[win.id] = { start: nextCursor, end: nextCursor };
      window.setTimeout(() => {
        const targetTa = textTextareaRefs.current[win.id];
        if (targetTa) {
          targetTa.focus();
          targetTa.setSelectionRange(nextCursor, nextCursor);
        }
      }, 0);
      return;
    }

    const ta = textareaRefs.current[win.id];
    const savedPos = cursorPosByWinRef.current[win.id];
    const start = savedPos?.start ?? ta?.selectionStart ?? win.content.length;
    const end = savedPos?.end ?? ta?.selectionEnd ?? win.content.length;
    const clampedStart = Math.max(0, Math.min(start, win.content.length));
    const clampedEnd = Math.max(clampedStart, Math.min(end, win.content.length));
    const next =
      win.content.slice(0, clampedStart) + snippet + win.content.slice(clampedEnd);

    onUpdateWindowContent(activeTabIdx, winIdx, next);
    const nextCursor = clampedStart + snippet.length;
    cursorPosByWinRef.current[win.id] = { start: nextCursor, end: nextCursor };

    setTimeout(() => {
      const targetTa = textareaRefs.current[win.id];
      if (targetTa) {
        targetTa.focus();
        targetTa.setSelectionRange(nextCursor, nextCursor);
      }
    }, 0);
  };

  if (!activeTab) return null;

  const focusedIdx = Math.max(
    0,
    Math.min(activeTab.focused_index, activeTab.windows.length - 1)
  );

  return (
    <div
      className="flex flex-col h-full w-full select-none"
      style={{ backgroundColor: '#f5f5f5', fontFamily: "'Courier New', Courier, monospace" }}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept=".notetool,.json"
        className="hidden"
        onChange={handleLoadProjectFile}
      />
      <input
        ref={(el) => {
          dirInputRef.current = el;
          if (el) {
            el.setAttribute('webkitdirectory', '');
            el.setAttribute('directory', '');
          }
        }}
        type="file"
        multiple
        className="hidden"
        onChange={handleComputerFolderPicked}
      />

      {/* ── MENU BAR (#ffffff) ── */}
      <div
        className="relative flex flex-wrap items-center justify-between gap-2 px-3 py-2 border-b"
        style={{ backgroundColor: '#ffffff', borderColor: '#bec8de' }}
      >
        <OverlayLayer
          id="gui1_menubar"
          enabled={overlayMode}
          item={overlaysMap.gui1_menubar}
          fallbackTitle="GUI1 Menu Bar"
          onEdit={onEditOverlay}
        />
        <div className="flex items-center gap-3 min-w-0">
          {(() => {
            const linkedComputerDir = computerDirHandle?.name || computerDirLabel;
            const dirLabel =
              linkedComputerDir && linkedComputerDir !== saveDir
                ? `${saveDir} | 💻 ${linkedComputerDir}`
                : saveDir;
            const fullText = projectName
              ? `📄 ${projectName}.notetool${hasUnsavedChanges ? ' *' : ''} (${dirLabel})`
              : 'No project loaded';
            return (
              <span
                className="text-xs italic whitespace-normal break-words"
                style={{
                  fontSize: '21px',
                  fontWeight: 'bold',
                  color: '#ff0105',
                  fontFamily: 'Georgia',
                  textDecorationLine: 'line-through',
                  lineHeight: '24px',
                }}
                title={fullText}
              >
                {fullText}
              </span>
            );
          })()}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={openSetDirDialog}
            className="px-2.5 py-1 text-xs font-bold text-white cursor-pointer hover:opacity-90 transition-opacity"
            style={{ backgroundColor: '#7c3aed' }}
          >
            📁 Default Dir
          </button>
          <button
            type="button"
            onClick={openNewProjectDialog}
            className="px-2.5 py-1 text-xs font-bold text-white cursor-pointer hover:opacity-90 transition-opacity"
            style={{ backgroundColor: '#6d28d9' }}
          >
            🆕 New Project
          </button>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="px-2.5 py-1 text-xs font-bold text-white cursor-pointer hover:opacity-90 transition-opacity"
            style={{ backgroundColor: '#0369a1' }}
          >
            📂 Load Project
          </button>
          <button
            type="button"
            onClick={openSaveProjectDialog}
            className="px-2.5 py-1 text-xs font-bold text-white cursor-pointer hover:opacity-90 transition-opacity"
            style={{ backgroundColor: '#0f766e' }}
          >
            💾 Save Project
          </button>
          <button
            type="button"
            onClick={openSaveAllDialog}
            className="px-2.5 py-1 text-xs font-bold text-white cursor-pointer hover:opacity-90 transition-opacity"
            style={{ backgroundColor: '#15803d' }}
          >
            💾 Save All
          </button>
          <button
            type="button"
            onClick={() => {
              setViewAllSearch('');
              setViewAllOriginalOpen(true);
            }}
            className="px-2.5 py-1 text-xs font-bold text-white cursor-pointer hover:opacity-90 transition-opacity"
            style={{ backgroundColor: '#0284c7' }}
            title="View all tabs and all windows in Original Form in a single popup"
          >
            👁 View All
          </button>
          <button
            type="button"
            onClick={() =>
              setDialog({
                type: 'clear_tab',
                idx: activeTabIdx,
                name: activeTab.tab_name,
              })
            }
            className="px-2.5 py-1 text-xs font-bold text-white cursor-pointer hover:opacity-90 transition-opacity"
            style={{ backgroundColor: '#dc2626' }}
          >
            🗑 Clear Tab
          </button>
          <button
            type="button"
            onClick={onLaunchGenerator}
            className="px-3 py-1 text-xs font-bold text-white cursor-pointer hover:opacity-95 shadow-sm transition-opacity"
            style={{ backgroundColor: '#2563eb' }}
          >
            ⚡ Generate Data
          </button>
          <button
            type="button"
            onClick={() => setHelpOpen(true)}
            className="px-2.5 py-1 text-xs font-bold cursor-pointer hover:bg-slate-200 border"
            style={{
              backgroundColor: '#f1f5f9',
              borderColor: '#bec8de',
              color: '#1a4fb5',
            }}
            title="Help — Explain GUI1 and all buttons"
          >
            ❓ Help
          </button>
        </div>
      </div>

      {/* ── DYNAMIC TAB BAR (#e4e8f0) ── */}
      <div
        className="relative flex items-center justify-between px-2 py-1 border-b-2"
        style={{ backgroundColor: '#e4e8f0', borderColor: '#bec8de' }}
      >
        <OverlayLayer
          id="gui1_tabbar"
          enabled={overlayMode}
          item={overlaysMap.gui1_tabbar}
          fallbackTitle="GUI1 Dynamic Tab Bar"
          onEdit={onEditOverlay}
        />
        <div className="flex items-center gap-1 overflow-x-auto py-0.5">
          {tabs.map((tab, idx) => {
            const isActive = idx === activeTabIdx;
            return (
              <div
                key={tab.id}
                onClick={() => onSelectTab(idx)}
                onDoubleClick={() =>
                  setDialog({ type: 'rename_tab', idx, name: tab.tab_name })
                }
                title="Click to switch, double-click to rename"
                className="flex items-center border cursor-pointer shrink-0 transition-colors"
                style={{
                  backgroundColor: isActive ? '#ffffff' : '#d8dce8',
                  borderColor: isActive ? '#1a4fb5' : '#bec8de',
                }}
              >
                <span
                  className="px-2.5 py-1 text-xs"
                  style={{
                    color: isActive ? '#1a4fb5' : '#8899aa',
                    fontWeight: isActive ? 700 : 400,
                  }}
                >
                  {tab.tab_name}
                </span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (tabs.length <= 1) {
                      setDialog({
                        type: 'warning',
                        title: 'Cannot Close',
                        message: 'At least one tab must remain.',
                      });
                    } else {
                      setDialog({ type: 'close_tab', idx, name: tab.tab_name });
                    }
                  }}
                  className="px-1.5 py-1 text-xs font-bold cursor-pointer hover:opacity-80"
                  style={{ color: isActive ? '#dc2626' : '#8899aa' }}
                  title="Close tab"
                >
                  ✕
                </button>
              </div>
            );
          })}
        </div>

        <button
          type="button"
          onClick={() => setDialog({ type: 'add_tab', name: 'New Tab' })}
          className="ml-2 px-2.5 py-0.5 text-sm font-bold text-white cursor-pointer shrink-0 hover:opacity-90"
          style={{ backgroundColor: '#22c55e' }}
          title="Add New Tab"
        >
          ＋
        </button>
      </div>

      {/* ── TAB TOOLBAR (#f7f8fc) ── */}
      <div
        className="relative flex items-center justify-between px-3 py-1.5 border-b"
        style={{ backgroundColor: '#f7f8fc', borderColor: '#bec8de' }}
      >
        <OverlayLayer
          id="gui1_toolbar"
          enabled={overlayMode}
          item={overlaysMap.gui1_toolbar}
          fallbackTitle="GUI1 Tab Toolbar"
          onEdit={onEditOverlay}
        />
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold" style={{ color: '#1a4fb5' }}>
            {activeTab.tab_name}
          </span>
          <span className="text-xs" style={{ color: '#8899aa' }}>
            ({activeTab.windows.length} windows)
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onAddWindow(activeTabIdx)}
            className="px-2.5 py-1 text-xs font-bold text-white cursor-pointer hover:opacity-90"
            style={{ backgroundColor: '#2563eb' }}
          >
            ＋ Add Window
          </button>
          <button
            type="button"
            onClick={() =>
              setDialog({
                type: 'clear_tab',
                idx: activeTabIdx,
                name: activeTab.tab_name,
              })
            }
            className="px-2.5 py-1 text-xs font-bold text-white cursor-pointer hover:opacity-90"
            style={{ backgroundColor: '#dc2626' }}
            title="Clear all windows in this tab"
          >
            🗑 Clear All Windows
          </button>
          <button
            type="button"
            onClick={() => openDownloadAllTabDialog(activeTab)}
            className="px-2.5 py-1 text-xs font-bold text-white cursor-pointer hover:opacity-90"
            style={{ backgroundColor: '#15803d' }}
            title={`Choose computer folder & download all ${activeTab.windows.length} combined windows under '${activeTab.tab_name}'`}
          >
            ⬇ Download All
          </button>
          <button
            type="button"
            onClick={() => onToggleOrient(activeTabIdx)}
            className="px-2.5 py-1 text-xs font-bold text-white cursor-pointer hover:opacity-90"
            style={{
              backgroundColor:
                activeTab.orient === 'horizontal' ? '#7c3aed' : '#1a4fb5',
            }}
          >
            {activeTab.orient === 'horizontal' ? '⬜ Horizontal' : '⬛ Vertical'}
          </button>
        </div>
      </div>

      {/* ── WINDOWS CANVAS (#f0f2f8) ── */}
      <div className="relative flex-1 min-h-0 flex flex-col">
        <OverlayLayer
          id="gui1_canvas"
          enabled={overlayMode}
          item={overlaysMap.gui1_canvas}
          fallbackTitle="GUI1 Note Windows Canvas"
          onEdit={onEditOverlay}
          align="center"
        />
        <div
          className={`flex-1 overflow-auto p-2 ${
            activeTab.orient === 'horizontal'
              ? 'flex flex-row items-stretch gap-2 overflow-x-auto overflow-y-hidden'
              : 'flex flex-col gap-2 overflow-y-auto overflow-x-hidden'
          }`}
          style={{ backgroundColor: '#f0f2f8' }}
        >
        {activeTab.windows.map((win, wIdx) => {
          const isFocused = wIdx === focusedIdx;
          const wrapMode = win.meta.wrap || 'word';
          const isInlineOriginal = isWinOriginalView(win.id);
          const inlineOriginalText = isInlineOriginal
            ? getEditableOriginalText(win, wIdx)
            : '';
          const incomingRaw = win.incoming_data?.trim() ?? '';
          const hasIncoming = incomingRaw.length > 0;
          const incomingParts = hasIncoming ? parseIncomingParts(incomingRaw) : [];
          const selectedIdsList =
            incomingSelectionByWin[win.id] ??
            incomingParts.filter((p) => p.defaultSelected).map((p) => p.id);
          const selectedSet = new Set(selectedIdsList);
          const isIncomingCollapsed = Boolean(incomingCollapsedByWin[win.id]);
          const incomingFmt = incomingFormatByWin[win.id] ?? 'json';

          return (
            <div
              key={win.id}
              ref={(el) => {
                windowRefs.current[win.id] = el;
              }}
              onClick={() => onFocusWindow(activeTabIdx, wIdx)}
              className="relative flex flex-col shrink-0"
              style={{
                backgroundColor: '#ffffff',
                border: isFocused ? '1px solid #1a4fb5' : '1px solid #bec8de',
                boxShadow: isFocused ? 'inset 0 0 0 1px #1a4fb5' : undefined,
                height:
                  activeTab.orient === 'vertical' ? `${win.meta.height}px` : '100%',
                width:
                  activeTab.orient === 'horizontal'
                    ? `${win.meta.win_width}px`
                    : '100%',
                minHeight: activeTab.orient === 'vertical' ? `${MIN_WIN_HEIGHT}px` : undefined,
              }}
            >
              {/* Window Header (#dde8ff) */}
              <div
                className="flex flex-col gap-1 px-2 py-1 shrink-0"
                style={{ backgroundColor: '#dde8ff' }}
              >
                <div className="flex items-center justify-between gap-2 w-full min-w-0">
                  {editingWinName?.winId === win.id ? (
                    <input
                      type="text"
                      autoFocus
                      value={editingWinName.value}
                      onClick={(e) => e.stopPropagation()}
                      onDoubleClick={(e) => e.stopPropagation()}
                      onChange={(e) =>
                        setEditingWinName({
                          winId: win.id,
                          value: e.target.value,
                        })
                      }
                      onBlur={() => {
                        onRenameWindow(activeTabIdx, wIdx, editingWinName.value);
                        setEditingWinName(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          onRenameWindow(activeTabIdx, wIdx, editingWinName.value);
                          setEditingWinName(null);
                        } else if (e.key === 'Escape') {
                          e.preventDefault();
                          setEditingWinName(null);
                        }
                      }}
                      className="text-xs font-bold px-1.5 py-0.5 bg-white border border-blue-500 focus:outline-none w-36"
                      style={{ color: '#1a4fb5' }}
                    />
                  ) : (
                    <span
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        setEditingWinName({
                          winId: win.id,
                          value: win.name?.trim() || `Window ${wIdx + 1}`,
                        });
                      }}
                      title="Double-click to rename window"
                      className="text-xs font-bold truncate cursor-text"
                      style={{ color: '#1a4fb5' }}
                    >
                      ✦ {win.name?.trim() || `Window ${wIdx + 1}`}
                    </span>
                  )}
                  {hasIncoming && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setIncomingCollapsedByWin((prev) => ({
                          ...prev,
                          [win.id]: !prev[win.id],
                        }));
                      }}
                      className="px-1.5 py-0.5 text-[10px] font-bold cursor-pointer border shrink-0"
                      style={{
                        backgroundColor: isIncomingCollapsed ? '#fef3c7' : '#d97706',
                        borderColor: '#f59e0b',
                        color: isIncomingCollapsed ? '#92400e' : '#ffffff',
                      }}
                      title="Toggle separated Incoming Data panel from GUI2"
                    >
                      📥 Incoming ({selectedSet.size}/{incomingParts.length})
                    </button>
                  )}
                </div>

                <div
                  className="w-full flex flex-wrap items-center justify-center gap-1 relative"
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    type="button"
                    onClick={() =>
                      onUpdateWindowMeta(activeTabIdx, wIdx, {
                        font_size: Math.min(36, win.meta.font_size + 1),
                      })
                    }
                    className="px-1.5 py-0.5 text-[11px] font-bold cursor-pointer hover:brightness-95"
                    style={{ backgroundColor: '#e4ebf8', color: '#1a4fb5' }}
                    title="Increase font size"
                  >
                    A+
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      onUpdateWindowMeta(activeTabIdx, wIdx, {
                        font_size: Math.max(7, win.meta.font_size - 1),
                      })
                    }
                    className="px-1.5 py-0.5 text-[11px] font-bold cursor-pointer hover:brightness-95"
                    style={{ backgroundColor: '#e4ebf8', color: '#1a4fb5' }}
                    title="Decrease font size"
                  >
                    A-
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      onUpdateWindowMeta(activeTabIdx, wIdx, { bold: !win.meta.bold })
                    }
                    className="px-1.5 py-0.5 text-[11px] font-bold cursor-pointer"
                    style={{
                      backgroundColor: win.meta.bold ? '#1a4fb5' : '#e4ebf8',
                      color: win.meta.bold ? '#ffffff' : '#1a4fb5',
                    }}
                    title="Toggle Bold"
                  >
                    B
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      onUpdateWindowMeta(activeTabIdx, wIdx, {
                        italic: !win.meta.italic,
                      })
                    }
                    className="px-1.5 py-0.5 text-[11px] italic font-bold cursor-pointer"
                    style={{
                      backgroundColor: win.meta.italic ? '#1a4fb5' : '#e4ebf8',
                      color: win.meta.italic ? '#ffffff' : '#1a4fb5',
                    }}
                    title="Toggle Italic"
                  >
                    I
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setColorPickerWin(colorPickerWin === wIdx ? null : wIdx)
                    }
                    className="px-1.5 py-0.5 text-[11px] cursor-pointer hover:brightness-95"
                    style={{ backgroundColor: '#e4ebf8', color: '#1a4fb5' }}
                    title="Font colour"
                  >
                    🎨
                  </button>
                  <button
                    type="button"
                    onClick={() => setOriginalFormModal({ activeTab: wIdx + 1 })}
                    className="px-1.5 py-0.5 text-[11px] font-bold cursor-pointer hover:brightness-95"
                    style={{ backgroundColor: '#fef9c3', color: '#854d0e' }}
                    title="Original Form popup view"
                  >
                    📊 Original Form
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onFocusWindow(activeTabIdx, wIdx);
                      setInlineOriginalByWin((prev) => ({
                        ...prev,
                        [win.id]: !(prev[win.id] ?? true),
                      }));
                    }}
                    className="px-1.5 py-0.5 text-[11px] font-bold cursor-pointer hover:brightness-95"
                    style={{
                      backgroundColor: isInlineOriginal ? '#1a4fb5' : '#fef3c7',
                      color: isInlineOriginal ? '#ffffff' : '#92400e',
                    }}
                    title={
                      isInlineOriginal
                        ? 'Switch back to JSON / raw notes in this window'
                        : 'Show Original Form inside this same window'
                    }
                  >
                    {isInlineOriginal ? '🔁 JSON View' : '🔁 Original View'}
                  </button>
                  <button
                    type="button"
                    onClick={() => downloadWindowFile(win, wIdx, isInlineOriginal)}
                    className="px-1.5 py-0.5 text-[11px] font-bold cursor-pointer hover:brightness-95"
                    style={{ backgroundColor: '#dcfce7', color: '#15803d' }}
                    title={`Download Window ${wIdx + 1} (${
                      isInlineOriginal
                        ? 'Original / Text View'
                        : isValidJsonString(win.content)
                          ? 'JSON'
                          : 'Text'
                    })`}
                  >
                    ⬇ Download
                  </button>
                  <button
                    type="button"
                    onClick={() => setDialog({ type: 'clear_window', winIdx: wIdx })}
                    className="px-1.5 py-0.5 text-[11px] font-bold cursor-pointer hover:brightness-95"
                    style={{ backgroundColor: '#fef2f2', color: '#dc2626' }}
                    title={`Clear ${win.name?.trim() || `Window ${wIdx + 1}`}`}
                  >
                    🗑 Clear
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (activeTab.windows.length <= 1) {
                        setDialog({
                          type: 'warning',
                          title: 'Cannot Delete Window',
                          message: 'At least one window must remain in this tab.',
                        });
                      } else {
                        setDialog({ type: 'delete_window', winIdx: wIdx });
                      }
                    }}
                    className="px-1.5 py-0.5 text-[11px] font-bold cursor-pointer hover:brightness-95 flex items-center justify-center"
                    style={{ backgroundColor: '#fee2e2', color: '#b91c1c' }}
                    title={`Delete ${win.name?.trim() || `Window ${wIdx + 1}`}`}
                    aria-label={`Delete ${win.name?.trim() || `Window ${wIdx + 1}`}`}
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 20 20"
                      fill="currentColor"
                      className="w-3.5 h-3.5"
                    >
                      <path
                        fillRule="evenodd"
                        d="M8.75 1A2.75 2.75 0 006 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 10.23 1.482l.149-.022.841 10.518A2.75 2.75 0 007.596 19h4.807a2.75 2.75 0 002.742-2.53l.841-10.52.149.023a.75.75 0 00.23-1.482A41.03 41.03 0 0014 4.193V3.75A2.75 2.75 0 0011.25 1h-2.5zM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4zM8.58 7.72a.75.75 0 00-1.5.06l.3 7.5a.75.75 0 101.5-.06l-.3-7.5zm4.34.06a.75.75 0 10-1.5-.06l-.3 7.5a.75.75 0 101.5.06l.3-7.5z"
                        clipRule="evenodd"
                      />
                    </svg>
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      const rect = e.currentTarget.getBoundingClientRect();
                      setContextMenu({
                        winIdx: wIdx,
                        x: Math.min(rect.left, window.innerWidth - 230),
                        y: Math.min(rect.bottom + 4, window.innerHeight - 360),
                      });
                    }}
                    className="px-1.5 py-0.5 text-[11px] font-bold cursor-pointer hover:brightness-95"
                    style={{ backgroundColor: '#e4ebf8', color: '#1a4fb5' }}
                    title="Window options (or right-click text)"
                  >
                    ⋮
                  </button>

                  {colorPickerWin === wIdx && (
                    <div
                      className="absolute right-0 top-7 z-30 p-2 bg-white border shadow-lg flex items-center gap-1.5"
                      style={{ borderColor: '#bec8de' }}
                    >
                      {FONT_COLORS.map((hex) => (
                        <button
                          key={hex}
                          type="button"
                          onClick={() => {
                            onUpdateWindowMeta(activeTabIdx, wIdx, { font_color: hex });
                            setColorPickerWin(null);
                          }}
                          className="w-5 h-5 border border-slate-300 cursor-pointer"
                          style={{ backgroundColor: hex }}
                          title={hex}
                        />
                      ))}
                      <input
                        type="color"
                        value={win.meta.font_color}
                        onChange={(e) =>
                          onUpdateWindowMeta(activeTabIdx, wIdx, {
                            font_color: e.target.value,
                          })
                        }
                        className="w-6 h-6 cursor-pointer border-0 p-0"
                        title="Custom colour"
                      />
                    </div>
                  )}
                </div>
              </div>

              {/* Window Body: Left = Original Editor | Right = Incoming Data */}
              <div className="flex-1 min-h-0 flex flex-row">
                {/* Editable Textarea OR Editable Original/Text View */}
                {isInlineOriginal ? (
                  <textarea
                    ref={(el) => {
                      textTextareaRefs.current[win.id] = el;
                    }}
                    value={inlineOriginalText}
                    onFocus={(e) => {
                      onFocusWindow(activeTabIdx, wIdx);
                      recordTextCursorPos(win.id, e.currentTarget);
                    }}
                    onClick={(e) => recordTextCursorPos(win.id, e.currentTarget)}
                    onMouseUp={(e) => recordTextCursorPos(win.id, e.currentTarget)}
                    onKeyUp={(e) => recordTextCursorPos(win.id, e.currentTarget)}
                    onSelect={(e) => recordTextCursorPos(win.id, e.currentTarget)}
                    onBlur={(e) => recordTextCursorPos(win.id, e.currentTarget)}
                    onPaste={(e) => handleWindowPaste(e, wIdx, 'text')}
                    onChange={(e) => {
                      const nextText = e.target.value;
                      recordTextCursorPos(win.id, e.currentTarget);
                      if (!nextText.trim()) {
                        onUpdateWindowDual(activeTabIdx, wIdx, {
                          content: '',
                          text_content: null,
                        });
                      } else {
                        const isFormattedReport =
                          (nextText.trimStart().startsWith('════') ||
                            nextText.includes('[Metadata]') ||
                            nextText.includes('[Parameters Applied]')) &&
                          win.content.trim().startsWith('{') &&
                          win.content.includes('"data"');
                        onUpdateWindowDual(activeTabIdx, wIdx, {
                          text_content: nextText,
                          ...(isFormattedReport
                            ? {}
                            : { content: textToJsonString(nextText) }),
                        });
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.ctrlKey && e.key === 'ArrowUp') {
                        e.preventDefault();
                        scrollToWindow(Math.max(0, wIdx - 1));
                      } else if (e.ctrlKey && e.key === 'ArrowDown') {
                        e.preventDefault();
                        scrollToWindow(
                          Math.min(activeTab.windows.length - 1, wIdx + 1)
                        );
                      }
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setContextMenu({
                        winIdx: wIdx,
                        x: Math.min(e.clientX, window.innerWidth - 230),
                        y: Math.min(e.clientY, window.innerHeight - 360),
                      });
                    }}
                    spellCheck={false}
                    placeholder={`Window ${wIdx + 1} text / Original View...`}
                    className="flex-1 min-w-0 min-h-0 h-full p-2 resize-none focus:outline-none select-text"
                    style={{
                      backgroundColor: '#fffbeb',
                      color: '#1e293b',
                      fontFamily: "'Courier New', Courier, monospace",
                      fontSize: `${win.meta.font_size}pt`,
                      fontWeight: win.meta.bold ? 700 : 400,
                      fontStyle: win.meta.italic ? 'italic' : 'normal',
                      whiteSpace: wrapMode === 'none' ? 'pre' : 'pre-wrap',
                      wordBreak: wrapMode === 'char' ? 'break-all' : 'normal',
                      overflowX: wrapMode === 'none' ? 'auto' : 'hidden',
                    }}
                  />
                ) : (
                  <textarea
                    ref={(el) => {
                      textareaRefs.current[win.id] = el;
                    }}
                    value={win.content}
                    onFocus={(e) => {
                      onFocusWindow(activeTabIdx, wIdx);
                      recordCursorPos(win.id, e.currentTarget);
                    }}
                    onClick={(e) => recordCursorPos(win.id, e.currentTarget)}
                    onMouseUp={(e) => recordCursorPos(win.id, e.currentTarget)}
                    onKeyUp={(e) => recordCursorPos(win.id, e.currentTarget)}
                    onSelect={(e) => recordCursorPos(win.id, e.currentTarget)}
                    onBlur={(e) => recordCursorPos(win.id, e.currentTarget)}
                    onPaste={(e) => handleWindowPaste(e, wIdx, 'json')}
                    onChange={(e) => {
                      recordCursorPos(win.id, e.currentTarget);
                      onUpdateWindowContent(activeTabIdx, wIdx, e.target.value);
                    }}
                    onKeyDown={(e) => {
                      if (e.ctrlKey && e.key === 'ArrowUp') {
                        e.preventDefault();
                        scrollToWindow(Math.max(0, wIdx - 1));
                      } else if (e.ctrlKey && e.key === 'ArrowDown') {
                        e.preventDefault();
                        scrollToWindow(
                          Math.min(activeTab.windows.length - 1, wIdx + 1)
                        );
                      }
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setContextMenu({
                        winIdx: wIdx,
                        x: Math.min(e.clientX, window.innerWidth - 230),
                        y: Math.min(e.clientY, window.innerHeight - 360),
                      });
                    }}
                    spellCheck={false}
                    placeholder={`Window ${wIdx + 1} notes or JSON...`}
                    className="flex-1 min-w-0 min-h-0 h-full p-2 resize-none focus:outline-none select-text"
                    style={{
                      backgroundColor: '#ffffff',
                      color: win.meta.font_color,
                      fontFamily: "'Courier New', Courier, monospace",
                      fontSize: `${win.meta.font_size}pt`,
                      fontWeight: win.meta.bold ? 700 : 400,
                      fontStyle: win.meta.italic ? 'italic' : 'normal',
                      whiteSpace:
                        wrapMode === 'none'
                          ? 'pre'
                          : wrapMode === 'char'
                            ? 'pre-wrap'
                            : 'pre-wrap',
                      wordBreak: wrapMode === 'char' ? 'break-all' : 'normal',
                      overflowX: wrapMode === 'none' ? 'auto' : 'hidden',
                    }}
                  />
                )}

                {/* Separated Portion for Incoming GUI2 Data (Multi-Select + Paste at Cursor / Copy) */}
                {hasIncoming && !isIncomingCollapsed && (
                  <div
                    onClick={(e) => e.stopPropagation()}
                    className="border-l-2 w-[46%] min-w-[165px] max-w-[420px] h-full flex flex-col shrink-0 min-h-0"
                    style={{
                      borderLeftColor: '#f59e0b',
                      backgroundColor: '#fffbeb',
                      fontFamily: 'system-ui, -apple-system, Segoe UI, sans-serif',
                    }}
                  >
                    {/* Incoming Tray Toolbar */}
                    <div
                      className="flex items-start justify-between gap-1.5 px-2 py-1 border-b shrink-0"
                      style={{ backgroundColor: '#fef3c7', borderColor: '#fde68a' }}
                    >
                      <div className="flex flex-wrap items-center gap-1 min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-[11px] font-bold text-amber-900">
                            📥 Incoming Data (GUI2)
                          </span>
                          <span className="text-[10px] font-semibold text-amber-700">
                            {selectedSet.size}/{incomingParts.length} selected
                          </span>
                          <button
                            type="button"
                            onClick={() =>
                              setIncomingSelectionByWin((prev) => ({
                                ...prev,
                                [win.id]: incomingParts.map((p) => p.id),
                              }))
                            }
                            className="px-1.5 py-0.5 text-[10px] font-bold bg-white border border-amber-300 text-amber-900 cursor-pointer hover:bg-amber-100"
                          >
                            All
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setIncomingSelectionByWin((prev) => ({
                                ...prev,
                                [win.id]: [],
                              }))
                            }
                            className="px-1.5 py-0.5 text-[10px] font-bold bg-white border border-amber-300 text-amber-900 cursor-pointer hover:bg-amber-100"
                          >
                            None
                          </button>
                        </div>

                        <div className="flex flex-wrap items-center gap-1">
                          <button
                            type="button"
                            onClick={() =>
                              setIncomingFormatByWin((prev) => ({
                                ...prev,
                                [win.id]: incomingFmt === 'json' ? 'text' : 'json',
                              }))
                            }
                            className="px-1.5 py-0.5 text-[10px] font-bold bg-white border border-amber-300 text-slate-700 cursor-pointer hover:bg-slate-100"
                            title="Primary OS clipboard format for external apps (both JSON & Text sync automatically inside GUI1)"
                          >
                            {incomingFmt === 'json' ? '{ } JSON' : '≡ Text'}
                          </button>
                          <button
                            type="button"
                            disabled={selectedSet.size === 0}
                            onClick={async () => {
                              const dual = serializeSelectedIncomingDual(
                                incomingParts,
                                selectedSet
                              );
                              if (!dual.partCount) return;
                              dualClipboardRef.current = dual;
                              const activeFmtText =
                                incomingFmt === 'text' ? dual.text : dual.json;
                              await copyToClipboard(activeFmtText);
                              setIncomingCopiedWinId(win.id);
                              window.setTimeout(() => {
                                setIncomingCopiedWinId((cur) =>
                                  cur === win.id ? null : cur
                                );
                              }, 1400);
                              onStatus(
                                `📋 Copied ${dual.partCount} part(s) (both JSON & Text ready for auto-format paste)`
                              );
                            }}
                            className={`px-2 py-0.5 text-[10px] font-bold border cursor-pointer disabled:opacity-45 ${
                              incomingCopiedWinId === win.id
                                ? 'copy-btn-blink'
                                : 'bg-white border-slate-300 text-slate-800 hover:bg-slate-100'
                            }`}
                            title="Copy selected incoming parts (carries both JSON & Text for smart paste)"
                          >
                            {incomingCopiedWinId === win.id ? '✓ Copied!' : '📋 Copy'}
                          </button>
                          <button
                            type="button"
                            disabled={selectedSet.size === 0}
                            onClick={() => {
                              const dual = serializeSelectedIncomingDual(
                                incomingParts,
                                selectedSet
                              );
                              if (!dual.partCount) return;
                              dualClipboardRef.current = dual;
                              const targetView: 'json' | 'text' = isInlineOriginal
                                ? 'text'
                                : 'json';
                              applyDualToWindow(
                                wIdx,
                                dual.json,
                                dual.text,
                                targetView
                              );
                              onStatus(
                                `📥 Sent ${dual.partCount} part(s) to ${
                                  targetView === 'text' ? 'Original/Text View' : 'JSON View'
                                } & auto-synced ${
                                  targetView === 'text' ? 'JSON View' : 'Text View'
                                } in Window ${wIdx + 1}`
                              );
                            }}
                            className="px-2 py-0.5 text-[10px] font-bold text-white cursor-pointer disabled:opacity-45 hover:opacity-95"
                            style={{ backgroundColor: '#1a4fb5' }}
                            title="Send & paste in active view (JSON or Text) and auto-sync the other format"
                          >
                            📥 Send / Paste at Cursor
                          </button>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => onClearWindowIncoming(activeTabIdx, wIdx)}
                        className="px-1.5 py-0.5 text-[10px] font-bold bg-red-50 border border-red-200 text-red-600 cursor-pointer hover:bg-red-100 shrink-0 self-start"
                        title="Dismiss incoming data for this window"
                        aria-label="Close incoming data"
                      >
                        ✕
                      </button>
                    </div>

                    {/* Multi-Select Parts List */}
                    <div className="flex-1 overflow-y-auto p-1.5 space-y-1">
                      {incomingParts.map((part) => {
                        const checked = selectedSet.has(part.id);
                        return (
                          <label
                            key={part.id}
                            className={`flex items-center gap-2 px-2 py-1 border text-[11px] cursor-pointer select-none ${
                              checked
                                ? 'bg-white border-blue-400 text-slate-900'
                                : 'bg-amber-50/40 border-amber-200 text-slate-600 hover:bg-white'
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => {
                                setIncomingSelectionByWin((prev) => {
                                  const current = prev[win.id] ?? selectedIdsList;
                                  const next = current.includes(part.id)
                                    ? current.filter((id) => id !== part.id)
                                    : [...current, part.id];
                                  return { ...prev, [win.id]: next };
                                });
                              }}
                              className="shrink-0 accent-blue-600 cursor-pointer"
                            />
                            <span className="font-mono truncate flex-1" title={part.label}>
                              {part.label}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              {/* Drag Resize Handle */}
              <div
                onMouseDown={(e) => {
                  e.preventDefault();
                  dragRef.current = {
                    winIdx: wIdx,
                    orient: activeTab.orient,
                    startCoord:
                      activeTab.orient === 'vertical' ? e.clientY : e.clientX,
                    startSize:
                      activeTab.orient === 'vertical'
                        ? win.meta.height
                        : win.meta.win_width,
                  };
                }}
                title="Drag to resize window"
                className={
                  activeTab.orient === 'vertical'
                    ? 'h-1.5 w-full cursor-ns-resize shrink-0'
                    : 'w-1.5 h-full cursor-ew-resize absolute right-0 top-7 bottom-0'
                }
                style={{ backgroundColor: '#bcc8e0' }}
              />
            </div>
          );
        })}
        </div>
      </div>

      {/* ── BOTTOM NAV BAR (#eaedf5) ── */}
      <div
        className="relative flex flex-wrap items-center gap-1.5 px-3 py-1.5 border-t"
        style={{ backgroundColor: '#eaedf5', borderColor: '#bec8de' }}
      >
        <OverlayLayer
          id="gui1_navbar"
          enabled={overlayMode}
          item={overlaysMap.gui1_navbar}
          fallbackTitle="GUI1 Window Navigator"
          onEdit={onEditOverlay}
        />
        <button
          type="button"
          disabled={focusedIdx <= 0}
          onClick={() => scrollToWindow(Math.max(0, focusedIdx - 1))}
          className="px-2.5 py-1 text-xs font-bold cursor-pointer disabled:opacity-50 disabled:cursor-default"
          style={{
            backgroundColor: focusedIdx > 0 ? '#1a4fb5' : '#dde3f0',
            color: focusedIdx > 0 ? '#ffffff' : '#1e3a5f',
          }}
        >
          ◀ Prev
        </button>
        <button
          type="button"
          disabled={focusedIdx >= activeTab.windows.length - 1}
          onClick={() =>
            scrollToWindow(Math.min(activeTab.windows.length - 1, focusedIdx + 1))
          }
          className="px-2.5 py-1 text-xs font-bold cursor-pointer disabled:opacity-50 disabled:cursor-default"
          style={{
            backgroundColor:
              focusedIdx < activeTab.windows.length - 1 ? '#1a4fb5' : '#dde3f0',
            color:
              focusedIdx < activeTab.windows.length - 1 ? '#ffffff' : '#1e3a5f',
          }}
        >
          Next ▶
        </button>

        <span className="text-xs font-bold px-2" style={{ color: '#1a4fb5' }}>
          Window {focusedIdx + 1}/{activeTab.windows.length}
        </span>

        <div className="flex items-center gap-1 flex-wrap">
          {activeTab.windows.map((w, i) => (
            <button
              key={w.id}
              type="button"
              onClick={() => scrollToWindow(i)}
              className="px-2 py-0.5 text-[11px] font-bold cursor-pointer"
              style={{
                backgroundColor: i === focusedIdx ? '#1a4fb5' : '#dde3f0',
                color: i === focusedIdx ? '#ffffff' : '#1e3a5f',
              }}
            >
              {i + 1}
            </button>
          ))}
        </div>
      </div>

      {/* ── RIGHT-CLICK / QUICK CONTEXT MENU ── */}
      {contextMenu && activeTab.windows[contextMenu.winIdx] && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="fixed z-50 w-56 bg-white border shadow-xl py-1 text-xs"
          style={{
            left: contextMenu.x,
            top: contextMenu.y,
            borderColor: '#bec8de',
            color: '#333344',
          }}
        >
          <button
            type="button"
            onClick={() => {
              navigator.clipboard.writeText(
                activeTab.windows[contextMenu.winIdx].content
              );
              onStatus(`📋 Copied Window ${contextMenu.winIdx + 1} text`);
              setContextMenu(null);
            }}
            className="w-full text-left px-3 py-1.5 hover:bg-[#1a4fb5] hover:text-white cursor-pointer"
          >
            ⬚ Copy All Text
          </button>
          <button
            type="button"
            onClick={() => {
              setOriginalFormModal({ activeTab: contextMenu.winIdx + 1 });
              setContextMenu(null);
            }}
            className="w-full text-left px-3 py-1.5 hover:bg-[#1a4fb5] hover:text-white cursor-pointer"
          >
            📊 Original Form
          </button>
          <button
            type="button"
            onClick={() => {
              setDialog({ type: 'clear_window', winIdx: contextMenu.winIdx });
              setContextMenu(null);
            }}
            className="w-full text-left px-3 py-1.5 hover:bg-[#1a4fb5] hover:text-white cursor-pointer"
          >
            ⌦ Clear Window
          </button>
          <div className="my-1 border-t border-slate-200" />
          <button
            type="button"
            onClick={() => {
              insertIntoWindow(
                contextMenu.winIdx,
                new Date().toISOString().slice(0, 10)
              );
              setContextMenu(null);
            }}
            className="w-full text-left px-3 py-1.5 hover:bg-[#1a4fb5] hover:text-white cursor-pointer"
          >
            📅 Insert Date
          </button>
          <button
            type="button"
            onClick={() => {
              insertIntoWindow(
                contextMenu.winIdx,
                new Date().toTimeString().slice(0, 8)
              );
              setContextMenu(null);
            }}
            className="w-full text-left px-3 py-1.5 hover:bg-[#1a4fb5] hover:text-white cursor-pointer"
          >
            🕐 Insert Time
          </button>
          <button
            type="button"
            onClick={() => {
              insertIntoWindow(
                contextMenu.winIdx,
                `\n${'─'.repeat(50)}\n`
              );
              setContextMenu(null);
            }}
            className="w-full text-left px-3 py-1.5 hover:bg-[#1a4fb5] hover:text-white cursor-pointer"
          >
            ─ Insert Divider
          </button>
          <div className="my-1 border-t border-slate-200" />
          <button
            type="button"
            onClick={() => {
              const src = activeTab.windows[contextMenu.winIdx];
              onAddWindow(activeTabIdx, src.content, { ...src.meta });
              setContextMenu(null);
            }}
            className="w-full text-left px-3 py-1.5 hover:bg-[#1a4fb5] hover:text-white cursor-pointer"
          >
            ⧉ Duplicate This Window
          </button>
          <div className="px-3 py-1 text-[10px] font-bold text-slate-400">
            HEIGHT / WIDTH / WRAP
          </div>
          <div className="flex flex-wrap gap-1 px-3 pb-1.5">
            {[
              ['120px', 120],
              ['210px', 210],
              ['340px', 340],
              ['480px', 480],
            ].map(([lbl, h]) => (
              <button
                key={String(lbl)}
                type="button"
                onClick={() => {
                  onUpdateWindowMeta(activeTabIdx, contextMenu.winIdx, {
                    height: Number(h),
                  });
                  setContextMenu(null);
                }}
                className="px-1.5 py-0.5 bg-slate-100 hover:bg-[#1a4fb5] hover:text-white text-[10px] cursor-pointer"
              >
                H:{lbl}
              </button>
            ))}
            {(['word', 'char', 'none'] as WrapMode[]).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => {
                  onUpdateWindowMeta(activeTabIdx, contextMenu.winIdx, {
                    wrap: mode,
                  });
                  setContextMenu(null);
                }}
                className="px-1.5 py-0.5 bg-slate-100 hover:bg-[#1a4fb5] hover:text-white text-[10px] cursor-pointer"
              >
                Wrap:{mode}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── DIALOG MODALS (Replaces tkinter simpledialog/messagebox) ── */}
      {dialog && (
        <div
          onClick={() => {
            if (!isSaving) closeDialog();
          }}
          className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-white border shadow-2xl w-full max-w-md p-5"
            style={{ borderColor: '#bec8de', fontFamily: 'system-ui, sans-serif' }}
          >
            {dialog.type === 'new_project' && (() => {
              const suggested = suggestDirFromProjectName(dialog.name);
              return (
                <>
                  <h3 className="text-base font-bold text-slate-900 mb-1">
                    🆕 New Project
                  </h3>
                  <p className="text-[11px] text-slate-500 mb-3">
                    Choose a project name, where to make its default directory, and computer save folder.
                  </p>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">
                    Project name:
                  </label>
                  <input
                    type="text"
                    autoFocus
                    value={dialog.name}
                    onChange={(e) => {
                      const nextName = e.target.value;
                      const nextSuggested = suggestDirFromProjectName(nextName);
                      setDialog({
                        ...dialog,
                        name: nextName,
                        ...(dialog.dirSyncedToName ? { dir: nextSuggested } : {}),
                      });
                    }}
                    className="w-full border border-slate-300 px-3 py-1.5 text-sm mb-3"
                  />

                  <div className="flex items-center justify-between gap-2 mb-1">
                    <label className="block text-xs font-semibold text-slate-600">
                      Where to make default directory for this project:
                    </label>
                    <button
                      type="button"
                      onClick={() =>
                        setDialog({ ...dialog, dir: suggested, dirSyncedToName: true })
                      }
                      className="px-1.5 py-0.5 text-[10px] font-bold bg-blue-50 border border-blue-200 text-blue-700 cursor-pointer hover:bg-blue-100"
                    >
                      ✨ Use Project Name ({suggested})
                    </button>
                  </div>
                  <input
                    type="text"
                    value={dialog.dir}
                    onChange={(e) =>
                      setDialog({
                        ...dialog,
                        dir: e.target.value,
                        dirSyncedToName: false,
                      })
                    }
                    className="w-full border border-slate-300 px-3 py-1.5 text-sm mb-2 font-mono"
                  />

                  <label className="flex items-center gap-2 text-xs text-slate-700 mb-3 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={dialog.makeDefaultDir}
                      onChange={(e) =>
                        setDialog({ ...dialog, makeDefaultDir: e.target.checked })
                      }
                      className="accent-[#6d28d9] cursor-pointer"
                    />
                    <span className="font-semibold">
                      Make this the default directory for this project
                    </span>
                  </label>

                  <div className="bg-slate-50 border border-slate-200 p-2.5 mb-3">
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <span className="text-xs font-semibold text-slate-700">
                        Save to which directory in computer?
                      </span>
                      <button
                        type="button"
                        onClick={() => void handleBrowseComputerDirectory(false)}
                        className="px-2 py-0.5 text-[11px] font-bold bg-white border border-slate-300 text-slate-800 cursor-pointer hover:bg-slate-100"
                      >
                        💻 Browse Computer Folder
                      </button>
                    </div>
                    <input
                      type="text"
                      value={dialog.computerDir}
                      onChange={(e) =>
                        setDialog({ ...dialog, computerDir: e.target.value })
                      }
                      placeholder="e.g. C:\Projects\my_project or ~/Documents/my_project"
                      className="w-full border border-slate-300 bg-white px-2.5 py-1 text-xs font-mono"
                    />
                    {computerDirHandle && (
                      <div className="text-[10px] text-emerald-700 font-semibold mt-1">
                        ✓ Linked computer folder: {computerDirHandle.name}
                      </div>
                    )}
                    {computerPickerNotice && (
                      <div className="text-[10px] text-amber-700 mt-1">
                        {computerPickerNotice}
                      </div>
                    )}
                    {iframeDirRestricted && (
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        <a
                          href={typeof window !== 'undefined' ? window.location.href : '/'}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="px-2 py-0.5 text-[10px] font-bold text-white no-underline"
                          style={{ backgroundColor: '#1a4fb5' }}
                        >
                          ↗ Open in New Tab (Real Folder Picker)
                        </a>
                      </div>
                    )}
                  </div>

                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setDialog(null)}
                      className="px-3 py-1.5 text-xs font-semibold bg-slate-100 text-slate-700 cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (dialog.name.trim()) {
                          if (dialog.computerDir.trim()) {
                            persistComputerDirLabel(dialog.computerDir.trim());
                          }
                          const chosenDir = dialog.makeDefaultDir
                            ? dialog.dir.trim() || suggested
                            : saveDir || 'workspace';
                          onNewProject(dialog.name.trim(), chosenDir);
                        }
                        setDialog(null);
                      }}
                      className="px-3 py-1.5 text-xs font-semibold text-white cursor-pointer"
                      style={{ backgroundColor: '#6d28d9' }}
                    >
                      Create Project
                    </button>
                  </div>
                </>
              );
            })()}

            {dialog.type === 'set_dir' && (() => {
              const suggested = suggestDirFromProjectName(projectName);
              return (
                <>
                  <h3 className="text-base font-bold text-slate-900 mb-1">
                    📁 Where to Set Default Directory
                  </h3>
                  <p className="text-[11px] text-slate-500 mb-3">
                    Choose where to make the default directory for{' '}
                    <span className="font-semibold text-slate-700">{projectName}</span> (suggests
                    project name as folder).
                  </p>

                  <div className="flex items-center justify-between gap-2 mb-1">
                    <label className="block text-xs font-semibold text-slate-600">
                      Project Default Directory:
                    </label>
                    <button
                      type="button"
                      onClick={() => setDialog({ ...dialog, dir: suggested })}
                      className="px-2 py-0.5 text-[10px] font-bold bg-blue-50 border border-blue-200 text-blue-700 cursor-pointer hover:bg-blue-100"
                    >
                      ✨ Suggest: {suggested}
                    </button>
                  </div>
                  <input
                    type="text"
                    autoFocus
                    value={dialog.dir}
                    onChange={(e) =>
                      setDialog({ ...dialog, dir: e.target.value })
                    }
                    placeholder={suggested}
                    className="w-full border border-slate-300 px-3 py-1.5 text-sm mb-3 font-mono"
                  />

                  <div className="bg-slate-50 border border-slate-200 p-2.5 mb-4">
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <span className="text-xs font-semibold text-slate-700">
                        Save to which directory in computer?
                      </span>
                      <button
                        type="button"
                        onClick={() => void handleBrowseComputerDirectory(true)}
                        className="px-2 py-0.5 text-[11px] font-bold bg-white border border-slate-300 text-slate-800 cursor-pointer hover:bg-slate-100"
                      >
                        💻 Choose Computer Folder
                      </button>
                    </div>
                    <input
                      type="text"
                      value={dialog.computerDir}
                      onChange={(e) =>
                        setDialog({ ...dialog, computerDir: e.target.value })
                      }
                      placeholder={`e.g. C:\\Users\\You\\Documents\\${suggested}`}
                      className="w-full border border-slate-300 bg-white px-2.5 py-1 text-xs font-mono"
                    />
                    {computerDirHandle && (
                      <div className="text-[10px] text-emerald-700 font-semibold mt-1">
                        ✓ Linked computer folder: {computerDirHandle.name} (ready for direct write)
                      </div>
                    )}
                    {computerPickerNotice && (
                      <div className="text-[10px] text-amber-700 mt-1">
                        {computerPickerNotice}
                      </div>
                    )}
                    {iframeDirRestricted && (
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        <a
                          href={typeof window !== 'undefined' ? window.location.href : '/'}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="px-2 py-0.5 text-[10px] font-bold text-white no-underline"
                          style={{ backgroundColor: '#1a4fb5' }}
                        >
                          ↗ Open in New Tab (Real Folder Picker)
                        </a>
                      </div>
                    )}
                  </div>

                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setDialog(null)}
                      className="px-3 py-1.5 text-xs font-semibold bg-slate-100 text-slate-700 cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const chosen = dialog.dir.trim() || suggested;
                        if (dialog.computerDir.trim()) {
                          persistComputerDirLabel(dialog.computerDir.trim());
                        }
                        onSetSaveDir(chosen);
                        setDialog(null);
                      }}
                      className="px-3 py-1.5 text-xs font-semibold text-white cursor-pointer"
                      style={{ backgroundColor: '#7c3aed' }}
                    >
                      Set Default Directory
                    </button>
                  </div>
                </>
              );
            })()}

            {dialog.type === 'add_tab' && (
              <>
                <h3 className="text-base font-bold text-slate-900 mb-3">
                  New Tab
                </h3>
                <label className="block text-xs font-semibold text-slate-600 mb-1">
                  Tab name:
                </label>
                <input
                  type="text"
                  autoFocus
                  value={dialog.name}
                  onChange={(e) =>
                    setDialog({ ...dialog, name: e.target.value })
                  }
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && dialog.name.trim()) {
                      onAddTab(dialog.name.trim());
                      setDialog(null);
                    }
                  }}
                  className="w-full border border-slate-300 px-3 py-1.5 text-sm mb-4"
                />
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setDialog(null)}
                    className="px-3 py-1.5 text-xs font-semibold bg-slate-100 text-slate-700 cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (dialog.name.trim()) onAddTab(dialog.name.trim());
                      setDialog(null);
                    }}
                    className="px-3 py-1.5 text-xs font-semibold text-white cursor-pointer"
                    style={{ backgroundColor: '#22c55e' }}
                  >
                    Add Tab
                  </button>
                </div>
              </>
            )}

            {dialog.type === 'rename_tab' && (
              <>
                <h3 className="text-base font-bold text-slate-900 mb-3">
                  Rename Tab
                </h3>
                <input
                  type="text"
                  autoFocus
                  value={dialog.name}
                  onChange={(e) =>
                    setDialog({ ...dialog, name: e.target.value })
                  }
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && dialog.name.trim()) {
                      onRenameTab(dialog.idx, dialog.name.trim());
                      setDialog(null);
                    }
                  }}
                  className="w-full border border-slate-300 px-3 py-1.5 text-sm mb-4"
                />
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setDialog(null)}
                    className="px-3 py-1.5 text-xs font-semibold bg-slate-100 text-slate-700 cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (dialog.name.trim())
                        onRenameTab(dialog.idx, dialog.name.trim());
                      setDialog(null);
                    }}
                    className="px-3 py-1.5 text-xs font-semibold text-white cursor-pointer"
                    style={{ backgroundColor: '#1a4fb5' }}
                  >
                    Rename
                  </button>
                </div>
              </>
            )}

            {dialog.type === 'close_tab' && (
              <>
                <h3 className="text-base font-bold text-slate-900 mb-2">
                  Close Tab
                </h3>
                <p className="text-sm text-slate-600 mb-4">
                  Close tab &apos;{dialog.name}&apos;? All content will be lost.
                </p>
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setDialog(null)}
                    className="px-3 py-1.5 text-xs font-semibold bg-slate-100 text-slate-700 cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onCloseTab(dialog.idx);
                      setDialog(null);
                    }}
                    className="px-3 py-1.5 text-xs font-semibold text-white bg-red-600 cursor-pointer"
                  >
                    Close Tab
                  </button>
                </div>
              </>
            )}

            {dialog.type === 'clear_tab' && (
              <>
                <h3 className="text-base font-bold text-slate-900 mb-2">
                  Clear Tab
                </h3>
                <p className="text-sm text-slate-600 mb-4">
                  Clear all windows in &apos;{dialog.name}&apos;?
                </p>
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setDialog(null)}
                    className="px-3 py-1.5 text-xs font-semibold bg-slate-100 text-slate-700 cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onClearTab(dialog.idx);
                      setDialog(null);
                    }}
                    className="px-3 py-1.5 text-xs font-semibold text-white bg-red-600 cursor-pointer"
                  >
                    Clear All Windows
                  </button>
                </div>
              </>
            )}

            {dialog.type === 'clear_window' && (
              <>
                <h3 className="text-base font-bold text-slate-900 mb-2">
                  Clear Window
                </h3>
                <p className="text-sm text-slate-600 mb-4">
                  Clear all text in{' '}
                  {activeTab.windows[dialog.winIdx]?.name?.trim() ||
                    `Window ${dialog.winIdx + 1}`}
                  ?
                </p>
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setDialog(null)}
                    className="px-3 py-1.5 text-xs font-semibold bg-slate-100 text-slate-700 cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onUpdateWindowContent(activeTabIdx, dialog.winIdx, '');
                      setDialog(null);
                    }}
                    className="px-3 py-1.5 text-xs font-semibold text-white bg-red-600 cursor-pointer"
                  >
                    Clear
                  </button>
                </div>
              </>
            )}

            {dialog.type === 'delete_window' && (
              <>
                <h3 className="text-base font-bold text-slate-900 mb-2">
                  Delete Window
                </h3>
                <p className="text-sm text-slate-600 mb-4">
                  Delete{' '}
                  <span className="font-semibold text-slate-800">
                    {activeTab.windows[dialog.winIdx]?.name?.trim() ||
                      `Window ${dialog.winIdx + 1}`}
                  </span>
                  ? This window and its content will be permanently removed.
                </p>
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setDialog(null)}
                    className="px-3 py-1.5 text-xs font-semibold bg-slate-100 text-slate-700 cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onDeleteWindow(activeTabIdx, dialog.winIdx);
                      setDialog(null);
                    }}
                    className="px-3 py-1.5 text-xs font-semibold text-white bg-red-600 cursor-pointer"
                  >
                    Delete
                  </button>
                </div>
              </>
            )}

            {dialog.type === 'save_project' && (() => {
              const suggested = suggestDirFromProjectName(dialog.name || projectName);
              const cleanBase =
                dialog.name.trim().replace(/\.notetool$/i, '') || 'NoteTool_Project';

              const handleSaveProjectClick = (alsoDownload: boolean, skipComputerPicker = false) => {
                if (!dialog.dir.trim() || !dialog.name.trim()) {
                  setDialog({
                    ...dialog,
                    error: 'Please enter both a directory and a file name.',
                  });
                  return;
                }
                if (alsoDownload && !skipComputerPicker && !computerDirConfirmed) {
                  triggerSaveAndDownloadWithDirPicker({
                    kind: 'save_project',
                    dir: dialog.dir,
                    name: dialog.name,
                    makeDefaultDir: dialog.makeDefaultDir,
                  });
                  return;
                }
                void executeSaveProject({
                  dir: dialog.dir,
                  name: dialog.name,
                  alsoDownload,
                  makeDefaultDir: dialog.makeDefaultDir,
                  computerDir: dialog.computerDir,
                });
              };

              return (
                <>
                  <h3 className="text-base font-bold text-slate-900 mb-3">
                    💾 Save Project (.notetool)
                  </h3>
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <label className="block text-xs font-semibold text-slate-600">
                      Directory to save:
                    </label>
                    <button
                      type="button"
                      onClick={() =>
                        setDialog({ ...dialog, dir: suggested, error: undefined })
                      }
                      className="px-1.5 py-0.5 text-[10px] font-bold bg-blue-50 border border-blue-200 text-blue-700 cursor-pointer hover:bg-blue-100"
                    >
                      ✨ Suggest Project Name ({suggested})
                    </button>
                  </div>
                  <input
                    type="text"
                    autoFocus
                    value={dialog.dir}
                    onChange={(e) =>
                      setDialog({ ...dialog, dir: e.target.value, error: undefined })
                    }
                    placeholder={suggested}
                    className="w-full border border-slate-300 px-3 py-1.5 text-sm mb-2 font-mono"
                  />
                  <label className="flex items-center gap-2 text-xs text-slate-700 mb-3 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={dialog.makeDefaultDir}
                      onChange={(e) =>
                        setDialog({ ...dialog, makeDefaultDir: e.target.checked })
                      }
                      className="accent-[#0f766e] cursor-pointer"
                    />
                    <span className="font-semibold">
                      Make this the default directory for this project
                    </span>
                  </label>

                  <label className="block text-xs font-semibold text-slate-600 mb-1">
                    File / project name:
                  </label>
                  <input
                    type="text"
                    value={dialog.name}
                    onChange={(e) =>
                      setDialog({ ...dialog, name: e.target.value, error: undefined })
                    }
                    placeholder="NoteTool_Project"
                    className="w-full border border-slate-300 px-3 py-1.5 text-sm mb-2 font-mono"
                  />

                  <div className="bg-slate-50 border border-slate-200 p-2.5 mb-2">
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <span className="text-xs font-semibold text-slate-700">
                        Save to which directory in computer?
                      </span>
                      <button
                        type="button"
                        onClick={() => handleBrowseComputerDirectory(false)}
                        className="px-2 py-0.5 text-[11px] font-bold bg-white border border-slate-300 text-slate-800 cursor-pointer hover:bg-slate-100"
                      >
                        💻 Choose Computer Folder
                      </button>
                    </div>
                    <input
                      type="text"
                      value={dialog.computerDir}
                      onChange={(e) =>
                        setDialog({ ...dialog, computerDir: e.target.value })
                      }
                      placeholder={`e.g. C:\\Projects\\${suggested} or Downloads`}
                      className="w-full border border-slate-300 bg-white px-2.5 py-1 text-xs font-mono"
                    />
                    {computerDirHandle && (
                      <div className="text-[10px] text-emerald-700 font-semibold mt-1">
                        ✓ Will also write directly into computer folder: {computerDirHandle.name}/{cleanBase}.notetool
                      </div>
                    )}
                    {computerPickerNotice && (
                      <div className="text-[10px] text-amber-700 mt-1">
                        {computerPickerNotice}
                      </div>
                    )}
                    {awaitingComputerSavePick && (
                      <div className="mt-2 p-2 bg-blue-50 border border-blue-200 text-[11px] text-blue-900">
                        <div className="font-semibold mb-1.5">
                          {iframeDirRestricted
                            ? 'Embedded preview blocks the native "Select Folder" dialog.'
                            : 'Select the destination directory in the opened folder picker...'}
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => handleSaveProjectClick(true, true)}
                            className="px-2 py-1 text-[10px] font-bold text-white cursor-pointer"
                            style={{ backgroundColor: '#1a4fb5' }}
                          >
                            ⬇ Save &amp; Download to Computer Now
                          </button>
                          <a
                            href={typeof window !== 'undefined' ? window.location.href : '/'}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="px-2 py-1 text-[10px] font-bold bg-white border border-blue-300 text-blue-800 no-underline hover:bg-blue-100"
                          >
                            ↗ Open in New Tab (Choose Folder)
                          </a>
                        </div>
                      </div>
                    )}
                    {!awaitingComputerSavePick && iframeDirRestricted && (
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        <a
                          href={typeof window !== 'undefined' ? window.location.href : '/'}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="px-2 py-0.5 text-[10px] font-bold text-white no-underline"
                          style={{ backgroundColor: '#1a4fb5' }}
                        >
                          ↗ Open in New Tab (Real Folder Picker)
                        </a>
                      </div>
                    )}
                  </div>

                  <p className="text-[11px] text-slate-500 mb-3 font-mono">
                    Server Target: saved_projects/{dialog.dir.trim() || 'workspace'}/
                    {cleanBase}.notetool
                  </p>
                  {dialog.error && (
                    <p className="text-xs text-red-600 font-semibold mb-3">{dialog.error}</p>
                  )}
                  <div className="flex flex-wrap justify-end gap-2">
                    <button
                      type="button"
                      disabled={isSaving}
                      onClick={closeDialog}
                      className="px-3 py-1.5 text-xs font-semibold bg-slate-100 text-slate-700 cursor-pointer disabled:opacity-50"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      disabled={isSaving}
                      onClick={() => handleSaveProjectClick(false)}
                      className="px-3 py-1.5 text-xs font-semibold text-white cursor-pointer disabled:opacity-50"
                      style={{ backgroundColor: '#0f766e' }}
                    >
                      {isSaving ? 'Saving...' : 'Save to Directory'}
                    </button>
                    <button
                      type="button"
                      disabled={isSaving}
                      onClick={() => handleSaveProjectClick(true)}
                      className="px-3 py-1.5 text-xs font-semibold text-white cursor-pointer disabled:opacity-50"
                      style={{ backgroundColor: '#1a4fb5' }}
                    >
                      {isSaving ? 'Saving...' : 'Save & Download to Computer'}
                    </button>
                  </div>
                </>
              );
            })()}

            {dialog.type === 'save_all_txt' && (() => {
              const suggested = suggestDirFromProjectName(dialog.name || projectName);
              const cleanBase =
                dialog.name.trim().replace(/\.txt$/i, '') || projectName || 'note_tool';
              const combinedFileName = cleanBase.endsWith('_all_tabs')
                ? `${cleanBase}.txt`
                : `${cleanBase}_all_tabs.txt`;

              const handleSaveAllClick = (alsoDownload: boolean, skipComputerPicker = false) => {
                if (!dialog.dir.trim() || !dialog.name.trim()) {
                  setDialog({
                    ...dialog,
                    error: 'Please enter both a directory and a save name.',
                  });
                  return;
                }
                if (alsoDownload && !skipComputerPicker && !computerDirConfirmed) {
                  triggerSaveAndDownloadWithDirPicker({
                    kind: 'save_all',
                    dir: dialog.dir,
                    name: dialog.name,
                    makeDefaultDir: dialog.makeDefaultDir,
                  });
                  return;
                }
                void executeSaveAll({
                  dir: dialog.dir,
                  name: dialog.name,
                  alsoDownload,
                  makeDefaultDir: dialog.makeDefaultDir,
                  computerDir: dialog.computerDir,
                });
              };

              return (
                <>
                  <h3 className="text-base font-bold text-slate-900 mb-3">
                    💾 Save All Tabs (.txt Export)
                  </h3>
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <label className="block text-xs font-semibold text-slate-600">
                      Directory to save:
                    </label>
                    <button
                      type="button"
                      onClick={() =>
                        setDialog({ ...dialog, dir: suggested, error: undefined })
                      }
                      className="px-1.5 py-0.5 text-[10px] font-bold bg-blue-50 border border-blue-200 text-blue-700 cursor-pointer hover:bg-blue-100"
                    >
                      ✨ Suggest Project Name ({suggested})
                    </button>
                  </div>
                  <input
                    type="text"
                    autoFocus
                    value={dialog.dir}
                    onChange={(e) =>
                      setDialog({ ...dialog, dir: e.target.value, error: undefined })
                    }
                    placeholder={suggested}
                    className="w-full border border-slate-300 px-3 py-1.5 text-sm mb-2 font-mono"
                  />
                  <label className="flex items-center gap-2 text-xs text-slate-700 mb-3 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={dialog.makeDefaultDir}
                      onChange={(e) =>
                        setDialog({ ...dialog, makeDefaultDir: e.target.checked })
                      }
                      className="accent-[#15803d] cursor-pointer"
                    />
                    <span className="font-semibold">
                      Make this the default directory for this project
                    </span>
                  </label>

                  <label className="block text-xs font-semibold text-slate-600 mb-1">
                    Save name (combined file prefix):
                  </label>
                  <input
                    type="text"
                    value={dialog.name}
                    onChange={(e) =>
                      setDialog({ ...dialog, name: e.target.value, error: undefined })
                    }
                    placeholder="note_tool"
                    className="w-full border border-slate-300 px-3 py-1.5 text-sm mb-2 font-mono"
                  />

                  <div className="bg-slate-50 border border-slate-200 p-2.5 mb-2">
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <span className="text-xs font-semibold text-slate-700">
                        Save to which directory in computer?
                      </span>
                      <button
                        type="button"
                        onClick={() => handleBrowseComputerDirectory(false)}
                        className="px-2 py-0.5 text-[11px] font-bold bg-white border border-slate-300 text-slate-800 cursor-pointer hover:bg-slate-100"
                      >
                        💻 Choose Computer Folder
                      </button>
                    </div>
                    <input
                      type="text"
                      value={dialog.computerDir}
                      onChange={(e) =>
                        setDialog({ ...dialog, computerDir: e.target.value })
                      }
                      placeholder={`e.g. C:\\Projects\\${suggested} or Downloads`}
                      className="w-full border border-slate-300 bg-white px-2.5 py-1 text-xs font-mono"
                    />
                    {computerDirHandle && (
                      <div className="text-[10px] text-emerald-700 font-semibold mt-1">
                        ✓ Will also write {tabs.length + 1} files into computer folder: {computerDirHandle.name}
                      </div>
                    )}
                    {computerPickerNotice && (
                      <div className="text-[10px] text-amber-700 mt-1">
                        {computerPickerNotice}
                      </div>
                    )}
                    {awaitingComputerSavePick && (
                      <div className="mt-2 p-2 bg-blue-50 border border-blue-200 text-[11px] text-blue-900">
                        <div className="font-semibold mb-1.5">
                          {iframeDirRestricted
                            ? 'Embedded preview blocks the native "Select Folder" dialog.'
                            : 'Select the destination directory in the opened folder picker...'}
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => handleSaveAllClick(true, true)}
                            className="px-2 py-1 text-[10px] font-bold text-white cursor-pointer"
                            style={{ backgroundColor: '#1a4fb5' }}
                          >
                            ⬇ Save &amp; Download to Computer Now
                          </button>
                          <a
                            href={typeof window !== 'undefined' ? window.location.href : '/'}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="px-2 py-1 text-[10px] font-bold bg-white border border-blue-300 text-blue-800 no-underline hover:bg-blue-100"
                          >
                            ↗ Open in New Tab (Choose Folder)
                          </a>
                        </div>
                      </div>
                    )}
                    {!awaitingComputerSavePick && iframeDirRestricted && (
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        <a
                          href={typeof window !== 'undefined' ? window.location.href : '/'}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="px-2 py-0.5 text-[10px] font-bold text-white no-underline"
                          style={{ backgroundColor: '#1a4fb5' }}
                        >
                          ↗ Open in New Tab (Real Folder Picker)
                        </a>
                      </div>
                    )}
                  </div>

                  <p className="text-[11px] text-slate-500 mb-2 font-mono">
                    Server Target: saved_projects/{dialog.dir.trim() || 'workspace'}/
                    {combinedFileName} + {tabs.length} tab .txt files
                  </p>
                  {dialog.error && (
                    <p className="text-xs text-red-600 font-semibold mb-3">{dialog.error}</p>
                  )}
                  <div className="max-h-36 overflow-y-auto border border-slate-200 divide-y divide-slate-200 mb-3">
                    {tabs.map((t) => (
                      <div
                        key={t.id}
                        className="flex items-center justify-between px-3 py-1.5 text-xs"
                      >
                        <span className="font-mono font-semibold text-slate-800">
                          {noteSlug(t.tab_name)}.txt
                        </span>
                        <button
                          type="button"
                          onClick={() => downloadSingleTxt(t)}
                          className="px-2 py-0.5 text-white font-semibold cursor-pointer"
                          style={{ backgroundColor: '#15803d' }}
                        >
                          Download
                        </button>
                      </div>
                    ))}
                  </div>
                  <div className="flex flex-wrap justify-end gap-2">
                    <button
                      type="button"
                      disabled={isSaving}
                      onClick={closeDialog}
                      className="px-3 py-1.5 text-xs font-semibold bg-slate-100 text-slate-700 cursor-pointer disabled:opacity-50"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      disabled={isSaving}
                      onClick={() => handleSaveAllClick(false)}
                      className="px-3 py-1.5 text-xs font-semibold text-white cursor-pointer disabled:opacity-50"
                      style={{ backgroundColor: '#15803d' }}
                    >
                      {isSaving ? 'Saving...' : 'Save All to Directory'}
                    </button>
                    <button
                      type="button"
                      disabled={isSaving}
                      onClick={() => handleSaveAllClick(true)}
                      className="px-3 py-1.5 text-xs font-semibold text-white cursor-pointer disabled:opacity-50"
                      style={{ backgroundColor: '#1a4fb5' }}
                    >
                      {isSaving ? 'Saving...' : 'Save & Download to Computer'}
                    </button>
                  </div>
                </>
              );
            })()}

            {dialog.type === 'download_all_tab' && (() => {
              const handleDownloadAllTabClick = (skipComputerPicker = false) => {
                if (!dialog.fileName.trim()) {
                  setDialog({
                    ...dialog,
                    error: 'Please enter a file name.',
                  });
                  return;
                }
                if (!skipComputerPicker && !computerDirConfirmed) {
                  triggerSaveAndDownloadWithDirPicker({
                    kind: 'download_all_tab',
                    fileName: dialog.fileName,
                    computerDir: dialog.computerDir,
                  });
                  return;
                }
                void executeDownloadAllTab({
                  fileName: dialog.fileName,
                  computerDir: dialog.computerDir,
                });
              };

              return (
                <>
                  <h3 className="text-base font-bold text-slate-900 mb-1">
                    ⬇ Download All Windows
                  </h3>
                  <p className="text-[11px] text-slate-500 mb-3">
                    Ask which computer folder to save{' '}
                    <span className="font-semibold text-slate-700">
                      {activeTab.windows.length} combined windows
                    </span>{' '}
                    from <span className="font-semibold text-slate-700">{activeTab.tab_name}</span>.
                  </p>

                  <label className="block text-xs font-semibold text-slate-600 mb-1">
                    File name:
                  </label>
                  <input
                    type="text"
                    autoFocus
                    value={dialog.fileName}
                    onChange={(e) =>
                      setDialog({ ...dialog, fileName: e.target.value, error: undefined })
                    }
                    placeholder={`${noteSlug(activeTab.tab_name)}_all_windows.txt`}
                    className="w-full border border-slate-300 px-3 py-1.5 text-sm mb-3 font-mono"
                  />

                  <div className="bg-slate-50 border border-slate-200 p-2.5 mb-3">
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <span className="text-xs font-semibold text-slate-700">
                        Which computer folder should it be saved to?
                      </span>
                      <button
                        type="button"
                        onClick={() => handleBrowseComputerDirectory(false)}
                        className="px-2 py-0.5 text-[11px] font-bold bg-white border border-slate-300 text-slate-800 cursor-pointer hover:bg-slate-100"
                      >
                        💻 Choose Computer Folder
                      </button>
                    </div>
                    <input
                      type="text"
                      value={dialog.computerDir}
                      onChange={(e) =>
                        setDialog({ ...dialog, computerDir: e.target.value })
                      }
                      placeholder="e.g. C:\Projects\esp32 or Downloads"
                      className="w-full border border-slate-300 bg-white px-2.5 py-1 text-xs font-mono"
                    />
                    {computerDirHandle && (
                      <div className="text-[10px] text-emerald-700 font-semibold mt-1">
                        ✓ Will write directly into computer folder: {computerDirHandle.name}/
                        {dialog.fileName.trim() || `${noteSlug(activeTab.tab_name)}_all_windows.txt`}
                      </div>
                    )}
                    {computerPickerNotice && (
                      <div className="text-[10px] text-amber-700 mt-1">
                        {computerPickerNotice}
                      </div>
                    )}
                    {awaitingComputerSavePick && (
                      <div className="mt-2 p-2 bg-blue-50 border border-blue-200 text-[11px] text-blue-900">
                        <div className="font-semibold mb-1.5">
                          {iframeDirRestricted
                            ? 'Embedded preview blocks the native "Select Folder" dialog.'
                            : 'Select the computer folder in the opened folder picker...'}
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => handleDownloadAllTabClick(true)}
                            className="px-2 py-1 text-[10px] font-bold text-white cursor-pointer"
                            style={{ backgroundColor: '#15803d' }}
                          >
                            ⬇ Download to Computer Now
                          </button>
                          <a
                            href={typeof window !== 'undefined' ? window.location.href : '/'}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="px-2 py-1 text-[10px] font-bold bg-white border border-blue-300 text-blue-800 no-underline hover:bg-blue-100"
                          >
                            ↗ Open in New Tab (Choose Folder)
                          </a>
                        </div>
                      </div>
                    )}
                    {!awaitingComputerSavePick && iframeDirRestricted && (
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        <a
                          href={typeof window !== 'undefined' ? window.location.href : '/'}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="px-2 py-0.5 text-[10px] font-bold text-white no-underline"
                          style={{ backgroundColor: '#1a4fb5' }}
                        >
                          ↗ Open in New Tab (Real Folder Picker)
                        </a>
                      </div>
                    )}
                  </div>

                  {dialog.error && (
                    <p className="text-xs text-red-600 font-semibold mb-3">{dialog.error}</p>
                  )}

                  <div className="flex flex-wrap justify-end gap-2">
                    <button
                      type="button"
                      disabled={isSaving}
                      onClick={closeDialog}
                      className="px-3 py-1.5 text-xs font-semibold bg-slate-100 text-slate-700 cursor-pointer disabled:opacity-50"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      disabled={isSaving}
                      onClick={() => handleDownloadAllTabClick(false)}
                      className="px-3 py-1.5 text-xs font-semibold text-white cursor-pointer disabled:opacity-50"
                      style={{ backgroundColor: '#15803d' }}
                    >
                      {isSaving ? 'Saving...' : 'Save & Download'}
                    </button>
                  </div>
                </>
              );
            })()}

            {dialog.type === 'warning' && (
              <>
                <h3 className="text-base font-bold text-slate-900 mb-2">
                  {dialog.title}
                </h3>
                <p className="text-sm text-slate-600 mb-4">{dialog.message}</p>
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => setDialog(null)}
                    className="px-3 py-1.5 text-xs font-semibold text-white cursor-pointer"
                    style={{ backgroundColor: '#1a4fb5' }}
                  >
                    OK
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
      {/* ── ORIGINAL FORM MULTI-WINDOW POPUP ── */}
      {originalFormModal && (() => {
        const allWinEntries = activeTab.windows.map((w, idx) => {
          const winName = w.name?.trim() || `Window ${idx + 1}`;
          const formattedText =
            w.text_content !== undefined
              ? w.text_content
              : w.content.trim()
                ? jsonToSnippetText(w.content)
                : '';
          return {
            windowId: idx + 1,
            name: winName,
            content: w.content,
            text: formattedText,
          };
        });
        const allCombinedText =
          [
            '█'.repeat(74),
            `  ALL WINDOWS ORIGINAL FORM  •  TAB: ${activeTab.tab_name.toUpperCase()}  •  ${allWinEntries.length} WINDOW(S)`,
            '█'.repeat(74),
            '',
          ].join('\n') +
          allWinEntries
            .map(
              (w) =>
                `${'─'.repeat(74)}\n  ${w.name.toUpperCase()}\n${'─'.repeat(74)}\n${
                  w.text.trim() ? w.text : '(empty)'
                }`
            )
            .join('\n\n');
        const currentTab = originalFormModal.activeTab;
        const selectedEntry =
          currentTab === 'all' ? null : allWinEntries[currentTab - 1];
        const currentViewText =
          currentTab === 'all'
            ? allCombinedText
            : (selectedEntry?.text.trim()
                ? selectedEntry.text
                : '(no content / not generated yet)');
        const populatedCount = allWinEntries.filter(
          (w) => w.content.trim() || w.text.trim()
        ).length;

        return (
          <div
            onClick={() => setOriginalFormModal(null)}
            className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4"
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="bg-white border shadow-2xl w-full max-w-5xl h-[82vh] flex flex-col p-4"
              style={{
                borderColor: '#bec8de',
                fontFamily: 'system-ui, -apple-system, Segoe UI, sans-serif',
              }}
            >
              {/* Header + Action Buttons */}
              <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 border-b border-slate-200">
                <div>
                  <h3 className="text-sm font-bold text-slate-900">
                    📊 Original Form — {activeTab.tab_name}{' '}
                    {currentTab === 'all'
                      ? `/ All Windows (1-${activeTab.windows.length})`
                      : `/ ${selectedEntry?.name ?? `Window ${currentTab}`}`}
                  </h3>
                  <p className="text-xs text-slate-500">
                    {currentTab === 'all'
                      ? `All windows in '${activeTab.tab_name}' (${populatedCount}/${activeTab.windows.length} non-empty)`
                      : `Formatted view of ${selectedEntry?.name ?? `Window ${currentTab}`} (${populatedCount}/${activeTab.windows.length} non-empty across tab)`}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  {currentTab !== 'all' && (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          scrollToWindow(currentTab - 1);
                          setOriginalFormModal(null);
                        }}
                        className="px-2.5 py-1.5 text-xs font-bold cursor-pointer hover:brightness-95"
                        style={{ backgroundColor: '#e4ebf8', color: '#1a4fb5' }}
                      >
                        🎯 Focus Window {currentTab}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          onFocusWindow(activeTabIdx, currentTab - 1);
                          setOriginalFormModal(null);
                          onLaunchGenerator();
                        }}
                        className="px-2.5 py-1.5 text-xs font-bold text-white cursor-pointer hover:opacity-95"
                        style={{ backgroundColor: '#2563eb' }}
                      >
                        ⚡ Generate Data
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    onClick={async () => {
                      await copyToClipboard(currentViewText);
                      triggerCopyBlink('current');
                      onStatus('📋 Copied Original Form view to clipboard');
                    }}
                    className={`px-2.5 py-1.5 text-xs font-bold cursor-pointer ${
                      copiedBlinkBtn === 'current'
                        ? 'copy-btn-blink'
                        : 'hover:bg-slate-200'
                    }`}
                    style={
                      copiedBlinkBtn === 'current'
                        ? undefined
                        : { backgroundColor: '#f1f5f9', color: '#0f172a' }
                    }
                  >
                    {copiedBlinkBtn === 'current'
                      ? '✓ Copied Current!'
                      : '📋 Copy Current'}
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      await copyToClipboard(allCombinedText);
                      triggerCopyBlink('all');
                      onStatus('📋 Copied All Windows Original Form to clipboard');
                    }}
                    className={`px-2.5 py-1.5 text-xs font-bold cursor-pointer ${
                      copiedBlinkBtn === 'all'
                        ? 'copy-btn-blink'
                        : 'hover:bg-slate-200'
                    }`}
                    style={
                      copiedBlinkBtn === 'all'
                        ? undefined
                        : { backgroundColor: '#f1f5f9', color: '#0f172a' }
                    }
                  >
                    {copiedBlinkBtn === 'all'
                      ? '✓ Copied All Windows!'
                      : '📋 Copy All Windows'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const blob = new Blob([currentViewText], {
                        type: 'text/plain;charset=utf-8',
                      });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = `${noteSlug(activeTab.tab_name)}_${
                        currentTab === 'all' ? 'all_windows' : `window${currentTab}`
                      }_original_form.txt`;
                      a.click();
                      URL.revokeObjectURL(url);
                    }}
                    className="px-2.5 py-1.5 text-xs font-bold text-white cursor-pointer hover:opacity-95"
                    style={{ backgroundColor: '#15803d' }}
                  >
                    ⬇ Download .txt
                  </button>
                  <button
                    type="button"
                    onClick={() => setOriginalFormModal(null)}
                    className="px-3 py-1.5 text-xs font-bold text-white cursor-pointer"
                    style={{ backgroundColor: '#1a4fb5' }}
                  >
                    Close
                  </button>
                </div>
              </div>

              {/* Multi-Window Tabs */}
              <div
                className="flex items-center gap-1 pt-2 overflow-x-auto border-b border-slate-200 shrink-0"
                style={{ backgroundColor: '#f8fafc' }}
              >
                <button
                  type="button"
                  onClick={() => setOriginalFormModal({ activeTab: 'all' })}
                  className="px-3 py-1.5 text-xs font-bold cursor-pointer shrink-0 border-t-2"
                  style={{
                    backgroundColor: currentTab === 'all' ? '#ffffff' : '#e2e8f0',
                    color: currentTab === 'all' ? '#1a4fb5' : '#475569',
                    borderTopColor: currentTab === 'all' ? '#1a4fb5' : 'transparent',
                  }}
                >
                  🗂 All Windows (1-{activeTab.windows.length})
                </button>
                {allWinEntries.map(({ windowId, name, content, text }) => {
                  const isActive = currentTab === windowId;
                  const hasData = Boolean(content.trim() || text.trim());
                  return (
                    <button
                      key={windowId}
                      type="button"
                      onClick={() => setOriginalFormModal({ activeTab: windowId })}
                      className="px-3 py-1.5 text-xs font-bold cursor-pointer shrink-0 border-t-2 flex items-center gap-1.5"
                      style={{
                        backgroundColor: isActive ? '#ffffff' : '#e2e8f0',
                        color: isActive ? '#1a4fb5' : '#475569',
                        borderTopColor: isActive ? '#1a4fb5' : 'transparent',
                      }}
                    >
                      <span>{name}</span>
                      <span
                        className="inline-block w-1.5 h-1.5 rounded-full"
                        style={{
                          backgroundColor: hasData ? '#15803d' : '#94a3b8',
                        }}
                        title={hasData ? 'Has content' : 'Empty'}
                      />
                    </button>
                  );
                })}
              </div>

              <textarea
                readOnly
                value={currentViewText}
                className="flex-1 mt-3 p-3 border text-xs resize-none focus:outline-none select-text"
                style={{
                  backgroundColor: '#f8fafc',
                  borderColor: '#bec8de',
                  fontFamily: "'Courier New', Courier, monospace",
                }}
              />
            </div>
          </div>
        );
      })()}

      {/* ── VIEW ALL TABS & WINDOWS ORIGINAL FORM SINGLE-VIEW POPUP ── */}
      {viewAllOriginalOpen && (() => {
        const query = viewAllSearch.trim().toLowerCase();
        const allTabsData = tabs.map((tab, tIdx) => {
          const winEntries = tab.windows.map((w, wIdx) => {
            const winName = w.name?.trim() || `Window ${wIdx + 1}`;
            const formattedText =
              w.text_content !== undefined
                ? w.text_content
                : w.content.trim()
                  ? jsonToSnippetText(w.content)
                  : '';
            const hasContent = Boolean(formattedText.trim() || w.content.trim());
            return {
              wIdx,
              winId: w.id,
              name: winName,
              text: formattedText,
              hasContent,
            };
          });
          return {
            tIdx,
            tabId: tab.id,
            tabName: tab.tab_name,
            winEntries,
          };
        });

        const totalWins = allTabsData.reduce((acc, t) => acc + t.winEntries.length, 0);
        const nonEmptyWins = allTabsData.reduce(
          (acc, t) => acc + t.winEntries.filter((w) => w.hasContent).length,
          0
        );

        const filteredTabs = allTabsData
          .map((t) => {
            const tabMatches = query ? t.tabName.toLowerCase().includes(query) : true;
            const visibleWindows = t.winEntries.filter((w) => {
              if (viewAllHideEmpty && !w.hasContent) return false;
              if (!query || tabMatches) return true;
              return (
                w.name.toLowerCase().includes(query) ||
                w.text.toLowerCase().includes(query)
              );
            });
            return {
              ...t,
              visibleWindows,
            };
          })
          .filter((t) => t.visibleWindows.length > 0);

        const combinedAllTabsText =
          [
            '█'.repeat(76),
            `  VIEW ALL ORIGINAL FORM  •  PROJECT: ${projectName || 'NoteTool'}  •  ${tabs.length} TAB(S) / ${totalWins} WINDOW(S)`,
            '█'.repeat(76),
            '',
          ].join('\n') +
          filteredTabs
            .map((t) => {
              const tabHeader = [
                '═'.repeat(76),
                `  TAB ${t.tIdx + 1}: ${t.tabName.toUpperCase()} (${t.visibleWindows.length} window${t.visibleWindows.length === 1 ? '' : 's'})`,
                '═'.repeat(76),
              ].join('\n');
              const winBlocks = t.visibleWindows
                .map(
                  (w) =>
                    `${'─'.repeat(76)}\n  [${t.tabName}] ${w.name}\n${'─'.repeat(76)}\n${
                      w.text.trim() ? w.text : '(empty)'
                    }`
                )
                .join('\n\n');
              return `${tabHeader}\n\n${winBlocks}`;
            })
            .join('\n\n\n');

        return (
          <div
            onClick={() => setViewAllOriginalOpen(false)}
            className="fixed inset-0 z-50 bg-slate-900/45 flex items-center justify-center p-4"
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="bg-white border shadow-2xl w-full max-w-6xl h-[88vh] flex flex-col"
              style={{
                borderColor: '#bec8de',
                fontFamily: 'system-ui, -apple-system, Segoe UI, sans-serif',
              }}
            >
              {/* Popup Header */}
              <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-slate-200 bg-white">
                <div>
                  <h3 className="text-sm font-bold text-slate-900">
                    👁 View All — {projectName || 'Project'} (Original Form • Single View)
                  </h3>
                  <p className="text-xs text-slate-500">
                    Showing all {tabs.length} tab(s) and {totalWins} window(s) together ({nonEmptyWins} with data) — no tab switching needed
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    onClick={async () => {
                      await copyToClipboard(combinedAllTabsText);
                      triggerCopyBlink('view_all');
                      onStatus('📋 Copied all tabs & windows Original Form to clipboard');
                    }}
                    className={`px-2.5 py-1.5 text-xs font-bold cursor-pointer ${
                      copiedBlinkBtn === 'view_all'
                        ? 'copy-btn-blink'
                        : 'hover:bg-slate-200'
                    }`}
                    style={
                      copiedBlinkBtn === 'view_all'
                        ? undefined
                        : { backgroundColor: '#f1f5f9', color: '#0f172a' }
                    }
                  >
                    {copiedBlinkBtn === 'view_all'
                      ? '✓ Copied All!'
                      : '📋 Copy All Tabs'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const blob = new Blob([combinedAllTabsText], {
                        type: 'text/plain;charset=utf-8',
                      });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = `${noteSlug(projectName || 'project')}_view_all_original_form.txt`;
                      a.click();
                      URL.revokeObjectURL(url);
                    }}
                    className="px-2.5 py-1.5 text-xs font-bold text-white cursor-pointer hover:opacity-95"
                    style={{ backgroundColor: '#15803d' }}
                  >
                    ⬇ Download .txt
                  </button>
                  <button
                    type="button"
                    onClick={() => setViewAllOriginalOpen(false)}
                    className="px-3 py-1.5 text-xs font-bold text-white cursor-pointer hover:opacity-95"
                    style={{ backgroundColor: '#1a4fb5' }}
                  >
                    ✕ Close
                  </button>
                </div>
              </div>

              {/* Filter & View Mode Bar */}
              <div
                className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 border-b border-slate-200"
                style={{ backgroundColor: '#f8fafc' }}
              >
                <div className="flex flex-wrap items-center gap-2 flex-1 min-w-[220px]">
                  <input
                    type="text"
                    value={viewAllSearch}
                    onChange={(e) => setViewAllSearch(e.target.value)}
                    placeholder="🔍 Filter by tab name, window name, or text..."
                    className="w-full max-w-sm border border-slate-300 bg-white px-2.5 py-1 text-xs focus:outline-none focus:border-[#1a4fb5]"
                  />
                  <label className="flex items-center gap-1.5 text-xs text-slate-700 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={viewAllHideEmpty}
                      onChange={(e) => setViewAllHideEmpty(e.target.checked)}
                      className="accent-[#1a4fb5] cursor-pointer"
                    />
                    <span>Hide empty windows</span>
                  </label>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setViewAllMode('sections')}
                    className="px-2.5 py-1 text-xs font-bold border cursor-pointer"
                    style={{
                      backgroundColor: viewAllMode === 'sections' ? '#1a4fb5' : '#ffffff',
                      color: viewAllMode === 'sections' ? '#ffffff' : '#334155',
                      borderColor: viewAllMode === 'sections' ? '#1a4fb5' : '#cbd5e1',
                    }}
                  >
                    📑 Structured Single View
                  </button>
                  <button
                    type="button"
                    onClick={() => setViewAllMode('combined')}
                    className="px-2.5 py-1 text-xs font-bold border cursor-pointer"
                    style={{
                      backgroundColor: viewAllMode === 'combined' ? '#1a4fb5' : '#ffffff',
                      color: viewAllMode === 'combined' ? '#ffffff' : '#334155',
                      borderColor: viewAllMode === 'combined' ? '#1a4fb5' : '#cbd5e1',
                    }}
                  >
                    📄 Plain Text Block
                  </button>
                </div>
              </div>

              {/* Single-View Body */}
              {viewAllMode === 'combined' ? (
                <div className="flex-1 p-4 flex flex-col min-h-0 bg-[#f0f2f8]">
                  <textarea
                    readOnly
                    value={
                      filteredTabs.length > 0
                        ? combinedAllTabsText
                        : '(No tabs or windows match the current filter)'
                    }
                    className="flex-1 w-full p-3 border text-xs resize-none focus:outline-none select-text bg-white"
                    style={{
                      borderColor: '#bec8de',
                      fontFamily: "'Courier New', Courier, monospace",
                    }}
                  />
                </div>
              ) : (
                <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-[#f0f2f8] select-text">
                  {filteredTabs.length === 0 ? (
                    <div className="bg-white border border-slate-200 p-6 text-center text-xs text-slate-500">
                      No tabs or windows match the current filter.
                    </div>
                  ) : (
                    filteredTabs.map((tabItem) => (
                      <div
                        key={tabItem.tabId}
                        className="bg-white border shadow-sm"
                        style={{ borderColor: '#bec8de' }}
                      >
                        <div
                          className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 border-b"
                          style={{
                            backgroundColor: '#e4e8f0',
                            borderColor: '#bec8de',
                          }}
                        >
                          <div className="flex items-center gap-2">
                            <span
                              className="text-xs font-bold uppercase tracking-wide"
                              style={{ color: '#1a4fb5' }}
                            >
                              Tab {tabItem.tIdx + 1}: {tabItem.tabName}
                            </span>
                            <span className="text-[11px] text-slate-600">
                              ({tabItem.visibleWindows.length} window
                              {tabItem.visibleWindows.length === 1 ? '' : 's'})
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              onSelectTab(tabItem.tIdx);
                              setViewAllOriginalOpen(false);
                            }}
                            className="px-2 py-0.5 text-[11px] font-bold bg-white border border-slate-300 text-[#1a4fb5] cursor-pointer hover:bg-blue-50"
                          >
                            ↗ Open Tab in Editor
                          </button>
                        </div>

                        <div className="p-3 space-y-3">
                          {tabItem.visibleWindows.map((winEntry) => {
                            const copyKey = `${tabItem.tabId}_${winEntry.winId}`;
                            const isCopied = viewAllCopiedWinKey === copyKey;
                            return (
                              <div
                                key={winEntry.winId}
                                className="border"
                                style={{ borderColor: '#cbd5e1' }}
                              >
                                <div
                                  className="flex items-center justify-between gap-2 px-2.5 py-1.5 border-b"
                                  style={{
                                    backgroundColor: '#f8fafc',
                                    borderColor: '#e2e8f0',
                                  }}
                                >
                                  <div className="flex items-center gap-2">
                                    <span
                                      className="inline-block w-2 h-2 rounded-full"
                                      style={{
                                        backgroundColor: winEntry.hasContent
                                          ? '#15803d'
                                          : '#94a3b8',
                                      }}
                                    />
                                    <span className="text-xs font-bold text-slate-800">
                                      {winEntry.name}
                                    </span>
                                  </div>
                                  <button
                                    type="button"
                                    onClick={async () => {
                                      await copyToClipboard(winEntry.text);
                                      setViewAllCopiedWinKey(copyKey);
                                      window.setTimeout(() => {
                                        setViewAllCopiedWinKey((curr) =>
                                          curr === copyKey ? null : curr
                                        );
                                      }, 1200);
                                      onStatus(
                                        `📋 Copied ${tabItem.tabName} → ${winEntry.name}`
                                      );
                                    }}
                                    className="px-2 py-0.5 text-[10px] font-bold border border-slate-300 bg-white text-slate-700 cursor-pointer hover:bg-slate-100"
                                  >
                                    {isCopied ? '✓ Copied' : '📋 Copy'}
                                  </button>
                                </div>
                                <pre
                                  className="p-2.5 text-xs whitespace-pre-wrap break-words bg-white text-slate-800 m-0"
                                  style={{
                                    fontFamily: "'Courier New', Courier, monospace",
                                  }}
                                >
                                  {winEntry.text.trim() ? winEntry.text : '(empty)'}
                                </pre>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* ── GUI1 TEXT-FILE HELP MODAL ── */}
      {helpOpen && (
        <TextHelpModal
          docId="gui1"
          title="❓ GUI1 Help — Note Tool Workspace"
          accentColor="#1a4fb5"
          defaultText={DEFAULT_GUI1_HELP_TXT}
          onClose={() => setHelpOpen(false)}
        />
      )}
    </div>
  );
};
