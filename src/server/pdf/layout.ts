import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage, type PDFImage } from "pdf-lib";

/**
 * Minimal document layout engine over pdf-lib: A4 pages, header title block, flowing text,
 * tables with page breaks, and a footer with page numbers and document control text.
 * Uses the standard Helvetica fonts (WinAnsi) — text is sanitised to that character set.
 */
export const A4 = { w: 595.28, h: 841.89 };
const M = 40; // margin
const INK = rgb(0.106, 0.141, 0.188);
const STEEL = rgb(0.357, 0.42, 0.478);
const LINE = rgb(0.84, 0.86, 0.88);
const BLUE = rgb(0.137, 0.322, 0.627);

export type Company = { name: string; addressLines: string; phone?: string | null; email?: string | null; vatNumber?: string | null; companyNumber?: string | null };

/** pdf-lib standard fonts only support WinAnsi; replace anything else. */
export function clean(s: unknown): string {
  return String(s ?? "")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/±/g, "+/-")
    .replace(/≥/g, ">=")
    .replace(/≤/g, "<=")
    .replace(/Ø|⌀/g, "Dia ")
    .replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF]/g, "?");
}

export class Doc {
  pdf!: PDFDocument;
  font!: PDFFont;
  bold!: PDFFont;
  page!: PDFPage;
  y = 0;
  pages: PDFPage[] = [];
  constructor(
    private opts: { title: string; refNo: string; company: Company; footerNote?: string; demo?: boolean; meta?: [string, string][] },
  ) {}

  static async create(opts: ConstructorParameters<typeof Doc>[0]) {
    const d = new Doc(opts);
    d.pdf = await PDFDocument.create();
    d.pdf.setTitle(`${opts.title} ${opts.refNo}`);
    d.pdf.setProducer("MJMS");
    d.pdf.setCreator("MJMS — Manufacturing Job Management System");
    d.font = await d.pdf.embedFont(StandardFonts.Helvetica);
    d.bold = await d.pdf.embedFont(StandardFonts.HelveticaBold);
    d.newPage();
    return d;
  }

  newPage() {
    this.page = this.pdf.addPage([A4.w, A4.h]);
    this.pages.push(this.page);
    this.drawHeader();
  }

  private drawHeader() {
    const p = this.page;
    const top = A4.h - M;
    // Company block (left)
    p.drawText(clean(this.opts.company.name), { x: M, y: top - 14, size: 13, font: this.bold, color: INK });
    let yy = top - 28;
    for (const line of clean(this.opts.company.addressLines).split("\n").slice(0, 5)) {
      p.drawText(line, { x: M, y: yy, size: 8, font: this.font, color: STEEL });
      yy -= 10;
    }
    const contact = [this.opts.company.phone, this.opts.company.email].filter(Boolean).join("   ");
    if (contact) p.drawText(clean(contact), { x: M, y: yy, size: 8, font: this.font, color: STEEL });
    // Title block (right) — drawing-style box
    const bw = 220;
    const bx = A4.w - M - bw;
    const rows = this.opts.meta ?? [];
    const bh = 44 + rows.length * 14;
    p.drawRectangle({ x: bx, y: top - bh, width: bw, height: bh, borderColor: INK, borderWidth: 0.8 });
    p.drawText(clean(this.opts.title.toUpperCase()), { x: bx + 8, y: top - 14, size: 8, font: this.bold, color: STEEL });
    p.drawText(clean(this.opts.refNo), { x: bx + 8, y: top - 34, size: 18, font: this.bold, color: INK });
    p.drawLine({ start: { x: bx, y: top - 42 }, end: { x: bx + bw, y: top - 42 }, thickness: 0.8, color: INK });
    let ry = top - 54;
    for (const [k, v] of rows) {
      p.drawText(clean(k), { x: bx + 8, y: ry, size: 7.5, font: this.font, color: STEEL });
      p.drawText(clean(v).slice(0, 38), { x: bx + 78, y: ry, size: 8, font: this.bold, color: INK });
      ry -= 14;
    }
    if (this.opts.demo) {
      p.drawText("DEMONSTRATION DOCUMENT - NOT VALID", { x: M, y: top - bh - 14, size: 8, font: this.bold, color: rgb(0.7, 0.15, 0.12) });
    }
    this.y = Math.min(yy, top - bh) - 26;
  }

