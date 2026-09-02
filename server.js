const express = require('express');
const { poolPromise } = require('./db');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.set('views', './views');
app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
const session = require('express-session');

// Cấu hình Session (Bộ nhớ lưu trạng thái đăng nhập)
app.use(session({
    secret: 'koicafe-super-secret-key',
    resave: false,
    saveUninitialized: true
}));

// ==========================================
// TẠO "NGƯỜI GÁC CỔNG" (GLOBAL MIDDLEWARE)
// ==========================================
app.use((req, res, next) => {
    // 1. Phân loại các khu vực nhạy cảm
    const adminPaths = ['/dashboard', '/employees', '/products', '/vouchers', '/invoices'];
    
    // 2. Cho phép vào tự do: Trang chủ khách (/), Đăng nhập, và các API gọi ngầm
    if (req.path === '/' || req.path === '/login' || req.path === '/logout' || req.path.startsWith('/api') || req.path.includes('.')) {
        return next();
    }

    // 3. Chặn kẻ lạ: Chưa đăng nhập mà đòi vào phần mềm -> Đẩy ra trang Login
    if (!req.session.user) {
        return res.redirect('/login');
    }

    // 4. Chống lạm quyền: Nếu là Nhân viên mà cố tình vào trang của Admin -> Chặn lại
    if (adminPaths.some(path => req.path.startsWith(path)) && req.session.user.vaiTro !== 'Admin') {
        return res.send(`
            <div style="text-align:center; padding-top: 50px; font-family: sans-serif;">
                <h1 style="color: red; font-size: 50px;">🛑</h1>
                <h2 style="color: red;">BẠN KHÔNG CÓ QUYỀN TRUY CẬP TRANG NÀY!</h2>
                <p>Khu vực này chỉ dành riêng cho Quản trị viên (Admin).</p>
                <br>
                <a href="/pos" style="padding: 12px 25px; background: #28a745; color: white; text-decoration: none; border-radius: 8px; font-weight: bold;">Quay Về Máy Bán Hàng</a>
            </div>
        `);
    }

    // 5. Nếu hợp lệ: Cấp thẻ đi tiếp và truyền dữ liệu user cho Giao diện EJS
    res.locals.user = req.session.user;
    next();
});

// ==========================================
// API ĐĂNG NHẬP / ĐĂNG XUẤT
// ==========================================
app.get('/login', (req, res) => {
    res.render('login', { error: null });
});

app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const pool = await poolPromise;
        const result = await pool.request()
            .input('User', username)
            .input('Pass', password)
            .query("SELECT tk.*, nv.TenNV FROM TaiKhoan tk JOIN NhanVien nv ON tk.MaNV = nv.MaNV WHERE tk.TenDangNhap = @User AND tk.MatKhau = @Pass");
        
        if (result.recordset.length > 0) {
            // Lưu thông tin nhân viên vào Session
            req.session.user = {
                tenNV: result.recordset[0].TenNV,
                vaiTro: result.recordset[0].VaiTro,
                username: result.recordset[0].TenDangNhap
            };
            // Điều hướng theo quyền
            if(req.session.user.vaiTro === 'Admin') res.redirect('/dashboard');
            else res.redirect('/pos');
        } else {
            res.render('login', { error: 'Tên đăng nhập hoặc mật khẩu không chính xác!' });
        }
    } catch (err) { res.send('Lỗi máy chủ khi đăng nhập!'); }
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/login');
});
// ==========================================
// ==========================================
//        // ==========================================
//        1. GIAO DIỆN KHÁCH HÀNG (MỚI)
// ==========================================

// 1.1 Trang chủ (Hiển thị Top 4 Bán Chạy, Giới thiệu)
app.get('/', async (req, res) => {
    try {
        const pool = await poolPromise;
        // Lấy Top 4 món bán chạy nhất dựa trên tổng số lượng trong ChiTietHoaDon
        const topProducts = await pool.request().query(`
            SELECT TOP 4 sp.MaSP, sp.TenSP, sp.DonGia, sp.HinhAnh, dm.TenDM,
                   ISNULL(SUM(ct.SoLuong), 0) as TongBan
            FROM SanPham sp
            LEFT JOIN DanhMuc dm ON sp.MaDM = dm.MaDM
            LEFT JOIN ChiTietHoaDon ct ON sp.MaSP = ct.MaSP
            WHERE sp.TrangThai = 1
            GROUP BY sp.MaSP, sp.TenSP, sp.DonGia, sp.HinhAnh, dm.TenDM
            ORDER BY TongBan DESC, sp.MaSP ASC
        `);
        res.render('index', { topProducts: topProducts.recordset });
    } catch (err) {
        console.error(err);
        res.send('Lỗi tải trang chủ!');
    }
});

// 1.2 Trang Thực Đơn (Hiển thị toàn bộ món chia theo danh mục)
app.get('/menu', async (req, res) => {
    try {
        const pool = await poolPromise;
        const products = await pool.request().query(`
            SELECT sp.MaSP, sp.TenSP, sp.DonGia, sp.HinhAnh, dm.TenDM 
            FROM SanPham sp 
            LEFT JOIN DanhMuc dm ON sp.MaDM = dm.MaDM 
            WHERE sp.TrangThai = 1
            ORDER BY dm.TenDM ASC, sp.TenSP ASC
        `);
        const categories = await pool.request().query('SELECT * FROM DanhMuc');
        res.render('menu', { products: products.recordset, categories: categories.recordset });
    } catch (err) {
        res.send('Lỗi tải trang thực đơn!');
    }
});

