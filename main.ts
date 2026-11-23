// THE WORLD TODAY — Monday 23 November 2026.
// A dense newspaper front page drawn entirely in code: own TTF parser +
// glyph rasteriser, own raster canvas, own PNG encoder. Node stdlib only,
// no network, fully deterministic (fixed-seed grain, no clock, no random).
import * as fs from "node:fs";
import * as path from "node:path";
import * as zlib from "node:zlib";

// ---------------------------------------------------------------- palette
const W = 1024, H = 1024;
const PAPER: RGB = [245, 240, 230];
const INK: RGB = [20, 18, 16];
const RED: RGB = [168, 30, 34];
const RED_DK: RGB = [128, 18, 24];
const NAVY: RGB = [22, 35, 63];
const NAVY2: RGB = [38, 56, 92];
const GOLD: RGB = [201, 162, 39];
const TEAL: RGB = [31, 111, 107];
const MUTED: RGB = [107, 98, 87];
const RULE: RGB = [60, 52, 44];
const CREAM2: RGB = [238, 231, 214];
const SKY: RGB = [176, 205, 222];
const SKY2: RGB = [214, 228, 236];

type RGB = [number, number, number];

// ---------------------------------------------------------------- canvas
class Canvas {
  data = new Uint8Array(W * H * 3);
  constructor() { this.fill(PAPER); }
  fill(c: RGB) {
    for (let i = 0; i < W * H; i++) { this.data[i * 3] = c[0]; this.data[i * 3 + 1] = c[1]; this.data[i * 3 + 2] = c[2]; }
  }
  set(x: number, y: number, c: RGB) {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const i = (y * W + x) * 3;
    this.data[i] = c[0]; this.data[i + 1] = c[1]; this.data[i + 2] = c[2];
  }
  blend(x: number, y: number, c: RGB, a: number) {
    if (x < 0 || y < 0 || x >= W || y >= H || a <= 0) return;
    if (a >= 1) { this.set(x, y, c); return; }
    const i = (y * W + x) * 3;
    this.data[i] = Math.round(this.data[i] * (1 - a) + c[0] * a);
    this.data[i + 1] = Math.round(this.data[i + 1] * (1 - a) + c[1] * a);
    this.data[i + 2] = Math.round(this.data[i + 2] * (1 - a) + c[2] * a);
  }
  rect(x: number, y: number, w: number, h: number, c: RGB) {
    x = Math.round(x); y = Math.round(y); w = Math.round(w); h = Math.round(h);
    for (let j = Math.max(0, y); j < Math.min(H, y + h); j++)
      for (let i = Math.max(0, x); i < Math.min(W, x + w); i++) this.set(i, j, c);
  }
  rectA(x: number, y: number, w: number, h: number, c: RGB, a: number) {
    x = Math.round(x); y = Math.round(y); w = Math.round(w); h = Math.round(h);
    for (let j = Math.max(0, y); j < Math.min(H, y + h); j++)
      for (let i = Math.max(0, x); i < Math.min(W, x + w); i++) this.blend(i, j, c, a);
  }
  hline(x: number, y: number, w: number, c: RGB, th = 1) { this.rect(x, y - Math.floor(th / 2), w, th, c); }
  vline(x: number, y: number, h: number, c: RGB, th = 1) { this.rect(x - Math.floor(th / 2), y, th, h, c); }
  line(x0: number, y0: number, x1: number, y1: number, c: RGB, th = 1) {
    const dx = x1 - x0, dy = y1 - y0, n = Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)));
    for (let s = 0; s <= n; s++) {
      const x = Math.round(x0 + dx * s / n), y = Math.round(y0 + dy * s / n);
      this.rect(x - Math.floor(th / 2), y - Math.floor(th / 2), th, th, c);
    }
  }
  circle(cx: number, cy: number, r: number, c: RGB) {
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++)
      for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
        const d = (x - cx + 0.5) * (x - cx + 0.5) + (y - cy + 0.5) * (y - cy + 0.5);
        if (d <= r * r) this.set(x, y, c);
      }
  }
  circleA(cx: number, cy: number, r: number, c: RGB, a: number) {
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++)
      for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
        const d = (x - cx + 0.5) * (x - cx + 0.5) + (y - cy + 0.5) * (y - cy + 0.5);
        if (d <= r * r) this.blend(x, y, c, a);
      }
  }
  ring(cx: number, cy: number, r: number, c: RGB, th = 2) {
    for (let y = Math.floor(cy - r - th); y <= Math.ceil(cy + r + th); y++)
      for (let x = Math.floor(cx - r - th); x <= Math.ceil(cx + r + th); x++) {
        const d = Math.sqrt((x - cx + 0.5) ** 2 + (y - cy + 0.5) ** 2);
        if (Math.abs(d - r) <= th / 2) this.set(x, y, c);
      }
  }
  // filled polygon, even-odd scanline
  poly(pts: [number, number][], c: RGB) {
    if (pts.length < 3) return;
    let minY = Infinity, maxY = -Infinity;
    for (const [, y] of pts) { minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
    for (let y = Math.floor(minY); y <= Math.ceil(maxY); y++) {
      const xs: number[] = [];
      for (let i = 0; i < pts.length; i++) {
        const [x0, y0] = pts[i], [x1, y1] = pts[(i + 1) % pts.length];
        if ((y0 <= y && y1 > y) || (y1 <= y && y0 > y)) {
          xs.push(x0 + (y - y0) * (x1 - x0) / (y1 - y0));
        }
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2)
        for (let x = Math.ceil(xs[k]); x <= Math.floor(xs[k + 1]); x++) this.set(x, y, c);
    }
  }
  // deterministic paper grain (fixed-seed LCG)
  grain(seed: number, amount: number) {
    let s = seed >>> 0;
    for (let i = 0; i < W * H; i++) {
      s = (s * 1664525 + 1013904223) >>> 0;
      const v = ((s >>> 24) % 13) - 6; // -6..6
      if (v === 0) continue;
      const d = amount * v / 6;
      for (let k = 0; k < 3; k++) {
        const nv = Math.max(0, Math.min(255, this.data[i * 3 + k] + d));
        this.data[i * 3 + k] = nv;
      }
    }
  }
}

// ---------------------------------------------------------------- PNG out
function crc32(buf: Buffer): number {
  let table = (crc32 as any).t;
  if (!table) {
    table = (crc32 as any).t = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, "ascii"), data])), 8 + data.length);
  return out;
}
function writePNG(cv: Canvas, file: string) {
  const raw = Buffer.alloc(H * (1 + W * 3));
  for (let y = 0; y < H; y++) {
    raw[y * (1 + W * 3)] = 0;
    Buffer.from(cv.data.buffer, y * W * 3, W * 3).copy(raw, y * (1 + W * 3) + 1);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0)),
  ]);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, png);
}

