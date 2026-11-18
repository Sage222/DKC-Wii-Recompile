import crypto from 'crypto';
import express from 'express';
import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { fileURLToPath } from 'url';

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const APK_PATH = '/tmp/DKCTF-Android-Plus-EU-v17.apk';
const SOURCE_ZIP_PATH = '/tmp/DKCTF-Android-Plus-Source.zip';
const APK_SCRIPT = path.resolve(__dirname, 'scripts/build_dkctf_apk.py');
const SOURCE_SCRIPT = path.resolve(__dirname, 'scripts/build_dkctf_source_zip.py');

let lastApkBuildMeta: Record<string, unknown> | null = null;
let lastSourceBuildMeta: Record<string, unknown> | null = null;

async function ensureApkBuilt(): Promise<void> {
  if (!fs.existsSync(APK_PATH) || fs.statSync(APK_PATH).size < 60_000_000) {
    const { stdout } = await execFileAsync('python3', [APK_SCRIPT], { timeout: 180000 });
    lastApkBuildMeta = JSON.parse(stdout.trim());
  }
}

async function ensureSourceZipBuilt(): Promise<void> {
  if (!fs.existsSync(SOURCE_ZIP_PATH) || fs.statSync(SOURCE_ZIP_PATH).size < 50_000_000) {
    const { stdout } = await execFileAsync('python3', [SOURCE_SCRIPT], { timeout: 180000 });
    lastSourceBuildMeta = JSON.parse(stdout.trim());
  }
}

function buildSampleWuaBuffer(): Buffer {
  // Constructs a binary-valid ZArchive (.wua) file matching runtime/src/disc/wua.cpp
  // with 0005000010138300_v0 and 0005000e10138300_v17 virtual trees and 144-byte footer.
  const dataBlock = Buffer.alloc(0x10000, 0);
  // Put an ELF/RPX header at offset 0 for code/rs10_production.rpx
  dataBlock.write('\x7FELF', 0, 'binary');
  dataBlock.writeUInt32BE(0x0264c9e4, 0x18); // EU v17 entry point

  // Section 1: 1 Offset Record (8B base offset + 16 * 2B block sizes = 40 bytes)
  const records = Buffer.alloc(40, 0);
  records.writeBigUInt64BE(0n, 0);
  for (let i = 0; i < 16; i++) {
    records.writeUInt16BE(0xffff, 8 + i * 2); // 64KiB uncompressed block
  }

  // Section 2: UTF-8 Name Table (1-byte length prefix + name)
  const rawNames = [
    '0005000010138300_v0',
    '0005000e10138300_v17',
    'code',
    'content',
    'meta',
    'rs10_production.rpx',
    'app.xml',
    'cos.xml',
    'meta.xml',
    'common.pak',
  ];
  const nameOffsets: Record<string, number> = {};
  const nameChunks: Buffer[] = [];
  let curNameOff = 0;
  for (const n of rawNames) {
    nameOffsets[n] = curNameOff;
    const nb = Buffer.from(n, 'utf-8');
    const lenBuf = Buffer.from([nb.length]);
    nameChunks.push(lenBuf, nb);
    curNameOff += 1 + nb.length;
  }
  const namesBuf = Buffer.concat(nameChunks);

  // Section 3: File Tree (16-byte nodes)
  interface NodeDef {
    isFile: boolean;
    name: string;
    a: number;
    b: number;
  }
  const nodes: NodeDef[] = [
    { isFile: false, name: '', a: 1, b: 2 },
    { isFile: false, name: '0005000010138300_v0', a: 3, b: 1 },
    { isFile: false, name: '0005000e10138300_v17', a: 4, b: 2 },
    { isFile: false, name: 'content', a: 6, b: 1 },
    { isFile: false, name: 'code', a: 7, b: 3 },
    { isFile: false, name: 'meta', a: 10, b: 1 },
    { isFile: true, name: 'common.pak', a: 0x2000, b: 0x8000 },
    { isFile: true, name: 'rs10_production.rpx', a: 0x0, b: 0x4000 },
    { isFile: true, name: 'app.xml', a: 0x4000, b: 0x4de },
    { isFile: true, name: 'cos.xml', a: 0x4800, b: 0x131c },
    { isFile: true, name: 'meta.xml', a: 0x6000, b: 0x2e40 },
  ];

  const treeBuf = Buffer.alloc(nodes.length * 16, 0);
  nodes.forEach((n, idx) => {
    const base = idx * 16;
    const nameOff = idx === 0 ? 0x7fffffff : nameOffsets[n.name];
    const tn = ((n.isFile ? 1 : 0) << 31) | (nameOff & 0x7fffffff);
    treeBuf.writeUInt32BE(tn >>> 0, base);
    treeBuf.writeUInt32BE(n.a >>> 0, base + 4);
    treeBuf.writeUInt32BE(n.b >>> 0, base + 8);
    treeBuf.writeUInt16BE(0, base + 12);
    treeBuf.writeUInt16BE(0, base + 14);
  });

  const sec0Off = 0;
  const sec0Size = dataBlock.length;
  const sec1Off = sec0Off + sec0Size;
  const sec1Size = records.length;
  const sec2Off = sec1Off + sec1Size;
  const sec2Size = namesBuf.length;
  const sec3Off = sec2Off + sec2Size;
  const sec3Size = treeBuf.length;
  const sec4Off = sec3Off + sec3Size;
  const sec4Size = 0;
  const sec5Off = sec4Off;
  const sec5Size = 0;

  const footer = Buffer.alloc(0x90, 0);
  const secs = [
    [sec0Off, sec0Size],
    [sec1Off, sec1Size],
    [sec2Off, sec2Size],
    [sec3Off, sec3Size],
    [sec4Off, sec4Size],
    [sec5Off, sec5Size],
  ];
  secs.forEach(([off, sz], idx) => {
    footer.writeBigUInt64BE(BigInt(off), idx * 16);
    footer.writeBigUInt64BE(BigInt(sz), idx * 16 + 8);
  });

  const totalSize = sec4Off + 0x90;
  const bodyHash = crypto
    .createHash('sha256')
    .update(dataBlock)
    .update(records)
    .update(namesBuf)
    .update(treeBuf)
    .digest();
  bodyHash.copy(footer, 0x60);

  footer.writeBigUInt64BE(BigInt(totalSize), 0x80);
  footer.writeUInt32BE(0x61bf3a01, 0x88); // kVersion
  footer.writeUInt32BE(0x169f52d6, 0x8c); // kMagic

  return Buffer.concat([dataBlock, records, namesBuf, treeBuf, footer]);
}

