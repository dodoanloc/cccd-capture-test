# CCCD Capture App V3

V3 tập trung sửa 2 điểm lớn:
1. **Tắt hoàn toàn auto capture** để người dùng chủ động chụp chính xác hơn.
2. **Cải thiện OCR** bằng pipeline nhiều lớp thay vì chỉ OCR 1 ảnh duy nhất.

## Điểm mới của V3
- Auto capture đã tắt hoàn toàn
- OCR thủ công lại theo bước hiện tại bằng nút **OCR lại**
- Tiền xử lý nhiều biến thể:
  - crop vùng trọng tâm
  - tăng tương phản
  - grayscale / nhị phân hóa
- Parser mạnh hơn theo hướng voting từ nhiều kết quả OCR
- Mặt trước ưu tiên: họ tên, CCCD, ngày sinh, giới tính, nơi cấp
- Mặt sau ưu tiên: ngày cấp, địa chỉ thường trú, địa chỉ hiện tại
- QR chỉ bổ sung số CMND cũ nếu có
- Có nút copy địa chỉ thường trú sang địa chỉ hiện tại
- Lưu bằng IndexedDB, hỗ trợ export/import JSON

## Ghi chú
Dù V3 tốt hơn V2, đây vẫn là frontend OCR. Nếu cần độ ổn định rất cao cho production thật, nên làm V4 với:
- crop/deskew bằng computer vision tốt hơn
- OCR backend chuyên dụng
- chuẩn hóa parser CCCD Việt Nam bằng rule engine riêng
