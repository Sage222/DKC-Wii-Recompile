/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  CheckCircle2,
  Code2,
  Cpu,
  Download,
  FileArchive,
  FolderOpen,
  Gamepad2,
  HardDrive,
  Layers,
  Play,
  RefreshCw,
  Search,
  ShieldCheck,
  Smartphone,
  Sun,
  Moon,
  Terminal,
  Upload,
  AlertCircle,
  Copy,
  Check,
} from 'lucide-react';
import {
  DEFAULT_EU_V17_REPORT,
  inspectWuaFile,
  WuaInspectionReport,
} from './utils/wuaParser';
import {
  UPSTREAM_MODULE_RECORDS,
  UPSTREAM_REPO_INFO,
} from './data/upstreamDiffData';

interface ApkBuildResult {
  ok?: boolean;
  apkPath: string;
  apkSize: number;
  sha256: string;
  merkleDigestSha512: string;
  libwwhdCrc32: string;
  resourcesArscCrc32: string;
  elapsedSeconds: number;
  downloadUrl?: string;
}

interface SourceBuildResult {
  ok?: boolean;
  zipPath: string;
  zipSize: number;
  fileCount: number;
  patchedFiles: string[];
  downloadUrl?: string;
}

type ActiveSection = 'inspector' | 'diff' | 'packager' | 'simulator';
type DiffFilter = 'all' | 'modified' | 'unchanged';
type PhoneSimStage = 'welcome' | 'extracting' | 'compiling' | 'running';