// ==========================================
//        2. ĐĂNG NHẬP
// ==========================================
app.get('/login', (req, res) => { res.render('login'); });
app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const pool = await poolPromise;
        const result = await pool.request()
            .input('TenDangNhap', username)
            .input('MatKhau', password)
            .query('SELECT * FROM TaiKhoan WHERE TenDangNhap = @TenDangNhap AND MatKhau = @MatKhau');

        if (result.recordset.length > 0) {
            const user = result.recordset[0];
            res.redirect(`/dashboard?role=${user.VaiTro}&username=${user.TenDangNhap}`);
        } else {
            res.render('login', { error: 'Tên đăng nhập hoặc mật khẩu không chính xác!' });
        }
    } catch (err) { res.render('login', { error: 'Lỗi kết nối hệ thống.' }); }
});

// ==========================================
//       // ==========================================
//        3. DASHBOARD (THỐNG KÊ KINH DOANH)
// ==========================================
app.get('/dashboard', async (req, res) => {
    const role = req.query.role || 'Admin';
    const username = req.query.username || 'Admin';

    try {
        const pool = await poolPromise;
        
        // 1. Thống kê số liệu tổng quan (Cũ)
        const doanhThuResult = await pool.request().query(`SELECT ISNULL(SUM(TongTien), 0) AS TongDoanhThu FROM HoaDon WHERE TrangThai = N'Đã thanh toán'`);
        const soDonResult = await pool.request().query(`SELECT COUNT(MaHD) AS SoDon FROM HoaDon WHERE TrangThai = N'Đã thanh toán'`);
        const banTrongResult = await pool.request().query(`SELECT COUNT(MaBan) AS BanTrong FROM Ban WHERE TrangThai = N'Trong'`);
        const monAnResult = await pool.request().query(`SELECT COUNT(MaSP) AS TongMon FROM SanPham WHERE TrangThai = 1`);

        // 2. Dữ liệu Biểu đồ: 5 Sản phẩm bán chạy nhất
        const topProducts = await pool.request().query(`
            SELECT TOP 5 sp.TenSP, SUM(ct.SoLuong) as TongSoLuong
            FROM ChiTietHoaDon ct
            JOIN SanPham sp ON ct.MaSP = sp.MaSP
            JOIN HoaDon hd ON ct.MaHD = hd.MaHD
            WHERE hd.TrangThai = N'Đã thanh toán'
            GROUP BY sp.TenSP
            ORDER BY TongSoLuong DESC
        `);

        // 3. Dữ liệu Biểu đồ: Doanh thu theo Nhân viên
        const nvRevenue = await pool.request().query(`
            SELECT nv.TenNV, ISNULL(SUM(hd.TongTien), 0) as DoanhThu
            FROM NhanVien nv
            LEFT JOIN HoaDon hd ON nv.MaNV = hd.MaNV AND hd.TrangThai = N'Đã thanh toán'
            GROUP BY nv.TenNV
        `);

        res.render('dashboard', { 
            role, username, 
            doanhThu: doanhThuResult.recordset[0].TongDoanhThu,
            soDon: soDonResult.recordset[0].SoDon,
            banTrong: banTrongResult.recordset[0].BanTrong,
            tongMon: monAnResult.recordset[0].TongMon,
            
            // Gửi cục data dạng JSON xuống Front-end để vẽ biểu đồ
            chartDataProducts: JSON.stringify(topProducts.recordset),
            chartDataRevenue: JSON.stringify(nvRevenue.recordset)
        });
    } catch (err) {
        console.log(err);
        res.send('Lỗi tải bảng điều khiển!');
    }
});
// ==========================================
//        4. BÀN
// ==========================================
app.get('/tables', async (req, res) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request().query('SELECT * FROM Ban ORDER BY MaBan ASC');
        res.render('tables', { tables: result.recordset });
    } catch (err) { res.send('Lỗi!'); }
});
app.post('/tables/add', async (req, res) => {
    try {
        const pool = await poolPromise;
        await pool.request().input('TenBan', req.body.tenBan).query("INSERT INTO Ban (TenBan, TrangThai) VALUES (@TenBan, N'Trong')");
        res.redirect('/tables');
    } catch (err) { res.send('Lỗi!'); }
});
// Thêm bàn mới (Đã nâng cấp có phân khu vực)
app.post('/tables/add', async (req, res) => {
    try {
        const pool = await poolPromise;
        await pool.request()
            .input('TenBan', req.body.tenBan)
            .input('KhuVuc', req.body.khuVuc)
            .query(`INSERT INTO Ban (TenBan, TrangThai, KhuVuc) VALUES (@TenBan, N'Trong', @KhuVuc)`);
        res.redirect('/tables');
    } catch (err) {
        console.error('Lỗi tạo bàn:', err);
        res.send('Lỗi thêm bàn mới!');
    }
});
// Cập nhật Tên bàn và Khu vực
app.post('/tables/edit', async (req, res) => {
    try {
        const pool = await poolPromise;
        await pool.request()
            .input('MaBan', req.body.maBan)
            .input('TenBan', req.body.tenBan)
            .input('KhuVuc', req.body.khuVuc)
            .query(`UPDATE Ban SET TenBan = @TenBan, KhuVuc = @KhuVuc WHERE MaBan = @MaBan`);
        res.redirect('/tables');
    } catch (err) {
        console.error('Lỗi sửa bàn:', err);
        res.send('Lỗi cập nhật thông tin bàn!');
    }
});
// ==========================================
// API CHUYỂN BÀN
// ==========================================
app.post('/tables/transfer', async (req, res) => {
    const { maBanCu, maBanMoi } = req.body;
    
    try {
        const pool = await poolPromise;
        
        // 1. Kiểm tra an toàn: Bàn mới phải đang "Trống" mới được chuyển tới
        const checkBanMoi = await pool.request()
            .input('MaBan', maBanMoi)
            .query("SELECT TrangThai FROM Ban WHERE MaBan = @MaBan");
            
        if (checkBanMoi.recordset[0].TrangThai !== 'Trong') {
            return res.send('<script>alert("❌ Bàn mới đang có khách, không thể chuyển tới!"); window.location.href="/tables";</script>');
        }

        // 2. Chuyển Hóa đơn chưa thanh toán sang bàn mới (nếu có)
        await pool.request()
            .input('MaBanCu', maBanCu)
            .input('MaBanMoi', maBanMoi)
            .query(`
                UPDATE HoaDon 
                SET MaBan = @MaBanMoi 
                WHERE MaBan = @MaBanCu AND TrangThai = N'Chưa thanh toán'
            `);

        // 3. Giải phóng bàn cũ thành "Trống"
        await pool.request()
            .input('MaBanCu', maBanCu)
            .query("UPDATE Ban SET TrangThai = N'Trong' WHERE MaBan = @MaBanCu");

        // 4. Cập nhật bàn mới thành "Đang phục vụ"
        await pool.request()
            .input('MaBanMoi', maBanMoi)
            .query("UPDATE Ban SET TrangThai = N'Đang phục vụ' WHERE MaBan = @MaBanMoi");

        res.redirect('/tables');
    } catch (err) {
        console.error('Lỗi chuyển bàn:', err);
        res.send('Lỗi hệ thống khi chuyển bàn!');
    }
});
// ==========================================
// API GỘP BÀN
// ==========================================
app.post('/tables/merge', async (req, res) => {
    const { maBanCu, maBanMoi } = req.body;
    
    if (maBanCu === maBanMoi) {
        return res.send('<script>alert("❌ Không thể gộp cùng một bàn!"); window.location.href="/tables";</script>');
    }

    try {
        const pool = await poolPromise;
        
        // 1. Lấy Hóa đơn chưa thanh toán của Bàn Cũ và Bàn Mới
        const hdCu = await pool.request().input('MaBan', maBanCu).query("SELECT MaHD, TongTien FROM HoaDon WHERE MaBan = @MaBan AND TrangThai = N'Chưa thanh toán'");
        const hdMoi = await pool.request().input('MaBan', maBanMoi).query("SELECT MaHD, TongTien FROM HoaDon WHERE MaBan = @MaBan AND TrangThai = N'Chưa thanh toán'");

        if (hdCu.recordset.length > 0) {
            if (hdMoi.recordset.length > 0) {
                // TRƯỜNG HỢP A: Cả 2 bàn đều có Hóa đơn -> Phải gộp chi tiết lại
                const maHDCu = hdCu.recordset[0].MaHD;
                const maHDMoi = hdMoi.recordset[0].MaHD;
                const tienCu = hdCu.recordset[0].TongTien || 0;

                // - Chuyển món ăn sang Hóa đơn mới
                await pool.request().input('MaHDCu', maHDCu).input('MaHDMoi', maHDMoi)
                    .query("UPDATE ChiTietHoaDon SET MaHD = @MaHDMoi WHERE MaHD = @MaHDCu");
                // - Cộng dồn tiền
                await pool.request().input('MaHDMoi', maHDMoi).input('TienCu', tienCu)
                    .query("UPDATE HoaDon SET TongTien = TongTien + @TienCu WHERE MaHD = @MaHDMoi");
                // - Xóa hóa đơn cũ
                await pool.request().input('MaHDCu', maHDCu).query("DELETE FROM HoaDon WHERE MaHD = @MaHDCu");
            } else {
                // TRƯỜNG HỢP B: Bàn mới chưa gọi món -> Chỉ cần đổi Mã bàn của Hóa đơn cũ
                await pool.request().input('MaBanMoi', maBanMoi).input('MaHDCu', hdCu.recordset[0].MaHD)
                    .query("UPDATE HoaDon SET MaBan = @MaBanMoi WHERE MaHD = @MaHDCu");
            }
        }

        // 2. Cập nhật trạng thái 2 Bàn
        await pool.request().input('MaBanCu', maBanCu).query("UPDATE Ban SET TrangThai = N'Trong' WHERE MaBan = @MaBanCu");
        await pool.request().input('MaBanMoi', maBanMoi).query("UPDATE Ban SET TrangThai = N'Đang phục vụ' WHERE MaBan = @MaBanMoi");

        res.redirect('/tables');
    } catch (err) {
        console.error('Lỗi gộp bàn:', err);
        res.send('Lỗi hệ thống khi gộp bàn!');
    }
});
// ==========================================
//        5. DANH MỤC
// ==========================================
app.get('/categories', async (req, res) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request().query('SELECT * FROM DanhMuc ORDER BY MaDM ASC');
        res.render('categories', { categories: result.recordset });
    } catch (err) { res.send('Lỗi!'); }
});
app.post('/categories/add', async (req, res) => {
    try {
        const pool = await poolPromise;
        await pool.request().input('TenDM', req.body.tenDM).input('MoTa', req.body.moTa).query('INSERT INTO DanhMuc (TenDM, MoTa) VALUES (@TenDM, @MoTa)');
        res.redirect('/categories');
    } catch (err) { res.send('Lỗi!'); }
});

