# CCCD Capture App

Bản test mobile-first để chụp CCCD/Căn cước, nhận dạng thông tin từ **ảnh mặt trước + mặt sau**, còn **QR chủ yếu để bổ sung số CMND cũ (nếu có)**.

## Cải tiến đã áp dụng
- Giao diện ưu tiên mobile, đưa camera lên đầu trang
- Bỏ phần giới thiệu/hướng dẫn dài để thao tác nhanh hơn
- Tự động chụp khi khung hình đủ sáng và đủ nét tương đối
- OCR mặt trước/mặt sau bằng `Tesseract.js`
- QR dùng để bổ sung dữ liệu phụ, không còn là nguồn chính cho toàn bộ hồ sơ
- Lưu database cục bộ, tra cứu, copy, in hình ảnh thẻ đầy đủ

## Ghi chú kỹ thuật
- OCR trên trình duyệt vẫn phụ thuộc chất lượng ảnh, độ rung, ánh sáng và hiệu năng máy
- Với điện thoại yếu, lần OCR đầu có thể chậm do tải model
- Nếu cần độ chính xác cao hơn cho production, nên chuyển OCR sang backend hoặc dùng mô hình/engine chuyên dụng hơn
