-- إنشاء قاعدة البيانات
CREATE DATABASE IF NOT EXISTS yemen_lands;
USE yemen_lands;

-- جدول الأراضي
CREATE TABLE IF NOT EXISTS lands (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    province VARCHAR(100),
    area DECIMAL(15, 2),
    centerLat DECIMAL(10, 8),
    centerLng DECIMAL(11, 8),
    points JSON NOT NULL,
    holderName VARCHAR(255),
    holderPhone VARCHAR(20),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_province (province),
    INDEX idx_created_at (created_at)
);

-- جدول ملفات الأراضي
CREATE TABLE IF NOT EXISTS land_files (
    id INT AUTO_INCREMENT PRIMARY KEY,
    land_id INT NOT NULL,
    file_name VARCHAR(255) NOT NULL,
    file_path VARCHAR(500) NOT NULL,
    file_size BIGINT,
    file_type VARCHAR(50),
    uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (land_id) REFERENCES lands(id) ON DELETE CASCADE,
    INDEX idx_land_id (land_id)
);

