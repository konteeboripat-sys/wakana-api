# wakana-api

API และหลังบ้านของ [wakanafooddelivery.com](https://www.wakanafooddelivery.com) บน **Cloudflare Workers + D1** (TypeScript)
**แยกจากเว็บ** [`wakana-site`](../wakana-site) — ถ้า API ล่ม หน้าเว็บกับการสั่งผ่าน LINE ยังใช้ได้ตามเดิม · หลังบ้านใช้แทน `back/orderList.php` ของเว็บ PHP เดิม

```
wakana-site (static)                    wakana-api (Worker · โปรเจกต์นี้)
www.wakanafooddelivery.com              api.wakanafooddelivery.com
  ตะกร้า ── POST /orders ───────────►     ตรวจ + คิดราคาเอง ──► D1 (orders / order_items / order_events)
  catalog.js ◄── ดึงเมนู/ราคา (แคช 5 นาที) ──┘
                                        /back/*  ◄── พนักงาน (Cloudflare Access)
```

## สถานะ (6 ต.ค. 69)
- โค้ดครบ · เทสผ่าน: unit 24 ข้อ (`pnpm test`) + ลองจริงกับ `wrangler dev` + D1 ในเครื่อง (API, บันทึกออเดอร์, หน้าออเดอร์/สินค้า, กัน XSS/CSRF, rate limit)
- **ยังไม่ deploy** · **ยังไม่ได้ต่อกับตะกร้าใน wakana-site** (ดู "ต่อกับหน้าเว็บ")

## เริ่มทำงาน
ต้องมี Node 22.18+ และ pnpm 11 (เครื่องที่ไม่มีสิทธิ์ admin: `corepack enable pnpm --install-directory "$env:APPDATA\npm"`)
```
pnpm install
copy .dev.vars.example .dev.vars
pnpm run db:migrate:local      # สร้างตารางใน D1 จำลอง (.wrangler/)
pnpm run dev                   # http://localhost:8787 · หลังบ้าน http://localhost:8787/back
pnpm test                      # unit test (node --test รันไฟล์ .ts ตรง ๆ)
pnpm run typecheck
```

## API
| | เส้นทาง | ใช้ทำอะไร |
|---|---|---|
| GET | `/health` | เช็คว่าทำงาน |
| GET | `/products?category=` | เมนูทั้งหมด (รูป/ลิงก์เป็น URL เต็มของเว็บ) |
| GET | `/search?q=&limit=` | ค้นเมนูจากชื่อ/หมวด — ทุกคำต้องเจอ · ชื่อขึ้นต้นด้วยคำค้นมาก่อน |
| POST | `/orders` | ส่งออเดอร์ (ด้านล่าง) |
| GET | `/back/orders?date=&status=&q=` | รายการออเดอร์ (ค่าเริ่มต้น = วันนี้ · `date=all` ทุกวัน · `q` = เบอร์/ชื่อ/เลขออเดอร์) |
| GET | `/back/orders/<ref>` | รายละเอียด + ประวัติสถานะ |
| POST | `/back/orders/<ref>/status` | เปลี่ยนสถานะ (ฟอร์มในหน้ารายละเอียด) |

### POST /orders
```json
{
  "ref": "WK-ABCD-2345",
  "items": [{ "id": "17", "qty": 2 }],
  "form": { "method": "delivery", "name": "สมชาย", "phone": "0812345678", "address": "…", "location": "13.68,100.54", "wantedAt": "2026-10-06T12:30", "note": "" }
}
```
- `form` = รูปเดียวกับ `state.form` ของตะกร้า · `wantedAt` = เวลาไทย · ไม่ส่ง `ref` = server สร้างให้แล้วคืนกลับ
- **ราคา/ชื่อคิดจาก catalog ฝั่ง server เสมอ** — ส่ง price มาก็ไม่ใช้
- `ref` เดิมซ้ำ = ไม่สร้างใหม่ (200 `created:false`) ⇒ เว็บยิงซ้ำได้ปลอดภัย
- รับ `Content-Type: text/plain` ด้วย = simple request ไม่มี preflight ⇒ ยิงด้วย `fetch(…, { keepalive: true })` / `sendBeacon` ขณะเปิด LINE ได้
- ตอบ 201 สร้างแล้ว · 200 ซ้ำ · 422 ข้อมูลผิด (`errors` บอกช่อง) · 403 origin ไม่อยู่ใน `ALLOWED_ORIGINS` · 429 เกิน 10 ครั้ง/นาที/IP · 503 โหลดเมนูไม่ได้
- กติกาตรวจ = เดียวกับตะกร้า (ช่องที่ต้องกรอก · เบอร์ไทย · เวลาทำการ 09:00–19:00 · ชุดปาร์ตี้ล่วงหน้า 2 ชม.) เผื่อเวลาเดินทางของคำขอ 10 นาที
  ค่าอยู่ใน `vars` ของ `wrangler.jsonc` — **แก้เวลาร้านต้องแก้ทั้งที่นี่และ `wakana-site/src/cart/cart-ui.js`**

## หลังบ้าน /back
- สถานะ: ใหม่ → ยืนยันแล้ว → กำลังเตรียม → เสร็จสิ้น (ยกเลิกได้ทุกขั้น · เปลี่ยนข้ามขั้น/ย้อนกลับได้จากเมนู "สถานะอื่น")
- ทุกการเปลี่ยนบันทึกว่าใคร (อีเมลจาก Access) เมื่อไร · พนักงานสองคนกดพร้อมกัน คนหลังได้ข้อความ "ถูกเปลี่ยนไปก่อนแล้ว" ไม่ทับกัน
- หน้า HTML สร้างฝั่ง server **ไม่มี JavaScript** · CSP ห้ามสคริปต์ · ทุกค่าจากลูกค้า escape (`src/html.ts`) · ฟอร์มตรวจ Origin กัน CSRF
- **ข้อจำกัด:** ออเดอร์บันทึกตอนลูกค้ากด "สั่งผ่าน LINE" แต่ลูกค้าต้องกดส่งในแชทเองอีกขั้น ⇒ อาจมีออเดอร์ที่ไม่ได้ส่งเข้า LINE จริง และลูกค้าแก้ข้อความใน LINE ได้ ⇒ **ยอดที่เชื่อได้คือในหลังบ้าน** (server คิด)

### สินค้า /back/products (แทน productList.php / editProduct.php)
- รายการ: รูป · ชื่อไทย/อังกฤษ · หมวด · ราคา · แสดงหน้าแรก · เปิด/ปิดขาย · กรองหมวด/ชื่อหรือรหัส/การขาย
- เพิ่ม/แก้: **ช่องและลำดับเดียวกับ `back/addProduct.php`** — CODE_NUMBER · Product url · ชื่อไทย/อังกฤษ · รายละเอียดย่อ/ยาว ไทย/อังกฤษ · Normal/Sale/Time price · Catalog · thumbnail/picture · Promotion · ส่งฟรี · Homepage · Enable · SEO Title/Keyword/Description
  **product thumbnail และ product picture = แนบไฟล์** (เก็บใน R2 `wakana-images` เสิร์ฟที่ `/media/products/<uuid>.<ext>`) — ตรวจชนิดจากเนื้อไฟล์ รับ JPG/PNG/WebP/GIF ≤ 2 MB ไม่รับ SVG · เปลี่ยน/ลบรูปแล้วไฟล์เก่าถูกลบ · บันทึกไม่สำเร็จไม่ทิ้งไฟล์ค้าง
  สินค้าที่นำเข้ายังใช้รูปบนเว็บเดิม (`/images/product/...`) — เปลี่ยน/ลบรูปไม่ลบไฟล์บนเว็บเดิม
  ต่างจากเดิม: รายละเอียดเป็นข้อความธรรมดา (เดิม TinyMCE ต้องใช้ JavaScript) · Product url เว้นว่างได้ (ตั้งจากชื่ออังกฤษ) · ชื่ออังกฤษบังคับเฉพาะสินค้าใหม่ (ของที่นำเข้าจากเว็บไม่มีชื่ออังกฤษ)
  **Sale price / Time price / Promotion / ส่งฟรี เก็บค่าไว้แต่ยังไม่มีผล** ลูกค้าจ่าย Normal price เสมอ — หน้าแก้ไขขึ้นเตือนเมื่อตั้งค่าเหล่านี้
- ตั้งต้นด้วยปุ่ม **นำเข้าจากเว็บ** (106 รายการ รหัสเดิม) — กดซ้ำได้ เพิ่มเฉพาะที่ยังไม่มี ไม่ทับที่แก้ไว้
- บันทึกประวัติทุกการแก้ (ช่องไหน จากอะไรเป็นอะไร ใคร เมื่อไร) · สองคนแก้พร้อมกัน คนหลังได้ข้อความเตือน ไม่ทับกัน
- **ลบ = ย้ายไปถังขยะ** (ปุ่ม "ลบ" ในรายการ / "ลบสินค้านี้" ในหน้าแก้ไข → หน้ายืนยัน) · หายจากรายการและไม่ใช้คิดราคา · กู้คืนได้จากตัวกรองสถานะ "ถังขยะ"
  ไม่ลบแถวจริงเพราะ: "นำเข้าจากเว็บ" จะดึงกลับมาใหม่ · ประวัติจะหาย · ชื่อในลิงก์ของตัวที่ลบใช้ซ้ำไม่ได้ (ระบบบอกให้กู้คืนแทน)
- **ตอนนี้แก้แล้วยังไม่ขึ้นเว็บ** (`PRICE_SOURCE = "catalog"` = หน้าเว็บและราคาออเดอร์ยังใช้ catalog.js) · คอลัมน์ "เทียบเว็บ" บอกสินค้าที่ไม่ตรงกับเว็บ
  ต่อเว็บเสร็จ (build เว็บจากตารางนี้) แล้วค่อยเปลี่ยนเป็น `"d1"` — เปลี่ยนก่อน = ลูกค้าเห็นราคาหนึ่ง หลังบ้านคิดอีกราคา
- ยังไม่ได้ทำจากหน้าเดิม: ให้ราคาโปร/โปรโมชัน/ส่งฟรีมีผลจริง (ตะกร้าต้องรองรับก่อน) · อัปโหลดรูป (ต้องมี R2) · เมนู Promotion / Promotion Rule / Settime / Monday

### Promotion /back/promotions (แทนหน้า promotion ของเว็บเดิม)
- รายการ: Promotion id · ชื่อ · Enable · Start date · Expire date · ช่วงเวลา (ยังไม่เริ่ม/กำลังใช้/หมดอายุ) · ค้นชื่อ · กรองวันเริ่ม (ตั้งแต่) / วันหมดอายุ (ไม่เกิน)
- เพิ่ม/แก้: ชื่อ · Enable (ค่าเริ่ม No) · Start date · Expire date (ต้องไม่ก่อนวันเริ่ม) · ประวัติการแก้ · จำนวนสินค้าที่ร่วมโปร
- ผูกสินค้ากับโปรที่ช่อง **Promotion** ในหน้าแก้ไขสินค้า ("ไม่ร่วมโปรโมชั่น" หรือเลือกโปร) · รายการสินค้ามีคอลัมน์/ตัวกรอง Promotion
- **ลบ = ย้ายไปถังขยะ** (ลิงก์ "ลบ" ในรายการ / "ลบโปรโมชันนี้" ในหน้าแก้ไข → หน้ายืนยันที่บอกสินค้าที่ผูกอยู่) · สินค้าที่ผูกถูกปลดเป็น "ไม่ร่วมโปรโมชั่น" ใน transaction เดียวกัน (บันทึกในประวัติสินค้า) · กู้คืนได้จาก "ถังขยะ" แต่ไม่ผูกสินค้ากลับให้
- **ยังไม่มีผลกับราคา** — ตะกร้าไม่คิดส่วนลด · ข้อมูลโปรเก่า ~60 รายการอยู่ในฐานข้อมูลบน EC2 ยังไม่ได้ย้ายมา

### Promotion Rule /back/promotion-rules (แทนหน้า Promotion Rule ของเว็บเดิม)
- รายการ: Name · Status (Enable / Disable สีแดง) · Type · Applies To · Buy quantity · Get free quantity · จำนวนสินค้า · ค้น Rule name
- เพิ่ม/แก้: Name · Status (ค่าเริ่ม Disable) · Type ("-" หรือ "โปรโมชั่นส่วนลดราคาสินค้า") · Applies To = Specific product(s). · Buy quantity (1–999) · Get free quantity (0–999) · **เลือกสินค้า** (checkbox แยกตามหมวด)
- ประวัติการแก้ (สินค้าที่เพิ่ม/เอาออก) · ลบ = ถังขยะ กู้คืนได้ (รายการสินค้ายังอยู่)
- ฟอร์มทำจากคอลัมน์ในหน้ารายการเดิม — ยังไม่เห็นหน้าเพิ่มกติกาของเว็บเดิม อาจมีช่องที่ขาด (เช่น ส่วนลดกี่ % / กี่บาท · ผูกกับโปรไหน)
- **ยังไม่มีผล** — ตะกร้าไม่คิดส่วนลด/ของแถม
### Promotion Monday /back/promotion-monday (แทนหน้า Promotion Monday ของเว็บเดิม)
- โปรที่ใช้ได้ **เฉพาะวันจันทร์** ในช่วงวันที่ — `kind = monday` แสดงแยกหน้า (เหมือนเว็บเดิม #69 Monday Special)
- หน้าตาเหมือน Settime ทุกอย่าง แต่ไม่มีคอลัมน์ Start time / End time · เพิ่ม/แก้/ลบ ใช้หน้าเดียวกับ Promotion (`/back/promotions/new?kind=monday`)
- **ยังไม่มีผล** — ตะกร้ายังไม่ดูวันในสัปดาห์

### Promotion Settime /back/promotion-settime (แทนหน้า Promotion Settime ของเว็บเดิม)
- โปรที่กำหนด **ช่วงเวลาในแต่ละวัน** (Start time / End time · 00:00:00–00:00:00 = ทั้งวัน) — ตาราง promotions เดียวกัน `kind = settime` ไม่แสดงในหน้า Promotion ปกติ (เหมือนเว็บเดิม #66 #67)
- หน้ารายการตามเว็บเดิม: Add promotion rule · Add new promotion · ตัวกรอง Select Promotion Name / Start date / End date / Status · ตารางซ้าย **Promotion Rule Name** (กติกาของโปรที่แสดง) · ตารางขวา **Promotion Name** (Pro id · ชื่อ · Status · วันที่ · เวลา · Edit · ลบ)
- เพิ่ม/แก้/ลบ ใช้หน้าเดียวกับ Promotion (`/back/promotions/new?kind=settime`)
- **กติกาผูกกับโปรได้** (ช่อง Promotion ในฟอร์มกติกา · ปุ่ม Add promotion rule ในหน้าโปรเลือกโปรไว้ให้) · ลบโปร = ปลดกติกาที่ผูก (กติกายังอยู่ บันทึกในประวัติ)
- **ยังไม่มีผล** — ตะกร้ายังไม่ดูช่วงเวลา/ส่วนลด

### Store Location /back/stores (แทนหน้า Store Location ของเว็บเดิม)
- รายการ: store id · store name th · store name en · store enable (Enable / Disable) · Edit · ลบ · ปุ่ม Add new store
- ข้อมูลตั้งต้น 9 สาขาจากหน้าเว็บเดิม (รหัสเดิม · เปิดอยู่เฉพาะ #3 พระราม 3) ใส่ไว้ใน migration `0010_stores.sql`
- เพิ่ม/แก้: ชื่อไทย · ชื่ออังกฤษ · store enable · ประวัติ · ลบ = ถังขยะ กู้คืนได้ (ลบสาขาที่เปิดอยู่ หน้ายืนยันแนะนำให้ใช้ Disable แทน)
- **ยังไม่มีผลกับหน้าเว็บ** — ตะกร้ายังใช้ "รับที่ร้าน ฟู้ดโปรมาร์ท พระราม 3" ตายตัว · ยังไม่เห็นหน้าแก้ไขสาขาของเว็บเดิม (อาจมีที่อยู่/พิกัด/เวลาเปิด)

### Customer /back/customers (แทนหน้า Customer ของเว็บเดิม) · อ่านอย่างเดียว
- แท็บ **สมาชิก (เว็บเดิม)** (ค่าเริ่มต้น): คอลัมน์ตามหน้าเดิม Name · Email · Tel · Company · register_date · ค้นชื่อ/อีเมล/เบอร์ — ตาราง `customers` **ว่างจนกว่าจะนำเข้า** (ด้านล่าง) · เว็บใหม่ไม่มีสมัครสมาชิก จึงไม่มีคนเพิ่มเอง
- แท็บ **ลูกค้าจากออเดอร์**: รวมตามเบอร์โทร — ชื่อ (ล่าสุด) · Tel · จำนวนออเดอร์ · ยอดรวม (ไม่นับที่ยกเลิก) · สั่งครั้งแรก/ล่าสุด · ลิงก์ดูออเดอร์
- ยังไม่มี: ลบข้อมูลลูกค้าตามคำขอ (สิทธิ์ลบข้อมูลตาม PDPA) — ต้องออกแบบร่วมกับนโยบายเก็บรักษาข้อมูล

#### นำเข้าสมาชิกเว็บเดิม (ทำหลัง IT/ฝ่ายกฎหมายอนุมัติเท่านั้น)
ไม่มีปุ่มอัปโหลดในหลังบ้านโดยตั้งใจ — ข้อมูลส่วนบุคคลจำนวนมากต้องนำเข้าแบบมีผู้รับผิดชอบ
1. export ตารางสมาชิกจากฐานข้อมูลเว็บเดิม (บน EC2) เป็น CSV UTF-8 มีหัวคอลัมน์ `id,name,email,tel,company,register_date` (รับชื่ออื่นที่ใกล้เคียง เช่น `phone`, `created_at`)
2. `pnpm run customers:to-sql -- members.csv customers-import.sql` — ตรวจทุกแถว บอกแถวที่ข้ามพร้อมเหตุผล
3. `pnpm exec wrangler d1 execute wakana --remote --file customers-import.sql` — รันซ้ำได้ (รหัสเดิมซ้ำ = ข้าม)
4. **ลบ `members.csv` และ `customers-import.sql` ทิ้งทันที** (อยู่ใน .gitignore แล้ว ห้าม commit/ส่งต่อ)

### สิทธิ์เข้า /back
- **บน Cloudflare:** ต้องตั้ง Cloudflare Access (Zero Trust → Access → Applications → Self-hosted) คุม `api.wakanafooddelivery.com/back*`
  แล้วใส่ `ACCESS_TEAM_DOMAIN` (`https://<team>.cloudflareaccess.com`) และ `ACCESS_AUD` (Application Audience Tag) ใน `wrangler.jsonc`
  Worker ตรวจลายเซ็น JWT ของ Access เองอีกชั้น — **ยังไม่ตั้ง = /back ตอบ 503 ทุกคำขอ** (ปิดไว้ก่อนโดยตั้งใจ)
- **ในเครื่อง:** `ADMIN_DEV_EMAIL` ใน `.dev.vars` — มีผลเฉพาะเปิดผ่าน `localhost`/`127.0.0.1` และยังไม่ได้ตั้ง Access
- **ชั่วคราวระหว่างยังไม่มี Access:** `pnpm exec wrangler secret put ADMIN_PASSWORD` → เปิด `/back` แล้วถูกส่งไปหน้า **`/back/login`** (ชื่อผู้ใช้ + รหัสผ่าน แทน `back/check_login.php` เดิม · ชื่อผู้ใช้ = `ADMIN_USERNAME` ใน `wrangler.jsonc` · ว่าง = ชื่ออะไรก็ได้) · ผ่านแล้วได้ cookie ลงลายเซ็น (`src/admin-session.ts` · HttpOnly · SameSite=Strict · 12 ชม.) แล้วกลับหน้าที่ตั้งใจเปิด · ปุ่ม "ออกจากระบบ" แถบบน · **เปลี่ยนรหัสผ่าน = ทุกคนหลุดออก** (ออกจากระบบแค่ลบ cookie ในเครื่องนั้น) · ชื่อที่กรอกบันทึกในประวัติสถานะเป็น `<ชื่อ> (รหัสผ่าน)` · ทุกคนใช้รหัสเดียวกัน ⇒ ใช้รหัสยาวสุ่ม · จำกัดการกดเข้าสู่ระบบ 60 ครั้ง/นาที/IP (`ADMIN_LOGIN_LIMITER`) · **ตั้ง Access แล้วรหัสผ่านใช้ไม่ได้เอง** แล้วลบ secret ทิ้ง (`wrangler secret delete ADMIN_PASSWORD`)
- ถ้า Access ผูกกับ Entra ID ของบริษัท พนักงานใช้บัญชีบริษัทล็อกอินได้เลย

## ขั้นตอนเปิดใช้จริง (ยังไม่ได้ทำ — ต้องมีสิทธิ์บัญชี Cloudflare ที่ถือโซน)
1. `pnpm exec wrangler login`
2. `pnpm exec wrangler d1 create wakana` → เอา `database_id` ใส่ `wrangler.jsonc`
3. `pnpm run db:migrate:remote`
3.1 `pnpm exec wrangler r2 bucket create wakana-images` (ที่เก็บรูป thumbnail)
4. ตั้ง Cloudflare Access (ด้านบน) + ใส่ค่าใน `vars`
5. เปิดบล็อก `routes` (`api.wakanafooddelivery.com`) ใน `wrangler.jsonc` → `pnpm run deploy`
6. สลับโดเมนเว็บแล้ว: เปลี่ยน `SITE_ORIGIN` เป็น `https://www.wakanafooddelivery.com` แล้ว deploy ใหม่

## หน้าเว็บใช้ข้อมูลสินค้าจากหลังบ้าน ✅
- `GET /export/products` (ต้องมี `Authorization: Bearer <EXPORT_TOKEN>`) — สินค้าทั้งหมดรวมที่ปิดขาย + รหัสที่ลบแล้ว · รูปที่อัปโหลดเป็น URL เต็มของ API
- wakana-site build ดึงข้อมูลนี้ (ตั้ง `WAKANA_API_ORIGIN` + `WAKANA_EXPORT_TOKEN`) แล้วแก้หน้าเว็บให้ตรง — รายละเอียดใน README ของ wakana-site
- **อัปเดตอัตโนมัติหลังบันทึก** (`src/publish.ts`, ตาราง `site_publish` — migration 0012): เพิ่ม/แก้/ลบ/กู้คืน/นำเข้าสินค้า → จดว่ามีของค้าง
  - บนเว็บจริง: cron ทุกนาที (`triggers.crons` ใน wrangler.jsonc) เห็นของค้าง → POST `DEPLOY_HOOK_URL` (deploy hook ของ Workers Builds ของ wakana-site) ⇒ หน้าเว็บเปลี่ยนภายในราว 1–3 นาที
  - แก้หลายตัวติดกัน = build รอบเดียว · เว้นอย่างน้อย 2 นาทีระหว่างรอบ (กัน build เก่าเสร็จทีหลังทับข้อมูลใหม่)
  - ในเครื่อง (hook เป็น localhost): สั่ง build ทันทีตอนบันทึก
  - หน้ารายการสินค้าแสดงสถานะ ● ตรงกับหลังบ้าน / มีการแก้ที่รอขึ้นหน้าเว็บ / อัปเดตครั้งล่าสุดไม่สำเร็จ
- ปุ่ม **"อัปเดตหน้าเว็บ"** = สั่ง build ทันทีไม่ต้องรอ cron · ไม่ตั้ง `DEPLOY_HOOK_URL` = ไม่อัปเดตอัตโนมัติ (ต้อง build wakana-site เอง)
- ตั้งค่าตอน deploy: `pnpm exec wrangler secret put EXPORT_TOKEN` · `pnpm exec wrangler secret put DEPLOY_HOOK_URL`
- **`PRICE_SOURCE` คง `"catalog"` ไว้** — catalog.js ถูก build จากหลังบ้านแล้ว ⇒ ราคาออเดอร์ = ราคาบนหน้าเว็บที่ลูกค้าเห็นเสมอ (ถ้าเปลี่ยนเป็น `"d1"` แก้ราคาแล้วยังไม่กดอัปเดตหน้าเว็บ ลูกค้าจะเห็นราคาหนึ่ง หลังบ้านคิดอีกราคา)

## Sitemap /back/sitemap
- อัปโหลด `sitemap.xml` แทนไฟล์ static ของเว็บ · เก็บใน D1 ตาราง `site_sitemap` (migration 0015 · แถวเดียว อัปโหลดใหม่ = ทับ) · ปุ่ม "ลบ" = กลับไปใช้ไฟล์เดิม
- ตรวจก่อนเก็บ (`src/sitemap.ts`): XML ถูกรูป (บอกบรรทัดที่ผิด) · UTF-8 ≤ 1 MB · ไม่รับ `<!DOCTYPE>` · `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">` · ทุก `<loc>` เป็น URL เต็มบน `SITE_ORIGIN` · `lastmod`/`changefreq`/`priority` ถูกรูป · ≤ 50,000 URL
- เสิร์ฟที่ `GET /sitemap.xml` (สาธารณะ · แคช 5 นาที · 404 = ยังไม่อัปโหลด) · wakana-site `src/worker.js` ส่ง `/sitemap.xml` ของเว็บมาที่นี่ ได้ 404/API ล่ม = ใช้ไฟล์ static เดิม ⇒ อัปโหลดแล้วขึ้นเว็บทันที ไม่ต้อง build
- ใช้ไฟล์ตามที่อัปโหลด — ไม่ตัด/เพิ่มหน้าสินค้าให้ (ไฟล์ static เดิมของเว็บยังปรับตามสินค้าตอน build)
- ก่อนใช้บนเว็บจริง: `pnpm run db:migrate:remote` (สร้างตาราง `site_sitemap`) แล้ว deploy ทั้ง wakana-api และ wakana-site

## ส่งออเดอร์จากตะกร้าเข้าหลังบ้าน (ยังไม่ได้ทำ — แก้ใน wakana-site)
ใน `sendViaLine()` ของ `src/cart/cart-ui.js`: สร้าง `ref` (รูป `WK-XXXX-XXXX` ดู `newOrderRef` ใน `src/orders.ts`) → ใส่บรรทัด `เลขออเดอร์: <ref>` ในข้อความ LINE →
`fetch('https://api.wakanafooddelivery.com/orders', { method: 'POST', keepalive: true, headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ ref, items: state.cart, form: state.form }) })`
**ไม่ await** แล้วเปิด LINE ทันทีเหมือนเดิม — รอ fetch ก่อน iOS อาจไม่เปิดแอป LINE · API ล่ม = ลูกค้ายังสั่งผ่าน LINE ได้ แค่ไม่มีในหลังบ้าน
ใช้ `ref` เดิมเมื่อกด "ลองเปิด LINE อีกครั้ง" (server ไม่สร้างซ้ำ) · สร้างใหม่เมื่อตะกร้า/ฟอร์มเปลี่ยน

## ข้อมูลส่วนบุคคล (PDPA)
เก็บชื่อ เบอร์ ที่อยู่ พิกัด ของลูกค้าใน D1 — **ต้องตกลงกับ IT/ฝ่ายกฎหมายก่อนเปิดจริง:** อนุญาตให้เก็บบน Cloudflare หรือไม่ · เก็บนานเท่าไร (ยังไม่มีระบบลบอัตโนมัติ) · ใครเข้าหลังบ้านได้
รับที่ร้าน = ไม่เก็บที่อยู่/พิกัดแม้เบราว์เซอร์ส่งมา · log ของ Worker บันทึกแค่เลขออเดอร์กับชื่อช่องที่ผิด ไม่บันทึกข้อมูลลูกค้า

## โครงไฟล์
```
src/index.ts       เส้นทางหลัก
src/api.ts         /health /products /search /orders
src/orders.ts      ตรวจออเดอร์ + คิดราคา (ฟังก์ชันล้วน) · เลขออเดอร์ · สถานะ
src/catalog.ts     อ่าน catalog.js ของเว็บ · ค้นหา
src/db.ts          คำสั่ง D1
src/admin.ts       หน้าหลังบ้าน: ออเดอร์ + router
src/admin-products.ts  หน้าหลังบ้าน: สินค้า
src/admin-layout.ts    โครงหน้า/CSS/CSP ที่ใช้ร่วมกัน
src/products.ts    ตรวจฟอร์มสินค้า · เทียบกับเว็บ (ฟังก์ชันล้วน)
src/products-db.ts คำสั่ง D1 ของสินค้า
src/auth.ts        ตรวจ JWT ของ Cloudflare Access · ตรวจรหัสผ่านชั่วคราว
src/admin-login.ts / admin-session.ts  หน้า /back/login · /back/logout · cookie session
src/html.ts        แม่แบบ HTML ที่ escape ให้
src/media.ts       รูปอัปโหลด: ตรวจไฟล์ · R2 · เสิร์ฟ /media
src/export.ts      GET /export/products สำหรับ build หน้าเว็บ
src/admin-sitemap.ts / sitemap.ts  หน้าหลังบ้าน: Sitemap + GET /sitemap.xml / ตรวจ XML + sitemap (ฟังก์ชันล้วน)
src/admin-promotions.ts  หน้าหลังบ้าน: Promotion
src/admin-promotion-rules.ts  หน้าหลังบ้าน: Promotion Rule
src/admin-stores.ts / stores.ts / stores-db.ts  หน้าหลังบ้าน: Store Location
src/admin-customers.ts  หน้าหลังบ้าน: Customer (สมาชิก + รวมจากออเดอร์)
src/customers-import.ts · scripts/import-customers.mjs  แปลง CSV สมาชิกเว็บเดิม → SQL
src/admin-promotion-special.ts  หน้าหลังบ้าน: Promotion Settime + Promotion Monday (รายการ · ฟอร์มใช้ร่วมกับ admin-promotions.ts)
src/promotion-rules.ts / promotion-rules-db.ts  ตรวจฟอร์ม / คำสั่ง D1 ของกติกา
src/promotions.ts  ตรวจฟอร์มโปรโมชัน (ฟังก์ชันล้วน)
src/promotions-db.ts คำสั่ง D1 ของโปรโมชัน
src/wall-time.ts   เวลาไทย (Worker รันเป็น UTC)
src/phone.ts       จัดรูปเบอร์ (เหมือนตะกร้า)
migrations/        schema D1
test/              unit test
```