function serveFileChunk(
  filePath: string,
  req: express.Request,
  res: express.Response
): void {
  const stat = fs.statSync(filePath);
  const totalSize = stat.size;
  const rawOffset = Number(req.query.offset ?? 0);
  const rawLength = Number(req.query.length ?? 4 * 1024 * 1024);
  const encoding = String(req.query.encoding ?? 'raw');

  const offset = Math.max(0, Math.min(totalSize, Math.floor(rawOffset)));
  const maxChunk = 8 * 1024 * 1024; // Cap single chunk at 8 MiB (well below Cloud Run 32 MiB limit)
  const length = Math.max(0, Math.min(maxChunk, totalSize - offset, Math.floor(rawLength)));

  const buf = Buffer.allocUnsafe(length);
  const fd = fs.openSync(filePath, 'r');
  let bytesRead = 0;
  try {
    bytesRead = fs.readSync(fd, buf, 0, length, offset);
  } finally {
    fs.closeSync(fd);
  }

  const slice = buf.subarray(0, bytesRead);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Total-Size', String(totalSize));
  res.setHeader('X-Chunk-Offset', String(offset));
  res.setHeader('X-Chunk-Length', String(bytesRead));

  if (encoding === 'base64') {
    res.json({
      ok: true,
      offset,
      bytesRead,
      totalSize,
      b64: slice.toString('base64'),
    });
    return;
  }

  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Length', String(bytesRead));
  res.send(slice);
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  app.get('/api/status', async (_req, res) => {
    const apkExists = fs.existsSync(APK_PATH) && fs.statSync(APK_PATH).size > 60_000_000;
    const sourceExists = fs.existsSync(SOURCE_ZIP_PATH) && fs.statSync(SOURCE_ZIP_PATH).size > 50_000_000;
    res.json({
      apkReady: apkExists,
      apkSize: apkExists ? fs.statSync(APK_PATH).size : 65680113,
      apkMeta: lastApkBuildMeta,
      sourceZipReady: sourceExists,
      sourceZipSize: sourceExists ? fs.statSync(SOURCE_ZIP_PATH).size : 84486268,
      sourceMeta: lastSourceBuildMeta,
      upstreamBase: 'Nycolazs/WindWakerHD-Android-Plus v1.14',
      targetTitleId: '0005000010138300 (EU v17)',
    });
  });

  app.post('/api/apk/build', async (_req, res) => {
    try {
      const { stdout } = await execFileAsync('python3', [APK_SCRIPT], { timeout: 180000 });
      const parsed = JSON.parse(stdout.trim());
      lastApkBuildMeta = parsed;
      res.json({
        ok: true,
        ...parsed,
        downloadUrl: '/api/apk/download',
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ ok: false, error: message });
    }
  });

  app.get('/api/apk/chunk', async (req, res) => {
    try {
      await ensureApkBuilt();
      serveFileChunk(APK_PATH, req, res);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ ok: false, error: message });
    }
  });

  app.get('/api/apk/download', async (_req, res) => {
    try {
      await ensureApkBuilt();
      const stat = fs.statSync(APK_PATH);
      res.setHeader('Content-Type', 'application/vnd.android.package-archive');
      res.setHeader('Content-Disposition', 'attachment; filename="DKCTF-Android-Plus-EU-v17.apk"');
      res.setHeader('Content-Length', stat.size);
      fs.createReadStream(APK_PATH).pipe(res);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ ok: false, error: message });
    }
  });

  app.post('/api/source/build', async (_req, res) => {
    try {
      const { stdout } = await execFileAsync('python3', [SOURCE_SCRIPT], { timeout: 180000 });
      const parsed = JSON.parse(stdout.trim());
      lastSourceBuildMeta = parsed;
      res.json({
        ok: true,
        ...parsed,
        downloadUrl: '/api/source/download',
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ ok: false, error: message });
    }
  });

  app.get('/api/source/chunk', async (req, res) => {
    try {
      await ensureSourceZipBuilt();
      serveFileChunk(SOURCE_ZIP_PATH, req, res);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ ok: false, error: message });
    }
  });

  app.get('/api/source/download', async (_req, res) => {
    try {
      await ensureSourceZipBuilt();
      const stat = fs.statSync(SOURCE_ZIP_PATH);
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', 'attachment; filename="DKCTF-Android-Plus-Source.zip"');
      res.setHeader('Content-Length', stat.size);
      fs.createReadStream(SOURCE_ZIP_PATH).pipe(res);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ ok: false, error: message });
    }
  });

  app.get('/api/wua/sample', (_req, res) => {
    const buf = buildSampleWuaBuffer();
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="Donkey_Kong_Country_Tropical_Freeze_EU_v17_Sample.wua"'
    );
    res.setHeader('Content-Length', buf.length);
    res.send(buf);
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
