// 🔧 Configuration File

const API_CONFIG = (() => {
    const hostname = window.location.hostname;
    const protocol = window.location.protocol;
    
    // إذا كان المضيف localhost أو 127.0.0.1 → استخدم localhost API
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
        return {
            apiUrl: 'http://localhost:3000/api'
        };
    }
    
    // إذا كان GitHub Pages أو أي domain آخر → استخدم ngrok
    return {
        apiUrl: 'https://ca60bccdadb0.ngrok-free.app/api'
    };
})();
