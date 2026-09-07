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
//        1. GIAO DIỆN KHÁCH HÀNG
// ==========================================

// 1.1 Trang chủ (Hiển thị Top 4 Bán Chạy, Giới thiệu)
app.get('/', async (req, res) => {
    try {
        const pool = await poolPromise;
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
//        3. DASHBOARD (THỐNG KÊ KINH DOANH)
// ==========================================
app.get('/dashboard', async (req, res) => {
    const role = req.query.role || 'Admin';
    const username = req.query.username || 'Admin';

    try {
        const pool = await poolPromise;
        const doanhThuResult = await pool.request().query(`SELECT ISNULL(SUM(TongTien), 0) AS TongDoanhThu FROM HoaDon WHERE TrangThai = N'Đã thanh toán'`);
        const soDonResult = await pool.request().query(`SELECT COUNT(MaHD) AS SoDon FROM HoaDon WHERE TrangThai = N'Đã thanh toán'`);
        const banTrongResult = await pool.request().query(`SELECT COUNT(MaBan) AS BanTrong FROM Ban WHERE TrangThai = N'Trong'`);
        const monAnResult = await pool.request().query(`SELECT COUNT(MaSP) AS TongMon FROM SanPham WHERE TrangThai = 1`);

        const topProducts = await pool.request().query(`
            SELECT TOP 5 sp.TenSP, SUM(ct.SoLuong) as TongSoLuong
            FROM ChiTietHoaDon ct
            JOIN SanPham sp ON ct.MaSP = sp.MaSP
            JOIN HoaDon hd ON ct.MaHD = hd.MaHD
            WHERE hd.TrangThai = N'Đã thanh toán'
            GROUP BY sp.TenSP
            ORDER BY TongSoLuong DESC
        `);

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
            chartDataProducts: JSON.stringify(topProducts.recordset),
            chartDataRevenue: JSON.stringify(nvRevenue.recordset)
        });
    } catch (err) { res.send('Lỗi tải bảng điều khiển!'); }
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
        await pool.request()
            .input('TenBan', req.body.tenBan)
            .input('KhuVuc', req.body.khuVuc)
            .input('SucChua', req.body.sucChua || 4)
            .query(`INSERT INTO Ban (TenBan, TrangThai, KhuVuc, SucChua) VALUES (@TenBan, N'Trong', @KhuVuc, @SucChua)`);
        res.redirect('/tables');
    } catch (err) { res.send('Lỗi thêm bàn mới!'); }
});

app.post('/tables/edit', async (req, res) => {
    try {
        const pool = await poolPromise;
        await pool.request()
            .input('MaBan', req.body.maBan).input('TenBan', req.body.tenBan)
            .input('KhuVuc', req.body.khuVuc).input('SucChua', req.body.sucChua || 4)
            .query(`UPDATE Ban SET TenBan = @TenBan, KhuVuc = @KhuVuc, SucChua = @SucChua WHERE MaBan = @MaBan`);
        res.redirect('/tables');
    } catch (err) { res.send('Lỗi cập nhật thông tin bàn!'); }
});

// [ĐÃ THÊM] Xóa bàn
app.post('/tables/delete', async (req, res) => {
    try {
        const pool = await poolPromise;
        const maBan = req.body.maBan;

        // Kiểm tra xem bàn có đang phục vụ hoặc có người đặt không
        const check = await pool.request().input('MaBan', maBan).query("SELECT TrangThai FROM Ban WHERE MaBan = @MaBan");
        if(check.recordset.length > 0 && check.recordset[0].TrangThai !== 'Trong') {
            return res.send('<script>alert("❌ Bàn đang có khách hoặc đã được đặt, KHÔNG THỂ XÓA!"); window.location.href="/tables";</script>');
        }

        // Thực hiện lệnh xóa
        await pool.request().input('MaBan', maBan).query('DELETE FROM Ban WHERE MaBan = @MaBan');
        res.redirect('/tables');
    } catch (err) {
        console.error('Lỗi xóa bàn:', err);
        // Nếu dính khóa ngoại (đã từng có hóa đơn lịch sử) thì chặn lại
        res.send('<script>alert("❌ Lỗi: Bàn này đã có lịch sử Hóa đơn hoặc Đặt bàn trước đây nên không thể xóa để bảo toàn dữ liệu thống kê!"); window.location.href="/tables";</script>');
    }
});

