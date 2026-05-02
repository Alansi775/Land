const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS with proper configuration
app.use(cors({
    origin: '*',
    credentials: false,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'ngrok-skip-browser-warning', 'X-Requested-With'],
    optionsSuccessStatus: 200,
    maxAge: 3600
}));

// Explicit preflight handling
app.options('*', cors());

app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, '../')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ⚠️ CRITICAL: Validate Railway Database Configuration
const validateRailwayConfig = () => {
    const required = ['DB_HOST', 'DB_PORT', 'DB_USER', 'DB_PASSWORD', 'DB_NAME'];
    const missing = required.filter(key => !process.env[key]);
    
    if (missing.length > 0) {
        console.error('\n CRITICAL ERROR: Missing Railway database configuration');
        console.error('Missing variables:', missing.join(', '));
        console.error('Please configure .env with Railway credentials.');
        process.exit(1);
    }
    
    // ENFORCE: NOT localhost (force Railway only)
    if (process.env.DB_HOST === 'localhost' || process.env.DB_HOST === '127.0.0.1') {
        console.error('\n CRITICAL ERROR: DB_HOST cannot be localhost or 127.0.0.1!');
        console.error('This project uses ONLY Railway MySQL (tramway.proxy.rlwy.net)');
        console.error('Using local MySQL is forbidden to maintain data consistency.');
        process.exit(1);
    }
};

validateRailwayConfig();

// MySQL Connection Pool - RAILWAY ONLY (No fallbacks, no localhost)
const pool = mysql.createPool({
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT) || 28820,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    enableKeepAlive: true,
    keepAliveInitialDelayMs: 0
});

console.log('\n Railway MySQL Configuration:');
console.log(`   Host: ${process.env.DB_HOST}`);
console.log(`   Port: ${process.env.DB_PORT}`);
console.log(`   Database: ${process.env.DB_NAME}\n`);

// File Upload Configuration
const storage = multer.diskStorage({
    destination: async (req, file, cb) => {
        const uploadDir = 'uploads';
        try {
            await fs.mkdir(uploadDir, { recursive: true });
            cb(null, uploadDir);
        } catch (error) {
            cb(error);
        }
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
    fileFilter: (req, file, cb) => {
        const allowedTypes = /jpeg|jpg|png|pdf/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype);
        
        if (mimetype && extname) {
            return cb(null, true);
        } else {
            cb(new Error('نوع الملف غير مدعوم'));
        }
    }
});

// Initialize Database (Railway tables already exist, but ensure they're ready)
async function initDatabase() {
    try {
        const connection = await pool.getConnection();
        
        // Verify tables exist (Railway should already have them)
        // Create lands table if it doesn't exist
        await connection.query(`
            CREATE TABLE IF NOT EXISTS lands (
                id INT AUTO_INCREMENT PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                description TEXT,
                province VARCHAR(100),
                subRegion VARCHAR(100),
                cropType VARCHAR(100),
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
            )
        `);;

        // Add new columns if they don't exist
        try {
            await connection.query(`ALTER TABLE lands ADD COLUMN subRegion VARCHAR(100) AFTER province`);
        } catch (error) {
            // Column might already exist
        }

        try {
            await connection.query(`ALTER TABLE lands ADD COLUMN cropType VARCHAR(100) AFTER subRegion`);
        } catch (error) {
            // Column might already exist
        }

        try {
            await connection.query(`ALTER TABLE lands ADD COLUMN centerLat DECIMAL(10, 8) AFTER area`);
        } catch (error) {
            // Column might already exist
        }

        try {
            await connection.query(`ALTER TABLE lands ADD COLUMN centerLng DECIMAL(11, 8) AFTER centerLat`);
        } catch (error) {
            // Column might already exist
        }

        try {
            await connection.query(`ALTER TABLE lands ADD COLUMN holderName VARCHAR(255) AFTER points`);
        } catch (error) {
            // Column might already exist
        }

        try {
            await connection.query(`ALTER TABLE lands ADD COLUMN holderPhone VARCHAR(20) AFTER holderName`);
        } catch (error) {
            // Column might already exist
        }

        // Create land_files table
        await connection.query(`
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
            )
        `);

        connection.release();
        console.log(' Database initialized successfully');
    } catch (error) {
        console.error(' Database initialization error:', error);
    }
}

// API Routes

// Get all lands
app.get('/api/lands', async (req, res) => {
    try {
        const [lands] = await pool.query(`
            SELECT l.* 
            FROM lands l
            ORDER BY l.created_at DESC
        `);
        
        // Parse JSON points and get files for each land
        for (const land of lands) {
            try {
                if (typeof land.points === 'string') {
                    land.points = JSON.parse(land.points);
                }
            } catch (e) {
                console.error('Error parsing points for land', land.id, ':', e.message);
                land.points = [];
            }
            
            // Get files for this land
            const [files] = await pool.query('SELECT * FROM land_files WHERE land_id = ?', [land.id]);
            land.files = files;
        }
        
        res.json(lands);
    } catch (error) {
        console.error('Error in GET /api/lands:', error.message);
        res.status(500).json({ error: 'فشل في جلب البيانات' });
    }
});

