const sql = require('mssql/msnodesqlv8'); 
require('dotenv').config();

console.log('⏳ Đang kết nối tới LocalDB bằng ODBC Driver 17...');

// ÉP Node.js dùng đúng Driver 17 có sẵn trong máy tính của bạn
const config = {
    connectionString: 'Driver={ODBC Driver 17 for SQL Server};Server=(localdb)\\MSSQLLocalDB;Database=koicafe;Trusted_Connection=yes;'
};

const poolPromise = new sql.ConnectionPool(config)
    .connect()
    .then(pool => {
        console.log('✅ Đã kết nối THÀNH CÔNG tới SQL Server koicafe!');
        return pool;
    })
    .catch(err => {
        console.log('❌ KẾT NỐI THẤT BẠI. Lý do:', err.message);
        throw err; // Ném lỗi để báo đỏ, không cho server bị treo
    });

module.exports = {
    sql, poolPromise
};