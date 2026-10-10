# Yêu cầu từ người dùng gửi Claude — đa dạng vùng đất

Ngày: 2026-10-10 (Asia/Bangkok). Người thực hiện: Claude, owner map/client hiện tại.
Trạng thái: đã ghi vào bàn giao chung; chưa có xác nhận tiếp nhận hoặc ảnh sau chỉnh sửa.

Yêu cầu nguyên văn:

> có thể báo cho claude đang dựng map, thêm có vùng đất khác nhau được không, hiện tại đang full màu xanh, thêm vùng đất nâu , ... các vùng khác cho tự nhiên

Người dùng yêu cầu chỉnh hình ảnh map hiện tại để mặt đất bớt đồng nhất. Áp dụng cho các map
đang dựng, giữ bản sắc City/Farm và bố cục đã duyệt. Các mảng có thể triển khai theo tài liệu sẵn có:

- Đất phù sa nâu nhạt ven suối, bãi đất trống tự nhiên; Farm docs/04 §3 đã yêu cầu biome `fertile` màu nâu nhạt.
- Đất khô nâu ấm xen với đồng cỏ; các sắc xanh cỏ khác nhau theo từng vùng.
- Cát/be ở bờ hồ, suối và vịnh phù hợp bố cục; đá xám ấm trên đồi, vách và quanh thác.
- Phân bố thành mảng có chủ đích theo địa hình, chuyển màu mềm ở ranh giới; tránh phủ xanh đồng nhất hoặc chia ô màu ngẫu nhiên.

Đây là yêu cầu về màu/bề mặt hiển thị và phân vùng địa hình tự nhiên, phù hợp docs/03, docs/04
và docs/07. Không bổ sung cơ chế biome, thưởng năng suất, giá đất hay thay đổi số cân bằng.
Không dùng ruộng đã cuốc (`TILLED`), nền công trình, hàng rào hay đường lát sẵn để tạo mảng nâu:
template vẫn bắt đầu với không có công trình/cầu/ruộng/kè/đường lát của người chơi.

Claude chọn cách thể hiện bằng palette/vertex color và dữ liệu map hiện có; nếu thay đổi surface/biome
thực tế, cần giữ đúng validator, luật xây/canh tác và worldgen xác định, không âm thầm đổi luật.
Owner hiện tại thực hiện để tránh hai agent sửa trùng map/renderer.

Bàn giao cần ảnh trước/sau ở camera mặc định và các góc visual review. Kiểm tra lại độ phân biệt
cỏ–đường đất ≥15%, điểm ảnh cháy sáng ≤5% theo docs/10; kiểm tra validator nếu dữ liệu template đổi.