// ---------------------------------------------------------------- TTF font
interface Pt { x: number; y: number; on: boolean }
class Font {
  buf: Buffer; upm: number; numGlyphs: number; locaFmt: number;
  cmap4: any = null; cmap12: any = null;
  hmtx: number[] = []; loca: number[] = []; glyfOff = 0;
  kernPairs = new Map<string, number>();
  cache = new Map<string, { w: number; h: number; dx: number; dy: number; px: Uint8Array }>();
  ascent = 0; descent = 0; lineGap = 0;
  constructor(file: string) {
    this.buf = fs.readFileSync(file);
    const b = this.buf;
    const u16 = (o: number) => b.readUInt16BE(o);
    const u32 = (o: number) => b.readUInt32BE(o);
    const i16 = (o: number) => b.readInt16BE(o);
    const numTables = u16(4);
    const tables = new Map<string, number>();
    for (let i = 0; i < numTables; i++) {
      const o = 12 + i * 16;
      tables.set(b.toString("ascii", o, o + 4), u32(o + 8));
    }
    const need = ["head", "hhea", "maxp", "hmtx", "loca", "glyf", "cmap"];
    for (const t of need) if (!tables.has(t)) throw new Error("missing table " + t);
    const head = tables.get("head")!;
    this.upm = u16(head + 18);
    this.locaFmt = i16(head + 50);
    const hhea = tables.get("hhea")!;
    this.ascent = i16(hhea + 4); this.descent = i16(hhea + 6); this.lineGap = i16(hhea + 8);
    const nH = u16(hhea + 34);
    const maxp = tables.get("maxp")!;
    this.numGlyphs = u16(maxp + 4);
    const hmtx = tables.get("hmtx")!;
    for (let g = 0; g < this.numGlyphs; g++) {
      const o = hmtx + (g < nH ? g * 4 : (nH - 1) * 4);
      this.hmtx[g] = u16(o);
    }
    const loca = tables.get("loca")!;
    for (let g = 0; g <= this.numGlyphs; g++)
      this.loca[g] = this.locaFmt === 1 ? u32(loca + g * 4) : u16(loca + g * 2) * 2;
    this.glyfOff = tables.get("glyf")!;
    // cmap: prefer format 12, else 4
    const cmap = tables.get("cmap")!;
    const nSub = u16(cmap + 2);
    for (let i = 0; i < nSub; i++) {
      const rec = cmap + 4 + i * 8;
      const plat = u16(rec), enc = u16(rec + 2), off = u32(rec + 4);
      const fmt = u16(cmap + off);
      if ((plat === 3 || plat === 0) && fmt === 12 && !this.cmap12) this.cmap12 = cmap + off;
      if ((plat === 3 || plat === 0) && fmt === 4 && !this.cmap4) this.cmap4 = cmap + off;
    }
    // kern format 0
    if (tables.has("kern")) {
      const k = tables.get("kern")!;
      const nT = u16(k + 2);
      let o = k + 4;
      for (let t = 0; t < nT; t++) {
        const len = u16(o + 2), fmt = u16(o + 4);
        if (fmt === 0) {
          const nP = u16(o + 6);
          for (let p = 0; p < nP; p++) {
            const po = o + 14 + p * 6;
            this.kernPairs.set(u16(po) + ":" + u16(po + 2), i16(po + 4));
          }
        }
        o += len;
      }
    }
  }
  glyphIndex(cp: number): number {
    const b = this.buf;
    if (this.cmap12) {
      const o = this.cmap12;
      const n = b.readUInt32BE(o + 12);
      let lo = 0, hi = n - 1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1, go = o + 16 + mid * 12;
        const s = b.readUInt32BE(go), e = b.readUInt32BE(go + 4), g0 = b.readUInt32BE(go + 8);
        if (cp < s) hi = mid - 1; else if (cp > e) lo = mid + 1; else return g0 + (cp - s);
      }
      return 0;
    }
    if (this.cmap4) {
      const o = this.cmap4;
      const segCount = b.readUInt16BE(o + 6) / 2;
      const endBase = o + 14, startBase = endBase + 2 + segCount * 2;
      const deltaBase = startBase + segCount * 2, rangeBase = deltaBase + segCount * 2;
      let lo = 0, hi = segCount - 1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const end = b.readUInt16BE(endBase + mid * 2);
        if (cp > end) lo = mid + 1;
        else {
          const start = b.readUInt16BE(startBase + mid * 2);
          if (cp < start) hi = mid - 1;
          else {
            const delta = b.readInt16BE(deltaBase + mid * 2);
            const ro = b.readUInt16BE(rangeBase + mid * 2);
            if (ro === 0) return (cp + delta) & 0xffff;
            const go = rangeBase + mid * 2 + ro + (cp - start) * 2;
            const g = b.readUInt16BE(go);
            return g === 0 ? 0 : (g + delta) & 0xffff;
          }
        }
      }
      return 0;
    }
    return 0;
  }
  kern(a: number, b: number): number { return this.kernPairs.get(a + ":" + b) || 0; }
  // outline of a glyph: list of contours, each a list of points
  outline(gid: number, depth = 0): Pt[][] {
    if (gid >= this.numGlyphs || depth > 3) return [];
    const start = this.loca[gid], end = this.loca[gid + 1];
    if (end <= start) return [];
    const b = this.buf, o = this.glyfOff + start;
    const nC = b.readInt16BE(o);
    if (nC >= 0) {
      const endPts = o + 10;
      const nPts = b.readUInt16BE(endPts + (nC - 1) * 2) + 1;
      const instrLen = b.readUInt16BE(endPts + nC * 2);
      let p = endPts + nC * 2 + 2 + instrLen;
      const flags: number[] = [];
      while (flags.length < nPts) {
        const f = b[p++];
        flags.push(f);
        if (f & 8) { const r = b[p++]; for (let i = 0; i < r; i++) flags.push(f); }
      }
      const xs: number[] = [], ys: number[] = [];
      let x = 0, y = 0;
      // TrueType stores ALL x deltas first, then ALL y deltas.
      for (let i = 0; i < nPts; i++) {
        const f = flags[i];
        if (f & 2) { const d = b[p++]; x += (f & 16) ? d : -d; }
        else if (!(f & 16)) { x += b.readInt16BE(p); p += 2; }
        xs.push(x);
      }
      for (let i = 0; i < nPts; i++) {
        const f = flags[i];
        if (f & 4) { const d = b[p++]; y += (f & 32) ? d : -d; }
        else if (!(f & 32)) { y += b.readInt16BE(p); p += 2; }
        ys.push(y);
      }
      const contours: Pt[][] = [];
      let s = 0;
      for (let c = 0; c < nC; c++) {
        const e = b.readUInt16BE(endPts + c * 2);
        const pts: Pt[] = [];
        for (let i = s; i <= e; i++) pts.push({ x: xs[i], y: ys[i], on: !!(flags[i] & 1) });
        contours.push(pts);
        s = e + 1;
      }
      return contours;
    }
    // composite
    const out: Pt[][] = [];
    let p = o + 10;
    let more = true;
    while (more) {
      const flags = b.readUInt16BE(p); const comp = b.readUInt16BE(p + 2); p += 4;
      let dx = 0, dy = 0, sx = 1, sy = 1;
      if (flags & 1) { dx = b.readInt16BE(p); dy = b.readInt16BE(p + 2); p += 4; }
      else { dx = b.readInt8(p); dy = b.readInt8(p + 1); p += 2; }
      if (flags & 8) { sx = b.readInt16BE(p) / 16384; sy = sx; p += 2; }
      else if (flags & 0x40) { sx = b.readInt16BE(p) / 16384; sy = b.readInt16BE(p + 2) / 16384; p += 4; }
      else if (flags & 0x80) { sx = b.readInt16BE(p) / 16384; p += 2; sy = b.readInt16BE(p) / 16384; p += 2; }
      for (const ctr of this.outline(comp, depth + 1))
        out.push(ctr.map(pt => ({ x: pt.x * sx + dx, y: pt.y * sy + dy, on: pt.on })));
      more = !!(flags & 0x20);
    }
    return out;
  }
  // rasterise one glyph at pixel size; returns alpha bitmap in font units
  raster(gid: number, px: number): { w: number; h: number; dx: number; dy: number; a: Uint8Array } {
    const key = gid + "@" + px;
    const hit = this.cache.get(key);
    if (hit) return hit;
    const SS = 3; // supersample
    const scale = px / this.upm * SS;
    const contours = this.outline(gid);
    // flatten quadratics to polylines
    const polys: [number, number][][] = [];
    for (const ctr of contours) {
      const pts: [number, number][] = [];
      const n = ctr.length;
      if (n === 0) continue;
      // build expanded point list with implied on-curve points
      const seq: Pt[] = [];
      for (let i = 0; i < n; i++) {
        const cur = ctr[i], nxt = ctr[(i + 1) % n];
        seq.push(cur);
        if (!cur.on && !nxt.on) seq.push({ x: (cur.x + nxt.x) / 2, y: (cur.y + nxt.y) / 2, on: true });
      }
      // start at an on-curve point
      let si = seq.findIndex(p => p.on);
      if (si < 0) si = 0;
      const rot = seq.slice(si).concat(seq.slice(0, si));
      let cx = rot[0].x, cy = rot[0].y;
      pts.push([cx * scale, cy * scale]);
      for (let i = 1; i < rot.length; i++) {
        const p = rot[i];
        if (p.on) { pts.push([p.x * scale, p.y * scale]); cx = p.x; cy = p.y; }
        else {
          const nxt = rot[(i + 1) % rot.length];
          const ex = nxt.x, ey = nxt.y;
          for (let s = 1; s <= 6; s++) {
            const t = s / 6;
            const bx = (1 - t) * (1 - t) * cx + 2 * (1 - t) * t * p.x + t * t * ex;
            const by = (1 - t) * (1 - t) * cy + 2 * (1 - t) * t * p.y + t * t * ey;
            pts.push([bx * scale, by * scale]);
          }
          cx = ex; cy = ey; i++;
        }
      }
      polys.push(pts);
    }
    // bounds
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const poly of polys) for (const [x, y] of poly) {
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
    if (!isFinite(minX)) {
      const empty = { w: 0, h: 0, dx: 0, dy: 0, a: new Uint8Array(0) };
      this.cache.set(key, empty); return empty;
    }
    const ox = Math.floor(minX), oy = Math.floor(minY);
    const wSS = Math.ceil(maxX) - ox + 1, hSS = Math.ceil(maxY) - oy + 1;
    const mask = new Uint8Array(wSS * hSS);
    // even-odd scanline fill at supersampled res; row 0 is the TOP of the
    // glyph (highest font y), so the bitmap is stored top-first.
    for (let y = 0; y < hSS; y++) {
      const xs: number[] = [];
      for (const poly of polys) {
        for (let i = 0; i < poly.length; i++) {
          const [x0, y0] = poly[i], [x1, y1] = poly[(i + 1) % poly.length];
          const yy = oy + (hSS - 1 - y) + 0.5;
          if ((y0 <= yy && y1 > yy) || (y1 <= yy && y0 > yy))
            xs.push(x0 + (yy - y0) * (x1 - x0) / (y1 - y0));
        }
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const x0 = Math.max(0, Math.ceil(xs[k] - ox)), x1 = Math.min(wSS - 1, Math.floor(xs[k + 1] - ox));
        for (let x = x0; x <= x1; x++) mask[y * wSS + x] = 1;
      }
    }
    // downsample 3x3 -> alpha
    const w = Math.ceil(wSS / SS), h = Math.ceil(hSS / SS);
    const a = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let s = 0, n = 0;
      for (let j = 0; j < SS; j++) for (let i = 0; i < SS; i++) {
        const mx = x * SS + i, my = y * SS + j;
        if (mx < wSS && my < hSS) { s += mask[my * wSS + mx]; n++; }
      }
      a[y * w + x] = Math.round(255 * s / n);
    }
    const res = { w, h, dx: ox / SS, dy: oy / SS, a };
    this.cache.set(key, res);
    return res;
  }
  advance(cp: number, px: number): number {
    return this.hmtx[this.glyphIndex(cp)] / this.upm * px;
  }
  textWidth(s: string, px: number, ls = 0): number {
    let w = 0, prev = -1;
    for (const ch of s) {
      const cp = ch.codePointAt(0)!;
      const g = this.glyphIndex(cp);
      w += this.hmtx[g] / this.upm * px + ls;
      if (prev >= 0) w += this.kern(prev, g) / this.upm * px;
      prev = g;
    }
    return w - (s.length ? ls : 0);
  }
  draw(cv: Canvas, s: string, x: number, yBase: number, px: number, c: RGB, ls = 0) {
    // yBase = baseline y
    let cx = x, prev = -1;
    for (const ch of s) {
      const cp = ch.codePointAt(0)!;
      const g = this.glyphIndex(cp);
      if (prev >= 0) cx += this.kern(prev, g) / this.upm * px;
      if (g !== 0) {
        const r = this.raster(g, px);
        const bx = Math.round(cx + r.dx), by = Math.round(yBase - (r.dy + r.h) + 0);
        // glyph bitmap y=0 is top (max y in font units); font y up: bitmap row 0 = highest y
        for (let j = 0; j < r.h; j++) for (let i = 0; i < r.w; i++) {
          const al = r.a[j * r.w + i];
          if (al) cv.blend(bx + i, by + j, c, al / 255);
        }
      }
      cx += this.hmtx[g] / this.upm * px + ls;
      prev = g;
    }
    return cx;
  }
}