// ==========================================
//        6. SẢN PHẨM
// ==========================================
app.get('/products', async (req, res) => {
    try {
        const pool = await poolPromise;
        const products = await pool.request().query(`SELECT sp.*, dm.TenDM FROM SanPham sp LEFT JOIN DanhMuc dm ON sp.MaDM = dm.MaDM ORDER BY sp.MaSP DESC`);
        const categories = await pool.request().query('SELECT * FROM DanhMuc');
        res.render('products', { products: products.recordset, categories: categories.recordset });
    } catch (err) { res.send('Lỗi!'); }
});
app.post('/products/add', async (req, res) => {
    try {
        const pool = await poolPromise;
        // Lấy dữ liệu, nếu khách không nhập link ảnh thì lấy ảnh mặc định
        let linkAnh = req.body.hinhAnh || 'https://images.unsplash.com/photo-1509042239860-f550ce710b93?q=80&w=200';
        
        await pool.request()
            .input('TenSP', req.body.tenSP)
            .input('DonGia', req.body.donGia)
            .input('MaDM', req.body.maDM)
            .input('TrangThai', req.body.trangThai)
            .input('HinhAnh', linkAnh)
            .query('INSERT INTO SanPham (TenSP, DonGia, MaDM, TrangThai, HinhAnh) VALUES (@TenSP, @DonGia, @MaDM, @TrangThai, @HinhAnh)');
        res.redirect('/products');
    } catch (err) { res.send('Lỗi thêm sản phẩm!'); }
    
});
// Cập nhật thông tin và hình ảnh sản phẩm
app.post('/products/edit', async (req, res) => {
    try {
        const pool = await poolPromise;
        await pool.request()
            .input('MaSP', req.body.maSP)
            .input('TenSP', req.body.tenSP)
            .input('DonGia', req.body.donGia)
            .input('MaDM', req.body.maDM)
            .input('TrangThai', req.body.trangThai)
            .input('HinhAnh', req.body.hinhAnh)
            .query(`
                UPDATE SanPham 
                SET TenSP = @TenSP, DonGia = @DonGia, MaDM = @MaDM, TrangThai = @TrangThai, HinhAnh = @HinhAnh 
                WHERE MaSP = @MaSP
            `);
        res.redirect('/products');
    } catch (err) {
        console.log(err);
        res.send('Lỗi cập nhật sản phẩm!');
    }
});
// Xóa sản phẩm
app.post('/products/delete', async (req, res) => {
    try {
        const pool = await poolPromise;
        await pool.request()
            .input('MaSP', req.body.maSP)
            .query('DELETE FROM SanPham WHERE MaSP = @MaSP');
        res.redirect('/products');
    } catch (err) {
        console.error('Lỗi xóa sản phẩm:', err);
        res.send('Lỗi: Không thể xóa sản phẩm đã có lịch sử đơn hàng. Hãy dùng chức năng "Ngừng Bán".');
    }
});
// ==========================================
// ==========================================
// ==========================================
// ==========================================
//        7. NHÂN SỰ & CẤP TÀI KHOẢN
// ==========================================

