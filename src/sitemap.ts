// sitemap.xml ที่อัปโหลดจากหลังบ้าน — ตรวจว่าเป็น XML ถูกรูป (well-formed) และเป็น sitemap ของเว็บเราจริงก่อนเก็บ (ฟังก์ชันล้วน)
// Worker ไม่มี DOMParser ⇒ ตัวอ่าน XML เล็ก ๆ ที่นี่ · ไม่รับ <!DOCTYPE> (กัน entity ซ้อนระเบิด / XXE) · รับแค่ entity มาตรฐาน 5 ตัว + &#..;

/** D1 เก็บแถวได้ ~2 MB — sitemap ของเว็บตอนนี้ ~24 KB */
export const MAX_SITEMAP_BYTES = 1024 * 1024;
/** เพดานตามมาตรฐาน sitemaps.org */
export const MAX_SITEMAP_URLS = 50_000;
export const SITEMAP_NS = 'http://www.sitemaps.org/schemas/sitemap/0.9';

export interface XmlElement {
  name: string;
  attrs: Map<string, string>;
  children: XmlElement[];
  /** ข้อความตรง ๆ ในแท็กนี้ (ถอด entity แล้ว · ไม่รวมของแท็กลูก) */
  text: string;
}

export type XmlResult = { ok: true; root: XmlElement } | { ok: false; error: string };

const NAME = /[A-Za-z_:][A-Za-z0-9_:.-]*/y;
const ENTITIES: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

class XmlError extends Error {}

