// Chỉ để script điểm-vào đóng được kết nối. Import thẳng "@/lib/db/prisma" từ
// scripts/ cũng được, nhưng alias "@/" không dùng được ngoài Next ở mọi cấu
// hình tsx, nên đường tương đối đi qua đây.
export { prisma } from "@/lib/db/prisma";