// Get single land with files
app.get('/api/lands/:id', async (req, res) => {
    try {
        const [lands] = await pool.query('SELECT * FROM lands WHERE id = ?', [req.params.id]);
        
        if (lands.length === 0) {
            return res.status(404).json({ error: 'الأرض غير موجودة' });
        }
        
        const land = lands[0];
        try {
            if (typeof land.points === 'string') {
                land.points = JSON.parse(land.points);
            }
        } catch (e) {
            console.error('Error parsing points:', e);
            land.points = [];
        }
        
        // Get files
        const [files] = await pool.query('SELECT * FROM land_files WHERE land_id = ?', [req.params.id]);
        land.files = files;
        
        res.json(land);
    } catch (error) {
        console.error('Error fetching land:', error);
        res.status(500).json({ error: 'فشل في جلب البيانات' });
    }
});

// Create new land
app.post('/api/lands', async (req, res) => {
    const { name, description, province, area, centerLat, centerLng, points, holderName, holderPhone } = req.body;
    
    if (!name || !points || points.length < 3) {
        return res.status(400).json({ error: 'بيانات غير كاملة' });
    }
    
    try {
        const [result] = await pool.query(`
            INSERT INTO lands (name, description, province, area, centerLat, centerLng, points, holderName, holderPhone)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [name, description, province, area, centerLat, centerLng, JSON.stringify(points), holderName || null, holderPhone || null]);
        
        res.json({ message: 'تم حفظ الأرض بنجاح', id: result.insertId });
    } catch (error) {
        console.error('Error creating land:', error);
        res.status(500).json({ error: 'فشل في حفظ الأرض' });
    }
});

// Update land
app.put('/api/lands/:id', async (req, res) => {
    const { name, description, province, area, centerLat, centerLng, points, holderName, holderPhone, subRegion, cropType } = req.body;
    
    try {
        await pool.query(`
            UPDATE lands 
            SET name = ?, description = ?, province = ?, subRegion = ?, cropType = ?, area = ?, centerLat = ?, centerLng = ?, points = ?, holderName = ?, holderPhone = ?
            WHERE id = ?
        `, [name, description, province, subRegion || null, cropType || null, area, centerLat, centerLng, JSON.stringify(points), holderName || null, holderPhone || null, req.params.id]);
        
        // Fetch and return the updated land data
        const [updatedLand] = await pool.query('SELECT * FROM lands WHERE id = ?', [req.params.id]);
        
        if (updatedLand.length > 0) {
            const land = updatedLand[0];
            const [files] = await pool.query('SELECT * FROM land_files WHERE land_id = ?', [req.params.id]);
            
            // Parse JSON fields safely
            try {
                land.points = typeof land.points === 'string' ? JSON.parse(land.points) : land.points;
            } catch (parseError) {
                console.warn('Could not parse points JSON:', parseError);
                land.points = [];
            }
            land.files = files;
            
            res.json({ message: 'تم تحديث الأرض بنجاح', land });
        } else {
            res.status(404).json({ error: 'الأرض غير موجودة' });
        }
    } catch (error) {
        console.error('Error updating land:', error);
        res.status(500).json({ error: 'فشل في تحديث الأرض' });
    }
});

// Delete land
app.delete('/api/lands/:id', async (req, res) => {
    try {
        // Get associated files to delete from filesystem
        const [files] = await pool.query('SELECT file_path FROM land_files WHERE land_id = ?', [req.params.id]);
        
        // Delete files from filesystem
        for (const file of files) {
            try {
                await fs.unlink(file.file_path);
            } catch (err) {
                console.error('Error deleting file:', err);
            }
        }
        
        // Delete from database (cascade will delete land_files)
        await pool.query('DELETE FROM lands WHERE id = ?', [req.params.id]);
        
        res.json({ message: 'تم حذف الأرض بنجاح' });
    } catch (error) {
        console.error('Error deleting land:', error);
        res.status(500).json({ error: 'فشل في حذف الأرض' });
    }
});

// Upload files for a land
app.post('/api/lands/:id/files', upload.array('files', 10), async (req, res) => {
    try {
        const landId = req.params.id;
        const files = req.files;
        
        console.log(`📁 طلب رفع ملفات للأرض ${landId}`);
        console.log(` عدد الملفات: ${files ? files.length : 0}`);
        console.log(` الملفات:`, files);
        
        if (!files || files.length === 0) {
            console.warn('⚠️ لم يتم استقبال أي ملفات');
            return res.status(400).json({ error: 'لم يتم رفع أي ملفات' });
        }
        
        const fileRecords = [];
        
        for (const file of files) {
            console.log(`💾 حفظ الملف: ${file.originalname} (${file.size} bytes)`);
            const [result] = await pool.query(`
                INSERT INTO land_files (land_id, file_name, file_path, file_size, file_type)
                VALUES (?, ?, ?, ?, ?)
            `, [landId, file.originalname, file.path, file.size, file.mimetype]);
            
            console.log(` تم حفظ الملف بـ ID: ${result.insertId}`);
            
            fileRecords.push({
                id: result.insertId,
                name: file.originalname,
                path: file.path,
                size: file.size,
                type: file.mimetype
            });
        }
        
        console.log(`🎉 تم رفع جميع الملفات بنجاح: ${fileRecords.length}`);
        res.json({ message: 'تم رفع الملفات بنجاح', files: fileRecords });
    } catch (error) {
        console.error(' خطأ في رفع الملفات:', error);
        res.status(500).json({ error: 'فشل في رفع الملفات', details: error.message });
    }
});

// Get file (download/view)
app.get('/api/files/:id', async (req, res) => {
    try {
        const [files] = await pool.query('SELECT file_path, file_name, file_type FROM land_files WHERE id = ?', [req.params.id]);
        
        if (files.length === 0) {
            console.warn(`⚠️ File not found: ${req.params.id}`);
            return res.status(404).json({ error: 'الملف غير موجود' });
        }
        
        const filePath = files[0].file_path;
        const fileName = files[0].file_name;
        const fileType = files[0].file_type;
        
        console.log(`📥 Accessing file: ${filePath}, Type: ${fileType}`);
        
        // Check if file exists
        try {
            await fs.access(filePath);
        } catch (err) {
            console.error(` File not found on disk: ${filePath}`);
            return res.status(404).json({ error: 'الملف غير موجود في النظام' });
        }
        
        // For images and PDFs, stream the file for viewing
        const ext = fileName.split('.').pop().toLowerCase();
        const isImage = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(ext);
        const isPdf = ext === 'pdf';
        
        if (isImage) {
            // Serve image inline with proper headers
            res.setHeader('Content-Type', fileType || 'image/jpeg');
            res.setHeader('Cache-Control', 'public, max-age=3600');
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
            res.setHeader('X-Content-Type-Options', 'nosniff');
            res.sendFile(path.resolve(filePath), {
                headers: {
                    'Content-Type': fileType || 'image/jpeg'
                }
            });
        } else if (isPdf) {
            // Serve PDF inline
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', 'inline; filename=' + fileName);
            res.setHeader('Cache-Control', 'public, max-age=3600');
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
            res.sendFile(path.resolve(filePath), {
                headers: {
                    'Content-Type': 'application/pdf'
                }
            });
        } else {
            // Download for other files
            res.download(filePath, fileName);
        }
    } catch (error) {
        console.error(' Error accessing file:', error);
        res.status(500).json({ error: 'خطأ في تحميل الملف' });
    }
});

// Delete file
app.delete('/api/files/:id', async (req, res) => {
    try {
        const [files] = await pool.query('SELECT file_path FROM land_files WHERE id = ?', [req.params.id]);
        
        if (files.length === 0) {
            return res.status(404).json({ error: 'الملف غير موجود' });
        }
        
        // Delete from filesystem
        try {
            await fs.unlink(files[0].file_path);
        } catch (err) {
            console.error('Error deleting file from filesystem:', err);
        }
        
        // Delete from database
        await pool.query('DELETE FROM land_files WHERE id = ?', [req.params.id]);
        
        res.json({ message: 'تم حذف الملف بنجاح' });
    } catch (error) {
        console.error('Error deleting file:', error);
        res.status(500).json({ error: 'فشل في حذف الملف' });
    }
});



// Delete specific file for a land
app.delete('/api/lands/:landId/files/:fileId', async (req, res) => {
    try {
        const [files] = await pool.query('SELECT file_path FROM land_files WHERE id = ? AND land_id = ?', [req.params.fileId, req.params.landId]);
        
        if (files.length === 0) {
            return res.status(404).json({ error: 'الملف غير موجود' });
        }
        
        // Delete from filesystem
        try {
            await fs.unlink(files[0].file_path);
        } catch (err) {
            console.error('Error deleting file from filesystem:', err);
        }
        
        // Delete from database
        await pool.query('DELETE FROM land_files WHERE id = ? AND land_id = ?', [req.params.fileId, req.params.landId]);
        
        res.json({ message: 'تم حذف الملف بنجاح' });
    } catch (error) {
        console.error('Error deleting file:', error);
        res.status(500).json({ error: 'فشل في حذف الملف' });
    }
});

// Search lands
app.get('/api/lands/search/:query', async (req, res) => {
    try {
        const query = `%${req.params.query}%`;
        const [lands] = await pool.query(`
            SELECT * FROM lands 
            WHERE name LIKE ? OR province LIKE ? OR description LIKE ?
            ORDER BY created_at DESC
        `, [query, query, query]);
        
        lands.forEach(land => {
            land.points = JSON.parse(land.points);
        });
        
        res.json(lands);
    } catch (error) {
        console.error('Error searching lands:', error);
        res.status(500).json({ error: 'فشل في البحث' });
    }
});

// Get statistics
app.get('/api/stats', async (req, res) => {
    try {
        const [totalLands] = await pool.query('SELECT COUNT(*) as count FROM lands');
        const [totalArea] = await pool.query('SELECT SUM(area) as total FROM lands');
        const [byProvince] = await pool.query(`
            SELECT province, COUNT(*) as count, SUM(area) as total_area
            FROM lands
            GROUP BY province
        `);
        
        res.json({
            totalLands: totalLands[0].count,
            totalArea: totalArea[0].total || 0,
            byProvince: byProvince
        });
    } catch (error) {
        console.error('Error getting stats:', error);
        res.status(500).json({ error: 'فشل في جلب الإحصائيات' });
    }
});

// Error handling middleware
app.use((error, req, res, next) => {
    console.error('Server error:', error);
    res.status(500).json({ error: error.message || 'حدث خطأ في الخادم' });
});

//  VALIDATION ENDPOINT: Test Railway MySQL Connection
app.get('/api/health/railway', async (req, res) => {
    try {
        const connection = await pool.getConnection();
        
        // Test 1: Verify we can query the database
        const [databases] = await connection.query('SELECT DATABASE() as current_db');
        
        // Test 2: Count existing lands
        const [landCount] = await connection.query('SELECT COUNT(*) as count FROM lands');
        
        // Test 3: Get table info
        const [tableInfo] = await connection.query(
            "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME IN ('lands', 'land_files')",
            [process.env.DB_NAME]
        );
        
        connection.release();
        
        return res.json({
            status: 'connected',
            database: databases[0]?.current_db,
            railway_configured: process.env.DB_HOST,
            lands_count: landCount[0]?.count || 0,
            tables: tableInfo.map(t => t.TABLE_NAME),
            message: ' Successfully connected to Railway MySQL'
        });
    } catch (error) {
        console.error('Railway connection test failed:', error);
        res.status(500).json({
            status: 'error',
            error: error.message,
            db_host: process.env.DB_HOST,
            message: ' Failed to connect to Railway MySQL'
        });
    }
});

//  TEST ENDPOINT: Insert test record and verify it's in Railway
app.post('/api/health/test-insert', async (req, res) => {
    let testId = null;
    try {
        const connection = await pool.getConnection();
        
        // Test insert
        const testData = {
            name: 'Test Land - Railway Validation',
            description: 'This is a test record to verify Railway connection',
            province: 'تعز',
            area: 100,
            centerLat: 14.465,
            centerLng: 44.590,
            points: JSON.stringify([[14.465, 44.590], [14.466, 44.591]]),
            createdAt: new Date().toISOString()
        };
        
        const [insertResult] = await connection.query(
            'INSERT INTO lands (name, description, province, area, centerLat, centerLng, points, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, NOW())',
            [testData.name, testData.description, testData.province, testData.area, testData.centerLat, testData.centerLng, testData.points]
        );
        
        testId = insertResult.insertId;
        
        // Test read back
        const [verifyResult] = await connection.query('SELECT * FROM lands WHERE id = ?', [testId]);
        
        connection.release();
        
        if (verifyResult.length > 0) {
            return res.json({
                status: 'success',
                message: ' Test record inserted and retrieved successfully from Railway',
                inserted_id: testId,
                record: verifyResult[0]
            });
        } else {
            return res.status(500).json({
                status: 'error',
                message: ' Record inserted but could not be retrieved',
                inserted_id: testId
            });
        }
    } catch (error) {
        console.error('Test insert failed:', error);
        res.status(500).json({
            status: 'error',
            message: ' Failed to test Railway connection',
            error: error.message,
            test_id: testId
        });
    }
});

// Start Server
async function startServer() {
    try {
        await initDatabase();
        
        app.listen(PORT, () => {
            console.log(`\n Server running on http://localhost:${PORT}`);
            console.log(` API available at http://localhost:${PORT}/api`);
            console.log(`\n Database: Railway MySQL (${process.env.DB_HOST})`);
            console.log(` Health check: http://localhost:${PORT}/api/health/railway\n`);
        });
    } catch (error) {
        console.error('Failed to start server:', error);
        process.exit(1);
    }
}

startServer();

module.exports = app;