  ensure(space: number) {
    if (this.y - space < M + 40) this.newPage();
  }

  heading(text: string) {
    this.ensure(30);
    this.y -= 6;
    this.page.drawText(clean(text), { x: M, y: this.y, size: 10.5, font: this.bold, color: INK });
    this.y -= 5;
    this.page.drawLine({ start: { x: M, y: this.y }, end: { x: A4.w - M, y: this.y }, thickness: 0.6, color: LINE });
    this.y -= 13;
  }

  /** Wrapped paragraph. */
  text(s: string, opts: { size?: number; bold?: boolean; color?: "ink" | "steel"; indent?: number } = {}) {
    const size = opts.size ?? 9;
    const font = opts.bold ? this.bold : this.font;
    const width = A4.w - 2 * M - (opts.indent ?? 0);
    for (const para of clean(s).split("\n")) {
      const lines = wrap(para, font, size, width);
      for (const ln of lines.length ? lines : [""]) {
        this.ensure(size + 4);
        this.page.drawText(ln, { x: M + (opts.indent ?? 0), y: this.y, size, font, color: opts.color === "steel" ? STEEL : INK });
        this.y -= size + 3.5;
      }
    }
  }

  gap(h = 8) {
    this.y -= h;
  }

  /** Two-column key/value grid. */
  fields(pairs: [string, string | null | undefined][], cols = 2) {
    const colW = (A4.w - 2 * M) / cols;
    for (let i = 0; i < pairs.length; i += cols) {
      const row = pairs.slice(i, i + cols);
      const heights = row.map(([, v]) => wrap(clean(v ?? "-"), this.font, 9, colW - 10).length);
      const h = 11 + Math.max(1, ...heights) * 11;
      this.ensure(h);
      row.forEach(([k, v], j) => {
        const x = M + j * colW;
        this.page.drawText(clean(k), { x, y: this.y, size: 7.5, font: this.font, color: STEEL });
        let yy = this.y - 11;
        for (const ln of wrap(clean(v || "-"), this.font, 9, colW - 10)) {
          this.page.drawText(ln, { x, y: yy, size: 9, font: this.font, color: INK });
          yy -= 11;
        }
      });
      this.y -= h + 2;
    }
  }

  /** Table with header repeated on page breaks. widths are fractions of the content width. */
  table(head: string[], rows: (string | number | null | undefined)[][], widths: number[], opts: { align?: ("l" | "r")[]; size?: number } = {}) {
    const size = opts.size ?? 8.5;
    const W = A4.w - 2 * M;
    const cw = widths.map((w) => w * W);
    const drawHead = () => {
      this.ensure(20);
      this.page.drawRectangle({ x: M, y: this.y - 4, width: W, height: 15, color: rgb(0.93, 0.945, 0.955) });
      let x = M;
      head.forEach((h, i) => {
        const t = clean(h);
        const tx = opts.align?.[i] === "r" ? x + cw[i] - 4 - this.bold.widthOfTextAtSize(t, size) : x + 4;
        this.page.drawText(t, { x: tx, y: this.y, size, font: this.bold, color: STEEL });
        x += cw[i];
      });
      this.y -= 16;
    };
    drawHead();
    for (const r of rows) {
      const cells = r.map((c, i) => wrap(clean(c ?? ""), this.font, size, cw[i] - 8));
      const h = Math.max(1, ...cells.map((c) => c.length)) * (size + 3) + 4;
      if (this.y - h < M + 40) {
        this.newPage();
        drawHead();
      }
      let x = M;
      cells.forEach((lines, i) => {
        let yy = this.y;
        for (const ln of lines) {
          const tx = opts.align?.[i] === "r" ? x + cw[i] - 4 - this.font.widthOfTextAtSize(ln, size) : x + 4;
          this.page.drawText(ln, { x: tx, y: yy, size, font: this.font, color: INK });
          yy -= size + 3;
        }
        x += cw[i];
      });
      this.y -= h;
      this.page.drawLine({ start: { x: M, y: this.y + 4 }, end: { x: M + W, y: this.y + 4 }, thickness: 0.4, color: LINE });
    }
    this.y -= 6;
  }

