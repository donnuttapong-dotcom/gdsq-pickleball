# Deploy GDSQ Pickleball

## เป้าหมาย

Deploy แอปนี้ขึ้น URL จริง เพื่อเลิกใช้ localtunnel และเอา URL จริงไปใส่ใน LINE LIFF

## ตัวเลือกที่แนะนำ: Render

### 1. เตรียมโค้ดขึ้น GitHub

สร้าง repository ใหม่ใน GitHub แล้ว push โฟลเดอร์โปรเจกต์นี้ขึ้นไป

```bash
git init
git add .
git commit -m "Initial GDSQ Pickleball app"
git branch -M main
git remote add origin YOUR_GITHUB_REPO_URL
git push -u origin main
```

### 2. สร้าง Web Service ใน Render

1. ไปที่ Render Dashboard
2. กด New
3. เลือก Web Service
4. Connect GitHub repository ของโปรเจกต์นี้
5. ตั้งค่า:

```text
Name: gdsq-pickleball
Runtime: Node
Build Command: npm install
Start Command: npm start
```

### 3. ใส่ Environment Variables ใน Render

ในหน้า Render service ไปที่ Environment แล้วเพิ่ม:

```text
NODE_ENV=production
HOST=0.0.0.0
SUPABASE_URL=https://sgmhfjlautezuaygfcae.supabase.co
SUPABASE_SERVICE_ROLE_KEY=secret key ของ Supabase
LINE_LIFF_ID=LIFF ID ของ LINE
```

ห้ามใส่ `SUPABASE_SERVICE_ROLE_KEY` ในหน้าเว็บหรือส่งให้คนอื่น

### 4. Deploy

กด Manual Deploy หรือรอ Render deploy อัตโนมัติ

เมื่อเสร็จ จะได้ URL ประมาณ:

```text
https://gdsq-pickleball.onrender.com
```

ทดสอบ:

```text
https://gdsq-pickleball.onrender.com/health
https://gdsq-pickleball.onrender.com/admin
```

### 5. เปลี่ยน LINE LIFF Endpoint URL

กลับไป LINE Developers Console แล้วแก้ Endpoint URL เป็น URL จริง:

```text
https://gdsq-pickleball.onrender.com
```

แล้วกด Save

หลังจากนั้นให้เปิด LIFF URL เดิม:

```text
https://liff.line.me/...
```

ระบบจะโหลดจากเว็บจริง ไม่ต้องใช้ localtunnel แล้ว

## หลัง deploy

ถ้ามีการแก้โค้ดใหม่:

```bash
git add .
git commit -m "Update app"
git push
```

Render จะ deploy ใหม่จาก GitHub