/** อ่าน XML ทั้งไฟล์ · ไม่ถูกรูป = บอกบรรทัดที่ผิด */
export function parseXml(src: string): XmlResult {
  let i = src.charCodeAt(0) === 0xfeff ? 1 : 0;
  const lineAt = (at: number) => src.slice(0, at).split('\n').length;
  const fail = (msg: string, at = i): never => {
    throw new XmlError(`บรรทัด ${lineAt(at)}: ${msg}`);
  };

  const skipSpace = () => {
    while (i < src.length && /\s/.test(src[i]!)) i++;
  };
  const readName = (): string => {
    NAME.lastIndex = i;
    const m = NAME.exec(src);
    if (!m) fail('ชื่อแท็ก/attribute ไม่ถูกต้อง');
    i += m![0].length;
    return m![0];
  };
  const decode = (raw: string, at: number): string =>
    raw.replace(/&([^;&\s]*);?/g, (whole, ref: string) => {
      if (!whole.endsWith(';')) fail(`เครื่องหมาย & ต้องเขียนเป็น &amp;`, at);
      if (ref in ENTITIES) return ENTITIES[ref]!;
      const code = /^#x[0-9a-fA-F]+$/.test(ref) ? parseInt(ref.slice(2), 16) : /^#[0-9]+$/.test(ref) ? Number(ref.slice(1)) : NaN;
      if (!Number.isInteger(code) || code < 1 || code > 0x10ffff) fail(`ไม่รู้จัก entity &${ref};`, at);
      return String.fromCodePoint(code);
    });
  const until = (end: string, what: string): string => {
    const at = src.indexOf(end, i);
    if (at === -1) fail(`${what} ไม่ได้ปิด`);
    const body = src.slice(i, at);
    i = at + end.length;
    return body;
  };
  /** คอมเมนต์ / processing instruction ที่อยู่ได้ทุกที่ · คืน false = ไม่ใช่ */
  const skipMisc = (): boolean => {
    if (src.startsWith('<!--', i)) {
      const start = i;
      i += 4;
      if (until('-->', 'คอมเมนต์ <!--').includes('--')) fail('ในคอมเมนต์ห้ามมี --', start);
      return true;
    }
    if (src.startsWith('<?', i)) {
      const start = i;
      i += 2;
      const target = readName();
      if (target.toLowerCase() === 'xml') fail('<?xml ...?> ต้องอยู่บรรทัดแรกสุดของไฟล์', start);
      until('?>', `<?${target}`);
      return true;
    }
    if (src.startsWith('<!DOCTYPE', i) || src.startsWith('<!doctype', i)) fail('ไม่รับไฟล์ที่มี <!DOCTYPE>');
    return false;
  };

  const readElement = (): XmlElement => {
    const start = i;
    i++; // <
    const el: XmlElement = { name: readName(), attrs: new Map(), children: [], text: '' };
    for (;;) {
      const before = i;
      skipSpace();
      if (src.startsWith('/>', i)) {
        i += 2;
        return el;
      }
      if (src[i] === '>') {
        i++;
        break;
      }
      if (i >= src.length) fail(`แท็ก <${el.name}> ไม่ได้ปิด`, start);
      if (i === before) fail(`ต้องเว้นวรรคก่อน attribute ใน <${el.name}>`);
      const attrAt = i;
      const attr = readName();
      skipSpace();
      if (src[i] !== '=') fail(`attribute ${attr} ต้องมีค่า (${attr}="...")`);
      i++;
      skipSpace();
      const quote = src[i];
      if (quote !== '"' && quote !== "'") fail(`ค่าของ ${attr} ต้องอยู่ในเครื่องหมายคำพูด`);
      i++;
      const raw = until(quote!, `ค่าของ ${attr}`);
      if (raw.includes('<')) fail(`ค่าของ ${attr} ห้ามมี <`, attrAt);
      if (el.attrs.has(attr)) fail(`attribute ${attr} ซ้ำใน <${el.name}>`, attrAt);
      el.attrs.set(attr, decode(raw, attrAt));
    }
    // เนื้อในแท็ก
    for (;;) {
      if (i >= src.length) fail(`แท็ก <${el.name}> ไม่ได้ปิด (ไม่เจอ </${el.name}>)`, start);
      const lt = src.indexOf('<', i);
      if (lt === -1 || lt > i) {
        const end = lt === -1 ? src.length : lt;
        el.text += decode(src.slice(i, end), i);
        i = end;
        continue;
      }
      if (src.startsWith('</', i)) {
        const closeAt = i;
        i += 2;
        const name = readName();
        skipSpace();
        if (src[i] !== '>') fail(`</${name} ต้องปิดด้วย >`);
        i++;
        if (name !== el.name) fail(`ปิดแท็กผิด: เปิด <${el.name}> (บรรทัด ${lineAt(start)}) แต่ปิด </${name}>`, closeAt);
        return el;
      }
      if (src.startsWith('<![CDATA[', i)) {
        i += 9;
        el.text += until(']]>', 'CDATA');
        continue;
      }
      if (skipMisc()) continue;
      el.children.push(readElement());
    }
  };

  try {
    if (src.startsWith('<?xml', i)) {
      i += 5;
      if (!/\s/.test(src[i] ?? '')) fail('<?xml ...?> ไม่ถูกต้อง');
      const decl = until('?>', '<?xml');
      if (!/\bversion\s*=\s*["']1\.[0-9]["']/.test(decl)) fail('<?xml ...?> ต้องมี version="1.0"');
      const enc = /\bencoding\s*=\s*["']([^"']+)["']/.exec(decl)?.[1];
      if (enc && enc.toLowerCase() !== 'utf-8') fail(`รับเฉพาะไฟล์ UTF-8 (ไฟล์นี้ประกาศ ${enc})`);
    }
    for (;;) {
      skipSpace();
      if (!skipMisc()) break;
    }
    if (src[i] !== '<') fail(i >= src.length ? 'ไฟล์ไม่มีแท็กเลย' : 'ต้องเริ่มด้วยแท็ก <urlset>');
    const root = readElement();
    for (;;) {
      skipSpace();
      if (i >= src.length) break;
      if (!skipMisc()) fail(`มีข้อความ/แท็กต่อท้ายหลัง </${root.name}>`);
    }
    return { ok: true, root };
  } catch (err) {
    if (err instanceof XmlError) return { ok: false, error: err.message };
    throw err;
  }
}

export interface SitemapCheck {
  ok: true;
  urls: string[];
  /** ไม่ผิดแต่ควรรู้ (เช่น URL ซ้ำ) */
  warnings: string[];
}

const W3C_DATETIME = /^\d{4}(-\d{2}(-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2}))?)?)?$/;
const CHANGEFREQ = new Set(['always', 'hourly', 'daily', 'weekly', 'monthly', 'yearly', 'never']);

