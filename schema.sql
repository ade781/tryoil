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
  ('Joran Spinning Carbon 180cm 8-17lb', 'Joran', 'Shimano', 485000, 12, 'Joran spinning blank carbon IM7 ringan, cocok untuk mancing galatama patin dan sungai.'),
  ('Joran Tegek Fiber Lentur 360cm', 'Joran', 'Oregon', 165000, 18, 'Joran tegek ruas pendek ringan dan lentur, ideal untuk nila, mujair, dan wader.'),
  ('Joran Jigging Overhead PE 2-4', 'Joran', 'Daiwa', 1150000, 5, 'Joran jigging laut dalam dengan ring Fuji Alconite dan backbone kuat.'),
  ('Joran Ultralight 198cm 2-6lb', 'Joran', 'Relix Nusantara', 420000, 9, 'Joran UL sensitif untuk casting gabus, hampala, dan micro jigging.'),
  ('Reel Baitcasting 7.2:1 Gear Ratio', 'Reel', 'Daiwa', 720000, 8, 'Reel baitcasting halus dengan sistem rem magnetik presisi dan drag 6 kg.'),
  ('Reel Spinning 3000HG Power Handle', 'Reel', 'Shimano', 890000, 10, 'Reel spinning spool aluminium dengan 5+1 ball bearing tahan air asin.'),
  ('Reel Spinning Ekonomis 2000 8BB', 'Reel', 'Kenzi', 235000, 22, 'Reel harian serbaguna dengan putaran ringan untuk kolam dan rawa.'),
  ('Reel Trolling Laut Dalam 50W', 'Reel', 'Penn', 2450000, 3, 'Reel heavy duty full metal body untuk target tuna dan marlin.'),
  ('Senar PE Braided X8 150m 20lb', 'Senar', 'Relix Nusantara', 135000, 30, 'Senar PE 8 lilitan halus, minim gesekan ring, dan tahan karang.'),
  ('Senar Fluorocarbon Leader 30m 25lb', 'Senar', 'Seaguar', 145000, 24, 'Senar leader hampir tidak terlihat di air jernih dan tahan gigitan predator.'),
  ('Senar Monofilament Galatama 300m 0.28mm', 'Senar', 'Daiwa', 95000, 35, 'Senar nilon cepat tenggelam dengan kekuatan simpul tinggi.'),
  ('Umpan Minnow Floating 9cm 12g', 'Umpan', 'Rapala', 110000, 25, 'Lure minnow aksi renang agresif untuk barramundi, kakap, dan toman.'),
  ('Soft Frog Umpan Gabus 5.5cm 10g', 'Umpan', 'Relix Nusantara', 45000, 40, 'Umpan karet anti sangkut dengan double hook tajam untuk spot semak.'),
  ('Metal Jig Slow Pitch 60g Glow', 'Umpan', 'Storm', 78000, 28, 'Metal jig berlapis cat fosfor menyala di air dalam lengkap dengan assist hook.'),
  ('Pelet Umpan Essen Ikan Mas 500g', 'Umpan', 'Djempol', 32000, 50, 'Umpan racikan siap pakai beraroma amis wangi untuk lomba pelampungan.'),
  ('Kotak Kail & Aksesoris Waterproof 2 Sisi', 'Aksesoris', 'Kenzi', 75000, 40, 'Tackle box tahan air dengan sekat fleksibel untuk kail, swivel, dan timah.'),
  ('Tang Split Ring & Pemotong PE Stainless', 'Aksesoris', 'Shimano', 125000, 15, 'Tang multifungsi anti karat untuk membuka split ring dan memotong senar PE.'),
  ('Lip Grip Penjepit Ikan Digital 15kg', 'Aksesoris', 'Rapala', 210000, 11, 'Penjepit bibir ikan dengan timbangan terintegrasi dan tali pengaman.');
