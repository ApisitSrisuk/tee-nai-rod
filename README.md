# Tee Nai Rod (ที่ไหนรอด)

แผนที่ให้คนกรุงเทพฯ ช่วยกันปักหมุดหมู่บ้านที่น้ำท่วม / ไม่ท่วม ในปี 2554 และ 2569

- หน้าเว็บ: static HTML + Leaflet (`src/template.html` → build เป็น `public/index.html`)
- API: Vercel Functions (`api/pins.js`, `api/vote.js`)
- ฐานข้อมูล: Supabase (`supabase/schema.sql`)

## รันในเครื่อง

```bash
npm run dev
```

เปิด http://localhost:5173
- ถ้ายังไม่มีไฟล์ `.env` → โหมดทดลอง หมุดเก็บใน browser อย่างเดียว
- ถ้ามี `.env` (คัดลอกจาก `.env.example`) → ต่อ Supabase จริง

ทดสอบ API (ใช้ Supabase จำลอง ไม่ต้องมีบัญชี): `npm test`

แก้หน้าเว็บที่ `src/template.html` แล้วรัน `npm run dev` ใหม่ (build ให้อัตโนมัติ)

## Deploy (ฟรี)

### 1. Supabase
1. สมัคร https://supabase.com → New project (region: Southeast Asia (Singapore))
2. SQL Editor → New query → วางเนื้อหาทั้งหมดจาก `supabase/schema.sql` → Run
3. Project Settings → API → คัดลอก
   - Project URL → `SUPABASE_URL`
   - `anon` `public` key → `SUPABASE_ANON_KEY`
   - `service_role` key → `SUPABASE_SERVICE_ROLE_KEY` (**ห้ามเปิดเผย** ใส่เฉพาะใน Vercel / `.env`)

### 2. Vercel
1. push โฟลเดอร์นี้ขึ้น GitHub (repo private ก็ได้)
2. https://vercel.com → Add New → Project → Import repo นี้ (Framework Preset: **Other**)
3. Environment Variables ใส่:

| ชื่อ | ค่า |
|---|---|
| `SUPABASE_URL` | จาก Supabase |
| `SUPABASE_ANON_KEY` | จาก Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | จาก Supabase |
| `HASH_SALT` | ข้อความสุ่มยาวๆ เช่นจาก `node -e "console.log(crypto.randomUUID()+crypto.randomUUID())"` |
| `TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET` | ไม่บังคับ (ดูข้อ 3) |

4. Deploy → ได้เว็บที่ `ชื่อโปรเจกต์.vercel.app`

### 3. (ไม่บังคับ) กันบอทด้วย Cloudflare Turnstile — ฟรี
Cloudflare dashboard → Turnstile → Add site → ใส่โดเมน `xxx.vercel.app` → ได้ Site key / Secret key → ใส่ใน Vercel แล้ว Redeploy

## กติกาข้อมูล
- ทุกคนอ่านหมุดได้ (anon key อ่านได้อย่างเดียว เขียนไม่ได้)
- เพิ่มหมุดผ่าน API เท่านั้น: จำกัด 5 หมุด/ชม. และ 20 หมุด/วัน ต่อ IP (เก็บเป็น hash ไม่เก็บ IP จริง)
- ลบได้เฉพาะหมุดที่ปักจาก browser เครื่องนั้น (ใช้ token ที่ได้ตอนสร้าง)
- โหวต "ข้อมูลถูกต้อง / แจ้งว่าผิด" ได้คนละ 1 เสียงต่อหมุด ถ้าแจ้งผิด ≥ 3 และมากกว่า 2 เท่าของคนยืนยัน → หมุดถูกซ่อนอัตโนมัติ
- ดู/แก้ข้อมูลทั้งหมดได้ที่ Supabase → Table Editor (เช่น ปลดซ่อน: ตั้ง `hidden = false`)

## ข้อจำกัดของแพ็กเกจฟรี
- Supabase free: โปรเจกต์ถูก pause ถ้าไม่มีการใช้งาน 7 วัน → เข้า dashboard กด Restore (ข้อมูลไม่หาย)
- แผนที่พื้นหลัง (OSM / Esri) เหมาะกับคนเข้าไม่มาก ถ้าคนเข้าเยอะให้เปลี่ยนไปใช้ MapTiler (ฟรี 100k ครั้ง/เดือน) ที่ `BASEMAPS` ใน `src/template.html`

## ที่มาข้อมูล
ขอบเขต 50 เขต: [pcrete/gsvloader-demo](https://github.com/pcrete/gsvloader-demo/blob/master/geojson/Bangkok-districts.geojson) (ย่อขนาดและใส่ชื่อไทย)