/** ไฟล์ที่อัปโหลด → ตรวจว่าเป็น sitemap (<urlset>) ที่ทุก <loc> อยู่บนเว็บ siteOrigin */
export function checkSitemap(xml: string, siteOrigin: string): SitemapCheck | { ok: false; error: string } {
  const parsed = parseXml(xml);
  if (!parsed.ok) return { ok: false, error: `XML ไม่ถูกต้อง — ${parsed.error}` };
  const { root } = parsed;
  if (root.name !== 'urlset') return { ok: false, error: `แท็กนอกสุดต้องเป็น <urlset> (ไฟล์นี้เป็น <${root.name}>)${root.name === 'sitemapindex' ? ' — ยังไม่รองรับ sitemap index' : ''}` };
  if (root.attrs.get('xmlns') !== SITEMAP_NS) return { ok: false, error: `<urlset> ต้องมี xmlns="${SITEMAP_NS}"` };

  const site = new URL(siteOrigin).origin;
  const urls: string[] = [];
  const seen = new Set<string>();
  const warnings: string[] = [];
  for (const [n, url] of root.children.entries()) {
    const at = `รายการที่ ${n + 1}`;
    // แท็กของส่วนขยาย (xhtml:link, image:image ...) ข้ามได้
    if (url.name.includes(':')) continue;
    if (url.name !== 'url') return { ok: false, error: `${at}: ใน <urlset> ต้องเป็น <url> (เจอ <${url.name}>)` };
    const field = (name: string) => url.children.filter((c) => c.name === name);
    const locs = field('loc');
    if (locs.length !== 1) return { ok: false, error: `${at}: <url> ต้องมี <loc> หนึ่งตัว (เจอ ${locs.length})` };
    const loc = locs[0]!.text.trim();
    let parsedLoc: URL;
    try {
      parsedLoc = new URL(loc);
    } catch {
      return { ok: false, error: `${at}: <loc> ไม่ใช่ URL เต็ม: ${loc.slice(0, 200)}` };
    }
    if (parsedLoc.origin !== site) return { ok: false, error: `${at}: ${loc.slice(0, 200)} ไม่ได้อยู่บน ${site}` };
    if (loc.length > 2048) return { ok: false, error: `${at}: URL ยาวเกิน 2,048 ตัวอักษร` };
    const lastmod = field('lastmod')[0]?.text.trim();
    if (lastmod !== undefined && !W3C_DATETIME.test(lastmod)) return { ok: false, error: `${at}: <lastmod> รูปแบบวันที่ไม่ถูกต้อง: ${lastmod.slice(0, 50)}` };
    const changefreq = field('changefreq')[0]?.text.trim();
    if (changefreq !== undefined && !CHANGEFREQ.has(changefreq)) return { ok: false, error: `${at}: <changefreq> ต้องเป็น ${[...CHANGEFREQ].join(' / ')}` };
    const priority = field('priority')[0]?.text.trim();
    if (priority !== undefined && !(/^(0(\.\d+)?|1(\.0+)?)$/.test(priority))) return { ok: false, error: `${at}: <priority> ต้องอยู่ระหว่าง 0.0–1.0` };
    if (seen.has(loc)) warnings.push(`URL ซ้ำ: ${loc}`);
    seen.add(loc);
    urls.push(loc);
  }
  if (!urls.length) return { ok: false, error: 'ไม่มี <url> เลย' };
  if (urls.length > MAX_SITEMAP_URLS) return { ok: false, error: `มี ${urls.length.toLocaleString('en-US')} URL — เกิน ${MAX_SITEMAP_URLS.toLocaleString('en-US')} ต่อไฟล์` };
  return { ok: true, urls, warnings };
}

/** ไฟล์ที่แนบ → ข้อความ UTF-8 + ผลตรวจ */
export async function checkSitemapFile(file: File, siteOrigin: string): Promise<(SitemapCheck & { xml: string }) | { ok: false; error: string }> {
  if (file.size === 0) return { ok: false, error: 'ไฟล์ว่าง' };
  if (file.size > MAX_SITEMAP_BYTES) return { ok: false, error: `ไฟล์ใหญ่เกิน 1 MB (${(file.size / 1024 / 1024).toFixed(1)} MB)` };
  let xml: string;
  try {
    xml = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(await file.arrayBuffer());
  } catch {
    return { ok: false, error: 'ไฟล์ไม่ใช่ UTF-8' };
  }
  const result = checkSitemap(xml, siteOrigin);
  return result.ok ? { ...result, xml } : result;
}