app.post('/tables/transfer', async (req, res) => {
    const { maBanCu, maBanMoi } = req.body;
    try {
        const pool = await poolPromise;
        const checkBanMoi = await pool.request().input('MaBan', maBanMoi).query("SELECT TrangThai FROM Ban WHERE MaBan = @MaBan");
        if (checkBanMoi.recordset[0].TrangThai !== 'Trong') {
            return res.send('<script>alert("❌ Bàn mới đang có khách, không thể chuyển tới!"); window.location.href="/tables";</script>');
        }
        await pool.request().input('MaBanCu', maBanCu).input('MaBanMoi', maBanMoi).query(`UPDATE HoaDon SET MaBan = @MaBanMoi WHERE MaBan = @MaBanCu AND TrangThai = N'Chưa thanh toán'`);
        await pool.request().input('MaBanCu', maBanCu).query("UPDATE Ban SET TrangThai = N'Trong' WHERE MaBan = @MaBanCu");
        await pool.request().input('MaBanMoi', maBanMoi).query("UPDATE Ban SET TrangThai = N'Đang phục vụ' WHERE MaBan = @MaBanMoi");
        res.redirect('/tables');
    } catch (err) { res.send('Lỗi hệ thống khi chuyển bàn!'); }
});

app.post('/tables/merge', async (req, res) => {
    const { maBanCu, maBanMoi } = req.body;
    if (maBanCu === maBanMoi) return res.send('<script>alert("❌ Không thể gộp cùng một bàn!"); window.location.href="/tables";</script>');
    try {
        const pool = await poolPromise;
        const hdCu = await pool.request().input('MaBan', maBanCu).query("SELECT MaHD, TongTien FROM HoaDon WHERE MaBan = @MaBan AND TrangThai = N'Chưa thanh toán'");
        const hdMoi = await pool.request().input('MaBan', maBanMoi).query("SELECT MaHD, TongTien FROM HoaDon WHERE MaBan = @MaBan AND TrangThai = N'Chưa thanh toán'");
        if (hdCu.recordset.length > 0) {
            if (hdMoi.recordset.length > 0) {
                const maHDCu = hdCu.recordset[0].MaHD; const maHDMoi = hdMoi.recordset[0].MaHD; const tienCu = hdCu.recordset[0].TongTien || 0;
                await pool.request().input('MaHDCu', maHDCu).input('MaHDMoi', maHDMoi).query("UPDATE ChiTietHoaDon SET MaHD = @MaHDMoi WHERE MaHD = @MaHDCu");
                await pool.request().input('MaHDMoi', maHDMoi).input('TienCu', tienCu).query("UPDATE HoaDon SET TongTien = TongTien + @TienCu WHERE MaHD = @MaHDMoi");
                await pool.request().input('MaHDCu', maHDCu).query("DELETE FROM HoaDon WHERE MaHD = @MaHDCu");
            } else {
                await pool.request().input('MaBanMoi', maBanMoi).input('MaHDCu', hdCu.recordset[0].MaHD).query("UPDATE HoaDon SET MaBan = @MaBanMoi WHERE MaHD = @MaHDCu");
            }
        }
        await pool.request().input('MaBanCu', maBanCu).query("UPDATE Ban SET TrangThai = N'Trong' WHERE MaBan = @MaBanCu");
        await pool.request().input('MaBanMoi', maBanMoi).query("UPDATE Ban SET TrangThai = N'Đang phục vụ' WHERE MaBan = @MaBanMoi");
        res.redirect('/tables');
    } catch (err) { res.send('Lỗi hệ thống khi gộp bàn!'); }
});
// ==========================================
//        5 & 6. DANH MỤC VÀ SẢN PHẨM
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
        await pool.request().input('TenDM', req.body.tenDM).query('INSERT INTO DanhMuc (TenDM) VALUES (@TenDM)');
        res.redirect('/products');
    } catch (err) { res.send('Lỗi thêm danh mục!'); }
});
app.post('/categories/edit', async (req, res) => {
    try {
        const pool = await poolPromise;
        await pool.request().input('MaDM', req.body.maDM).input('TenDM', req.body.tenDM).query('UPDATE DanhMuc SET TenDM = @TenDM WHERE MaDM = @MaDM');
        res.redirect('/products');
    } catch (err) { res.send('Lỗi sửa danh mục!'); }
});
app.post('/categories/delete', async (req, res) => {
    try {
        const pool = await poolPromise;
        await pool.request().input('MaDM', req.body.maDM).query('DELETE FROM DanhMuc WHERE MaDM = @MaDM');
        res.redirect('/products');
    } catch (err) { res.send('<script>alert("❌ Lỗi: Không thể xóa Danh mục đang có món ăn bên trong!"); window.location.href="/products";</script>'); }
});