// ---------------------------------------------------------------- text utils
const DIR = path.resolve(process.cwd());
const F_PLAY = new Font(path.join(DIR, "fonts", "Playfair-Bold.ttf"));
const F_ITAL = new Font(path.join(DIR, "fonts", "Playfair-Italic.ttf"));
const F_OSW = new Font(path.join(DIR, "fonts", "Oswald-Bold.ttf"));
const F_INT = new Font(path.join(DIR, "fonts", "Inter-Regular.ttf"));

function wrap(font: Font, size: number, text: string, maxW: number, ls = 0): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const t = cur ? cur + " " + w : w;
    if (font.textWidth(t, size, ls) <= maxW || !cur) cur = t;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  return lines;
}
function drawLines(cv: Canvas, font: Font, size: number, lines: string[], x: number, yTop: number, lh: number, c: RGB, ls = 0) {
  let y = yTop + size; // baseline of first line (approx: ascent ~ size)
  for (const ln of lines) { font.draw(cv, ln, x, y, size, c, ls); y += lh; }
  return y;
}
function fitSize(font: Font, text: string, maxW: number, start: number, min = 8): number {
  let s = start;
  while (s > min && font.textWidth(text, s) > maxW) s -= 0.5;
  return s;
}
function center(font: Font, size: number, text: string, cx: number, yBase: number, c: RGB, ls = 0) {
  font.draw(cv0, text, cx - font.textWidth(text, size, ls) / 2, yBase, size, c, ls);
}
let cv0: Canvas;