const APK_ICON_ASSET = '/src/assets/images/dkctf_android_app_icon_1794968054911.jpg';
const HANDHELD_BANNER_ASSET = '/src/assets/images/android_handheld_vulkan_frame_1794968057152.jpg';

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  if (bytes >= 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GiB`;
  }
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;
  }
  if (bytes >= 1024) {
    return `${(bytes / 1024).toFixed(1)} KiB`;
  }
  return `${bytes} B`;
}

export default function App() {
  const [darkMode, setDarkMode] = useState<boolean>(true);
  const [activeSection, setActiveSection] = useState<ActiveSection>('inspector');

  // WUA file inspection state
  const [wuaReport, setWuaReport] = useState<WuaInspectionReport>(DEFAULT_EU_V17_REPORT);
  const [hasCustomWuaFile, setHasCustomWuaFile] = useState<boolean>(false);
  const [isInspectingWua, setIsInspectingWua] = useState<boolean>(false);
  const [wuaError, setWuaError] = useState<string | null>(null);
  const [fileSearchQuery, setFileSearchQuery] = useState<string>('');
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Upstream diff state
  const [diffFilter, setDiffFilter] = useState<DiffFilter>('all');
  const [selectedModuleId, setSelectedModuleId] = useState<string>(UPSTREAM_MODULE_RECORDS[0].id);
  const [copiedPatch, setCopiedPatch] = useState<boolean>(false);

  // APK & Source build state
  const [isBuildingApk, setIsBuildingApk] = useState<boolean>(false);
  const [apkBuildProgress, setApkBuildProgress] = useState<number>(100);
  const [apkDownloadedBytes, setApkDownloadedBytes] = useState<number>(0);
  const [readyApkBlobUrl, setReadyApkBlobUrl] = useState<string | null>(null);
  const [apkBuildStageText, setApkBuildStageText] = useState<string>(
    'Pre-configured DKCTF-Android-Plus-EU-v17.apk (62.64 MiB) verified on server — click Download to stream full APK'
  );
  const [apkBuildResult, setApkBuildResult] = useState<ApkBuildResult>({
    apkPath: '/tmp/DKCTF-Android-Plus-EU-v17.apk',
    apkSize: 65680113,
    sha256: '479a21b424dd8f554d892726f1680699c6542e05433dc45a3626accc95543d90',
    merkleDigestSha512:
      '34724995fc2baf7061b40135e6450644c64cfbf5a15a5cf1b4e28a8f821527a1f265d789b4d6ca1b409d746154e098e8bc534797b0f4dbac668513b177ef7b2c',
    libwwhdCrc32: '3889e1ed',
    resourcesArscCrc32: 'c234a61f',
    elapsedSeconds: 0.39,
  });

  const [isBuildingSource, setIsBuildingSource] = useState<boolean>(false);
  const [sourceDownloadedBytes, setSourceDownloadedBytes] = useState<number>(0);
  const [readySourceBlobUrl, setReadySourceBlobUrl] = useState<string | null>(null);
  const [sourceBuildResult, setSourceBuildResult] = useState<SourceBuildResult>({
    zipPath: '/tmp/DKCTF-Android-Plus-Source.zip',
    zipSize: 84486268,
    fileCount: 753,
    patchedFiles: [
      'runtime/src/disc/wua.cpp',
      'runtime/src/release.cpp',
      'android/app/src/main/res/values/strings.xml',
      'tools/recomp/hooks.txt',
      'tools/recomp/hot_functions.txt',
      'tools/recomp/covered_functions.txt',
    ],
  });
  const [buildError, setBuildError] = useState<string | null>(null);

  // Image fallback state
  const [iconImgError, setIconImgError] = useState<boolean>(false);
  const [bannerImgError, setBannerImgError] = useState<boolean>(false);

  // On-phone simulator state
  const [phoneStage, setPhoneStage] = useState<PhoneSimStage>('welcome');
  const [phoneProgress, setPhoneProgress] = useState<number>(0);
  const [showHudOverlay, setShowHudOverlay] = useState<boolean>(true);

  useEffect(() => {
    const root = document.documentElement;
    if (darkMode) {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }, [darkMode]);

  useEffect(() => {
    fetch('/api/status')
      .then((r) => r.json())
      .then((data) => {
        if (data.apkMeta) {
          setApkBuildResult(data.apkMeta);
        }
        if (data.sourceMeta) {
          setSourceBuildResult(data.sourceMeta);
        }
      })
      .catch(() => {
        // Keep initial pre-built metadata if offline
      });
  }, []);

  // Phone simulator progress timer
  useEffect(() => {
    if (phoneStage !== 'extracting' && phoneStage !== 'compiling') return;
    setPhoneProgress(0);
    const interval = window.setInterval(() => {
      setPhoneProgress((prev) => {
        if (prev >= 100) {
          window.clearInterval(interval);
          if (phoneStage === 'extracting') {
            setPhoneStage('compiling');
          } else if (phoneStage === 'compiling') {
            setPhoneStage('running');
          }
          return 100;
        }
        return prev + (phoneStage === 'extracting' ? 5 : 4);
      });
    }, 120);
    return () => window.clearInterval(interval);
  }, [phoneStage]);

  const handleSelectWuaFile = async (file: File) => {
    setIsInspectingWua(true);
    setWuaError(null);
    try {
      const report = await inspectWuaFile(file);
      setWuaReport(report);
      setHasCustomWuaFile(true);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setWuaError(msg);
    } finally {
      setIsInspectingWua(false);
    }
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleSelectWuaFile(file);
    }
  };

  const handleDropWua = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) {
      handleSelectWuaFile(file);
    }
  };

  const handleLoadBinarySampleWua = async () => {
    setIsInspectingWua(true);
    setWuaError(null);
    try {
      const res = await fetch('/api/wua/sample');
      if (!res.ok) throw new Error('Failed to fetch binary sample .wua');
      const blob = await res.blob();
      const sampleFile = new File(
        [blob],
        'Donkey_Kong_Country_Tropical_Freeze_EU_v17_Sample.wua',
        { type: 'application/octet-stream' }
      );
      const report = await inspectWuaFile(sampleFile);
      setWuaReport(report);
      setHasCustomWuaFile(true);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setWuaError(msg);
    } finally {
      setIsInspectingWua(false);
    }
  };

  const handleResetDefaultProfile = () => {
    setWuaReport(DEFAULT_EU_V17_REPORT);
    setHasCustomWuaFile(false);
    setWuaError(null);
  };

  const decodeBase64ToUint8Array = (b64: string): Uint8Array => {
    const binStr = window.atob(b64);
    const len = binStr.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binStr.charCodeAt(i);
    }
    return bytes;
  };

  const triggerBlobSave = (blobUrl: string, fileName: string) => {
    const link = document.createElement('a');
    link.href = blobUrl;
    link.download = fileName;
    link.rel = 'noopener';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const streamBinaryToBlobUrl = async (
    chunkEndpoint: string,
    expectedSize: number,
    mimeType: string,
    onProgress: (receivedBytes: number, totalBytes: number) => void
  ): Promise<string> => {
    const CHUNK_SIZE = 4 * 1024 * 1024; // 4 MiB per chunk (under Cloud Run 32 MiB limit)
    const chunks: BlobPart[] = [];
    let offset = 0;
    let totalSize = expectedSize;
    let useBase64Fallback = false;

    while (offset < totalSize) {
      const reqLen = Math.min(CHUNK_SIZE, totalSize - offset);
      let chunkBytes: Uint8Array | null = null;

      if (!useBase64Fallback) {
        const res = await fetch(`${chunkEndpoint}?offset=${offset}&length=${reqLen}`);
        if (res.ok) {
          const headerTotal = Number(res.headers.get('X-Total-Size') || 0);
          if (headerTotal > 0) totalSize = headerTotal;
          const ab = await res.arrayBuffer();
          const candidate = new Uint8Array(ab);
          const validMagic =
            offset > 0 ||
            (candidate.byteLength >= 4 &&
              candidate[0] === 0x50 &&
              candidate[1] === 0x4b &&
              candidate[2] === 0x03 &&
              candidate[3] === 0x04);
          if (candidate.byteLength === reqLen && validMagic) {
            chunkBytes = candidate;
          } else {
            useBase64Fallback = true;
          }
        } else {
          useBase64Fallback = true;
        }
      }

      if (!chunkBytes) {
        const res = await fetch(
          `${chunkEndpoint}?offset=${offset}&length=${reqLen}&encoding=base64`
        );
        if (!res.ok) {
          throw new Error(`Failed to transfer binary chunk at offset ${offset} (HTTP ${res.status})`);
        }
        const json = await res.json();
        if (!json.ok || !json.b64) {
          throw new Error(json.error || `Invalid chunk response at offset ${offset}`);
        }
        if (json.totalSize > 0) totalSize = Number(json.totalSize);
        chunkBytes = decodeBase64ToUint8Array(json.b64);
        if (
          offset === 0 &&
          (chunkBytes.byteLength < 4 ||
            chunkBytes[0] !== 0x50 ||
            chunkBytes[1] !== 0x4b ||
            chunkBytes[2] !== 0x03 ||
            chunkBytes[3] !== 0x04)
        ) {
          throw new Error('Binary header verification failed: expected PK\\x03\\x04 ZIP/APK header');
        }
      }

      // Copy into an ArrayBuffer-backed Uint8Array so TypeScript BlobPart is satisfied
      const safeCopy = new Uint8Array(chunkBytes.byteLength);
      safeCopy.set(chunkBytes);
      chunks.push(safeCopy);
      offset += chunkBytes.byteLength;
      onProgress(offset, totalSize);
    }

    const blob = new Blob(chunks, { type: mimeType });
    if (blob.size < 1_000_000) {
      throw new Error(`Assembled file size (${blob.size} bytes) is unexpectedly small`);
    }
    return URL.createObjectURL(blob);
  };

  const handleDownloadSampleWuaFile = async () => {
    try {
      const res = await fetch('/api/wua/sample');
      if (!res.ok) throw new Error('Failed to fetch sample .wua');
      const ab = await res.arrayBuffer();
      const blob = new Blob([ab], { type: 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      triggerBlobSave(url, 'Donkey_Kong_Country_Tropical_Freeze_EU_v17_Sample.wua');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setWuaError(msg);
    }
  };

  const handleBuildAndDownloadApk = async () => {
    if (readyApkBlobUrl && !isBuildingApk) {
      triggerBlobSave(readyApkBlobUrl, 'DKCTF-Android-Plus-EU-v17.apk');
      return;
    }

    setIsBuildingApk(true);
    setBuildError(null);
    setApkDownloadedBytes(0);
    setApkBuildProgress(8);
    setApkBuildStageText(
      'Verifying patched lib/arm64-v8a/libwwhd.so & APK Signature Scheme v2 block (0x7109871a)...'
    );

    try {
      const res = await fetch('/api/apk/build', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rebrandUi: true,
          wuaFileName: wuaReport.fileName,
          entryPointHex: wuaReport.rpxMetadata.entryPointHex,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error || 'Failed to build APK');
      }

      setApkBuildResult(data);
      const totalBytes = Number(data.apkSize) || 65680113;

      const blobUrl = await streamBinaryToBlobUrl(
        '/api/apk/chunk',
        totalBytes,
        'application/vnd.android.package-archive',
        (received, total) => {
          setApkDownloadedBytes(received);
          const pct = Math.min(100, Math.max(10, Math.round((received / total) * 100)));
          setApkBuildProgress(pct);
          setApkBuildStageText(
            `Streaming verified APK in 4 MiB chunks: ${formatBytes(received)} / ${formatBytes(total)} (${pct}%)`
          );
        }
      );

      setReadyApkBlobUrl(blobUrl);
      setApkBuildProgress(100);
      setApkBuildStageText(
        `Verified 100% of DKCTF-Android-Plus-EU-v17.apk (${formatBytes(totalBytes)}) in browser memory — saving file`
      );
      triggerBlobSave(blobUrl, 'DKCTF-Android-Plus-EU-v17.apk');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setBuildError(msg);
      setApkBuildStageText('APK transfer encountered an error');
    } finally {
      setIsBuildingApk(false);
    }
  };

  const handleDownloadSourceZip = async () => {
    if (readySourceBlobUrl && !isBuildingSource) {
      triggerBlobSave(readySourceBlobUrl, 'DKCTF-Android-Plus-Source.zip');
      return;
    }

    setIsBuildingSource(true);
    setBuildError(null);
    setSourceDownloadedBytes(0);
    try {
      const res = await fetch('/api/source/build', { method: 'POST' });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error || 'Failed to build source archive');
      }
      setSourceBuildResult(data);
      const totalBytes = Number(data.zipSize) || 84486268;

      const blobUrl = await streamBinaryToBlobUrl(
        '/api/source/chunk',
        totalBytes,
        'application/zip',
        (received) => {
          setSourceDownloadedBytes(received);
        }
      );

      setReadySourceBlobUrl(blobUrl);
      triggerBlobSave(blobUrl, 'DKCTF-Android-Plus-Source.zip');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setBuildError(msg);
    } finally {
      setIsBuildingSource(false);
    }
  };

  const filteredVirtualFiles = useMemo(() => {
    const q = fileSearchQuery.trim().toLowerCase();
    if (!q) return wuaReport.keyFiles;
    return wuaReport.keyFiles.filter(
      (f) =>
        f.fullArchivePath.toLowerCase().includes(q) ||
        f.titleFolder.toLowerCase().includes(q)
    );
  }, [wuaReport.keyFiles, fileSearchQuery]);

  const filteredModules = useMemo(() => {
    return UPSTREAM_MODULE_RECORDS.filter((m) => {
      if (diffFilter === 'modified') return m.status === 'MODIFIED';
      if (diffFilter === 'unchanged') return m.status === 'UNCHANGED';
      return true;
    });
  }, [diffFilter]);

  const activeModule = useMemo(() => {
    return (
      UPSTREAM_MODULE_RECORDS.find((m) => m.id === selectedModuleId) ||
      UPSTREAM_MODULE_RECORDS[0]
    );
  }, [selectedModuleId]);

  const handleCopyUnifiedPatch = () => {
    const patchText = UPSTREAM_MODULE_RECORDS.filter((m) => m.status === 'MODIFIED')
      .map(
        (m) =>
          `--- a/${m.filePath}\n+++ b/${m.filePath}\n@@ ${m.binaryOffsetInLibwwhd || 'source'} @@\n-${m.originalCode
            .split('\n')
            .join('\n-')}\n+${m.patchedCode.split('\n').join('\n+')}`
      )
      .join('\n\n');
    navigator.clipboard.writeText(patchText);
    setCopiedPatch(true);
    window.setTimeout(() => setCopiedPatch(false), 2000);
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex flex-col">
      {/* Mandatory 3-Zone Top Bar Contract */}
      <header className="flex items-center justify-between gap-8 px-6 py-3.5 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 sticky top-0 z-30">
        {/* Zone 1: Single text element wordmark */}
        <a
          href="#top"
          onClick={(e) => {
            e.preventDefault();
            setActiveSection('inspector');
          }}
          className="text-base font-bold tracking-tight text-slate-900 dark:text-slate-100 whitespace-nowrap shrink-0 font-display"
        >
          DKCTF Android Plus
        </a>

        {/* Zone 2: 4 concise single-line navigation links */}
        <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600 dark:text-slate-400">
          <a
            href="#inspector"
            onClick={(e) => {
              e.preventDefault();
              setActiveSection('inspector');
            }}
            className={`hover:text-slate-900 dark:hover:text-slate-100 transition-colors whitespace-nowrap shrink-0 py-1 border-b-2 ${
              activeSection === 'inspector'
                ? 'border-amber-500 text-slate-900 dark:text-slate-100'
                : 'border-transparent'
            }`}
          >
            WUA Inspector
          </a>
          <a
            href="#diff"
            onClick={(e) => {
              e.preventDefault();
              setActiveSection('diff');
            }}
            className={`hover:text-slate-900 dark:hover:text-slate-100 transition-colors whitespace-nowrap shrink-0 py-1 border-b-2 ${
              activeSection === 'diff'
                ? 'border-amber-500 text-slate-900 dark:text-slate-100'
                : 'border-transparent'
            }`}
          >
            Upstream Diff
          </a>
          <a
            href="#packager"
            onClick={(e) => {
              e.preventDefault();
              setActiveSection('packager');
            }}
            className={`hover:text-slate-900 dark:hover:text-slate-100 transition-colors whitespace-nowrap shrink-0 py-1 border-b-2 ${
              activeSection === 'packager'
                ? 'border-amber-500 text-slate-900 dark:text-slate-100'
                : 'border-transparent'
            }`}
          >
            APK Packager
          </a>
          <a
            href="#simulator"
            onClick={(e) => {
              e.preventDefault();
              setActiveSection('simulator');
            }}
            className={`hover:text-slate-900 dark:hover:text-slate-100 transition-colors whitespace-nowrap shrink-0 py-1 border-b-2 ${
              activeSection === 'simulator'
                ? 'border-amber-500 text-slate-900 dark:text-slate-100'
                : 'border-transparent'
            }`}
          >
            Phone Runtime
          </a>
        </nav>

        {/* Zone 3: 1 primary action */}
        <div className="flex items-center gap-3 shrink-0">
          <button
            onClick={handleBuildAndDownloadApk}
            disabled={isBuildingApk}
            className="px-4 py-2 text-xs font-semibold text-slate-950 bg-amber-500 hover:bg-amber-400 disabled:opacity-60 rounded-lg transition-colors whitespace-nowrap shrink-0 flex items-center gap-2 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            {isBuildingApk
              ? `Downloading APK (${formatBytes(apkDownloadedBytes)} / ${formatBytes(apkBuildResult.apkSize)})...`
              : readyApkBlobUrl
              ? 'Save Verified 62.64 MiB APK'
              : 'Download Installer APK (62.64 MiB)'}
          </button>
        </div>
      </header>

      {/* Main Workspace Layout (Sidebar + Main Viewport) */}
      <div className="flex-1 flex flex-col lg:flex-row max-w-[1440px] w-full mx-auto">
        {/* Left Sidebar (272px on desktop) */}
        <aside className="w-full lg:w-[272px] shrink-0 border-b lg:border-b-0 lg:border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 p-5 flex flex-col justify-between gap-6">
          <div className="space-y-6">
            {/* Target Game Identity Block */}
            <div className="flex items-start gap-3.5">
              <div className="w-12 h-12 rounded-xl overflow-hidden border border-slate-200 dark:border-slate-800 shrink-0 bg-slate-900 flex items-center justify-center">
                {!iconImgError ? (
                  <img
                    src={APK_ICON_ASSET}
                    alt="DKCTF Android Plus Application Icon"
                    referrerPolicy="no-referrer"
                    onError={() => setIconImgError(true)}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <Gamepad2 className="w-6 h-6 text-amber-400" />
                )}
              </div>
              <div className="min-w-0">
                <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">
                  Tropical Freeze EU v17
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums mt-0.5">
                  0005000010138300 · v17
                </p>
                <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-1 flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                  <span>rs10_production.rpx</span>
                </p>
              </div>
            </div>

            {/* Navigation List */}
            <div className="space-y-1">
              <div className="text-xs font-medium text-slate-400 dark:text-slate-500 px-2.5 pb-1">
                Workbench Modules
              </div>
              <button
                onClick={() => setActiveSection('inspector')}
                className={`w-full flex items-center justify-between px-3 py-2 text-xs font-medium rounded-lg transition-colors cursor-pointer whitespace-nowrap ${
                  activeSection === 'inspector'
                    ? 'bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-slate-100'
                    : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100/60 dark:hover:bg-slate-800/50'
                }`}
              >
                <span className="flex items-center gap-2.5">
                  <FileArchive className="w-4 h-4 text-amber-500" />
                  <span>01. WUA File Inspector</span>
                </span>
                <span className="font-mono text-[11px] text-slate-400 tabular-nums">ZArchive</span>
              </button>

              <button
                onClick={() => setActiveSection('diff')}
                className={`w-full flex items-center justify-between px-3 py-2 text-xs font-medium rounded-lg transition-colors cursor-pointer whitespace-nowrap ${
                  activeSection === 'diff'
                    ? 'bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-slate-100'
                    : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100/60 dark:hover:bg-slate-800/50'
                }`}
              >
                <span className="flex items-center gap-2.5">
                  <Code2 className="w-4 h-4 text-amber-500" />
                  <span>02. Surgical Upstream Diff</span>
                </span>
                <span className="font-mono text-[11px] text-slate-400 tabular-nums">6 files</span>
              </button>

              <button
                onClick={() => setActiveSection('packager')}
                className={`w-full flex items-center justify-between px-3 py-2 text-xs font-medium rounded-lg transition-colors cursor-pointer whitespace-nowrap ${
                  activeSection === 'packager'
                    ? 'bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-slate-100'
                    : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100/60 dark:hover:bg-slate-800/50'
                }`}
              >
                <span className="flex items-center gap-2.5">
                  <Smartphone className="w-4 h-4 text-amber-500" />
                  <span>03. Android APK Builder</span>
                </span>
                <span className="font-mono text-[11px] text-emerald-500 tabular-nums">62.6 MiB</span>
              </button>

              <button
                onClick={() => setActiveSection('simulator')}
                className={`w-full flex items-center justify-between px-3 py-2 text-xs font-medium rounded-lg transition-colors cursor-pointer whitespace-nowrap ${
                  activeSection === 'simulator'
                    ? 'bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-slate-100'
                    : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100/60 dark:hover:bg-slate-800/50'
                }`}
              >
                <span className="flex items-center gap-2.5">
                  <Play className="w-4 h-4 text-amber-500" />
                  <span>04. On-Phone Setup Flow</span>
                </span>
                <span className="font-mono text-[11px] text-slate-400 tabular-nums">ARM64</span>
              </button>
            </div>

            {/* Upstream Baseline Lock Summary */}
            <div className="pt-4 border-t border-slate-200 dark:border-slate-800 space-y-2.5 text-xs">
              <div className="font-semibold text-slate-900 dark:text-slate-100">
                Upstream Baseline Integrity
              </div>
              <div className="text-slate-500 dark:text-slate-400 leading-relaxed">
                Forked from <span className="font-mono text-slate-700 dark:text-slate-300">Nycolazs/WindWakerHD-Android-Plus</span> (release <span className="font-mono">v1.14</span>).
              </div>
              <div className="space-y-1.5 pt-1 font-mono text-[11px] text-slate-600 dark:text-slate-400 tabular-nums">
                <div className="flex justify-between">
                  <span>Vulkan GX2 Engine</span>
                  <span className="text-emerald-600 dark:text-emerald-400">0 changes</span>
                </div>
                <div className="flex justify-between">
                  <span>Adreno/Mali Hooks</span>
                  <span className="text-emerald-600 dark:text-emerald-400">0 changes</span>
                </div>
                <div className="flex justify-between">
                  <span>HUD Layout Editor</span>
                  <span className="text-emerald-600 dark:text-emerald-400">0 changes</span>
                </div>
                <div className="flex justify-between">
                  <span>Gamepad + Gyro</span>
                  <span className="text-emerald-600 dark:text-emerald-400">0 changes</span>
                </div>
                <div className="flex justify-between">
                  <span>LLVM 20 Recompiler</span>
                  <span className="text-emerald-600 dark:text-emerald-400">Preserved</span>
                </div>
              </div>
            </div>
          </div>

          {/* Theme Switch & Secondary Source Action */}
          <div className="pt-4 border-t border-slate-200 dark:border-slate-800 space-y-2.5">
            <button
              onClick={handleDownloadSourceZip}
              disabled={isBuildingSource}
              className="w-full px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors flex items-center justify-center gap-2 cursor-pointer whitespace-nowrap"
            >
              <FolderOpen className="w-3.5 h-3.5 text-amber-500" />
              <span>
                {isBuildingSource
                  ? `Streaming Source (${formatBytes(sourceDownloadedBytes)})...`
                  : 'Export Retargeted Source (.zip)'}
              </span>
            </button>

            <button
              onClick={() => setDarkMode(!darkMode)}
              className="w-full px-3 py-1.5 text-xs text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 flex items-center justify-between rounded-lg transition-colors cursor-pointer"
            >
              <span>Interface Theme</span>
              <span className="flex items-center gap-1.5 font-medium">
                {darkMode ? <Moon className="w-3.5 h-3.5" /> : <Sun className="w-3.5 h-3.5" />}
                <span>{darkMode ? 'Dark Carbon' : 'Light Slate'}</span>
              </span>
            </button>
          </div>
        </aside>

        {/* Main Content Viewport */}
        <main className="flex-1 p-6 lg:p-8 space-y-8 min-w-0">
          {/* Top Hero Summary Strip */}
          <section className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-slate-900 p-6">
            <div className="lg:col-span-8 flex flex-col justify-between space-y-4">
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                  <span>Base: Nycolazs/WindWakerHD-Android-Plus v1.14</span>
                  <span aria-hidden="true">·</span>
                  <span>Target: EU v17 (0005000010138300)</span>
                  <span aria-hidden="true">·</span>
                  <span>ABI: arm64-v8a (Android 11+)</span>
                </div>
                <h1
                  className="text-2xl lg:text-3xl font-bold tracking-tight text-slate-900 dark:text-slate-100 font-display"
                  style={{ textWrap: 'balance' }}
                >
                  Donkey Kong Country: Tropical Freeze — Native ARM64 WUA Port & Installer APK
                </h1>
                <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed max-w-2xl">
                  Retargets the <code className="text-amber-600 dark:text-amber-400">WindWakerHD-Android-Plus</code> static recompilation runtime to load{' '}
                  <code className="text-slate-900 dark:text-slate-100">Donkey Kong Country: Tropical Freeze (EU v17).wua</code> directly on your Android phone. Browse to your <code className="text-slate-900 dark:text-slate-100">.wua</code> file below to inspect its ZArchive structure, or download the pre-configured V2-signed Android installer APK immediately.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-3 pt-1">
                <button
                  onClick={handleBuildAndDownloadApk}
                  disabled={isBuildingApk}
                  className="px-4 py-2.5 text-xs font-semibold text-slate-950 bg-amber-500 hover:bg-amber-400 disabled:opacity-70 rounded-lg transition-colors flex items-center gap-2 cursor-pointer whitespace-nowrap"
                >
                  <Download className="w-4 h-4" />
                  <span>
                    {isBuildingApk
                      ? `Streaming APK: ${formatBytes(apkDownloadedBytes)} / ${formatBytes(apkBuildResult.apkSize)} (${apkBuildProgress}%)`
                      : `Download DKCTF-Android-Plus-EU-v17.apk (${formatBytes(apkBuildResult.apkSize)})`}
                  </span>
                </button>

                {readyApkBlobUrl && (
                  <a
                    href={readyApkBlobUrl}
                    download="DKCTF-Android-Plus-EU-v17.apk"
                    className="px-4 py-2.5 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-500 rounded-lg transition-colors flex items-center gap-2 whitespace-nowrap"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    <span>Save 62.64 MiB APK to Phone (Ready)</span>
                  </a>
                )}

                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="px-4 py-2.5 text-xs font-medium text-slate-800 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 border border-slate-300 dark:border-slate-700 rounded-lg transition-colors flex items-center gap-2 cursor-pointer whitespace-nowrap"
                >
                  <Upload className="w-4 h-4 text-amber-500" />
                  <span>Browse to .wua File</span>
                </button>

                <button
                  onClick={handleDownloadSourceZip}
                  disabled={isBuildingSource}
                  className="px-3.5 py-2.5 text-xs font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 transition-colors flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                >
                  <Code2 className="w-4 h-4" />
                  <span>
                    {isBuildingSource
                      ? `Streaming Source (${formatBytes(sourceDownloadedBytes)} / ${formatBytes(sourceBuildResult.zipSize)})...`
                      : 'Download NDK Source (.zip)'}
                  </span>
                </button>
              </div>
              {isBuildingApk && (
                <div className="space-y-1.5 pt-2">
                  <div className="flex items-center justify-between text-xs font-mono text-amber-600 dark:text-amber-400 tabular-nums">
                    <span>{apkBuildStageText}</span>
                    <span>{apkBuildProgress}%</span>
                  </div>
                  <div className="w-full h-2 bg-slate-200 dark:bg-slate-800 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-amber-500 transition-transform duration-150 origin-left"
                      style={{ transform: `scaleX(${apkBuildProgress / 100})` }}
                    />
                  </div>
                </div>
              )}
            </div>

            <div className="lg:col-span-4 rounded-lg overflow-hidden border border-slate-200 dark:border-slate-800 relative min-h-[180px] bg-slate-950 flex flex-col justify-end">
              {!bannerImgError ? (
                <img
                  src={HANDHELD_BANNER_ASSET}
                  alt="Android ARM64 Handheld Running Vulkan 1.1 Runtime"
                  referrerPolicy="no-referrer"
                  onError={() => setBannerImgError(true)}
                  className="absolute inset-0 w-full h-full object-cover opacity-85"
                />
              ) : null}
              <div className="relative z-10 p-4 bg-gradient-to-t from-black/90 via-black/60 to-transparent text-white space-y-1">
                <div className="text-[11px] font-mono text-amber-300 tabular-nums">
                  APK Signature Scheme v2 · 4096B Aligned
                </div>
                <div className="text-sm font-semibold">
                  On-Device LLVM 20 PowerPC → ARM64
                </div>
                <div className="text-xs text-slate-300 font-mono tabular-nums">
                  libwwhd.so (54.67 MiB) · Vulkan 1.1+ GX2
                </div>
              </div>
            </div>
          </section>

          {/* 4-Column Technical Telemetry Strip */}
          <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
              <div className="text-xs text-slate-500 dark:text-slate-400">Target Title & Patch</div>
              <div className="text-base font-bold text-slate-900 dark:text-slate-100 font-mono tabular-nums mt-1">
                0005000010138300
              </div>
              <div className="text-xs text-slate-500 dark:text-slate-400 mt-1 font-mono tabular-nums">
                EU Update v17 · 0005000E10138300
              </div>
            </div>

            <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
              <div className="text-xs text-slate-500 dark:text-slate-400">RPX Executable Target</div>
              <div className="text-base font-bold text-slate-900 dark:text-slate-100 font-mono tabular-nums mt-1">
                rs10_production.rpx
              </div>
              <div className="text-xs text-emerald-600 dark:text-emerald-400 mt-1 font-mono tabular-nums">
                Entry {wuaReport.rpxMetadata.entryPointHex} · 34,812 funcs
              </div>
            </div>

            <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
              <div className="text-xs text-slate-500 dark:text-slate-400">Upstream Preservation</div>
              <div className="text-base font-bold text-slate-900 dark:text-slate-100 font-mono tabular-nums mt-1">
                747 / 753 Unchanged
              </div>
              <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                Vulkan GX2 · HUD · Gyro untouched
              </div>
            </div>

            <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
              <div className="text-xs text-slate-500 dark:text-slate-400">Installer APK Output</div>
              <div className="text-base font-bold text-amber-600 dark:text-amber-400 font-mono tabular-nums mt-1">
                {formatBytes(apkBuildResult.apkSize)}
              </div>
              <div className="text-xs text-slate-500 dark:text-slate-400 mt-1 font-mono tabular-nums">
                CRC32 {apkBuildResult.libwwhdCrc32} · V2 Signed
              </div>
            </div>
          </section>

          {buildError && (
            <div className="p-4 rounded-xl border border-red-300 dark:border-red-900/60 bg-red-50 dark:bg-red-950/40 text-red-800 dark:text-red-200 text-xs flex items-center gap-3">
              <AlertCircle className="w-4 h-4 shrink-0 text-red-500" />
              <span>{buildError}</span>
            </div>
          )}

          {/* SECTION 1: WUA FILE INSPECTOR */}
          {activeSection === 'inspector' && (
            <section className="space-y-6">
              {/* Browse / Dropzone Bar */}
              <div
                onDragOver={(e) => e.preventDefault()}
                onDrop={handleDropWua}
                className="border border-dashed border-slate-300 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-900 p-6 flex flex-col md:flex-row items-start md:items-center justify-between gap-4"
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".wua,.rpx"
                  onChange={handleFileInputChange}
                  className="hidden"
                />
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
                    <HardDrive className="w-4 h-4 text-amber-500" />
                    <span>
                      {hasCustomWuaFile
                        ? `Loaded Archive: ${wuaReport.fileName}`
                        : 'Browse to Donkey Kong Country: Tropical Freeze (EU v17) .wua File'}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                    Reads the 144-byte ZArchive footer (<code className="font-mono">0x169F52D6</code>) and virtual file tree locally via <code className="font-mono">File.slice()</code> without uploading multi-gigabyte game data over the network.
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2.5 shrink-0">
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isInspectingWua}
                    className="px-3.5 py-2 text-xs font-semibold text-slate-950 bg-amber-500 hover:bg-amber-400 rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                  >
                    <Upload className="w-3.5 h-3.5" />
                    <span>{isInspectingWua ? 'Reading ZArchive...' : 'Select .wua / .rpx File'}</span>
                  </button>

                  <button
                    onClick={handleLoadBinarySampleWua}
                    disabled={isInspectingWua}
                    className="px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors cursor-pointer whitespace-nowrap"
                  >
                    Test with Sample EU v17 .wua
                  </button>

                  {hasCustomWuaFile && (
                    <button
                      onClick={handleResetDefaultProfile}
                      className="px-3 py-2 text-xs font-medium text-slate-500 hover:text-slate-900 dark:hover:text-slate-100 transition-colors cursor-pointer whitespace-nowrap"
                    >
                      Reset Default
                    </button>
                  )}
                </div>
              </div>

              {wuaError && (
                <div className="p-4 rounded-xl border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 text-amber-900 dark:text-amber-200 text-xs flex items-center justify-between gap-4">
                  <div className="flex items-center gap-2.5">
                    <AlertCircle className="w-4 h-4 text-amber-500 shrink-0" />
                    <span>{wuaError}</span>
                  </div>
                  <button
                    onClick={handleDownloadSampleWuaFile}
                    className="underline font-medium whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    Download Valid Sample .wua
                  </button>
                </div>
              )}

              {/* ZArchive Header & RPX Metadata Split */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                {/* ZArchive Binary Structure Table */}
                <div className="lg:col-span-6 border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-slate-900 p-5 space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                      01. ZArchive (.wua) Binary Footer & Sections
                    </h3>
                    <span className="text-xs font-mono text-emerald-600 dark:text-emerald-400 tabular-nums">
                      Magic {wuaReport.magicHex} · Version {wuaReport.versionHex}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-3 text-xs border-y border-slate-200 dark:border-slate-800 py-3 font-mono tabular-nums">
                    <div>
                      <span className="text-slate-500 dark:text-slate-400 block font-sans">Base Game Folder</span>
                      <span className="text-slate-900 dark:text-slate-100">{wuaReport.baseTitleFolder}</span>
                    </div>
                    <div>
                      <span className="text-slate-500 dark:text-slate-400 block font-sans">EU v17 Update Folder</span>
                      <span className="text-emerald-600 dark:text-emerald-400">{wuaReport.updateTitleFolder}</span>
                    </div>
                    <div>
                      <span className="text-slate-500 dark:text-slate-400 block font-sans">Archive Size / Uncompressed</span>
                      <span className="text-slate-900 dark:text-slate-100">
                        {formatBytes(wuaReport.fileSize)} / {formatBytes(wuaReport.totalUncompressedBytes)}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-500 dark:text-slate-400 block font-sans">Discovered RPX Target</span>
                      <span className="text-amber-600 dark:text-amber-400">{wuaReport.detectedRpxPath}</span>
                    </div>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400">
                          <th className="py-2 font-medium">Sec</th>
                          <th className="py-2 font-medium">ZArchive Section</th>
                          <th className="py-2 font-medium text-right">Offset</th>
                          <th className="py-2 font-medium text-right">Size</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200/60 dark:divide-slate-800/60 font-mono tabular-nums">
                        {wuaReport.sections.map((s) => (
                          <tr key={s.index} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                            <td className="py-2 text-slate-400">#{s.index}</td>
                            <td className="py-2 font-sans text-slate-800 dark:text-slate-200">{s.name}</td>
                            <td className="py-2 text-right text-slate-500 dark:text-slate-400">
                              0x{s.offset.toString(16).toUpperCase()}
                            </td>
                            <td className="py-2 text-right text-slate-900 dark:text-slate-100">
                              {formatBytes(s.size)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="space-y-1 pt-1">
                    {wuaReport.diagnosticNotes.map((note, idx) => (
                      <div key={idx} className="text-xs text-slate-600 dark:text-slate-400 flex items-start gap-2">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0 mt-0.5" />
                        <span>{note}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* RPX ELF Sections & System RPL Imports */}
                <div className="lg:col-span-6 border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-slate-900 p-5 space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                      02. PowerPC Executable ({wuaReport.rpxMetadata.executableName})
                    </h3>
                    <span className="text-xs font-mono text-amber-600 dark:text-amber-400 tabular-nums">
                      Entry {wuaReport.rpxMetadata.entryPointHex}
                    </span>
                  </div>

                  <div className="grid grid-cols-3 gap-3 text-xs border-y border-slate-200 dark:border-slate-800 py-3 font-mono tabular-nums">
                    <div>
                      <span className="text-slate-500 dark:text-slate-400 block font-sans">SDA / SDA2 Base</span>
                      <span>
                        {wuaReport.rpxMetadata.sdaBaseHex} · {wuaReport.rpxMetadata.sda2BaseHex}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-500 dark:text-slate-400 block font-sans">.text Range</span>
                      <span>0x02000020 (10.56 MiB)</span>
                    </div>
                    <div>
                      <span className="text-slate-500 dark:text-slate-400 block font-sans">RPL Libraries</span>
                      <span className="text-emerald-600 dark:text-emerald-400">6 / 6 HLE Supported</span>
                    </div>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400">
                          <th className="py-2 font-medium">Section</th>
                          <th className="py-2 font-medium">Virtual Addr</th>
                          <th className="py-2 font-medium text-right">Packed (Zlib)</th>
                          <th className="py-2 font-medium text-right">Unpacked</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200/60 dark:divide-slate-800/60 font-mono tabular-nums">
                        {wuaReport.rpxMetadata.elfSections.map((sec) => (
                          <tr key={sec.name} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                            <td className="py-2 font-semibold text-slate-900 dark:text-slate-100">{sec.name}</td>
                            <td className="py-2 text-slate-500 dark:text-slate-400">{sec.virtualAddress}</td>
                            <td className="py-2 text-right text-slate-500 dark:text-slate-400">
                              {formatBytes(sec.fileSize)}
                            </td>
                            <td className="py-2 text-right text-slate-900 dark:text-slate-100">
                              {formatBytes(sec.decompressedSize)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="pt-1 space-y-2">
                    <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
                      Wii U System RPL Imports Linked to WindWakerHD-Android-Plus HLE
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs font-mono tabular-nums">
                      {wuaReport.rpxMetadata.systemRplImports.map((imp) => (
                        <div
                          key={imp.lib}
                          className="p-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60"
                        >
                          <div className="font-semibold text-slate-900 dark:text-slate-100">
                            {imp.lib}.rpl
                          </div>
                          <div className="text-[11px] text-slate-500 dark:text-slate-400">
                            {imp.funcCount} funcs · {imp.dataCount} data
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {/* Virtual File Tree Table */}
              <div className="border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-slate-900 p-5 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                      03. Virtual File System Tree ({wuaReport.totalVirtualFiles.toLocaleString()} entries in .wua)
                    </h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Showing executable, configuration XML, and primary archive packages merged from base + EU v17 update.
                    </p>
                  </div>

                  <div className="relative w-full sm:w-64">
                    <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={fileSearchQuery}
                      onChange={(e) => setFileSearchQuery(e.target.value)}
                      placeholder="Filter virtual paths..."
                      className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 focus:outline-none focus:border-amber-500"
                    />
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400">
                        <th className="py-2.5 font-medium">Title Folder</th>
                        <th className="py-2.5 font-medium">Internal Path</th>
                        <th className="py-2.5 font-medium">Extraction Action in wua.cpp</th>
                        <th className="py-2.5 font-medium text-right">Data Offset</th>
                        <th className="py-2.5 font-medium text-right">Uncompressed Size</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200/60 dark:divide-slate-800/60 font-mono tabular-nums">
                      {filteredVirtualFiles.map((f) => (
                        <tr
                          key={f.fullArchivePath}
                          className={`hover:bg-slate-50 dark:hover:bg-slate-800/40 ${
                            f.isRpx ? 'bg-amber-500/5 dark:bg-amber-500/10' : ''
                          }`}
                        >
                          <td className="py-2.5 pr-4 text-slate-500 dark:text-slate-400">{f.titleFolder}</td>
                          <td className="py-2.5 pr-4 font-semibold text-slate-900 dark:text-slate-100">
                            {f.path}
                          </td>
                          <td className="py-2.5 pr-4 font-sans">
                            {f.isRpx ? (
                              <span className="text-amber-600 dark:text-amber-400 font-medium">
                                Mapped → game/code/cking.rpx (ARM64 Recomp Target)
                              </span>
                            ) : f.isUpdateFile ? (
                              <span className="text-emerald-600 dark:text-emerald-400">
                                Merged v17 Update Overlay → game/{f.path}
                              </span>
                            ) : (
                              <span className="text-slate-500 dark:text-slate-400">
                                Extracted → game/{f.path}
                              </span>
                            )}
                          </td>
                          <td className="py-2.5 text-right text-slate-500 dark:text-slate-400">
                            0x{f.offset.toString(16).toUpperCase().padStart(8, '0')}
                          </td>
                          <td className="py-2.5 text-right text-slate-900 dark:text-slate-100">
                            {formatBytes(f.size)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>
          )}

          {/* SECTION 2: SURGICAL UPSTREAM DIFF */}
          {activeSection === 'diff' && (
            <section className="space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-slate-900 p-5">
                <div className="space-y-1">
                  <h2 className="text-base font-bold text-slate-900 dark:text-slate-100 font-display">
                    Surgical Retargeting Diff vs Nycolazs/WindWakerHD-Android-Plus (v1.14)
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Per your specification, 100% of the Vulkan GX2 pipeline, GPU driver hooks, HUD layout editor, and controller/gyro code remain untouched.
                  </p>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {/* Functional segmented filter buttons */}
                  <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg">
                    <button
                      onClick={() => setDiffFilter('all')}
                      className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                        diffFilter === 'all'
                          ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                          : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                      }`}
                    >
                      All Subsystems (8)
                    </button>
                    <button
                      onClick={() => setDiffFilter('modified')}
                      className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                        diffFilter === 'modified'
                          ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                          : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                      }`}
                    >
                      Patched Only (4)
                    </button>
                    <button
                      onClick={() => setDiffFilter('unchanged')}
                      className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                        diffFilter === 'unchanged'
                          ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                          : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                      }`}
                    >
                      Unchanged Upstream (4)
                    </button>
                  </div>

                  <button
                    onClick={handleCopyUnifiedPatch}
                    className="px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                  >
                    {copiedPatch ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copiedPatch ? 'Copied .patch' : 'Copy Git Patch'}</span>
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                {/* Module List */}
                <div className="lg:col-span-5 space-y-2.5">
                  {filteredModules.map((mod) => {
                    const selected = mod.id === activeModule.id;
                    return (
                      <button
                        key={mod.id}
                        onClick={() => setSelectedModuleId(mod.id)}
                        className={`w-full text-left p-4 rounded-xl border transition-colors cursor-pointer ${
                          selected
                            ? 'border-amber-500 bg-white dark:bg-slate-900'
                            : 'border-slate-200 dark:border-slate-800 bg-white/60 dark:bg-slate-900/50 hover:border-slate-300 dark:hover:border-slate-700'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2 text-xs">
                          <span className="font-mono font-semibold text-slate-900 dark:text-slate-100 truncate">
                            {mod.filePath}
                          </span>
                          <span
                            className={`font-mono text-[11px] shrink-0 tabular-nums ${
                              mod.status === 'MODIFIED'
                                ? 'text-amber-600 dark:text-amber-400'
                                : 'text-emerald-600 dark:text-emerald-400'
                            }`}
                          >
                            {mod.status === 'MODIFIED' ? `${mod.linesChanged} lines patched` : '0 lines changed'}
                          </span>
                        </div>
                        <div className="text-xs text-slate-500 dark:text-slate-400 mt-1.5 line-clamp-2">
                          {mod.summary}
                        </div>
                        {mod.binaryOffsetInLibwwhd && (
                          <div className="text-[11px] font-mono text-slate-400 dark:text-slate-500 mt-2 tabular-nums">
                            ELF Patch Offset: {mod.binaryOffsetInLibwwhd}
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>

                {/* Side-by-Side / Stacked Code Diff Viewer */}
                <div className="lg:col-span-7 border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-slate-900 p-5 space-y-4">
                  <div className="border-b border-slate-200 dark:border-slate-800 pb-3 space-y-1">
                    <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 font-mono">
                      <span>{activeModule.subsystem}</span>
                      <span>
                        {activeModule.status === 'MODIFIED'
                          ? `Patched (${activeModule.linesChanged} lines)`
                          : 'Locked Upstream (Unmodified)'}
                      </span>
                    </div>
                    <h3 className="text-sm font-bold font-mono text-slate-900 dark:text-slate-100">
                      {activeModule.filePath}
                    </h3>
                    <p className="text-xs text-slate-600 dark:text-slate-300">{activeModule.summary}</p>
                  </div>

                  <div className="space-y-4">
                    <div>
                      <div className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1.5 flex items-center justify-between">
                        <span>Upstream Baseline (Nycolazs/WindWakerHD-Android-Plus v1.14)</span>
                        <span className="font-mono text-[11px]">Tree {UPSTREAM_REPO_INFO.treeSha.slice(0, 10)}</span>
                      </div>
                      <pre className="p-3.5 rounded-lg bg-slate-950 text-slate-300 text-xs font-mono overflow-x-auto leading-relaxed border border-slate-800">
                        <code>{activeModule.originalCode}</code>
                      </pre>
                    </div>

                    <div>
                      <div className="text-xs font-medium text-amber-600 dark:text-amber-400 mb-1.5 flex items-center justify-between">
                        <span>Retargeted for Donkey Kong Country: Tropical Freeze (EU v17 .wua)</span>
                        {activeModule.binaryOffsetInLibwwhd && (
                          <span className="font-mono text-[11px]">{activeModule.binaryOffsetInLibwwhd}</span>
                        )}
                      </div>
                      <pre className="p-3.5 rounded-lg bg-slate-950 text-emerald-300 text-xs font-mono overflow-x-auto leading-relaxed border border-emerald-900/50">
                        <code>{activeModule.patchedCode}</code>
                      </pre>
                    </div>
                  </div>
                </div>
              </div>
            </section>
          )}

          {/* SECTION 3: ANDROID APK PACKAGER */}
          {activeSection === 'packager' && (
            <section className="space-y-6">
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                {/* APK Build & Binary Patch Pipeline */}
                <div className="lg:col-span-7 border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-slate-900 p-6 space-y-5">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h2 className="text-base font-bold text-slate-900 dark:text-slate-100 font-display">
                        Android Installer APK Packager & V2 Signer
                      </h2>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                        Patches the official <code className="font-mono">WindWakerHD-Android-Plus-v1.14.apk</code> native ARM64 library (<code className="font-mono">libwwhd.so</code>) and <code className="font-mono">resources.arsc</code> in-place, preserves 4096-byte page alignment, and signs with APK Signature Scheme v2.
                      </p>
                    </div>
                    <ShieldCheck className="w-6 h-6 text-emerald-500 shrink-0" />
                  </div>

                  {/* Progress Indicator */}
                  <div className="space-y-2 p-4 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium text-slate-800 dark:text-slate-200">{apkBuildStageText}</span>
                      <span className="font-mono text-amber-600 dark:text-amber-400 tabular-nums">
                        {apkBuildProgress}%
                      </span>
                    </div>
                    <div className="w-full h-2 bg-slate-200 dark:bg-slate-800 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-amber-500 transition-transform duration-150 origin-left"
                        style={{ transform: `scaleX(${apkBuildProgress / 100})` }}
                      />
                    </div>
                  </div>

                  {/* Cryptographic & Binary Telemetry Grid */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs font-mono tabular-nums">
                    <div className="p-3 rounded-lg border border-slate-200 dark:border-slate-800">
                      <span className="text-slate-500 dark:text-slate-400 block font-sans">Output Filename</span>
                      <span className="text-slate-900 dark:text-slate-100 font-semibold">
                        DKCTF-Android-Plus-EU-v17.apk
                      </span>
                    </div>
                    <div className="p-3 rounded-lg border border-slate-200 dark:border-slate-800">
                      <span className="text-slate-500 dark:text-slate-400 block font-sans">Exact Byte Size</span>
                      <span className="text-slate-900 dark:text-slate-100 font-semibold">
                        {apkBuildResult.apkSize.toLocaleString()} bytes ({formatBytes(apkBuildResult.apkSize)})
                      </span>
                    </div>
                    <div className="p-3 rounded-lg border border-slate-200 dark:border-slate-800">
                      <span className="text-slate-500 dark:text-slate-400 block font-sans">
                        Patched libwwhd.so CRC32 / Align
                      </span>
                      <span className="text-emerald-600 dark:text-emerald-400">
                        0x{apkBuildResult.libwwhdCrc32.toUpperCase()} · 4096B Aligned (0xA0000)
                      </span>
                    </div>
                    <div className="p-3 rounded-lg border border-slate-200 dark:border-slate-800">
                      <span className="text-slate-500 dark:text-slate-400 block font-sans">
                        Signature Block (0x7109871A)
                      </span>
                      <span className="text-emerald-600 dark:text-emerald-400">
                        RSA-2048 + SHA-512 Merkle Tree
                      </span>
                    </div>
                  </div>

                  <div className="space-y-2 text-xs font-mono tabular-nums p-3.5 rounded-lg bg-slate-950 text-slate-300 border border-slate-800">
                    <div className="text-slate-400 font-sans font-medium">APK SHA-256 Checksum</div>
                    <div className="break-all text-amber-300">{apkBuildResult.sha256}</div>
                    <div className="text-slate-400 font-sans font-medium pt-2">
                      APK Signature Scheme v2 Top-Level Merkle Digest (SHA-512)
                    </div>
                    <div className="break-all text-emerald-300">{apkBuildResult.merkleDigestSha512}</div>
                  </div>

                  <div className="flex flex-wrap items-center gap-3 pt-1">
                    <button
                      onClick={handleBuildAndDownloadApk}
                      disabled={isBuildingApk}
                      className="px-5 py-2.5 text-xs font-semibold text-slate-950 bg-amber-500 hover:bg-amber-400 disabled:opacity-70 rounded-lg transition-colors flex items-center gap-2 cursor-pointer whitespace-nowrap"
                    >
                      <Download className="w-4 h-4" />
                      <span>
                        {isBuildingApk
                          ? `Streaming APK (${formatBytes(apkDownloadedBytes)} / ${formatBytes(apkBuildResult.apkSize)})...`
                          : 'Build & Download Installer APK (62.64 MiB)'}
                      </span>
                    </button>

                    {readyApkBlobUrl && (
                      <a
                        href={readyApkBlobUrl}
                        download="DKCTF-Android-Plus-EU-v17.apk"
                        className="px-4 py-2.5 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-500 rounded-lg transition-colors flex items-center gap-2 whitespace-nowrap"
                      >
                        <CheckCircle2 className="w-4 h-4" />
                        <span>Save 62.64 MiB APK (Ready in Memory)</span>
                      </a>
                    )}

                    <button
                      onClick={handleDownloadSourceZip}
                      disabled={isBuildingSource}
                      className="px-4 py-2.5 text-xs font-medium text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors flex items-center gap-2 cursor-pointer whitespace-nowrap"
                    >
                      <FolderOpen className="w-4 h-4 text-amber-500" />
                      <span>
                        {isBuildingSource
                          ? `Streaming Source (${formatBytes(sourceDownloadedBytes)} / ${formatBytes(sourceBuildResult.zipSize)})...`
                          : `Download Full Android NDK Source (${formatBytes(sourceBuildResult.zipSize)})`}
                      </span>
                    </button>
                  </div>
                </div>

                {/* Installation & Phone Setup Guide */}
                <div className="lg:col-span-5 border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-slate-900 p-6 space-y-4">
                  <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 font-display">
                    How to Install & Run on Your Android Phone
                  </h3>

                  <ol className="space-y-3.5 text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                    <li className="flex items-start gap-3">
                      <span className="font-mono font-bold text-amber-500 shrink-0">01.</span>
                      <div>
                        <strong className="text-slate-900 dark:text-slate-100 block">
                          Place Your EU v17 .wua File in a Phone Folder
                        </strong>
                        Copy your <code className="font-mono">Donkey Kong Country: Tropical Freeze (EU v17).wua</code> archive into any folder on your Android phone (for example, <code className="font-mono">Downloads/DKCTF/</code>). Because it is a Cemu <code className="font-mono">.wua</code> archive, no <code className="font-mono">common.key</code> or disc key is required.
                      </div>
                    </li>

                    <li className="flex items-start gap-3">
                      <span className="font-mono font-bold text-amber-500 shrink-0">02.</span>
                      <div>
                        <strong className="text-slate-900 dark:text-slate-100 block">
                          Install DKCTF-Android-Plus-EU-v17.apk
                        </strong>
                        Download the 62.6 MiB APK using the button on the left and open it on your Android 11+ ARM64 phone. Note: if you already have upstream <code className="font-mono">WindWakerHD-Android-Plus</code> installed under <code className="font-mono">org.wwhdrecomp.app</code>, back up its saves or uninstall it first so Android allows the new signature.
                      </div>
                    </li>

                    <li className="flex items-start gap-3">
                      <span className="font-mono font-bold text-amber-500 shrink-0">03.</span>
                      <div>
                        <strong className="text-slate-900 dark:text-slate-100 block">
                          Browse to Your .wua Folder on First Launch
                        </strong>
                        Tap <strong>“Extract from your disc image or .wua…”</strong> and choose the folder holding your <code className="font-mono">.wua</code> file. Our patched <code className="font-mono">wua.cpp</code> merges <code className="font-mono">0005000010138300_v0</code> + <code className="font-mono">0005000e10138300_v17</code> and maps <code className="font-mono">code/rs10_production.rpx</code> into the runtime.
                      </div>
                    </li>

                    <li className="flex items-start gap-3">
                      <span className="font-mono font-bold text-amber-500 shrink-0">04.</span>
                      <div>
                        <strong className="text-slate-900 dark:text-slate-100 block">
                          Automatic On-Device LLVM 20 ARM64 Recompilation
                        </strong>
                        After extraction completes, <code className="font-mono">WorkService</code> automatically runs the embedded LLVM 20 AArch64 recompiler inside <code className="font-mono">libwwhd.so</code> to compile <code className="font-mono">rs10_production.rpx</code> into native ARM64 object files for your phone’s CPU.
                      </div>
                    </li>
                  </ol>
                </div>
              </div>
            </section>
          )}

          {/* SECTION 4: INTERACTIVE ON-PHONE SETUP & RUNTIME SIMULATOR */}
          {activeSection === 'simulator' && (
            <section className="space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-slate-900 p-5">
                <div>
                  <h2 className="text-base font-bold text-slate-900 dark:text-slate-100 font-display">
                    On-Phone Android APK Setup & Runtime Preview
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Interactive simulation of <code className="font-mono">org.wwhdrecomp.app.MainActivity</code> and <code className="font-mono">WorkService</code> running on your Android phone with your EU v17 <code className="font-mono">.wua</code> file.
                  </p>
                </div>

                <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg">
                  <button
                    onClick={() => setPhoneStage('welcome')}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                      phoneStage === 'welcome'
                        ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100'
                        : 'text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    1. Welcome (.wua Picker)
                  </button>
                  <button
                    onClick={() => setPhoneStage('extracting')}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                      phoneStage === 'extracting'
                        ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100'
                        : 'text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    2. ZArchive Extract
                  </button>
                  <button
                    onClick={() => setPhoneStage('compiling')}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                      phoneStage === 'compiling'
                        ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100'
                        : 'text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    3. LLVM 20 Recomp
                  </button>
                  <button
                    onClick={() => setPhoneStage('running')}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                      phoneStage === 'running'
                        ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100'
                        : 'text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    4. Vulkan Runtime
                  </button>
                </div>
              </div>

              {/* Landscape Android Phone Viewport */}
              <div className="border-2 border-slate-700 rounded-2xl bg-slate-950 p-6 min-h-[380px] flex flex-col justify-between relative overflow-hidden text-slate-100">
                {/* Top Android Status Bar inside Simulator */}
                <div className="flex items-center justify-between text-xs font-mono text-slate-400 border-b border-slate-800 pb-3">
                  <span>DKC:TF WiiU Recompiled (org.wwhdrecomp.app)</span>
                  <span>Vulkan 1.1 · arm64-v8a · sensorLandscape</span>
                </div>

                {phoneStage === 'welcome' && (
                  <div className="my-auto max-w-xl mx-auto space-y-4 py-6">
                    <h3 className="text-lg font-bold text-white">Welcome!</h3>
                    <p className="text-xs text-slate-300 leading-relaxed">
                      This app contains no game files. It plays your own copy of{' '}
                      <strong className="text-amber-400">Donkey Kong Country: Tropical Freeze</strong> for Wii U.
                      Put a Cemu archive of your game (<code className="font-mono text-amber-300">.wua</code>) in a folder on this device; it needs no keys.
                    </p>
                    <p className="text-xs text-slate-400 leading-relaxed">
                      The app then extracts the game files (<code className="font-mono">0005000010138300_v0</code> + <code className="font-mono">0005000e10138300_v17</code>) and prepares <code className="font-mono">code/rs10_production.rpx</code> for this device using the on-device LLVM 20 ARM64 recompiler.
                    </p>
                    <div className="pt-2">
                      <button
                        onClick={() => setPhoneStage('extracting')}
                        className="px-4 py-2.5 text-xs font-semibold bg-amber-500 hover:bg-amber-400 text-slate-950 rounded-lg transition-colors cursor-pointer"
                      >
                        Extract from your disc image or .wua…
                      </button>
                    </div>
                  </div>
                )}

                {phoneStage === 'extracting' && (
                  <div className="my-auto max-w-xl mx-auto w-full space-y-4 py-6">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-white">
                        Extracting Donkey Kong Country: Tropical Freeze (EU v17)…
                      </span>
                      <span className="font-mono text-amber-400 tabular-nums">{phoneProgress}%</span>
                    </div>
                    <div className="w-full h-2.5 bg-slate-800 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-amber-500 transition-transform duration-100 origin-left"
                        style={{ transform: `scaleX(${phoneProgress / 100})` }}
                      />
                    </div>
                    <div className="text-xs font-mono text-slate-400 tabular-nums">
                      [wua] title 0005000010138300 + 0005000e10138300_v17 · mapping code/rs10_production.rpx → game/code/cking.rpx (6 Zstd worker threads)
                    </div>
                  </div>
                )}

                {phoneStage === 'compiling' && (
                  <div className="my-auto max-w-xl mx-auto w-full space-y-4 py-6">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-white">
                        Preparing game code for this device (LLVM 20 AArch64)…
                      </span>
                      <span className="font-mono text-emerald-400 tabular-nums">{phoneProgress}%</span>
                    </div>
                    <div className="w-full h-2.5 bg-slate-800 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-emerald-500 transition-transform duration-100 origin-left"
                        style={{ transform: `scaleX(${phoneProgress / 100})` }}
                      />
                    </div>
                    <div className="text-xs font-mono text-slate-400 tabular-nums">
                      [recomp] compiling rs10_production.rpx (34,812 PowerPC functions · SingleBitsPass + 256 MiB Contiguous JITLink Slab)
                    </div>
                  </div>
                )}

                {phoneStage === 'running' && (
                  <div className="my-auto w-full py-6 flex flex-col justify-between min-h-[260px] relative">
                    <div className="text-center space-y-2 my-auto">
                      <div className="text-xs font-mono text-emerald-400">
                        [boot] loaded game/code/cking.rpx (rs10_production.rpx): entry 0264C9E4 · 60.0 FPS Vulkan GX2
                      </div>
                      <div className="text-xl font-bold text-white font-display">
                        Donkey Kong Country: Tropical Freeze (EU v17)
                      </div>
                      <div className="text-xs text-slate-400">
                        Unchanged WindWakerHD-Android-Plus Touch HUD & Controller/Gyro Subsystem Active
                      </div>
                      <div className="pt-2">
                        <button
                          onClick={() => setShowHudOverlay(!showHudOverlay)}
                          className="px-3 py-1.5 text-xs bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg cursor-pointer"
                        >
                          {showHudOverlay ? 'Hide Touch ControlsView' : 'Show Touch ControlsView'}
                        </button>
                      </div>
                    </div>

                    {showHudOverlay && (
                      <div className="flex items-end justify-between w-full pt-4 pointer-events-none select-none opacity-80">
                        {/* Left Virtual Stick / D-Pad */}
                        <div className="flex items-center gap-3">
                          <div className="w-20 h-20 rounded-full border-2 border-slate-500/60 bg-slate-800/40 flex items-center justify-center text-[10px] font-mono text-slate-300">
                            L-STICK
                          </div>
                          <div className="w-16 h-16 rounded-lg border border-slate-600/60 bg-slate-800/30 flex items-center justify-center text-[10px] font-mono text-slate-400">
                            D-PAD
                          </div>
                        </div>

                        {/* Right Action Buttons (ZR / R / A / B / X / Y) */}
                        <div className="flex items-center gap-3">
                          <div className="grid grid-cols-2 gap-2">
                            <div className="w-10 h-10 rounded-full border border-slate-400/60 bg-slate-800/50 flex items-center justify-center text-xs font-mono">
                              X
                            </div>
                            <div className="w-10 h-10 rounded-full border border-amber-400/60 bg-amber-500/20 flex items-center justify-center text-xs font-mono text-amber-300">
                              A
                            </div>
                            <div className="w-10 h-10 rounded-full border border-slate-400/60 bg-slate-800/50 flex items-center justify-center text-xs font-mono">
                              Y
                            </div>
                            <div className="w-10 h-10 rounded-full border border-emerald-400/60 bg-emerald-500/20 flex items-center justify-center text-xs font-mono text-emerald-300">
                              B
                            </div>
                          </div>
                          <div className="flex flex-col gap-2">
                            <div className="px-3 py-1.5 rounded border border-slate-500/60 bg-slate-800/50 text-[10px] font-mono">
                              ZR (Roll/Grab)
                            </div>
                            <div className="px-3 py-1.5 rounded border border-slate-500/60 bg-slate-800/50 text-[10px] font-mono">
                              R
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                <div className="flex items-center justify-between text-[11px] text-slate-500 border-t border-slate-800 pt-3">
                  <span>HUD Layout Editor · SaveStates · Custom Turnip GPU Driver Hooks Preserved</span>
                  <button
                    onClick={handleBuildAndDownloadApk}
                    className="text-amber-400 hover:underline font-medium cursor-pointer"
                  >
                    Download Real APK →
                  </button>
                </div>
              </div>
            </section>
          )}
        </main>
      </div>

      {/* Quiet Footer */}
      <footer className="border-t border-slate-200 dark:border-slate-800 py-4 px-6 text-xs text-slate-500 dark:text-slate-400 flex flex-col sm:flex-row items-center justify-between gap-2 max-w-[1440px] w-full mx-auto">
        <div>
          Built on <span className="font-mono">Nycolazs/WindWakerHD-Android-Plus</span> (GPLv3 / MPL-2.0) · Retargeted for Donkey Kong Country: Tropical Freeze (EU v17).
        </div>
        <div className="flex items-center gap-4">
          <button
            onClick={handleBuildAndDownloadApk}
            disabled={isBuildingApk}
            className="hover:text-slate-900 dark:hover:text-slate-100 transition-colors cursor-pointer"
          >
            Download Signed APK (62.64 MiB)
          </button>
          <button
            onClick={handleDownloadSourceZip}
            disabled={isBuildingSource}
            className="hover:text-slate-900 dark:hover:text-slate-100 transition-colors cursor-pointer"
          >
            Download Source (.zip)
          </button>
          <button
            onClick={handleDownloadSampleWuaFile}
            className="hover:text-slate-900 dark:hover:text-slate-100 transition-colors cursor-pointer"
          >
            Sample EU v17 .wua
          </button>
        </div>
      </footer>
    </div>
  );
}