app.get('/products', async (req, res) => {
    try {
        const pool = await poolPromise;
        const products = await pool.request().query(`
            SELECT sp.*, dm.TenDM FROM SanPham sp 
            LEFT JOIN DanhMuc dm ON sp.MaDM = dm.MaDM 
            ORDER BY dm.TenDM ASC, sp.TenSP ASC
        `);
        const categories = await pool.request().query('SELECT * FROM DanhMuc');
        res.render('products', { products: products.recordset, categories: categories.recordset });
    } catch (err) { res.send('Lỗi tải trang quản lý sản phẩm!'); }
});
app.post('/products/add', async (req, res) => {
    try {
        const pool = await poolPromise;
        let linkAnh = req.body.hinhAnh || 'https://images.unsplash.com/photo-1509042239860-f550ce710b93?q=80&w=200';
        await pool.request()
            .input('TenSP', req.body.tenSP).input('DonGia', req.body.donGia).input('MaDM', req.body.maDM).input('TrangThai', req.body.trangThai).input('HinhAnh', linkAnh)
            .query('INSERT INTO SanPham (TenSP, DonGia, MaDM, TrangThai, HinhAnh) VALUES (@TenSP, @DonGia, @MaDM, @TrangThai, @HinhAnh)');
        res.redirect('/products');
    } catch (err) { res.send('Lỗi thêm sản phẩm!'); }
});
app.post('/products/edit', async (req, res) => {
    try {
        const pool = await poolPromise;
        await pool.request()
            .input('MaSP', req.body.maSP).input('TenSP', req.body.tenSP).input('DonGia', req.body.donGia).input('MaDM', req.body.maDM).input('TrangThai', req.body.trangThai).input('HinhAnh', req.body.hinhAnh)
            .query(`UPDATE SanPham SET TenSP = @TenSP, DonGia = @DonGia, MaDM = @MaDM, TrangThai = @TrangThai, HinhAnh = @HinhAnh WHERE MaSP = @MaSP`);
        res.redirect('/products');
    } catch (err) { res.send('Lỗi cập nhật sản phẩm!'); }
});
app.post('/products/delete', async (req, res) => {
    try {
        const pool = await poolPromise;
        await pool.request().input('MaSP', req.body.maSP).query('DELETE FROM SanPham WHERE MaSP = @MaSP');
        res.redirect('/products');
    } catch (err) { res.send('Lỗi: Không thể xóa sản phẩm đã có lịch sử đơn hàng.'); }
});