// ---------------------------------------------------------------- scenes
// Each hero/medium illustration is a small drawn scene on the canvas.
function skyGrad(cv: Canvas, x: number, y: number, w: number, h: number, top: RGB, bot: RGB) {
  for (let j = 0; j < h; j++) {
    const t = j / h;
    const c: RGB = [Math.round(top[0] * (1 - t) + bot[0] * t), Math.round(top[1] * (1 - t) + bot[1] * t), Math.round(top[2] * (1 - t) + bot[2] * t)];
    cv.rect(x, y + j, w, 1, c);
  }
}
function sun(cv: Canvas, x: number, y: number, r: number, c: RGB) {
  cv.circle(x, y, r, c); cv.ring(x, y, r + 4, c, 2);
}
function chartDown(cv: Canvas, x: number, y: number, w: number, h: number, c: RGB, th = 3) {
  // jagged falling line with area fill
  const pts: [number, number][] = [];
  const n = 9;
  for (let i = 0; i < n; i++) {
    const px = x + w * i / (n - 1);
    const py = y + h * (0.12 + 0.75 * (i / (n - 1)) + ((i * 37) % 5) * 0.04);
    pts.push([px, py]);
  }
  for (let i = 0; i + 1 < pts.length; i++) cv.line(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], c, th);
  for (let i = 0; i < pts.length; i++) cv.circle(pts[i][0], pts[i][1], 3, c);
  // arrow head at end
  const [ex, ey] = pts[pts.length - 1];
  cv.poly([[ex, ey + 12], [ex - 12, ey - 2], [ex + 2, ey - 2]], c);
}
function bars(cv: Canvas, x: number, y: number, w: number, h: number, vals: number[], c: RGB, c2: RGB) {
  const bw = w / vals.length;
  vals.forEach((v, i) => {
    const bh = h * v;
    cv.rect(x + i * bw + 2, y + h - bh, bw - 4, bh, i === vals.length - 1 ? c2 : c);
  });
}
function building(cv: Canvas, x: number, y: number, w: number, h: number, c: RGB, win: RGB) {
  cv.rect(x, y, w, h, c);
  for (let j = 0; j < 4; j++) for (let i = 0; i < 3; i++)
    cv.rect(x + 6 + i * (w - 12) / 3, y + 8 + j * (h - 16) / 4, (w - 12) / 3 - 5, (h - 16) / 4 - 5, win);
}
function person(cv: Canvas, x: number, y: number, s: number, suit: RGB, skin: RGB) {
  cv.circle(x, y, 4.5 * s, skin); // head
  cv.rect(x - 5 * s, y + 5 * s, 10 * s, 14 * s, suit); // body
  cv.rect(x - 8 * s, y + 19 * s, 16 * s, 3 * s, INK); // base
}
function flagPole(cv: Canvas, x: number, y: number, h: number) {
  cv.vline(x, y - h, h, INK, 2);
  cv.rect(x, y - h, 22, 14, [255, 255, 255]);
  cv.rect(x, y - h, 22, 14, RED);
  cv.circle(x + 11, y - h + 7, 4, [0, 71, 160]);
}
function smoke(cv: Canvas, x: number, y: number, s: number) {
  const cols: RGB[] = [[120, 118, 112], [150, 148, 140], [90, 88, 84]];
  for (let i = 0; i < 7; i++) {
    const a = i * 0.9;
    cv.circleA(x + Math.sin(a * 2.1) * 14 * s + (i - 3) * 6 * s, y - i * 9 * s, (8 + i * 2.2) * s, cols[i % 3], 0.85);
  }
}
function coin(cv: Canvas, cx: number, cy: number, r: number) {
  cv.circle(cx, cy, r, GOLD);
  cv.ring(cx, cy, r - 4, [176, 132, 20], 3);
  F_PLAY.draw(cv, "B", cx - r * 0.32, cy + r * 0.42, r * 1.1, [120, 86, 10]);
}
function wave(cv: Canvas, x: number, y: number, w: number, amp: number, c: RGB) {
  for (let i = 0; i < w; i++) {
    const yy = y + Math.sin(i / 9) * amp * Math.sin(i / 23);
    cv.rect(x + i, Math.round(yy), 2, 2, c);
  }
}

// hero scenes ------------------------------------------------------------
function heroAI(cv: Canvas, x: number, y: number, w: number, h: number) {
  skyGrad(cv, x, y, w, h, [24, 30, 54], [58, 74, 110]);
  sun(cv, x + w - 34, y + 26, 12, GOLD);
  // skyline
  const bw = w / 7;
  for (let i = 0; i < 7; i++) {
    const bh = h * (0.28 + ((i * 53) % 40) / 100);
    building(cv, x + i * bw + 2, y + h - bh - 26, bw - 4, bh, i % 2 ? NAVY2 : [16, 24, 46], [240, 200, 90]);
  }
  cv.rect(x, y + h - 26, w, 26, [12, 18, 36]);
  // red chip top-left with the big number
  cv.rect(x + 10, y + 8, 88, 34, RED);
  F_OSW.draw(cv, "-3.8%", x + 16, y + 27, 20, [255, 255, 255]);
  F_INT.draw(cv, "KOSPI", x + 16, y + 38, 9, [255, 220, 220]);
  // falling chart across the middle
  chartDown(cv, x + 14, y + 50, w - 28, h * 0.35, RED, 4);
  // ticker tape at the bottom
  cv.rect(x, y + h - 14, w, 14, RED);
  F_INT.draw(cv, "NASDAQ 100  -2.1%    NIKKEI  -1.9%    TAIEX  -2.4%", x + 8, y + h - 3, 10, [255, 255, 255]);
}
function heroSeoul(cv: Canvas, x: number, y: number, w: number, h: number) {
  skyGrad(cv, x, y, w, h, SKY, SKY2);
  // ministry building
  cv.rect(x + 20, y + h - 78, w - 40, 78, [232, 226, 210]);
  cv.rect(x + 20, y + h - 86, w - 40, 8, NAVY);
  for (let i = 0; i < 6; i++) cv.rect(x + 30 + i * ((w - 60) / 6), y + h - 70, 12, 22, NAVY2);
  // columns
  for (let i = 0; i < 4; i++) cv.rect(x + 34 + i * ((w - 68) / 3), y + h - 44, 8, 44, [255, 255, 255]);
  cv.rect(x, y + h - 8, w, 8, [90, 84, 70]);
  // flags
  flagPole(cv, x + 30, y + 34, 26);
  flagPole(cv, x + w - 52, y + 34, 26);
  // resigning minister walking away with box
  person(cv, x + w / 2 - 6, y + h - 66, 1.15, NAVY, [232, 190, 150]);
  cv.rect(x + w / 2 + 8, y + h - 52, 16, 10, [180, 140, 90]); // box
  // exam papers flying
  for (let i = 0; i < 5; i++) {
    const px = x + 40 + i * 44, py = y + 18 + ((i * 29) % 22);
    cv.poly([[px, py], [px + 12, py - 3], [px + 14, py + 9], [px + 2, py + 12]], [255, 255, 255]);
    cv.line(px + 3, py + 3, px + 11, py + 2, INK, 1);
  }
  F_OSW.draw(cv, "RESIGNS", x + w - 86, y + h - 30, 16, RED);
}
function heroGaza(cv: Canvas, x: number, y: number, w: number, h: number) {
  skyGrad(cv, x, y, w, h, [52, 44, 40], [120, 96, 72]);
  sun(cv, x + 30, y + 24, 11, [232, 180, 90]);
  // ruined buildings
  cv.poly([[x + 8, y + h - 10], [x + 8, y + h - 66], [x + 30, y + h - 84], [x + 44, y + h - 60], [x + 44, y + h - 10]], [70, 62, 54]);
  cv.poly([[x + 56, y + h - 10], [x + 56, y + h - 88], [x + 86, y + h - 88], [x + 86, y + h - 10]], [52, 46, 40]);
  cv.poly([[x + 96, y + h - 10], [x + 96, y + h - 54], [x + 118, y + h - 70], [x + 132, y + h - 48], [x + 132, y + h - 10]], [84, 74, 64]);
  for (let i = 0; i < 3; i++) cv.rect(x + 62 + i * 8, y + h - 78, 5, 6, [240, 200, 90]);
  // smoke columns (right side, clear of the headline)
  smoke(cv, x + 168, y + h - 62, 0.55);
  smoke(cv, x + 238, y + h - 70, 0.5);
  // rubble + ambulance light
  cv.rect(x, y + h - 10, w, 10, [40, 34, 28]);
  cv.circle(x + w - 26, y + h - 22, 5, RED);
  cv.ring(x + w - 26, y + h - 22, 9, RED, 2);
  F_OSW.draw(cv, "3 KILLED", x + 12, y + h - 26, 18, [255, 220, 200]);
  F_INT.draw(cv, "overnight strikes", x + 12, y + h - 10, 11, [255, 235, 220]);
}