// --- PHẦN BỊ THIẾU: Hiển thị trang Nhân Sự ---
app.get('/employees', async (req, res) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request().query(`
            SELECT nv.*, tk.TenDangNhap, tk.VaiTro 
            FROM NhanVien nv 
            LEFT JOIN TaiKhoan tk ON nv.MaNV = tk.MaNV 
            ORDER BY nv.MaNV DESC
        `);
        res.render('employees', { employees: result.recordset });
    } catch (err) {
        console.error('Lỗi tải danh sách nhân viên:', err);
        res.send('Lỗi tải danh sách nhân viên!');
    }
});

// 1. Thêm nhân viên mới
app.post('/employees/add', async (req, res) => {
    try {
        const pool = await poolPromise;
        await pool.request()
            .input('TenNV', req.body.tenNV)
            .input('SoDienThoai', req.body.soDienThoai)
            .input('Email', req.body.email)
            .input('NgayVaoLam', req.body.ngayVaoLam)
            .input('ChucVu', req.body.chucVu)
            .query(`INSERT INTO NhanVien (TenNV, SoDienThoai, Email, NgayVaoLam, ChucVu) VALUES (@TenNV, @SoDienThoai, @Email, @NgayVaoLam, @ChucVu)`);
        res.redirect('/employees');
    } catch (err) { res.send('Lỗi thêm nhân viên!'); }
});

// 2. Sửa thông tin & Chức vụ nhân viên
app.post('/employees/edit', async (req, res) => {
    try {
        const pool = await poolPromise;
        await pool.request()
            .input('MaNV', req.body.maNV)
            .input('TenNV', req.body.tenNV)
            .input('SoDienThoai', req.body.soDienThoai)
            .input('ChucVu', req.body.chucVu)
            .query(`UPDATE NhanVien SET TenNV = @TenNV, SoDienThoai = @SoDienThoai, ChucVu = @ChucVu WHERE MaNV = @MaNV`);
        res.redirect('/employees');
    } catch (err) { 
        // Thêm dòng lệnh này để "bắt tận tay" lỗi
        console.log("=== LỖI SỬA NHÂN VIÊN ===", err); 
        res.send('Lỗi sửa nhân viên!'); 
    }
});

// 2.5 Xóa Nhân Viên
app.post('/employees/delete', async (req, res) => {
    try {
        const pool = await poolPromise;
        // Xóa tài khoản liên kết trước (nếu có) do ràng buộc khóa ngoại
        await pool.request().input('MaNV', req.body.maNV).query('DELETE FROM TaiKhoan WHERE MaNV = @MaNV');
        // Sau đó xóa nhân viên
        await pool.request().input('MaNV', req.body.maNV).query('DELETE FROM NhanVien WHERE MaNV = @MaNV');
        res.redirect('/employees');
    } catch (err) { 
        console.error('Lỗi xóa nhân viên:', err);
        res.send('Không thể xóa nhân viên này. Hãy chắc chắn họ không bị ràng buộc bởi dữ liệu khác (ví dụ: người lập hóa đơn).'); 
    }
});

