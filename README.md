# CCCD Capture App v2

Bản v2 tập trung vào khả năng dùng thật tốt hơn trên mobile:
- **Mobile-first UI**
- **Lưu dữ liệu bằng IndexedDB** thay vì localStorage
- **Tiền xử lý ảnh** trước OCR để tăng độ tương phản
- **OCR mặt trước + mặt sau** là nguồn trích xuất chính
- **QR chỉ để bổ sung số CMND cũ (nếu có)**
- Tra cứu, copy, in, xuất/nhập JSON

## Cải tiến chính của v2
1. **IndexedDB**
   - lưu hồ sơ tốt hơn localStorage
   - phù hợp khi ảnh và dữ liệu tăng lên

2. **Image preprocessing**
   - chuyển grayscale / tăng tương phản trước OCR
   - với QR dùng ngưỡng nhị phân để dễ đọc hơn

3. **OCR-first parser**
   - mặt trước: họ tên, số CCCD, ngày sinh, giới tính, nơi cấp
   - mặt sau: ngày cấp, thường trú, hiện tại
   - QR: ưu tiên số CMND cũ

4. **Auto capture cải tiến**
   - kiểm tra sáng + sắc nét tương đối
   - tự chụp khi khung hình ổn định hơn

## Lưu ý
Đây vẫn là frontend-only prototype nâng cao. Nếu cần production-grade OCR rất ổn định, bước tiếp theo nên là:
- crop/deskew thẻ bằng computer vision
- OCR backend chuyên dụng
- đồng bộ database server-side