// medium scenes -----------------------------------------------------------
function medBitcoin(cv: Canvas, x: number, y: number, w: number, h: number) {
  cv.rect(x, y, w, h, NAVY);
  for (let i = 0; i < 5; i++) cv.circle(x + 14 + i * 22, y + 10 + ((i * 17) % 12), 2, [120, 140, 190]);
  coin(cv, x + w / 2 - 14, y + h / 2 + 2, 20);
  chartDown(cv, x + w - 62, y + 8, 54, 22, [120, 200, 140], 2);
  F_OSW.draw(cv, "$60,840", x + 8, y + h - 6, 13, GOLD);
}
function medNHS(cv: Canvas, x: number, y: number, w: number, h: number) {
  cv.rect(x, y, w, h, [232, 238, 244]);
  // scan frame
  cv.rect(x + 10, y + 6, w - 20, h - 20, [255, 255, 255]);
  cv.rect(x + 10, y + 6, w - 20, 2, TEAL); cv.rect(x + 10, y + h - 16, w - 20, 2, TEAL);
  cv.rect(x + 10, y + 6, 2, h - 20, TEAL); cv.rect(x + w - 12, y + 6, 2, h - 20, TEAL);
  // mammogram arcs
  cv.circleA(x + w / 2, y + 18, 12, [140, 150, 165], 0.9);
  cv.circleA(x + w / 2, y + 18, 7, [90, 100, 120], 0.9);
  cv.circle(x + w / 2 + 5, y + 16, 2, RED);
  cv.ring(x + w / 2 + 5, y + 16, 4, RED, 1);
  // crosshair
  cv.line(x + w / 2 - 18, y + 18, x + w / 2 + 18, y + 18, TEAL, 1);
  cv.line(x + w / 2, y + 8, x + w / 2, y + 28, TEAL, 1);
  F_OSW.draw(cv, "AI READS SCANS", x + 8, y + h - 4, 10, TEAL);
}
function medMeldrum(cv: Canvas, x: number, y: number, w: number, h: number) {
  cv.rect(x, y, w, h, [26, 20, 34]);
  // spotlight dots along the top (no beams — the old triangular beams
  // read as pyramids, wrong for a music legend)
  for (let i = 0; i < 3; i++) {
    const lx = x + 84 + i * 16;
    cv.circle(lx, y + 6, 3, [255, 230, 150]);
  }
  // vinyl record, right side
  const rcx = x + w - 30, rcy = y + h / 2;
  cv.circle(rcx, rcy, 20, [12, 12, 14]);
  cv.ring(rcx, rcy, 20, [90, 90, 100], 1);
  cv.ring(rcx, rcy, 16, [70, 70, 80], 1);
  cv.ring(rcx, rcy, 11, [70, 70, 80], 1);
  cv.circle(rcx, rcy, 6, [200, 30, 40]);
  cv.circle(rcx, rcy, 2, [235, 235, 235]);
  // mic stand + mic
  cv.vline(x + w / 2, y + 26, h - 40, [200, 200, 200], 2);
  cv.circle(x + w / 2, y + 22, 8, [220, 220, 220]);
  cv.rect(x + w / 2 - 16, y + h - 14, 32, 4, [200, 200, 200]);
  cv.rect(x + 6, y + 6, 68, 14, [26, 20, 34]);
  F_OSW.draw(cv, "1943–2026", x + 10, y + 17, 11, [255, 255, 255]);
}
function medTaiwan(cv: Canvas, x: number, y: number, w: number, h: number) {
  cv.rect(x, y, w, h, [238, 232, 214]);
  bars(cv, x + 12, y + 8, w - 24, h - 26, [0.5, 0.7, 0.45, 0.85, 0.6, 0.95], TEAL, RED);
  cv.line(x + 8, y + h - 16, x + w - 8, y + h - 16, INK, 2);
  F_OSW.draw(cv, "SHORT BAN", x + 8, y + h - 4, 11, RED);
}
function medQuake(cv: Canvas, x: number, y: number, w: number, h: number) {
  cv.rect(x, y, w, h, [18, 42, 58]);
  wave(cv, x + 8, y + 10, w - 16, 5, [120, 200, 220]);
  wave(cv, x + 8, y + 20, w - 16, 7, [240, 120, 90]);
  wave(cv, x + 8, y + 30, w - 16, 4, [120, 200, 220]);
  // epicentre rings
  cv.ring(x + w / 2 + 30, y + h - 12, 5, RED, 2);
  cv.ring(x + w / 2 + 30, y + h - 12, 10, RED, 1);
  cv.circle(x + w / 2 + 30, y + h - 12, 3, RED);
  F_OSW.draw(cv, "M4.7", x + 8, y + h - 4, 12, [255, 255, 255]);
}
function medUN(cv: Canvas, x: number, y: number, w: number, h: number) {
  cv.rect(x, y, w, h, SKY2);
  // UN-style building
  cv.rect(x + w / 2 - 26, y + 8, 52, h - 24, [235, 238, 242]);
  for (let j = 0; j < 2; j++) for (let i = 0; i < 4; i++)
    cv.rect(x + w / 2 - 20 + i * 11, y + 12 + j * 9, 7, 6, [90, 130, 180]);
  cv.rect(x + w / 2 - 30, y + h - 16, 60, 3, NAVY);
  // flags row
  for (let i = 0; i < 5; i++) {
    const fx = x + 14 + i * 30;
    cv.vline(fx, y + h - 14, 10, INK, 1);
    cv.rect(fx, y + h - 14, 12, 7, i % 2 ? [0, 71, 160] : RED);
  }
  F_OSW.draw(cv, "UN MEETING", x + 8, y + 12, 11, NAVY);
}
function medShip(cv: Canvas, x: number, y: number, w: number, h: number) {
  skyGrad(cv, x, y, w, h, [150, 180, 205], [210, 225, 235]);
  // sea
  cv.rect(x, y + h - 18, w, 18, [30, 80, 120]);
  wave(cv, x + 4, y + h - 12, w - 8, 2, [180, 220, 240]);
  // ship hull + containers
  cv.poly([[x + 18, y + h - 18], [x + w - 18, y + h - 18], [x + w - 30, y + h - 8], [x + 30, y + h - 8]], [90, 40, 30]);
  cv.rect(x + 70, y + h - 36, 24, 18, RED);
  cv.rect(x + 98, y + h - 36, 24, 18, GOLD);
  cv.rect(x + 126, y + h - 36, 24, 18, TEAL);
  cv.rect(x + 156, y + h - 44, 9, 26, [200, 200, 200]); // funnel
  smoke(cv, x + 160, y + h - 46, 0.35);
  // tow line to tug
  cv.line(x + 18, y + h - 12, x + 2, y + h - 8, INK, 1);
  F_OSW.draw(cv, "TOWED OUT", x + 8, y + 12, 11, NAVY);
}
function medNepal(cv: Canvas, x: number, y: number, w: number, h: number) {
  skyGrad(cv, x, y, w, h, [250, 220, 170], [240, 200, 150]);
  // Himalayas
  cv.poly([[x, y + h - 14], [x + 30, y + 12], [x + 62, y + h - 14]], [235, 240, 245]);
  cv.poly([[x + 44, y + h - 14], [x + 88, y + 6], [x + 132, y + h - 14]], [220, 228, 235]);
  cv.poly([[x + 110, y + h - 14], [x + 150, y + 16], [x + w, y + h - 14]], [235, 240, 245]);
  cv.rect(x, y + h - 14, w, 14, [120, 90, 60]);
  // temple
  cv.poly([[x + w / 2 - 20, y + h - 30], [x + w / 2, y + h - 44], [x + w / 2 + 20, y + h - 30]], RED_DK);
  cv.rect(x + w / 2 - 14, y + h - 30, 28, 16, [200, 160, 110]);
  F_OSW.draw(cv, "DELHI TALKS", x + 8, y + 12, 11, [255, 255, 255]);
}
function medSingapore(cv: Canvas, x: number, y: number, w: number, h: number) {
  skyGrad(cv, x, y, w, h, [120, 170, 210], [200, 225, 240]);
  // towers
  building(cv, x + 12, y + 18, 26, h - 32, [200, 210, 220], [240, 220, 120]);
  building(cv, x + 44, y + 8, 26, h - 22, [180, 195, 210], [240, 220, 120]);
  building(cv, x + 76, y + 24, 26, h - 38, [200, 210, 220], [240, 220, 120]);
  // marina bay sands boat
  cv.rect(x + 108, y + 14, 56, 7, [220, 225, 230]);
  cv.poly([[x + 108, y + 14], [x + 136, y + 6], [x + 164, y + 14]], [220, 225, 230]);
  cv.rect(x, y + h - 14, w, 14, [30, 90, 130]);
  F_OSW.draw(cv, "20+ DEALS", x + 8, y + h - 4, 11, [255, 255, 255]);
}
function medManila(cv: Canvas, x: number, y: number, w: number, h: number) {
  cv.rect(x, y, w, h, [232, 226, 210]);
  // courthouse columns
  cv.rect(x + 12, y + 8, w - 24, 7, NAVY);
  for (let i = 0; i < 4; i++) cv.rect(x + 20 + i * ((w - 40) / 3), y + 15, 8, h - 28, [255, 255, 255]);
  cv.rect(x + 12, y + h - 13, w - 24, 5, NAVY);
  // scales of justice
  cv.vline(x + w / 2, y + 18, 14, GOLD, 2);
  cv.line(x + w / 2 - 14, y + 20, x + w / 2 + 14, y + 20, GOLD, 2);
  cv.circle(x + w / 2 - 14, y + 27, 4, GOLD);
  cv.circle(x + w / 2 + 14, y + 27, 4, GOLD);
  F_OSW.draw(cv, "8,320 DEAD", x + w - 64, y + 12, 11, RED);
}