// 3. Cấp tài khoản đăng nhập cho nhân viên
app.post('/employees/create-account', async (req, res) => {
    const { maNV, tenDangNhap, matKhau, vaiTro } = req.body;
    try {
        const pool = await poolPromise;
        const check = await pool.request().input('MaNV', maNV).query('SELECT * FROM TaiKhoan WHERE MaNV = @MaNV');
        
        if (check.recordset.length > 0) {
            await pool.request()
                .input('MaNV', maNV)
                .input('TenDangNhap', tenDangNhap)
                .input('MatKhau', matKhau)
                .input('VaiTro', vaiTro)
                .query(`UPDATE TaiKhoan SET TenDangNhap = @TenDangNhap, MatKhau = @MatKhau, VaiTro = @VaiTro WHERE MaNV = @MaNV`);
        } else {
            await pool.request()
                .input('MaNV', maNV)
                .input('TenDangNhap', tenDangNhap)
                .input('MatKhau', matKhau)
                .input('VaiTro', vaiTro)
                .query(`INSERT INTO TaiKhoan (MaNV, TenDangNhap, MatKhau, VaiTro) VALUES (@MaNV, @TenDangNhap, @MatKhau, @VaiTro)`);
        }
        res.redirect('/employees');
    } catch (err) {
        res.send('Lỗi cấp tài khoản (Có thể Tên đăng nhập đã bị trùng)!');
    }
});

// ==========================================
//        8. POS (BÁN HÀNG TẠI QUÁN)
// ==========================================
app.get('/pos', async (req, res) => {
    try {
        const pool = await poolPromise;
        const tablesResult = await pool.request().query('SELECT * FROM Ban ORDER BY MaBan ASC');
        const productsResult = await pool.request().query(`SELECT sp.MaSP, sp.TenSP, sp.DonGia, dm.TenDM FROM SanPham sp LEFT JOIN DanhMuc dm ON sp.MaDM = dm.MaDM WHERE sp.TrangThai = 1 ORDER BY dm.TenDM, sp.TenSP`);
        res.render('pos', { tables: tablesResult.recordset, products: productsResult.recordset });
    } catch (err) { res.send('Lỗi!'); }
});
// ==========================================
// ==========================================
//        8. NGHIỆP VỤ POS CHUYÊN SÂU
// ==========================================

// 1. Kéo dữ liệu món ăn đang dùng dở của Bàn ra màn hình POS (Giữ nguyên đoạn này nếu bạn đang có)
app.get('/api/table-order/:maBan', async (req, res) => {
    try {
        const pool = await poolPromise;
        const hd = await pool.request()
            .input('MaBan', req.params.maBan)
            .query("SELECT MaHD FROM HoaDon WHERE MaBan = @MaBan AND TrangThai = N'Chưa thanh toán'");
        
        if (hd.recordset.length > 0) {
            const maHD = hd.recordset[0].MaHD;
            const chiTiet = await pool.request().input('MaHD', maHD).query(`
                SELECT ct.MaSP as maSP, sp.TenSP as tenSP, ct.DonGia as donGia, ct.SoLuong as soLuong
                FROM ChiTietHoaDon ct JOIN SanPham sp ON ct.MaSP = sp.MaSP
                WHERE ct.MaHD = @MaHD
            `);
            res.json({ success: true, cart: chiTiet.recordset });
        } else {
            res.json({ success: true, cart: [] }); 
        }
    } catch (err) { res.json({ success: false }); }
});

// [MỚI] 2. API Quét Số điện thoại khách hàng
app.get('/api/customer/:phone', async (req, res) => {
    try {
        const pool = await poolPromise;
        const check = await pool.request().input('SDT', req.params.phone)
            .query('SELECT * FROM KhachHang WHERE SoDienThoai = @SDT');
        if (check.recordset.length > 0) {
            res.json({ success: true, data: check.recordset[0] });
        } else {
            res.json({ success: false }); // Không tìm thấy -> Khách mới
        }
    } catch (err) { res.json({ success: false }); }
});