  /** Right-aligned totals block. */
  totals(rows: [string, string, boolean?][]) {
    for (const [k, v, strong] of rows) {
      this.ensure(14);
      const f = strong ? this.bold : this.font;
      const vw = f.widthOfTextAtSize(clean(v), 9.5);
      this.page.drawText(clean(k), { x: A4.w - M - 200, y: this.y, size: 9, font: f, color: STEEL });
      this.page.drawText(clean(v), { x: A4.w - M - vw, y: this.y, size: 9.5, font: f, color: INK });
      this.y -= 14;
    }
  }

  async image(img: PDFImage, w: number, x = A4.w - M - w) {
    const h = (img.height / img.width) * w;
    this.ensure(h + 6);
    this.page.drawImage(img, { x, y: this.y - h, width: w, height: h });
    return h;
  }

  signatureBox(label: string, signer?: string | null, when?: string | null) {
    this.ensure(56);
    const W = (A4.w - 2 * M) / 2;
    this.page.drawRectangle({ x: M, y: this.y - 44, width: W, height: 48, borderColor: INK, borderWidth: 0.6 });
    this.page.drawText(clean(label), { x: M + 6, y: this.y - 8, size: 7.5, font: this.font, color: STEEL });
    if (signer) this.page.drawText(clean(signer), { x: M + 6, y: this.y - 24, size: 10, font: this.bold, color: BLUE });
    if (when) this.page.drawText(clean(when), { x: M + 6, y: this.y - 37, size: 8, font: this.font, color: INK });
    this.y -= 56;
  }

  async save(): Promise<Buffer> {
    const total = this.pages.length;
    this.pages.forEach((p, i) => {
      p.drawLine({ start: { x: M, y: M + 18 }, end: { x: A4.w - M, y: M + 18 }, thickness: 0.5, color: LINE });
      const left = clean(this.opts.footerNote ?? `${this.opts.company.name}${this.opts.company.vatNumber ? `  |  VAT ${this.opts.company.vatNumber}` : ""}${this.opts.company.companyNumber ? `  |  Co. No. ${this.opts.company.companyNumber}` : ""}`);
      p.drawText(left.slice(0, 120), { x: M, y: M + 6, size: 7, font: this.font, color: STEEL });
      const right = `${clean(this.opts.refNo)}  -  Page ${i + 1} of ${total}`;
      p.drawText(right, { x: A4.w - M - this.font.widthOfTextAtSize(right, 7), y: M + 6, size: 7, font: this.font, color: STEEL });
    });
    return Buffer.from(await this.pdf.save());
  }
}

export function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  if (!text) return [];
  if (/[\r\n]/.test(text)) return text.split(/\r?\n/).flatMap((para) => (para ? wrap(para, font, size, width) : [""]));
  text = text.replace(/\t/g, "  ");
  const words = text.split(/(\s+)/);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const test = cur + w;
    if (font.widthOfTextAtSize(test, size) <= width || !cur.trim()) {
      // hard-break very long tokens
      if (font.widthOfTextAtSize(test, size) > width && !cur.trim()) {
        let chunk = "";
        for (const ch of w) {
          if (font.widthOfTextAtSize(chunk + ch, size) > width) {
            lines.push(chunk);
            chunk = ch;
          } else chunk += ch;
        }
        cur = chunk;
      } else cur = test;
    } else {
      lines.push(cur.trimEnd());
      cur = w.trimStart();
    }
  }
  if (cur.trim()) lines.push(cur.trimEnd());
  return lines;
}

export async function qrPng(text: string): Promise<Buffer> {
  const QR = await import("qrcode");
  return QR.toBuffer(text, { type: "png", margin: 1, width: 240, errorCorrectionLevel: "M" });
}

export function companyFromSettings(s: { companyName: string; addressLines: string; phone?: string | null; email?: string | null; vatNumber?: string | null; companyNumber?: string | null }): Company {
  return { name: s.companyName, addressLines: s.addressLines, phone: s.phone, email: s.email, vatNumber: s.vatNumber, companyNumber: s.companyNumber };
}