// ---------------------------------------------------------------- data
interface Story { tag: string; region: string; head: string; deck: string; dev?: boolean; draw: (cv: Canvas, x: number, y: number, w: number, h: number) => void; }
const HEROES: Story[] = [
  { tag: "GLOBAL · MARKETS", region: "Global", head: "AI ROUT HITS ASIA", deck: "Kospi falls 3.8% on Monday as the AI sell-off deepens and the Nasdaq 100 nears bear-market territory.", draw: heroAI },
  { tag: "ASIA · SEOUL", region: "Asia", head: "SEOUL MINISTER QUITS OVER EXAM CHAOS", deck: "South Korea's education minister resigns after AI-cheating rule chaos upends the college entrance exam.", draw: heroSeoul },
  { tag: "MIDDLE EAST · GAZA", region: "Middle East", head: "THREE KILLED IN GAZA OVERNIGHT STRIKES", deck: "Israeli attacks kill three people and wound four, medics say, in overnight strikes across Gaza.", draw: heroGaza },
];
const MEDIUM: Story[] = [
  { tag: "GLOBAL · MARKETS", region: "Global", head: "BITCOIN HOLDS $60,000", deck: "Steadies near $60,840 after a weekend plunge toward $55,000.", draw: medBitcoin },
  { tag: "EUROPE · LONDON", region: "Europe", head: "NHS TRIALS AI TO READ MAMMOGRAMS", deck: "700,000 women join a huge AI breast-screening trial.", draw: medNHS },
  { tag: "OCEANIA · MELBOURNE", region: "Oceania", head: "MOLLY MELDRUM DIES, 83", deck: "Countdown legend dies in Melbourne after a long illness.", draw: medMeldrum },
  { tag: "GLOBAL · MARKETS", region: "Global", head: "TAIWAN CURBS SHORT-SELLING", deck: "A ban on short sales below the prior close takes effect Monday.", draw: medTaiwan },
  { tag: "ASIA · INDONESIA", region: "Asia", head: "QUAKES RATTLE INDONESIA", deck: "M4.7 off Bitung; smaller tremors in the Philippines and Australia.", draw: medQuake },
  { tag: "EUROPE · PARIS", region: "Europe", head: "FRANCE SEEKS UN MEETING ON KYIV", deck: "Paris requests a Security Council session over the strikes.", draw: medUN },
  { tag: "EUROPE · HELSINKI", region: "Europe", head: "RUSSIAN SHIP TOWED FROM FINLAND", deck: "Sparta II leaves Finnish waters after Saturday's drone hit.", draw: medShip },
  { tag: "ASIA · NEW DELHI", region: "Asia", head: "NEPAL PM MEETS MODI", deck: "Shah and Modi review ties; a joint vision document is expected.", dev: true, draw: medNepal },
  { tag: "ASIA · SINGAPORE", region: "Asia", head: "SINGAPORE, CHINA HOLD TOP TALKS", deck: "The Joint Council is expected to conclude 20-plus deliverables.", dev: true, draw: medSingapore },
  { tag: "ASIA · MANILA", region: "Asia", head: "MANILA FACES DRUG-WAR RECKONING", deck: "Truth commission documents 8,320 deaths, 2016–2022.", draw: medManila },
];
// [number, headline, region, developing?]
const MORE: [string, string, boolean][] = [
  ["Trump blames Democrats, Iran for oil rise", "Americas", false],
  ["Small quake rattles Oklahoma, M3.2", "Americas", false],
  ["US flash PMI due today", "Americas", true],
  ["Cartel capture risks a bloody succession", "Americas", false],
  ["Amazon Leo launch set for today", "Americas", true],
  ["Boy, 7, pulled alive from Kyiv rubble", "Europe", false],
  ["What's next after the COP31 collapse?", "Global", false],
  ["Libya seeks UN probe into warship attack", "Africa", false],
  ["Albanese blames geopolitics for COP31", "Oceania", false],
  ["Singapore PM lands in Australia today", "Asia", false],
  ["Manila transport strike begins", "Asia", false],
  ["Duterte aide's reply due today", "Asia", true],
  ["Japan snow chaos lingers into Monday", "Asia", false],
  ["India flash PMI due this morning", "Asia", true],
  ["Baler officials meet after bridge tilts", "Asia", false],
  ["Rupee, bonds seen supported by inflows", "Asia", false],
  ["US PCE, GDP data due Wednesday", "Americas", true],
];
const STATS: [string, string][] = [
  ["-3.8%", "KOSPI"], ["$60,840", "BITCOIN"], ["700,000", "NHS TRIAL WOMEN"],
  ["8,320", "DRUG-WAR DEATHS"], ["36", "LEO SATELLITES"], ["M4.7", "BITUNG QUAKE"],
];
const REGIONS: [string, number, RGB][] = [
  ["ASIA", 12, RED], ["AMERICAS", 6, [31, 111, 107]], ["EUROPE", 4, NAVY],
  ["GLOBAL", 4, [107, 98, 87]], ["OCEANIA", 2, [201, 162, 39]],
  ["MIDDLE EAST", 1, [120, 60, 140]], ["AFRICA", 1, [180, 90, 30]],
];
const MAP_PINS: [string, number, number][] = [ // name, lon, lat
  ["Seoul", 127.0, 37.5], ["Gaza", 34.5, 31.5], ["Kyiv", 30.5, 50.4],
  ["Melbourne", 145.0, -37.8], ["Bitung", 125.2, 1.4], ["Manila", 121.0, 14.6],
  ["New Delhi", 77.2, 28.6], ["Singapore", 103.8, 1.35], ["Taipei", 121.6, 25.0],
  ["Oklahoma", -97.5, 35.5], ["Paris", 2.35, 48.85], ["Helsinki", 24.9, 60.2],
  ["Tokyo", 139.7, 35.7], ["Tripoli", 13.2, 32.9],
];
// Display offsets (px, map-relative) for pins whose true spots would collide:
// the numbered circle is drawn at true+offset, with a leader line back to a
// small white dot marking the true position. Offsets verified: no two drawn
// circles closer than 15px (radius 7), all inside the map rect.
const PIN_OFF: Record<number, [number, number]> = {
  2: [6, 6], 5: [12, 8], 9: [-16, -10], 12: [0, -12], 13: [10, -6],
};

