import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkSitemap, checkSitemapFile, MAX_SITEMAP_BYTES, parseXml, SITEMAP_NS } from '../src/sitemap.ts';

const SITE = 'https://www.wakanafooddelivery.com';
const sitemap = (body: string, head = '<?xml version="1.0" encoding="UTF-8"?>\n') => `${head}<urlset xmlns="${SITEMAP_NS}">${body}</urlset>`;
const url = (loc: string, extra = '') => `<url><loc>${loc}</loc>${extra}</url>`;

test('parseXml: ไฟล์ถูกรูป · entity · CDATA · คอมเมนต์ · processing instruction', () => {
  const r = parseXml('﻿<?xml version="1.0"?>\n<?xml-stylesheet type="text/css" href="a.css"?>\n<!-- c --><a x=\'1\' y="&amp;&#65;&#x42;"><b>t&lt;1</b><![CDATA[<raw>]]><c/></a>\n<!-- end -->');
  assert.ok(r.ok);
  assert.equal(r.root.name, 'a');
  assert.equal(r.root.attrs.get('y'), '&AB');
  assert.equal(r.root.children[0]!.text, 't<1');
  assert.equal(r.root.text, '<raw>');
  assert.equal(r.root.children.length, 2);
});

test('parseXml: ไม่ถูกรูป → บอกบรรทัด', () => {
  const bad: [string, RegExp][] = [
    ['<a><b></a>', /ปิดแท็กผิด/],
    ['<a>', /ไม่ได้ปิด/],
    ['<a>x & y</a>', /&amp;/],
    ['<a>&nbsp;</a>', /entity/],
    ['<a x=1></a>', /เครื่องหมายคำพูด/],
    ['<a x="1"x="2"></a>', /เว้นวรรค/],
    ['<a x="1" x="2"></a>', /ซ้ำ/],
    ['<a></a><b></b>', /ต่อท้าย/],
    ['<!DOCTYPE a [<!ENTITY e "x">]><a>&e;</a>', /DOCTYPE/],
    ['\n\n<?xml version="1.0"?><a/>', /บรรทัดแรก/],
    ['<?xml version="1.0" encoding="TIS-620"?><a/>', /UTF-8/],
    ['<a><!-- x -- y --></a>', /--/],
    ['', /ไม่มีแท็ก/],
    ['hello', /urlset/],
  ];
  for (const [src, re] of bad) {
    const r = parseXml(src);
    assert.ok(!r.ok, src);
    assert.match(r.error, re, src);
  }
  const r = parseXml('<a>\n<b>\n</a>');
  assert.ok(!r.ok && r.error.startsWith('บรรทัด 3:'));
});

test('checkSitemap: sitemap ของเว็บเดิม (มี xml-stylesheet · lastmod · priority · xhtml:link)', () => {
  const xml = sitemap(
    url(`${SITE}/`, '<lastmod>2026-09-02T07:16:42+00:00</lastmod><priority>1.0000</priority>') +
      url(`${SITE}/menu`, `<changefreq>weekly</changefreq><xhtml:link rel="alternate" hreflang="en" href="${SITE}/en/menu"/>`) +
      url(`${SITE}/menu?a=1&amp;b=2`),
    '<?xml version="1.0" encoding="UTF-8"?>\n<?xml-stylesheet type="text/css" href="https://www.xml-sitemaps.com/css/sitemap.css"?>\n'
  ).replace('<urlset ', '<urlset xmlns:xhtml="http://www.w3.org/1999/xhtml" ');
  const r = checkSitemap(xml, SITE);
  assert.ok(r.ok, !r.ok ? r.error : '');
  assert.deepEqual(r.urls, [`${SITE}/`, `${SITE}/menu`, `${SITE}/menu?a=1&b=2`]);
  assert.deepEqual(r.warnings, []);
});

test('checkSitemap: ไม่ใช่ sitemap ของเว็บเรา → ไม่รับ', () => {
  const bad: [string, RegExp][] = [
    ['<html><body/></html>', /<urlset>/],
    [`<sitemapindex xmlns="${SITEMAP_NS}"/>`, /sitemap index/],
    ['<urlset><url><loc>https://www.wakanafooddelivery.com/</loc></url></urlset>', /xmlns/],
    [sitemap(''), /ไม่มี <url>/],
    [sitemap('<page/>'), /<url>/],
    [sitemap('<url></url>'), /<loc> หนึ่งตัว/],
    [sitemap(url('/menu')), /URL เต็ม/],
    [sitemap(url('https://evil.example/menu')), /ไม่ได้อยู่บน/],
    [sitemap(url('http://www.wakanafooddelivery.com/')), /ไม่ได้อยู่บน/],
    [sitemap(url(`${SITE}/`, '<lastmod>yesterday</lastmod>')), /lastmod/],
    [sitemap(url(`${SITE}/`, '<priority>2</priority>')), /priority/],
    [sitemap(url(`${SITE}/`, '<changefreq>sometimes</changefreq>')), /changefreq/],
    [sitemap(url(`${SITE}/`) + '<url><loc>'), /XML ไม่ถูกต้อง/],
  ];
  for (const [xml, re] of bad) {
    const r = checkSitemap(xml, SITE);
    assert.ok(!r.ok, xml);
    assert.match(r.error, re, xml);
  }
});

test('checkSitemap: URL ซ้ำ = เตือน ไม่ล้ม', () => {
  const r = checkSitemap(sitemap(url(`${SITE}/`) + url(`${SITE}/`)), SITE);
  assert.ok(r.ok && r.warnings.length === 1);
});

test('checkSitemapFile: ไฟล์ว่าง · ใหญ่เกิน · ไม่ใช่ UTF-8', async () => {
  assert.ok((await checkSitemapFile(new File([sitemap(url(`${SITE}/`))], 'sitemap.xml'), SITE)).ok);
  const empty = await checkSitemapFile(new File([], 'sitemap.xml'), SITE);
  assert.ok(!empty.ok && /ว่าง/.test(empty.error));
  const big = await checkSitemapFile(new File([new Uint8Array(MAX_SITEMAP_BYTES + 1)], 'sitemap.xml'), SITE);
  assert.ok(!big.ok && /1 MB/.test(big.error));
  const latin = await checkSitemapFile(new File([Uint8Array.from([0x3c, 0x61, 0xff, 0x3e])], 'sitemap.xml'), SITE);
  assert.ok(!latin.ok && /UTF-8/.test(latin.error));
});