// [NÂNG CẤP] 3. Xử lý LƯU ORDER hoặc THANH TOÁN (CÓ TÍCH ĐIỂM)
app.post('/pos/process', async (req, res) => {
    // Lấy thêm thông tin SĐT và Tên khách từ giao diện
    const { maBan, cart, action, sdtKhach, tenKhach } = req.body; 
    
    try {
        const pool = await poolPromise;
        const tongTien = cart.reduce((sum, item) => sum + (item.donGia * item.soLuong), 0);
        const trangThaiHD = (action === 'pay') ? 'Đã thanh toán' : 'Chưa thanh toán';
        const trangThaiBan = (action === 'pay') ? 'Trong' : 'Đang phục vụ';

        let maKH_db = null; // Biến lưu Mã Khách Hàng

        // ---> NGHIỆP VỤ TÍCH ĐIỂM (Chỉ tính khi Thanh toán và Thu ngân có nhập SĐT) <---
        if (action === 'pay' && sdtKhach) {
            const diemCong = Math.floor(tongTien / 10000); // 10k = 1 điểm
            
            const checkKhach = await pool.request().input('SDT', sdtKhach).query("SELECT MaKH FROM KhachHang WHERE SoDienThoai = @SDT");
            
            if (checkKhach.recordset.length > 0) {
                // Khách Cũ: Lấy mã KH và Cộng điểm
                maKH_db = checkKhach.recordset[0].MaKH;
                await pool.request().input('MaKH', maKH_db).input('Diem', diemCong)
                    .query("UPDATE KhachHang SET DiemTichLuy = DiemTichLuy + @Diem WHERE MaKH = @MaKH");
            } else {
                // Khách Mới: Lưu thông tin và cộng điểm đầu tiên
                const insertKhach = await pool.request()
                    .input('TenKH', tenKhach || 'Khách vãng lai').input('SDT', sdtKhach).input('Diem', diemCong)
                    .query("INSERT INTO KhachHang (TenKH, SoDienThoai, DiemTichLuy) OUTPUT INSERTED.MaKH VALUES (@TenKH, @SDT, @Diem)");
                maKH_db = insertKhach.recordset[0].MaKH;
            }
        }

        // 1. Lưu Hóa đơn
        const checkHD = await pool.request().input('MaBan', maBan).query("SELECT MaHD FROM HoaDon WHERE MaBan = @MaBan AND TrangThai = N'Chưa thanh toán'");
        let maHD = 0;
        
        if (checkHD.recordset.length > 0) {
            maHD = checkHD.recordset[0].MaHD;
            // Nếu có mã KH thì update gắn vào Hóa đơn
            let updateQuery = "UPDATE HoaDon SET TongTien = @TongTien, TrangThai = @TrangThai WHERE MaHD = @MaHD";
            if (maKH_db) updateQuery = "UPDATE HoaDon SET TongTien = @TongTien, TrangThai = @TrangThai, MaKH = @MaKH WHERE MaHD = @MaHD";
            
            await pool.request().input('MaHD', maHD).input('TongTien', tongTien).input('TrangThai', trangThaiHD).input('MaKH', maKH_db).query(updateQuery);
            // Xóa chi tiết cũ để chèn lại
            await pool.request().input('MaHD', maHD).query("DELETE FROM ChiTietHoaDon WHERE MaHD = @MaHD");
        } else {
            // Tạo Hóa đơn mới
            const insertHD = await pool.request().input('MaBan', maBan).input('TongTien', tongTien).input('TrangThai', trangThaiHD).input('MaKH', maKH_db)
                .query("INSERT INTO HoaDon (MaBan, MaNV, NgayLap, TongTien, TrangThai, MaKH) OUTPUT INSERTED.MaHD VALUES (@MaBan, 1, GETDATE(), @TongTien, @TrangThai, @MaKH)");
            maHD = insertHD.recordset[0].MaHD;
        }

        // 2. Chèn danh sách món ăn vào Hóa đơn
        for (let item of cart) {
            await pool.request().input('MaHD', maHD).input('MaSP', item.maSP).input('SoLuong', item.soLuong).input('DonGia', item.donGia)
                .query("INSERT INTO ChiTietHoaDon (MaHD, MaSP, SoLuong, DonGia) VALUES (@MaHD, @MaSP, @SoLuong, @DonGia)");
        }
        
        // 3. Cập nhật trạng thái Bàn
        await pool.request().input('MaBan', maBan).input('TrangThai', trangThaiBan)
            .query("UPDATE Ban SET TrangThai = @TrangThai WHERE MaBan = @MaBan");

        // Tạo câu thông báo trả về
        let msg = action === 'save' ? '✅ Đã lưu order xuống bếp!' : '✅ Thanh toán thành công!';
        if (action === 'pay' && sdtKhach) msg += ` (Đã cộng ${Math.floor(tongTien / 10000)} điểm vào ví)`;
        
        res.json({ success: true, message: msg });
    } catch (err) {
        console.error(err); res.json({ success: false, message: 'Lỗi máy chủ POS!' });
    }
});

// ==========================================
//        9. HÓA ĐƠN
// ==========================================
app.get('/invoices', async (req, res) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request().query(`SELECT hd.MaHD, hd.MaBan, b.TenBan, nv.TenNV, hd.NgayLap, hd.TongTien, hd.TrangThai FROM HoaDon hd LEFT JOIN Ban b ON hd.MaBan = b.MaBan LEFT JOIN NhanVien nv ON hd.MaNV = nv.MaNV ORDER BY hd.NgayLap DESC`);
        res.render('invoices', { invoices: result.recordset });
    } catch (err) { res.send('Lỗi!'); }
});
app.get('/api/invoices/:id', async (req, res) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request().input('MaHD', req.params.id)
            .query(`SELECT sp.TenSP, ct.SoLuong, ct.DonGia, (ct.SoLuong * ct.DonGia) as ThanhTien FROM ChiTietHoaDon ct JOIN SanPham sp ON ct.MaSP = sp.MaSP WHERE ct.MaHD = @MaHD`);
        res.json(result.recordset);
    } catch (err) { res.status(500).json({ error: 'Lỗi' }); }
});
app.post('/invoices/pay', async (req, res) => {
    try {
        const pool = await poolPromise;
        await pool.request().input('MaHD', req.body.maHD).query(`UPDATE HoaDon SET TrangThai = N'Đã thanh toán' WHERE MaHD = @MaHD`);
        await pool.request().input('MaBan', req.body.maBan).query(`UPDATE Ban SET TrangThai = N'Trong' WHERE MaBan = @MaBan`);
        res.redirect('/invoices');
    } catch (err) { res.send('Lỗi!'); }
});