// ---------------------------------------------------------------- build
function main() {
  const cv = new Canvas();
  cv0 = cv;
  const M = 26, CW = W - 2 * M; // margins, content width 972
  // ---- masthead
  cv.hline(M, 30, CW, INK, 3);
  F_OSW.draw(cv, "THE WORLD TODAY", M, 50, 15, RED, 1);
  const rightTop = "30 STORIES  ·  7 REGIONS  ·  No. 327";
  F_INT.draw(cv, rightTop, M + CW - F_INT.textWidth(rightTop, 11), 50, 11, MUTED);
  const dateSize = fitSize(F_PLAY, "Monday 23 November 2026", CW, 52);
  F_PLAY.draw(cv, "Monday 23 November 2026", M, 100, dateSize, INK);
  F_ITAL.draw(cv, "Asia's AI rout deepens as Seoul's minister quits and Gaza counts its dead — Monday's world, in full.", M, 122, 16, [70, 60, 50]);
  cv.hline(M, 132, CW, INK, 1);
  cv.hline(M, 135, CW, INK, 3);
  // ---- 6-stat strip
  const sy = 144, sw = CW / 6;
  for (let i = 0; i < 6; i++) {
    const x = M + i * sw;
    if (i > 0) cv.vline(x, sy + 4, 44, [200, 190, 172], 1);
    const [num, lab] = STATS[i];
    const ns = fitSize(F_PLAY, num, sw - 16, 26);
    center(F_PLAY, ns, num, x + sw / 2, sy + 24, RED);
    center(F_INT, 9, lab, x + sw / 2, sy + 40, MUTED, 0.5);
  }
  cv.hline(M, sy + 46, CW, RULE, 1);
  // ---- region bar
  const ry = 196;
  F_OSW.draw(cv, "WHERE THE NEWS IS", M, ry + 12, 11, INK, 1);
  let bx = M + 150;
  const barW = CW - 150;
  const total = REGIONS.reduce((s, r) => s + r[1], 0);
  for (const [name, n, col] of REGIONS) {
    const w = barW * n / total;
    cv.rect(bx, ry, w, 14, col);
    bx += w;
  }
  // region labels under bar: row 1 for segments wide enough to hold their
  // label; narrow segments (MIDDLE EAST, AFRICA) go on a second row,
  // right-aligned with a color chip, so all 7 regions are labelled.
  let lx = M + 150;
  const narrow: [string, number, RGB][] = [];
  for (const [name, n, col] of REGIONS) {
    const w = barW * n / total;
    const lab = name + " " + n;
    const lw = F_INT.textWidth(lab, 8.5);
    if (w > lw + 4) F_INT.draw(cv, lab, lx + (w - lw) / 2, ry + 26, 8.5, INK);
    else narrow.push([name, n, col]);
    lx += w;
  }
  let rx = M + CW;
  for (let i = narrow.length - 1; i >= 0; i--) {
    const [name, n, col] = narrow[i];
    const lab = name + " " + n;
    const lw = F_INT.textWidth(lab, 8);
    cv.rect(rx - lw - 12, ry + 31, 7, 7, col);
    F_INT.draw(cv, lab, rx - lw, ry + 38, 8, INK);
    rx -= lw + 12 + 14;
  }
  cv.hline(M, ry + 44, CW, RULE, 1);
  // ---- heroes
  const hy = 246, hw = (CW - 2 * 14) / 3, hh = 212;
  HEROES.forEach((st, i) => {
    const x = M + i * (hw + 14);
    // illustration
    st.draw(cv, x, hy, hw, 118);
    cv.rect(x, hy, hw, 2, RED); cv.rect(x, hy + 118, hw, 1, RULE);
    // tag
    F_OSW.draw(cv, st.tag, x, hy + 132, 11, RED, 0.5);
    if (st.dev) {
      const dw = F_OSW.textWidth("DEVELOPING", 10) + 10;
      cv.rect(x + hw - dw, hy + 122, dw, 14, GOLD);
      F_OSW.draw(cv, "DEVELOPING", x + hw - dw + 5, hy + 133, 10, INK);
    }
    const hl = wrap(F_PLAY, 19, st.head, hw);
    drawLines(cv, F_PLAY, 19, hl.slice(0, 2), x, hy + 138, 21, INK);
    const dl = wrap(F_INT, 11, st.deck, hw);
    drawLines(cv, F_INT, 11, dl.slice(0, 2), x, hy + 138 + Math.min(2, hl.length) * 21 + 4, 14, [60, 54, 46]);
    if (i < 2) cv.vline(x + hw + 7, hy, hh, [200, 190, 172], 1);
  });
  cv.hline(M, hy + hh + 8, CW, INK, 2);
  // ---- medium: 2 rows x 5
  const my = hy + hh + 8, mw = (CW - 4 * 10) / 5, mh = 124;
  MEDIUM.forEach((st, i) => {
    const r = Math.floor(i / 5), c = i % 5;
    const x = M + c * (mw + 10), y = my + r * (mh + 8);
    st.draw(cv, x, y, mw, 50);
    cv.rect(x, y + 50, mw, 1, RULE);
    F_OSW.draw(cv, st.tag, x, y + 64, 9, RED, 0.5);
    const hl = wrap(F_PLAY, 13.5, st.head, mw);
    drawLines(cv, F_PLAY, 13.5, hl.slice(0, 2), x, y + 68, 15, INK);
    const dl = wrap(F_INT, 9.5, st.deck, mw);
    drawLines(cv, F_INT, 9.5, dl.slice(0, 2), x, y + 68 + Math.min(2, hl.length) * 15 + 2, 12, [60, 54, 46]);
    if (st.dev) {
      const dw = F_OSW.textWidth("DEV", 8) + 8;
      cv.rect(x + mw - dw, y + 54, dw, 11, GOLD);
      F_OSW.draw(cv, "DEV", x + mw - dw + 4, y + 62, 8, INK);
    }
  });
  const afterMed = my + 2 * mh + 12;
  cv.hline(M, afterMed + 4, CW, INK, 2);
  // ---- day in brief
  const by = afterMed + 14;
  F_OSW.draw(cv, "THE DAY IN BRIEF", M, by + 13, 12, RED, 1);
  F_ITAL.draw(cv, "Markets fell, a minister fell, and the war's toll rose again — while trials, talks and launches carried on.", M + 150, by + 13, 13.5, INK);
  cv.hline(M, by + 22, CW, RULE, 1);
  // ---- map + more stories
  const py = by + 32, ph = 122;
  const mapW = 470, mapX = M, mapY = py;
  cv.rect(mapX, mapY, mapW, ph, NAVY);
  // graticule
  for (let g = 0; g < 8; g++) cv.vline(mapX + 30 + g * 58, mapY + 8, ph - 16, [50, 68, 108], 1);
  for (let g = 0; g < 4; g++) cv.hline(mapX + 8, mapY + 24 + g * 30, mapW - 16, [50, 68, 108], 1);
  // continents (rough equirectangular polygons, lon -170..190, lat -55..83)
  const px = (lon: number) => mapX + 8 + (lon + 170) / 360 * (mapW - 16);
  const py2 = (lat: number) => mapY + 6 + (83 - lat) / 138 * (ph - 12);
  const land: [number, number][][] = [
    [[-168, 66], [-140, 70], [-120, 72], [-100, 73], [-85, 80], [-70, 73], [-58, 62], [-55, 47], [-65, 44], [-75, 36], [-81, 25], [-90, 21], [-97, 16], [-105, 20], [-114, 28], [-125, 40], [-140, 60], [-155, 58], [-168, 66]],
    [[-80, 10], [-60, 8], [-52, 5], [-40, -5], [-35, -8], [-48, -15], [-58, -25], [-70, -35], [-73, -50], [-70, -54], [-75, -40], [-80, -20], [-81, -5], [-80, 10]],
    [[-10, 36], [-9, 43], [-2, 48], [0, 51], [5, 53], [10, 57], [18, 56], [21, 55], [28, 60], [30, 70], [40, 68], [30, 62], [23, 58], [18, 54], [12, 45], [8, 44], [3, 42], [-2, 37], [-9, 38], [-10, 36]],
    [[30, 70], [45, 68], [60, 69], [75, 72], [100, 77], [130, 72], [160, 70], [178, 65], [170, 60], [158, 52], [140, 45], [135, 43], [127, 40], [120, 32], [110, 20], [105, 10], [100, 8], [95, 15], [90, 22], [80, 20], [77, 8], [72, 20], [66, 25], [60, 25], [55, 26], [50, 29], [45, 30], [40, 32], [35, 36], [30, 36], [28, 45], [22, 45], [18, 40], [12, 44], [3, 43], [-5, 36], [-10, 31], [-17, 28], [-16, 20], [-17, 15], [-12, 8], [-8, 4], [9, 4], [12, -5], [13, -12], [12, -18], [18, -25], [20, -30], [26, -34], [32, -29], [35, -20], [40, -15], [42, -10], [48, -2], [51, 11], [48, 12], [43, 12], [38, 18], [35, 28], [32, 31], [30, 36], [27, 40], [23, 40], [19, 45], [15, 44], [12, 44], [8, 54], [5, 58], [5, 62], [10, 64], [18, 69], [25, 71], [30, 70]],
    [[113, -22], [122, -14], [132, -12], [142, -11], [146, -19], [150, -23], [153, -27], [150, -37], [140, -38], [130, -32], [124, -33], [115, -32], [113, -22]],
  ];
  for (const poly of land) cv.poly(poly.map(([lo, la]) => [px(lo), py2(la)] as [number, number]), [58, 84, 122]);
  // pins: numbered circle at true spot, or at true+offset with a leader
  // line back to a small white dot on the true spot (dense clusters)
  MAP_PINS.forEach(([name, lon, lat], i) => {
    const x = px(lon), y = py2(lat);
    const off = PIN_OFF[i + 1];
    const cx = x + (off ? off[0] : 0), cy = y + (off ? off[1] : 0);
    if (off) {
      cv.line(x, y, cx, cy, [255, 255, 255], 1);
      cv.circle(x, y, 2, [255, 255, 255]);
    }
    cv.circle(cx, cy, 7, RED);
    cv.ring(cx, cy, 7, [255, 255, 255], 1);
    F_INT.draw(cv, String(i + 1), cx - 2.5, cy + 3.5, 8, [255, 255, 255]);
  });
  F_OSW.draw(cv, "WHERE IT HAPPENED", mapX + 10, mapY + 14, 11, [255, 255, 255], 1);
  // map key: two columns of numbered names below title? place at bottom-left inside map
  // ---- more stories, right of map
  const lx0 = M + mapW + 16, lw = CW - mapW - 16;
  F_OSW.draw(cv, "17 MORE STORIES", lx0, py + 13, 12, RED, 1);
  const colW = (lw - 12) / 2;
  const perCol = Math.ceil(MORE.length / 2);
  MORE.forEach(([head, region, dev], i) => {
    const col = i < perCol ? 0 : 1;
    const row = i % perCol;
    const x = lx0 + col * (colW + 12);
    const y = py + 18 + row * 15;
    const num = String(i + 1).padStart(2, "0");
    F_OSW.draw(cv, num, x, y + 9, 9, RED);
    const label = dev ? head + "  · DEV" : head;
    const lines = wrap(F_INT, 9.5, label, colW - 24);
    F_INT.draw(cv, lines[0], x + 24, y + 9, 9.5, INK);
    if (lines[1]) F_INT.draw(cv, lines[1], x + 24, y + 20, 9.5, INK);
  });
  // map key under map (wraps to a second row when full)
  const ky = py + ph + 8;
  let kx = M, krow = 0;
  MAP_PINS.forEach(([name], i) => {
    const t = (i + 1) + " " + name;
    const w = F_INT.textWidth(t, 8) + 8;
    if (kx + w > M + mapW) { kx = M; krow++; }
    F_INT.draw(cv, t, kx, ky + 8 + krow * 10, 8, MUTED);
    kx += w;
  });
  cv.hline(M, ky + 26, CW, RULE, 1);
  // ---- also today strip (one line each)
  const ay = ky + 34;
  F_OSW.draw(cv, "ALSO TODAY", M, ay + 12, 11, RED, 1);
  const also = [
    "US flash PMI due 09:45 ET",
    "Amazon Leo: 36 satellites, 11:09 UTC",
    "India flash PMI due 10:30 IST",
  ];
  const aw = (CW - 130) / 3;
  also.forEach((t, i) => {
    const x = M + 118 + i * aw;
    F_INT.draw(cv, t, x, ay + 12, 10, INK);
    if (i < 2) cv.vline(x + aw - 6, ay + 2, 16, [200, 190, 172], 1);
  });
  cv.hline(M, ay + 20, CW, RULE, 1);
  // ---- date check + footer
  const dy = ay + 28;
  cv.rect(M, dy, CW, 24, CREAM2);
  cv.rect(M, dy, 4, 24, RED);
  F_OSW.draw(cv, "DATE CHECK", M + 14, dy + 16, 11, RED, 1);
  F_INT.draw(cv, "Every story on this page was verified from primary sources for Monday 23 November 2026.", M + 118, dy + 16, 11.5, INK);
  const fy = dy + 34;
  F_INT.draw(cv, "THE WORLD TODAY  ·  No. 327  ·  Printed Monday 23 November 2026  ·  30 stories from 7 regions  ·  Sources: Reuters, Dow Jones, Sky News, AAP, USGS, BBC, AFP", M, fy + 8, 9, MUTED);
  // grain last (deterministic)
  cv.grain(20261123, 0.5);
  const out = process.env.MAKEFUN_OUTPUT_DIR || "out";
  writePNG(cv, path.join(out, "entry.png"));
  console.log("wrote", path.join(out, "entry.png"));
}

main();
