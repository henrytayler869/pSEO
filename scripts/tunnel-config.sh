# Định nghĩa DUY NHẤT về đường tới VPS.
#
# Cả db-tunnel.sh, wp-tunnel.sh và trình sinh LaunchAgent đều đọc từ đây. Có
# hai bản là có một bản sai vào lần đầu ai đó đổi VPS — và bản sai sẽ là bản
# chạy nền, thứ không ai nhìn.
VPS_HOST="${VPS_HOST:-46.225.145.196}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/id_ed25519}"

# Người dùng SSH khác nhau giữa hai tunnel, giữ nguyên như cũ.
DB_SSH_USER="${DB_SSH_USER:-deploy}"
WP_SSH_USER="${WP_SSH_USER:-root}"

# Cổng. DB cố tình LỆCH (55433 <- 5433) vì tồn tại hai database và URL trùng
# số thì không phân biệt được. WordPress SOI GƯƠNG (8090 <- 8090) vì chỉ có
# một WordPress, và soi gương khiến wpApiBaseUrl trong database chạy nguyên
# vẹn ở cả VPS lẫn máy cá nhân. Lý do đầy đủ nằm trong đầu mỗi script.
DB_LOCAL_PORT="${DB_LOCAL_PORT:-55433}"
DB_REMOTE_PORT="${DB_REMOTE_PORT:-5433}"
WP_LOCAL_PORT="${WP_LOCAL_PORT:-8090}"
WP_REMOTE_PORT="${WP_REMOTE_PORT:-8090}"
