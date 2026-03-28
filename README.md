# CCCD Capture App

Webapp chụp CCCD/Căn cước bằng camera thiết bị, quét QR, trích xuất dữ liệu cơ bản và lưu database cục bộ ngay trên trình duyệt.

## Tính năng
- Chụp tuần tự: mặt trước → mặt sau → QR
- Quét QR CCCD bằng `jsQR`
- Tự điền các trường phổ biến từ dữ liệu QR
- Chỉnh tay dữ liệu trước khi lưu
- Lưu database bằng `localStorage`
- Tra cứu, copy, in đầy đủ ảnh mặt trước, mặt sau, QR và dữ liệu văn bản
- Xuất/Nhập JSON để backup hoặc chuyển máy

## Cấu trúc
- `index.html` — giao diện chính
- `styles.css` — toàn bộ UI
- `app.js` — logic camera, QR, database, in

## Chạy thử
Chỉ cần mở `index.html` trong trình duyệt hiện đại.

Để dùng camera ổn định hơn, nên chạy qua web server local hoặc deploy HTTPS:
- GitHub Pages
- Vercel
- Netlify
- hoặc `python3 -m http.server`

## Lưu ý kỹ thuật
- Bản hiện tại ưu tiên chạy hoàn toàn trên frontend, chưa có OCR backend.
- Việc trích xuất tự động hiện dựa chủ yếu vào **QR CCCD**.
- Ảnh mặt trước/mặt sau được lưu dưới dạng base64 trong localStorage, phù hợp demo/prototype.
- Nếu dùng lâu dài với lượng dữ liệu lớn, nên nâng cấp sang IndexedDB hoặc backend thật.

## Hướng nâng cấp tiếp theo
- Dùng OCR cho mặt trước/mặt sau khi QR không đọc được
- Lưu ảnh vào IndexedDB thay vì localStorage
- Đồng bộ lên Airtable / Supabase / PostgreSQL
- Sinh phiếu in đẹp hơn dạng A4 chuẩn nghiệp vụ
