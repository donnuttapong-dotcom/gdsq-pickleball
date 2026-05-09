# GDSQ Pickleball

## สิ่งที่ต้องตั้งค่าก่อนรัน

1. ติดตั้ง Node.js จาก https://nodejs.org
2. เปิด Terminal ที่โฟลเดอร์โปรเจกต์นี้
3. ติดตั้งแพ็กเกจ:

```bash
npm install
```

4. คัดลอกไฟล์ `.env.example` เป็น `.env`

```bash
cp .env.example .env
```

5. เปิดไฟล์ `.env` แล้วใส่ค่าจริง:

```bash
SUPABASE_URL=your_supabase_project_url
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key
LINE_LIFF_ID=your_line_liff_id
ADMIN_PASSWORD=your_admin_password
ADMIN_SESSION_SECRET=your_long_random_admin_cookie_secret
```

6. ใน Supabase SQL Editor ให้รัน `setup.sql` เพื่อสร้าง session แรกสำหรับหน้าเว็บนี้

ถ้าเคยสร้างตารางไว้แล้ว ให้รัน `migration-event-details.sql` เพื่อเพิ่มวันที่ เวลา ราคา สถานที่ และรูปโปสเตอร์กิจกรรม

7. เริ่ม server:

```bash
npm run dev
```

หรือ:

```bash
npm start
```

8. เปิดเว็บ:

```text
http://localhost:3000
```

หน้า Admin:

```text
http://localhost:3000/admin
```

Health check:

```text
http://localhost:3000/health
```

## หมายเหตุ

หน้าเว็บส่ง `sessionId: 1` ไปที่ backend และ backend จะแปลงเป็น session แรกในตาราง `sessions` ให้อัตโนมัติ

## Deploy

ดูขั้นตอน deploy จริงใน `DEPLOY.md`
