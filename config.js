// API Configuration

const API_CONFIG = (() => {
    const hostname = window.location.hostname;
    
    // Local development
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
        return {
            apiUrl: 'http://localhost:3000/api'
        };
    }
    
    // Production with ngrok
    return {
        apiUrl: 'https://7ff6fb80365b.ngrok-free.app/api'
    };
})();
