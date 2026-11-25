CREATE DATABASE IF NOT EXISTS toko_pancing
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE toko_pancing;

CREATE TABLE IF NOT EXISTS products (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  category ENUM('Joran','Reel','Senar','Umpan','Aksesoris') NOT NULL,
  brand VARCHAR(100) NOT NULL,
  price INT NOT NULL,
  stock INT NOT NULL DEFAULT 0,
  description TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

INSERT INTO products (name, category, brand, price, stock, description) VALUES
  ('Joran Spinning Carbon 180cm', 'Joran', 'Shimano', 485000, 12, 'Joran spinning bahan carbon ringan untuk mancing galatama dan sungai.'),
  ('Reel Baitcasting 7.2:1 Gear Ratio', 'Reel', 'Daiwa', 720000, 8, 'Reel baitcasting halus dengan sistem rem magnetik presisi.'),
  ('Senar PE Braided X8 150m 20lb', 'Senar', 'Relix Nusantara', 135000, 30, 'Senar PE 8 lilitan kuat dan tahan gesekan karang.'),
  ('Umpan Minnow Floating 9cm 12g', 'Umpan', 'Rapala', 110000, 25, 'Lure minnow aksi renang agresif untuk predator air tawar dan laut.'),
  ('Joran Tegek Fiber 360cm', 'Joran', 'Oregon', 165000, 18, 'Joran tegek lentur dan ringan cocok untuk mancing nila dan mujair.'),
  ('Kotak Kail & Aksesoris Waterproof 2 Sisi', 'Aksesoris', 'Kenzi', 75000, 40, 'Tackle box tahan air dengan sekat fleksibel untuk kail, swivel, dan timah.');