// ==========================================
//        10. ĐẶT BÀN
// ==========================================
app.post('/api/book-table', async (req, res) => {
    try {
        const pool = await poolPromise;
        await pool.request()
            .input('TenKhachHang', req.body.tenKhach).input('SoDienThoai', req.body.sdt).input('NgayDat', req.body.ngayDat).input('GioDat', req.body.gioDat).input('SoNguoi', req.body.soNguoi).input('GhiChu', req.body.ghiChu)
            .query(`INSERT INTO DatBan (TenKhachHang, SoDienThoai, NgayDat, GioDat, SoNguoi, GhiChu, TrangThai) VALUES (@TenKhachHang, @SoDienThoai, @NgayDat, @GioDat, @SoNguoi, @GhiChu, N'Chờ xác nhận')`);
        res.json({ success: true });
    } catch (err) { res.json({ success: false, message: 'Lỗi' }); }
});
app.get('/bookings', async (req, res) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request().query('SELECT * FROM DatBan ORDER BY NgayDat DESC, GioDat DESC');
        res.render('bookings', { bookings: result.recordset });
    } catch (err) { res.send('Lỗi'); }
});
app.post('/bookings/update', async (req, res) => {
    try {
        const pool = await poolPromise;
        await pool.request().input('MaDatBan', req.body.maDatBan).input('TrangThai', req.body.trangThai).query('UPDATE DatBan SET TrangThai = @TrangThai WHERE MaDatBan = @MaDatBan');
        res.redirect('/bookings');
    } catch (err) { res.send('Lỗi'); }
});

// ==========================================
//        11. ĐƠN HÀNG ONLINE
// ==========================================
app.post('/api/order-online', async (req, res) => {
    try {
        const pool = await poolPromise;
        let tongTien = req.body.cart.reduce((sum, item) => sum + (item.donGia * item.soLuong), 0);
        const result = await pool.request()
            .input('TenKhach', req.body.tenKhach).input('SDT', req.body.sdt).input('DiaChi', req.body.diaChi).input('GhiChu', req.body.ghiChu).input('TongTien', tongTien)
            .query(`INSERT INTO DonHangOnline (TenKhachHang, SoDienThoai, DiaChiGiaoHang, GhiChu, TongTien) OUTPUT INSERTED.MaDon VALUES (@TenKhach, @SDT, @DiaChi, @GhiChu, @TongTien)`);
        const maDonMoi = result.recordset[0].MaDon;
        for (let item of req.body.cart) {
            await pool.request().input('MaDon', maDonMoi).input('MaSP', item.maSP).input('SoLuong', item.soLuong).input('DonGia', item.donGia)
                .query(`INSERT INTO ChiTietDonOnline (MaDon, MaSP, SoLuong, DonGia) VALUES (@MaDon, @MaSP, @SoLuong, @DonGia)`);
        }
        res.json({ success: true });
    } catch (err) { res.json({ success: false, message: 'Lỗi' }); }
});
app.get('/orders', async (req, res) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request().query('SELECT * FROM DonHangOnline ORDER BY NgayDat DESC');
        res.render('orders', { orders: result.recordset });
    } catch (err) { res.send('Lỗi'); }
});
app.get('/api/orders/:id', async (req, res) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request().input('MaDon', req.params.id)
            .query(`SELECT sp.TenSP, ct.SoLuong, ct.DonGia, (ct.SoLuong * ct.DonGia) as ThanhTien FROM ChiTietDonOnline ct JOIN SanPham sp ON ct.MaSP = sp.MaSP WHERE ct.MaDon = @MaDon`);
        res.json(result.recordset);
    } catch (err) { res.status(500).json({ error: 'Lỗi' }); }
});
app.post('/orders/update', async (req, res) => {
    try {
        const pool = await poolPromise;
        await pool.request().input('MaDon', req.body.maDon).input('TrangThai', req.body.trangThai).query('UPDATE DonHangOnline SET TrangThai = @TrangThai WHERE MaDon = @MaDon');
        res.redirect('/orders');
    } catch (err) { res.send('Lỗi'); }
});

// ==========================================
//        12. HỆ THỐNG KHUYẾN MÃI (VOUCHER)
// ==========================================
app.post('/api/check-voucher', async (req, res) => {
    const { maVoucher, tongTienDon } = req.body;
    try {
        const pool = await poolPromise;
        const result = await pool.request()
            .input('MaVoucher', maVoucher)
            .query(`
                SELECT * FROM KhuyenMai 
                WHERE MaVoucher = @MaVoucher 
                  AND TrangThai = 1 
                  AND NgayKetThuc >= GETDATE()
                  AND (SoLuong > 0 OR SoLuong = -1)
            `);
            
        if (result.recordset.length === 0) {
            return res.json({ success: false, message: 'Mã không tồn tại hoặc đã hết hạn!' });
        }
        
        const voucher = result.recordset[0];
        
        if (tongTienDon < voucher.DonHangToiThieu) {
            return res.json({ success: false, message: `Mã này chỉ áp dụng cho đơn từ ${voucher.DonHangToiThieu.toLocaleString('vi-VN')} đ` });
        }
        
        let tienGiam = (tongTienDon * voucher.PhanTramGiam) / 100;
        if (voucher.SoTienGiamToiDa > 0 && tienGiam > voucher.SoTienGiamToiDa) {
            tienGiam = voucher.SoTienGiamToiDa;
        }
        
        res.json({ 
            success: true, 
            tienGiam: tienGiam,
            message: `Áp dụng thành công! Đã giảm ${tienGiam.toLocaleString('vi-VN')} đ`
        });
    } catch (err) {
        console.error('Lỗi check voucher:', err);
        res.status(500).json({ success: false, message: 'Lỗi hệ thống khi check voucher' });
    }
});
// ==========================================
//        13. QUẢN LÝ KHUYẾN MÃI (ADMIN)
// ==========================================