// ==========================================
//        7. NHÂN SỰ & CẤP TÀI KHOẢN
// ==========================================
app.get('/employees', async (req, res) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request().query(`
            SELECT nv.*, tk.TenDangNhap, tk.VaiTro 
            FROM NhanVien nv LEFT JOIN TaiKhoan tk ON nv.MaNV = tk.MaNV ORDER BY nv.MaNV DESC
        `);
        res.render('employees', { employees: result.recordset });
    } catch (err) { res.send('Lỗi tải danh sách nhân viên!'); }
});
app.post('/employees/add', async (req, res) => {
    try {
        const pool = await poolPromise;
        await pool.request()
            .input('TenNV', req.body.tenNV).input('SoDienThoai', req.body.soDienThoai).input('Email', req.body.email).input('NgayVaoLam', req.body.ngayVaoLam).input('ChucVu', req.body.chucVu)
            .query(`INSERT INTO NhanVien (TenNV, SoDienThoai, Email, NgayVaoLam, ChucVu) VALUES (@TenNV, @SoDienThoai, @Email, @NgayVaoLam, @ChucVu)`);
        res.redirect('/employees');
    } catch (err) { res.send('Lỗi thêm nhân viên!'); }
});
app.post('/employees/edit', async (req, res) => {
    try {
        const pool = await poolPromise;
        await pool.request().input('MaNV', req.body.maNV).input('TenNV', req.body.tenNV).input('SoDienThoai', req.body.soDienThoai).input('ChucVu', req.body.chucVu)
            .query(`UPDATE NhanVien SET TenNV = @TenNV, SoDienThoai = @SoDienThoai, ChucVu = @ChucVu WHERE MaNV = @MaNV`);
        res.redirect('/employees');
    } catch (err) { res.send('Lỗi sửa nhân viên!'); }
});
app.post('/employees/delete', async (req, res) => {
    try {
        const pool = await poolPromise;
        await pool.request().input('MaNV', req.body.maNV).query('DELETE FROM TaiKhoan WHERE MaNV = @MaNV');
        await pool.request().input('MaNV', req.body.maNV).query('DELETE FROM NhanVien WHERE MaNV = @MaNV');
        res.redirect('/employees');
    } catch (err) { res.send('Không thể xóa nhân viên này.'); }
});
app.post('/employees/create-account', async (req, res) => {
    const { maNV, tenDangNhap, matKhau, vaiTro } = req.body;
    try {
        const pool = await poolPromise;
        const check = await pool.request().input('MaNV', maNV).query('SELECT * FROM TaiKhoan WHERE MaNV = @MaNV');
        if (check.recordset.length > 0) {
            await pool.request().input('MaNV', maNV).input('TenDangNhap', tenDangNhap).input('MatKhau', matKhau).input('VaiTro', vaiTro).query(`UPDATE TaiKhoan SET TenDangNhap = @TenDangNhap, MatKhau = @MatKhau, VaiTro = @VaiTro WHERE MaNV = @MaNV`);
        } else {
            await pool.request().input('MaNV', maNV).input('TenDangNhap', tenDangNhap).input('MatKhau', matKhau).input('VaiTro', vaiTro).query(`INSERT INTO TaiKhoan (MaNV, TenDangNhap, MatKhau, VaiTro) VALUES (@MaNV, @TenDangNhap, @MatKhau, @VaiTro)`);
        }
        res.redirect('/employees');
    } catch (err) { res.send('Lỗi cấp tài khoản (Có thể Tên đăng nhập đã bị trùng)!'); }
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

app.get('/api/table-order/:maBan', async (req, res) => {
    try {
        const pool = await poolPromise;
        const hd = await pool.request().input('MaBan', req.params.maBan).query("SELECT MaHD FROM HoaDon WHERE MaBan = @MaBan AND TrangThai = N'Chưa thanh toán'");
        if (hd.recordset.length > 0) {
            const chiTiet = await pool.request().input('MaHD', hd.recordset[0].MaHD).query(`
                SELECT ct.MaSP as maSP, sp.TenSP as tenSP, ct.DonGia as donGia, ct.SoLuong as soLuong
                FROM ChiTietHoaDon ct JOIN SanPham sp ON ct.MaSP = sp.MaSP WHERE ct.MaHD = @MaHD
            `);
            res.json({ success: true, cart: chiTiet.recordset });
        } else {
            res.json({ success: true, cart: [] }); 
        }
    } catch (err) { res.json({ success: false }); }
});

app.get('/api/customer/:phone', async (req, res) => {
    try {
        const pool = await poolPromise;
        const check = await pool.request().input('SDT', req.params.phone).query('SELECT * FROM KhachHang WHERE SoDienThoai = @SDT');
        if (check.recordset.length > 0) res.json({ success: true, data: check.recordset[0] });
        else res.json({ success: false });
    } catch (err) { res.json({ success: false }); }
});

// ==========================================
// XỬ LÝ POS: KHÓA HÓA ĐƠN & LƯU VẾT THAO TÁC
// ==========================================
app.post('/pos/process', async (req, res) => {
    const { maBan, cart, action, sdtKhach, tenKhach, lyDoHuy } = req.body; 
    const tenThuNgan = req.session.user ? req.session.user.tenNV : 'Hệ thống';

    try {
        const pool = await poolPromise;
        
        // 1. Kiểm tra trạng thái Hóa đơn hiện tại của Bàn
        const checkHD = await pool.request().input('MaBan', maBan).query("SELECT MaHD, TrangThai FROM HoaDon WHERE MaBan = @MaBan AND TrangThai = N'Chưa thanh toán'");
        let maHD = checkHD.recordset.length > 0 ? checkHD.recordset[0].MaHD : 0;

        // [BẢO MẬT] Ngăn chặn tác động nếu hóa đơn không tồn tại mà đòi Hủy/Thanh toán
        if (maHD === 0 && action !== 'save') {
            return res.json({ success: false, message: 'Bàn này chưa có hóa đơn để xử lý!' });
        }

        // ==========================================
        // NGHIỆP VỤ 1: HỦY HÓA ĐƠN
        // ==========================================
        if (action === 'cancel') {
            await pool.request().input('MaHD', maHD).input('LyDo', lyDoHuy || 'Khách đổi ý')
                .query("UPDATE HoaDon SET TrangThai = N'Đã hủy', LyDoHuy = @LyDo WHERE MaHD = @MaHD");
            await pool.request().input('MaBan', maBan).query("UPDATE Ban SET TrangThai = N'Trong' WHERE MaBan = @MaBan");
            
            // Lưu vết
            await pool.request().input('MaHD', maHD).input('NV', tenThuNgan).input('HanhDong', `Hủy hóa đơn. Lý do: ${lyDoHuy}`)
                .query("INSERT INTO LichSuThaoTac (MaHD, TenNhanVien, HanhDong) VALUES (@MaHD, @NV, @HanhDong)");
                
            return res.json({ success: true, message: 'Đã hủy hóa đơn và giải phóng bàn!' });
        }

        // ==========================================
        // NGHIỆP VỤ 2: LƯU ORDER & THANH TOÁN
        // ==========================================
        const tongTien = cart.reduce((sum, item) => sum + (item.donGia * item.soLuong), 0);
        let maKH_db = null; 

        // Xử lý Khách hàng & Tích điểm (Chỉ khi Thanh toán)
        if (action === 'pay' && sdtKhach) {
            const diemCong = Math.floor(tongTien / 10000); 
            const checkKhach = await pool.request().input('SDT', sdtKhach).query("SELECT MaKH FROM KhachHang WHERE SoDienThoai = @SDT");
            if (checkKhach.recordset.length > 0) {
                maKH_db = checkKhach.recordset[0].MaKH;
                await pool.request().input('MaKH', maKH_db).input('Diem', diemCong).query("UPDATE KhachHang SET DiemTichLuy = DiemTichLuy + @Diem WHERE MaKH = @MaKH");
            } else {
                const insertKhach = await pool.request().input('TenKH', tenKhach || 'Khách vãng lai').input('SDT', sdtKhach).input('Diem', diemCong)
                    .query("INSERT INTO KhachHang (TenKH, SoDienThoai, DiemTichLuy) OUTPUT INSERTED.MaKH VALUES (@TenKH, @SDT, @Diem)");
                maKH_db = insertKhach.recordset[0].MaKH;
            }
        }

        let logAction = "";

        if (maHD > 0) {
            // Hóa đơn đã tồn tại -> Sửa món / Cập nhật
            const trangThaiHD = (action === 'pay') ? 'Đã thanh toán' : 'Chưa thanh toán';
            let updateQuery = "UPDATE HoaDon SET TongTien = @TongTien, TrangThai = @TrangThai WHERE MaHD = @MaHD";
            if (maKH_db) updateQuery = "UPDATE HoaDon SET TongTien = @TongTien, TrangThai = @TrangThai, MaKH = @MaKH WHERE MaHD = @MaHD";
            
            await pool.request().input('MaHD', maHD).input('TongTien', tongTien).input('TrangThai', trangThaiHD).input('MaKH', maKH_db).query(updateQuery);
            await pool.request().input('MaHD', maHD).query("DELETE FROM ChiTietHoaDon WHERE MaHD = @MaHD"); // Xóa chi tiết cũ
            
            logAction = (action === 'pay') ? "Thanh toán hóa đơn" : "Cập nhật lại món ăn";
        } else {
            // Tạo Hóa đơn mới hoàn toàn
            const insertHD = await pool.request().input('MaBan', maBan).input('TongTien', tongTien).input('MaKH', maKH_db)
                .query("INSERT INTO HoaDon (MaBan, MaNV, NgayLap, TongTien, TrangThai, MaKH) OUTPUT INSERTED.MaHD VALUES (@MaBan, 1, GETDATE(), @TongTien, N'Chưa thanh toán', @MaKH)");
            maHD = insertHD.recordset[0].MaHD;
            logAction = "Tạo mới hóa đơn";
        }

        // Chèn danh sách món mới nhất
        for (let item of cart) {
            await pool.request().input('MaHD', maHD).input('MaSP', item.maSP).input('SoLuong', item.soLuong).input('DonGia', item.donGia)
                .query("INSERT INTO ChiTietHoaDon (MaHD, MaSP, SoLuong, DonGia) VALUES (@MaHD, @MaSP, @SoLuong, @DonGia)");
        }

        // Cập nhật trạng thái Bàn & Lưu Log
        if (action === 'pay') {
            await pool.request().input('MaBan', maBan).query("UPDATE Ban SET TrangThai = N'Trong' WHERE MaBan = @MaBan"); // Tự trả bàn về Trống
        } else {
            await pool.request().input('MaBan', maBan).query("UPDATE Ban SET TrangThai = N'Đang phục vụ' WHERE MaBan = @MaBan");
        }

        // Lưu vết vào hệ thống
        await pool.request().input('MaHD', maHD).input('NV', tenThuNgan).input('HanhDong', logAction)
            .query("INSERT INTO LichSuThaoTac (MaHD, TenNhanVien, HanhDong) VALUES (@MaHD, @NV, @HanhDong)");

        let msg = action === 'save' ? '✅ Đã lưu order!' : '✅ Đã khóa Hóa đơn và Thanh toán thành công!';
        res.json({ success: true, message: msg });

    } catch (err) {
        console.error(err); res.json({ success: false, message: 'Lỗi hệ thống POS!' });
    }
});
// ==========================================
//        9. HÓA ĐƠN & NHẬT KÝ HỆ THỐNG
// ==========================================
app.get('/invoices', async (req, res) => {
    try {
        const pool = await poolPromise;
        
        // 1. Tải danh sách Hóa Đơn (Kéo thêm cột LyDoHuy)
        const invoicesResult = await pool.request().query(`
            SELECT hd.MaHD, hd.MaBan, b.TenBan, nv.TenNV, hd.NgayLap, hd.TongTien, hd.TrangThai, hd.LyDoHuy 
            FROM HoaDon hd 
            LEFT JOIN Ban b ON hd.MaBan = b.MaBan 
            LEFT JOIN NhanVien nv ON hd.MaNV = nv.MaNV 
            ORDER BY hd.NgayLap DESC
        `);

        // 2. Tải Nhật ký thao tác (Audit Log)
        const logsResult = await pool.request().query(`
            SELECT * FROM LichSuThaoTac 
            ORDER BY ThoiGian DESC
        `);

        res.render('invoices', { 
            invoices: invoicesResult.recordset, 
            logs: logsResult.recordset 
        });
    } catch (err) { 
        console.error(err);
        res.send('Lỗi tải trang hóa đơn!'); 
    }
});
app.get('/api/invoices/:id', async (req, res) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request().input('MaHD', req.params.id).query(`SELECT sp.TenSP, ct.SoLuong, ct.DonGia, (ct.SoLuong * ct.DonGia) as ThanhTien FROM ChiTietHoaDon ct JOIN SanPham sp ON ct.MaSP = sp.MaSP WHERE ct.MaHD = @MaHD`);
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
//        10. ĐẶT BÀN & LIÊN KẾT BÀN
// ==========================================
app.post('/api/book-table', async (req, res) => {
    const { tenKhach, sdt, ngayDat, gioDat, soNguoi, ghiChu } = req.body;
    try {
        const pool = await poolPromise;
        await pool.request()
            // Đã sửa lại thành TenKhachHang cho khớp với SQL Server của bạn
            .input('TenKhachHang', tenKhach).input('SDT', sdt).input('NgayDat', ngayDat).input('GioDat', gioDat).input('SoNguoi', soNguoi).input('GhiChu', ghiChu || '')
            .query(`INSERT INTO DatBan (TenKhachHang, SoDienThoai, NgayDat, GioDat, SoNguoi, GhiChu, TrangThai) VALUES (@TenKhachHang, @SDT, @NgayDat, @GioDat, @SoNguoi, @GhiChu, N'Chờ xác nhận')`);
        res.json({ success: true, message: '🎉 Đặt bàn thành công! Quán sẽ sớm liên hệ để xác nhận.' });
    } catch (err) { 
        console.log("=== LỖI ĐẶT BÀN ===", err); // In lỗi ra màn hình Terminal để kiểm soát
        res.json({ success: false, message: 'Lỗi hệ thống, vui lòng thử lại sau!' }); 
    }
});

app.get('/bookings', async (req, res) => {
    try {
        const pool = await poolPromise;
        // Đổi tên giả (alias) thành TenKhach để tương thích với file EJS
        const result = await pool.request().query(`
            SELECT d.*, d.TenKhachHang as TenKhach, b.TenBan, b.KhuVuc 
            FROM DatBan d LEFT JOIN Ban b ON d.MaBan = b.MaBan ORDER BY NgayDat DESC, GioDat DESC
        `);
        const tables = await pool.request().query("SELECT * FROM Ban WHERE TrangThai = N'Trong'");
        res.render('bookings', { bookings: result.recordset, tables: tables.recordset });
    } catch (err) { res.send('Lỗi tải danh sách đặt bàn!'); }
});

app.post('/bookings/update-status', async (req, res) => {
    const { id, status, maBan } = req.body;
    try {
        const pool = await poolPromise;
        const currentBooking = await pool.request().input('ID', id).query("SELECT MaBan FROM DatBan WHERE MaDatBan = @ID");
        const currentMaBan = currentBooking.recordset[0]?.MaBan;

        if (status === 'Đã xác nhận') {
            await pool.request().input('ID', id).input('MaBan', maBan).query("UPDATE DatBan SET TrangThai = N'Đã xác nhận', MaBan = @MaBan WHERE MaDatBan = @ID");
            await pool.request().input('MaBan', maBan).query("UPDATE Ban SET TrangThai = N'Đã đặt' WHERE MaBan = @MaBan");
        } 
        else if (status === 'Đã hủy') {
            await pool.request().input('ID', id).query("UPDATE DatBan SET TrangThai = N'Đã hủy' WHERE MaDatBan = @ID");
            if (currentMaBan) await pool.request().input('MaBan', currentMaBan).query("UPDATE Ban SET TrangThai = N'Trong' WHERE MaBan = @MaBan");
        }
        else if (status === 'Đã đến') {
            await pool.request().input('ID', id).query("UPDATE DatBan SET TrangThai = N'Đã đến' WHERE MaDatBan = @ID");
            if (currentMaBan) await pool.request().input('MaBan', currentMaBan).query("UPDATE Ban SET TrangThai = N'Đang phục vụ' WHERE MaBan = @MaBan");
        }
        res.json({ success: true, message: 'Đã cập nhật trạng thái!' });
    } catch (err) { res.json({ success: false, message: 'Lỗi khi cập nhật!' }); }
    //  API Sửa chi tiết Đặt Bàn & Đổi Bàn
app.post('/bookings/edit-details', async (req, res) => {
    const { id, ngayDat, gioDat, soNguoi, ghiChu, maBanMoi, trangThaiHienTai } = req.body;
    try {
        const pool = await poolPromise;
        
        // 1. Lấy thông tin bàn cũ đang giữ (nếu có)
        const currentBooking = await pool.request().input('ID', id).query("SELECT MaBan FROM DatBan WHERE MaDatBan = @ID");
        const maBanCu = currentBooking.recordset[0]?.MaBan;

        // 2. Nếu khách Đã xác nhận và Thu ngân muốn đổi sang bàn khác
        let finalMaBan = maBanCu;
        if (trangThaiHienTai === 'Đã xác nhận' && maBanMoi && maBanMoi != maBanCu) {
            // Giải phóng bàn cũ (chuyển về Trống)
            if (maBanCu) await pool.request().input('MaBanCu', maBanCu).query("UPDATE Ban SET TrangThai = N'Trong' WHERE MaBan = @MaBanCu");
            // Khóa bàn mới (chuyển thành Đã đặt)
            await pool.request().input('MaBanMoi', maBanMoi).query("UPDATE Ban SET TrangThai = N'Đã đặt' WHERE MaBan = @MaBanMoi");
            finalMaBan = maBanMoi; // Cập nhật mã bàn mới để lưu vào phiếu đặt
        }

        // 3. Cập nhật mọi thông tin mới vào phiếu Đặt Bàn
        await pool.request()
            .input('ID', id)
            .input('NgayDat', ngayDat)
            .input('GioDat', gioDat)
            .input('SoNguoi', soNguoi)
            .input('GhiChu', ghiChu)
            .input('MaBan', finalMaBan) // Bàn cũ, hoặc bàn mới nếu có đổi
            .query(`
                UPDATE DatBan 
                SET NgayDat = @NgayDat, GioDat = @GioDat, SoNguoi = @SoNguoi, GhiChu = @GhiChu, MaBan = @MaBan 
                WHERE MaDatBan = @ID
            `);

        res.json({ success: true, message: 'Cập nhật thông tin đặt bàn thành công!' });
    } catch (err) {
        console.error("Lỗi sửa đặt bàn:", err);
        res.json({ success: false, message: 'Lỗi hệ thống khi sửa thông tin!' });
    }
});
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

app.post('/orders/update-status', async (req, res) => {
    const { maDon, sdt, tongTien, trangThaiMoi, tenKhach } = req.body;
    try {
        const pool = await poolPromise;
        await pool.request().input('MaDon', maDon).input('TrangThai', trangThaiMoi).query("UPDATE DonHangOnline SET TrangThai = @TrangThai WHERE MaDon = @MaDon");
        if (trangThaiMoi === 'Hoàn thành' && sdt) {
            const diemCong = Math.floor(tongTien / 10000); 
            const checkKhach = await pool.request().input('SDT', sdt).query("SELECT MaKH FROM KhachHang WHERE SoDienThoai = @SDT");
            if (checkKhach.recordset.length > 0) {
                await pool.request().input('SDT', sdt).input('Diem', diemCong).query("UPDATE KhachHang SET DiemTichLuy = DiemTichLuy + @Diem WHERE SoDienThoai = @SDT");
            } else {
                await pool.request().input('TenKH', tenKhach || 'Khách Online').input('SDT', sdt).input('Diem', diemCong)
                    .query("INSERT INTO KhachHang (TenKH, SoDienThoai, DiemTichLuy) VALUES (@TenKH, @SDT, @Diem)");
            }
        }
        res.json({ success: true, message: 'Đã cập nhật trạng thái đơn hàng!' });
    } catch (err) { res.json({ success: false, message: 'Lỗi máy chủ!' }); }
});

app.get('/api/order-details/:maDon', async (req, res) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request().input('MaHD', req.params.maDon).query(`
            SELECT sp.TenSP, ct.SoLuong, ct.DonGia
            FROM ChiTietDonOnline ct
            JOIN SanPham sp ON ct.MaSP = sp.MaSP
            WHERE ct.MaDon = @MaHD
        `);
        res.json({ success: true, items: result.recordset });
    } catch (err) { res.json({ success: false }); }
});

// ==========================================
//        12 & 13. KHUYẾN MÃI (VOUCHER)
// ==========================================
app.post('/api/check-voucher', async (req, res) => {
    const { maVoucher, tongTienDon } = req.body;
    try {
        const pool = await poolPromise;
        const result = await pool.request().input('MaVoucher', maVoucher).query(`
            SELECT * FROM KhuyenMai WHERE MaVoucher = @MaVoucher AND TrangThai = 1 AND NgayKetThuc >= GETDATE() AND (SoLuong > 0 OR SoLuong = -1)
        `);
        if (result.recordset.length === 0) return res.json({ success: false, message: 'Mã không tồn tại hoặc đã hết hạn!' });
        
        const voucher = result.recordset[0];
        if (tongTienDon < voucher.DonHangToiThieu) return res.json({ success: false, message: `Mã này chỉ áp dụng cho đơn từ ${voucher.DonHangToiThieu.toLocaleString('vi-VN')} đ` });
        
        let tienGiam = (tongTienDon * voucher.PhanTramGiam) / 100;
        if (voucher.SoTienGiamToiDa > 0 && tienGiam > voucher.SoTienGiamToiDa) tienGiam = voucher.SoTienGiamToiDa;
        
        res.json({ success: true, tienGiam: tienGiam, message: `Áp dụng thành công! Đã giảm ${tienGiam.toLocaleString('vi-VN')} đ` });
    } catch (err) { res.status(500).json({ success: false, message: 'Lỗi hệ thống' }); }
});

app.get('/vouchers', async (req, res) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request().query('SELECT * FROM KhuyenMai ORDER BY MaKM DESC');
        res.render('vouchers', { vouchers: result.recordset });
    } catch (err) { res.send('Lỗi tải danh sách khuyến mãi'); }
});
app.post('/vouchers/add', async (req, res) => {
    const { maVoucher, tenCT, phanTram, giamToiDa, donToiThieu, ngayKT } = req.body;
    try {
        const pool = await poolPromise;
        await pool.request()
            .input('MaVoucher', maVoucher).input('TenChuongTrinh', tenCT).input('PhanTram', phanTram).input('ToiDa', giamToiDa).input('ToiThieu', donToiThieu).input('NgayKT', ngayKT)
            .query(`INSERT INTO KhuyenMai (MaVoucher, TenChuongTrinh, PhanTramGiam, SoTienGiamToiDa, DonHangToiThieu, NgayKetThuc) VALUES (@MaVoucher, @TenChuongTrinh, @PhanTram, @ToiDa, @ToiThieu, @NgayKT)`);
        res.redirect('/vouchers');
    } catch (err) { res.send('Lỗi thêm khuyến mãi!'); }
});
app.post('/vouchers/toggle', async (req, res) => {
    try {
        const pool = await poolPromise;
        await pool.request().input('MaKM', req.body.maKM).input('TrangThai', req.body.trangThai).query('UPDATE KhuyenMai SET TrangThai = @TrangThai WHERE MaKM = @MaKM');
        res.redirect('/vouchers');
    } catch (err) { res.send('Lỗi cập nhật trạng thái'); }
});

// Chạy server
app.listen(port, () => {
    console.log(`Server đang chạy tại http://localhost:${port}`);
});