// A. Hiển thị danh sách các Mã giảm giá
app.get('/vouchers', async (req, res) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request().query('SELECT * FROM KhuyenMai ORDER BY MaKM DESC');
        res.render('vouchers', { vouchers: result.recordset });
    } catch (err) { res.send('Lỗi tải danh sách khuyến mãi'); }
});

// B. Admin Thêm mã giảm giá mới
app.post('/vouchers/add', async (req, res) => {
    const { maVoucher, tenCT, phanTram, giamToiDa, donToiThieu, ngayKT } = req.body;
    try {
        const pool = await poolPromise;
        await pool.request()
            .input('MaVoucher', maVoucher).input('TenChuongTrinh', tenCT)
            .input('PhanTram', phanTram).input('ToiDa', giamToiDa)
            .input('ToiThieu', donToiThieu).input('NgayKT', ngayKT)
            .query(`INSERT INTO KhuyenMai (MaVoucher, TenChuongTrinh, PhanTramGiam, SoTienGiamToiDa, DonHangToiThieu, NgayKetThuc)
                    VALUES (@MaVoucher, @TenChuongTrinh, @PhanTram, @ToiDa, @ToiThieu, @NgayKT)`);
        res.redirect('/vouchers');
    } catch (err) { 
        res.send('Lỗi thêm khuyến mãi (Có thể mã Voucher bị trùng, vui lòng chọn mã khác!)'); 
    }
});

// C. Admin Bật/Tắt trạng thái hoạt động của mã
app.post('/vouchers/toggle', async (req, res) => {
    try {
        const pool = await poolPromise;
        await pool.request()
            .input('MaKM', req.body.maKM)
            .input('TrangThai', req.body.trangThai)
            .query('UPDATE KhuyenMai SET TrangThai = @TrangThai WHERE MaKM = @MaKM');
        res.redirect('/vouchers');
    } catch (err) { res.send('Lỗi cập nhật trạng thái'); }
});
// ==========================================
// API QUẢN LÝ DANH MỤC & SẮP XẾP MÓN ĂN
// ==========================================

// 1. Cập nhật lại API lấy danh sách Sản phẩm (SẮP XẾP THEO DANH MỤC)
app.get('/products', async (req, res) => {
    try {
        const pool = await poolPromise;
        const products = await pool.request().query(`
            SELECT sp.*, dm.TenDM 
            FROM SanPham sp 
            LEFT JOIN DanhMuc dm ON sp.MaDM = dm.MaDM 
            ORDER BY dm.TenDM ASC, sp.TenSP ASC -- Tự động nhóm các món cùng danh mục đứng cạnh nhau
        `);
        const categories = await pool.request().query('SELECT * FROM DanhMuc');
        res.render('products', { products: products.recordset, categories: categories.recordset });
    } catch (err) { res.send('Lỗi tải trang quản lý sản phẩm!'); }
});

// 2. Thêm Danh Mục mới
app.post('/categories/add', async (req, res) => {
    try {
        const pool = await poolPromise;
        await pool.request().input('TenDM', req.body.tenDM)
            .query('INSERT INTO DanhMuc (TenDM) VALUES (@TenDM)');
        res.redirect('/products');
    } catch (err) { res.send('Lỗi thêm danh mục!'); }
});

// 3. Sửa Tên Danh Mục
app.post('/categories/edit', async (req, res) => {
    try {
        const pool = await poolPromise;
        await pool.request().input('MaDM', req.body.maDM).input('TenDM', req.body.tenDM)
            .query('UPDATE DanhMuc SET TenDM = @TenDM WHERE MaDM = @MaDM');
        res.redirect('/products');
    } catch (err) { res.send('Lỗi sửa danh mục!'); }
});

// 4. Xóa Danh Mục
app.post('/categories/delete', async (req, res) => {
    try {
        const pool = await poolPromise;
        await pool.request().input('MaDM', req.body.maDM)
            .query('DELETE FROM DanhMuc WHERE MaDM = @MaDM');
        res.redirect('/products');
    } catch (err) { 
        res.send('<script>alert("❌ Lỗi: Không thể xóa Danh mục đang có món ăn bên trong! Hãy xóa hoặc chuyển danh mục các món ăn trước."); window.location.href="/products";</script>'); 
    }
});
// ==========================================
// API KHÁCH HÀNG ĐẶT BÀN ONLINE
// ==========================================
app.post('/api/book-table', async (req, res) => {
    const { tenKhach, sdt, ngayDat, gioDat, soNguoi, ghiChu } = req.body;
    try {
        const pool = await poolPromise;
        await pool.request()
            .input('TenKhach', tenKhach)
            .input('SDT', sdt)
            .input('NgayDat', ngayDat)
            .input('GioDat', gioDat)
            .input('SoNguoi', soNguoi)
            .input('GhiChu', ghiChu || '')
            .query(`
                INSERT INTO DatBan (TenKhach, SoDienThoai, NgayDat, GioDat, SoNguoi, GhiChu, TrangThai)
                VALUES (@TenKhach, @SDT, @NgayDat, @GioDat, @SoNguoi, @GhiChu, N'Chờ xác nhận')
            `);
        res.json({ success: true, message: '🎉 Đặt bàn thành công! Quán sẽ sớm liên hệ để xác nhận.' });
    } catch (err) {
        console.error('Lỗi đặt bàn:', err);
        res.json({ success: false, message: 'Lỗi hệ thống, vui lòng thử lại sau!' });
    }
});
// Chạy server
app.listen(port, () => {
    console.log(`Server đang chạy tại http://localhost:${port}`);
});