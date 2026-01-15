// Configuration
const CONFIG = {
    mapCenter: [14.464200, 44.590200], // Yemen - Taiz coordinates
    mapZoom: 15,
    apiKey: 'AIzaSyBuNjzvFZYnieWTJGRxyQunPmHliOmZDQc',
    longPressDelay: 800, // milliseconds for long press
    maxFileSize: 10 * 1024 * 1024, // 10MB
    // استخدم API_CONFIG من config.js أو استخدم localhost كـ default
    apiUrl: typeof API_CONFIG !== 'undefined' ? API_CONFIG.apiUrl : 'http://localhost:3000/api'
};

// Helper function for API requests with ngrok header
function apiRequest(url, options = {}) {
    const defaultHeaders = {
        'Content-Type': 'application/json',
        'ngrok-skip-browser-warning': 'true'
    };
    
    return fetch(url, {
        ...options,
        headers: {
            ...defaultHeaders,
            ...(options.headers || {})
        }
    });
}

// Tile layers for map switching
const TILE_LAYERS = {
    dark: {
        name: 'خريطة داكنة',
        url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
        attribution: '© OpenStreetMap contributors © CARTO'
    },
    satellite: {
        name: 'قمر صناعي (USGS)',
        url: 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}',
        attribution: '© USGS'
    },
    satellite_esri: {
        name: 'قمر صناعي (Esri)',
        url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        attribution: '© Esri'
    },
    hybrid: {
        name: 'هجين',
        url: 'https://{s}.tile.openstreetmap.de/tiles/osmde/{z}/{x}/{y}.png',
        attribution: '© OpenStreetMap contributors'
    }
};

// Local Unit Conversion Rules
const LOCAL_UNITS = {
    'صنعاء': {
        unitName: 'لبنة',
        unitValue: 44.44, // 1 لبنة = 44.44 متر مربع
        calculation: (m2) => m2 / 44.44
    },
    'ذمار': {
        unitName: 'حبل',
        unitValue: 127.99, // 1 حبل = 2.88 لبنة = 127.99 متر مربع
        calculation: (m2) => m2 / 127.99
    }
};

// Function to convert area to local unit
function convertAreaToLocalUnit(areaMeter, governorate) {
    if (!areaMeter || areaMeter <= 0) return null;
    
    const config = LOCAL_UNITS[governorate];
    if (!config) return null;
    
    return {
        governorate: governorate,
        area_m2: areaMeter,
        local_unit: config.unitName,
        value: parseFloat((config.calculation(areaMeter)).toFixed(2)),
        calculation_details: `${areaMeter} م² ÷ ${config.unitValue} = ${parseFloat((config.calculation(areaMeter)).toFixed(2))} ${config.unitName}`
    };
}

// State Management
const state = {
    map: null,
    currentLayer: null,
    currentTileLayer: 'dark',
    currentLand: null,
    drawingMode: false,
    drawingPoints: [],
    currentPolygon: null,
    currentCenter: null,
    centerMarker: null,
    tempMarkers: [],
    lands: [],
    selectedLandId: null,
    uploadedFiles: [],
    userLocation: null,
    fullscreenMode: false,
    panelHidden: false,
    sidebarHidden: false,
    persistentCoordMarker: null, // Marker from coordinates input
    markerLayer: null, // Separate layer for markers to keep them visible
};

// Initialize App
document.addEventListener('DOMContentLoaded', () => {
    initMap();
    initEventListeners();
    loadLandsFromServer();
    getUserLocation();
    setupResponsiveHandlers();
    
    // Expose functions to window for use in HTML onclick handlers
    window.viewLandDetails = viewLandDetails;
    
    // Image modal event listeners
    document.getElementById('imageModalClose').addEventListener('click', closeImageModal);
    document.getElementById('imagePrevBtn').addEventListener('click', prevImage);
    document.getElementById('imageNextBtn').addEventListener('click', nextImage);
    
    // Close modal when clicking outside
    document.getElementById('imageModal').addEventListener('click', (e) => {
        if (e.target.id === 'imageModal') closeImageModal();
    });
    
    // Keyboard navigation
    document.addEventListener('keydown', (e) => {
        const modal = document.getElementById('imageModal');
        if (modal.classList.contains('active')) {
            if (e.key === 'ArrowRight') prevImage();
            if (e.key === 'ArrowLeft') nextImage();
            if (e.key === 'Escape') closeImageModal();
        }
    });
});

// Map Initialization
function initMap() {
    // Initialize Leaflet map with smooth zoom
    state.map = L.map('map', {
        center: CONFIG.mapCenter,
        zoom: CONFIG.mapZoom,
        zoomControl: false,  // Disable built-in zoom controls
        zoomAnimation: true,  // Enable smooth zoom animation
        fadeAnimation: true,  // Enable fade animation
        markerZoomAnimation: true  // Enable marker zoom animation
    });

    // Add dark tile layer by default
    state.currentLayer = L.tileLayer(TILE_LAYERS.dark.url, {
        attribution: TILE_LAYERS.dark.attribution,
        subdomains: 'abcd',
        maxZoom: 22
    }).addTo(state.map);

    // Create a custom pane for markers to ensure they stay on top
    if (!state.map.getPane('markerPane')) {
        state.map.createPane('markerPane');
        state.map.getPane('markerPane').style.zIndex = 650;
    }

    // Create a separate marker layer that stays on top
    state.markerLayer = L.featureGroup([], {
        pane: 'markerPane'
    }).addTo(state.map);

    // Add map layer toggle controls
    addMapLayerToggle();

    // Long press handler for drawing
    let pressTimer;
    state.map.on('mousedown', (e) => {
        if (!state.drawingMode) return;
        
        pressTimer = setTimeout(() => {
            addDrawingPoint(e.latlng);
        }, CONFIG.longPressDelay);
    });

    state.map.on('mouseup', () => {
        clearTimeout(pressTimer);
    });

    // Mobile touch support
    state.map.on('touchstart', (e) => {
        if (!state.drawingMode || !e.latlng) return;
        
        pressTimer = setTimeout(() => {
            addDrawingPoint(e.latlng);
        }, CONFIG.longPressDelay);
    });

    state.map.on('touchend', () => {
        clearTimeout(pressTimer);
    });

    // Click handler to remove persistent marker when interacting with map
    state.map.on('click', () => {
        if (state.persistentCoordMarker && !state.drawingMode) {
            state.markerLayer.removeLayer(state.persistentCoordMarker);
            state.persistentCoordMarker = null;
        }
    });
}

// Add Map Layer Toggle
function addMapLayerToggle() {
    const mapContainer = state.map.getContainer();
    
    // Layer toggle is now in the toolbar - no need to add button here
}

// Toggle Map Layer
function toggleTileLayer() {
    // Cycle through layers: dark → satellite → satellite_esri → hybrid → dark
    const layers = Object.keys(TILE_LAYERS);
    const currentIndex = layers.indexOf(state.currentTileLayer);
    const nextIndex = (currentIndex + 1) % layers.length;
    const newLayer = layers[nextIndex];
    
    try {
        // Remove current layer
        if (state.currentLayer) {
            state.map.removeLayer(state.currentLayer);
        }
        
        // Add new layer
        state.currentLayer = L.tileLayer(TILE_LAYERS[newLayer].url, {
            attribution: TILE_LAYERS[newLayer].attribution,
            maxZoom: 22
        }).addTo(state.map);
        
        // Bring marker layer back to top
        if (state.markerLayer) {
            state.markerLayer.bringToFront();
        }
        
        state.currentTileLayer = newLayer;
        
        // Update button tooltip
        const btn = document.getElementById('layerToggleBtn');
        if (btn) {
            btn.title = `تبديل الخريطة: ${TILE_LAYERS[newLayer].name}`;
        }
        
        showNotification(`تم التبديل إلى ${TILE_LAYERS[newLayer].name}`, 'success');
    } catch (error) {
        console.error('خطأ في تبديل الخريطة:', error);
        showNotification('خطأ في تبديل الخريطة', 'error');
    }
}

// Event Listeners
function initEventListeners() {
    // Add Land Button (FAB)
    document.getElementById('fabTogglePanel').addEventListener('click', startNewLand);

    // Go to Coordinates - with auto-navigation on Enter
    const coordsInput = document.getElementById('coordsInputField');
    coordsInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            goToCoordinates();
        }
    });
    
    // Also support paste event for auto-navigation
    coordsInput.addEventListener('paste', (e) => {
        setTimeout(() => {
            goToCoordinates();
        }, 10);
    });

    // Drawing Controls
    document.getElementById('confirmDrawing').addEventListener('click', finishDrawing);
    document.getElementById('cancelDrawingBtn').addEventListener('click', cancelDrawing);
    document.getElementById('undoDrawingBtn').addEventListener('click', undoDrawing);

    // Close Panel
    document.getElementById('panelCloseBtn').addEventListener('click', closeDetailsPanel);

    // Menu button (sidebar toggle)
    document.getElementById('menuBtn').addEventListener('click', toggleSidebar);
    
    // Close sidebar button
    document.getElementById('closeSidebarBtn').addEventListener('click', () => {
        const sidebarLeft = document.querySelector('.sidebar-left');
        const sidebarOverlay = document.getElementById('sidebarOverlay');
        sidebarLeft.classList.add('hidden');
        sidebarOverlay.classList.remove('active');
    });
    
    // Layer toggle button
    document.getElementById('layerToggleBtn').addEventListener('click', toggleTileLayer);
    
    // Add Land Button (in sidebar)
    document.getElementById('addLandBtn').addEventListener('click', startNewLand);
    
    // Delete Land Button
    document.getElementById('deleteLandBtn').addEventListener('click', deleteLand);

    // Form Submit
    document.getElementById('landForm').addEventListener('submit', saveLand);

    // File Upload
    const fileUploadArea = document.getElementById('fileUploadArea');
    const fileInput = document.getElementById('fileInput');

    fileUploadArea.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', handleFileSelect);

    // Area and Governorate change listeners
    document.getElementById('areaInput').addEventListener('change', updateLocalUnitDisplay);
    document.getElementById('governorateInput').addEventListener('change', updateLocalUnitDisplay);
    document.getElementById('localUnitInput').addEventListener('change', () => {
        updateAreaFromLocalUnit();
    });

    // Drag and Drop
    fileUploadArea.addEventListener('dragover', (e) => {
        e.preventDefault();
        fileUploadArea.style.borderColor = 'var(--accent-primary)';
    });

    fileUploadArea.addEventListener('dragleave', () => {
        fileUploadArea.style.borderColor = 'var(--border-color)';
    });

    fileUploadArea.addEventListener('drop', (e) => {
        e.preventDefault();
        fileUploadArea.style.borderColor = 'var(--border-color)';
        handleFileSelect({ target: { files: e.dataTransfer.files } });
    });

    // Search
    const searchInput = document.getElementById('searchInput');
    if (searchInput) {
        searchInput.addEventListener('input', filterLands);
    }

    // Navigate Button (optional)
    const navigateBtn = document.getElementById('navigateBtn');
    if (navigateBtn) {
        navigateBtn.addEventListener('click', navigateToLand);
    }
}

// Get User Location
function getUserLocation() {
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            (position) => {
                state.userLocation = {
                    lat: position.coords.latitude,
                    lng: position.coords.longitude
                };
                console.log('User location obtained:', state.userLocation);
            },
            (error) => {
                console.log('Location access denied or unavailable');
            }
        );
    }
}

// Start New Land
function startNewLand() {
    state.drawingMode = true;
    state.drawingPoints = [];
    state.selectedLandId = null;
    
    // Add drawing mode class to map for cursor
    const mapElement = document.getElementById('map');
    if (mapElement) {
        mapElement.classList.add('drawing-mode');
    }
    
    // Clear previous drawing
    if (state.currentPolygon) {
        state.map.removeLayer(state.currentPolygon);
        state.currentPolygon = null;
    }
    
    if (state.centerMarker) {
        state.map.removeLayer(state.centerMarker);
        state.centerMarker = null;
    }
    
    state.tempMarkers.forEach(marker => state.map.removeLayer(marker));
    state.tempMarkers = [];

    // Hide sidebar to give more space for drawing
    if (!state.sidebarHidden) {
        toggleSidebar();
    }

    // Show drawing instructions and controls
    document.getElementById('drawingInstructions').style.display = 'flex';
    document.getElementById('drawingControls').style.display = 'flex';
    
    // Auto-hide drawing instructions after 1.5 seconds
    setTimeout(() => {
        const instructions = document.getElementById('drawingInstructions');
        if (instructions && instructions.style.display === 'flex') {
            instructions.style.display = 'none';
        }
    }, 1500);
    
    // Don't hide sidebar and don't open details panel yet - wait until drawing is finished
    showNotification('ابدأ برسم حدود الأرض بالضغط المطول على الخريطة', 'info');
}

// Add Drawing Point
function addDrawingPoint(latlng) {
    state.drawingPoints.push([latlng.lat, latlng.lng]);
    
    // Add marker for this point (smaller size for better visibility)
    const marker = L.circleMarker(latlng, {
        radius: 5,
        fillColor: '#FF3B30',
        color: '#fff',
        weight: 2,
        fillOpacity: 0.9
    }).addTo(state.map);
    
    state.tempMarkers.push(marker);

    // Update points count
    document.getElementById('pointsCountDisplay').textContent = `${state.drawingPoints.length} نقطة`;

    // Draw polygon connecting all points with red lines
    if (state.drawingPoints.length >= 2) {
        if (state.currentPolygon) {
            state.map.removeLayer(state.currentPolygon);
        }
        
        // Draw polyline (not polygon) to show borders
        state.currentPolygon = L.polyline(state.drawingPoints, {
            color: '#FF3B30',
            weight: 3,
            opacity: 0.8,
            dashArray: '5, 5'
        }).addTo(state.map);
    }

    // When we have 3+ points, draw the polygon and center marker
    if (state.drawingPoints.length >= 3) {
        // Recalculate the full polygon
        const polygon = L.polygon(state.drawingPoints);
        const center = polygon.getBounds().getCenter();
        
        state.currentCenter = center;
        
        // Remove old center marker
        if (state.centerMarker) {
            state.map.removeLayer(state.centerMarker);
        }
        
        // Add white circle at center
        state.centerMarker = L.circleMarker(center, {
            radius: 10,
            fillColor: '#fff',
            color: '#00D9FF',
            weight: 3,
            fillOpacity: 1
        }).addTo(state.map);

        // Calculate area
        const area = calculatePolygonArea(state.drawingPoints);
        document.getElementById('landArea').value = Math.round(area);
        document.getElementById('areaInput').value = Math.round(area);
        
        // Auto-fill center coordinates
        document.getElementById('autoLat').textContent = center.lat.toFixed(6);
        document.getElementById('autoLng').textContent = center.lng.toFixed(6);
        
        // Auto-fill province based on location (you can enhance this)
        document.getElementById('governorateInput').value = 'ذمار'; // Default
    }

    // Show success feedback
    showNotification('تم إضافة نقطة', 'success');
}

// Calculate Polygon Area (using Leaflet's built-in method)
function calculatePolygonArea(points) {
    if (points.length < 3) return 0;
    
    // Using Shoelace formula for more accurate area calculation
    let area = 0;
    for (let i = 0; i < points.length; i++) {
        const j = (i + 1) % points.length;
        const lat1 = points[i][0] * Math.PI / 180;
        const lat2 = points[j][0] * Math.PI / 180;
        const lon1 = points[i][1];
        const lon2 = points[j][1];
        
        area += Math.sin(lat1) * (lon2 - lon1);
    }
    
    // Earth radius in meters
    const R = 6371000;
    area = Math.abs(area * R * R / 2);
    return area;
}

// Get Province from Coordinates
function getProvinceFromCoordinates(lat, lng) {
    // Approximate Yemen provinces boundaries
    // This is a simplified version - in production use proper geolocation service
    
    if (lat >= 12 && lat <= 15 && lng >= 43 && lng <= 45) return 'تعز';
    if (lat >= 13 && lat <= 16 && lng >= 44 && lng <= 46) return 'عدن';
    if (lat >= 15 && lat <= 17 && lng >= 48 && lng <= 50) return 'حضرموت';
    if (lat >= 14 && lat <= 16 && lng >= 45 && lng <= 47) return 'لحج';
    if (lat >= 12 && lat <= 14 && lng >= 42 && lng <= 44) return 'إب';
    if (lat >= 14 && lat <= 16 && lng >= 43 && lng <= 45) return 'الضالع';
    if (lat >= 16 && lat <= 18 && lng >= 46 && lng <= 48) return 'شبوة';
    if (lat >= 17 && lat <= 19 && lng >= 45 && lng <= 47) return 'محافظة المهرة';
    
    return 'اليمن';
}

// Finish Drawing
function finishDrawing() {
    if (state.drawingPoints.length < 3) {
        showNotification('يجب تحديد 3 نقاط على الأقل', 'error');
        return;
    }

    state.drawingMode = false;
    
    // Remove drawing mode class from map
    const mapElement = document.getElementById('map');
    if (mapElement) {
        mapElement.classList.remove('drawing-mode');
    }
    
    document.getElementById('drawingInstructions').style.display = 'none';
    document.getElementById('drawingControls').style.display = 'none';
    
    showNotification('تم إنهاء الرسم بنجاح', 'success');
    
    // Now open details panel to enter land information
    setTimeout(() => {
        // Calculate area
        const area = calculatePolygonArea(state.drawingPoints);
        
        // Calculate center
        let centerLat = 0, centerLng = 0;
        state.drawingPoints.forEach(point => {
            centerLat += point[0];
            centerLng += point[1];
        });
        centerLat /= state.drawingPoints.length;
        centerLng /= state.drawingPoints.length;
        
        // Get province
        const province = getProvinceFromCoordinates(centerLat, centerLng);
        
        // Update input fields
        document.getElementById('governorateInput').value = province;
        document.getElementById('areaInput').value = Math.round(area);
        document.getElementById('autoLat').textContent = centerLat.toFixed(6);
        document.getElementById('autoLng').textContent = centerLng.toFixed(6);
        
        // Store for saving later
        state.currentLand = {
            province: province,
            area: area,
            centerLat: centerLat,
            centerLng: centerLng
        };
        
        // Trigger local unit display update
        updateLocalUnitDisplay();
        
        // Open details panel
        openDetailsPanel();
        resetForm();
    }, 500);
}

// Cancel Drawing
function cancelDrawing() {
    state.drawingMode = false;
    
    // Remove drawing mode class from map
    const mapElement = document.getElementById('map');
    if (mapElement) {
        mapElement.classList.remove('drawing-mode');
    }
    
    state.drawingPoints = [];
    
    if (state.currentPolygon) {
        state.map.removeLayer(state.currentPolygon);
        state.currentPolygon = null;
    }
    
    if (state.centerMarker) {
        state.map.removeLayer(state.centerMarker);
        state.centerMarker = null;
    }
    
    state.tempMarkers.forEach(marker => state.map.removeLayer(marker));
    state.tempMarkers = [];
    state.currentCenter = null;
    
    document.getElementById('drawingInstructions').style.display = 'none';
    document.getElementById('drawingControls').style.display = 'none';
    
    // Show sidebar again
    if (state.sidebarHidden) {
        toggleSidebar();
    }
    
    // Close details panel and show normal state
    closeDetailsPanel();
    showNotification('تم إلغاء الرسم', 'info');
}

// Undo Last Point
function undoDrawing() {
    if (state.drawingPoints.length === 0) {
        showNotification('لا توجد نقاط لحذفها', 'warning');
        return;
    }

    // Remove last point from array
    state.drawingPoints.pop();

    // Remove last marker from map
    if (state.tempMarkers.length > 0) {
        const lastMarker = state.tempMarkers.pop();
        state.map.removeLayer(lastMarker);
    }

    // Update points count
    document.getElementById('pointsCountDisplay').textContent = state.drawingPoints.length + ' نقطة';

    // Redraw polygon
    if (state.currentPolygon) {
        state.map.removeLayer(state.currentPolygon);
        state.currentPolygon = null;
    }

    if (state.drawingPoints.length >= 3) {
        state.currentPolygon = L.polyline(state.drawingPoints, {
            color: '#00D9FF',
            weight: 2,
            opacity: 0.7,
            dashArray: '5, 5'
        }).addTo(state.map);
    }

    showNotification('تم حذف آخر نقطة', 'info');
}

// Go to Coordinates
function goToCoordinates() {
    const input = document.getElementById('coordsInputField').value.trim();
    
    if (!input) {
        return;
    }
    
    // Parse the input: "lat, lng" format
    const parts = input.split(',').map(p => p.trim());
    
    if (parts.length !== 2) {
        showNotification('الرجاء إدخال الإحداثيات بصيغة: خط العرض, خط الطول', 'error');
        return;
    }
    
    const lat = parseFloat(parts[0]);
    const lng = parseFloat(parts[1]);

    if (isNaN(lat) || isNaN(lng)) {
        showNotification('الرجاء إدخال إحداثيات صحيحة', 'error');
        return;
    }

    // Remove old persistent marker if exists
    if (state.persistentCoordMarker) {
        state.markerLayer.removeLayer(state.persistentCoordMarker);
    }

    // Navigate to coordinates with moderate zoom level
    state.map.flyTo([lat, lng], 17, {
        duration: 1.5
    });

    // Add persistent marker to marker layer
    state.persistentCoordMarker = L.marker([lat, lng], {
        icon: L.icon({
            iconUrl: 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMzIiIGhlaWdodD0iNDgiIHZpZXdCb3g9IjAgMCAzMiA0OCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48Y2lyY2xlIGN4PSIxNiIgY3k9IjE2IiByPSIxMiIgZmlsbD0iIzAwRDlGRiIvPjxwYXRoIGQ9Ik0xNiAwQzguMjc1IDAgMiA2LjI3NSAyIDE0YzAgMTAgMTQgMzQgMTQgMzRzMTQtMjQgMTQtMzRjMC03LjcyNS01LjI3NS0xNC0xMi0xNHoiIGZpbGw9IiMwMEQ5RkYiLz48L3N2Zz4=',
            iconSize: [32, 48],
            iconAnchor: [16, 48]
        })
    }).bindPopup('الإحداثيات المحددة');
    
    state.markerLayer.addLayer(state.persistentCoordMarker);
}

// File Handling
function handleFileSelect(e) {
    const files = Array.from(e.target.files);
    
    files.forEach(file => {
        if (file.size > CONFIG.maxFileSize) {
            showNotification(`الملف ${file.name} أكبر من 10MB`, 'error');
            return;
        }

        const reader = new FileReader();
        reader.onload = (event) => {
            state.uploadedFiles.push({
                name: file.name,
                size: formatFileSize(file.size),
                data: event.target.result,
                type: file.type
            });
            renderUploadedFiles();
        };
        reader.readAsDataURL(file);
    });
}

function renderUploadedFiles() {
    const container = document.getElementById('uploadedFiles');
    container.innerHTML = '';
    
    if (state.uploadedFiles.length === 0) {
        container.innerHTML = '<p style="text-align: center; color: rgba(255,255,255,0.5); padding: 10px;">لا توجد ملفات مرفوعة</p>';
        return;
    }
    
    // Separate images and other files
    const images = state.uploadedFiles.filter(f => f.type && f.type.startsWith('image/'));
    const otherFiles = state.uploadedFiles.filter(f => !f.type || !f.type.startsWith('image/'));
    
    // Display images as gallery
    if (images.length > 0) {
        const imagesTitle = document.createElement('h4');
        imagesTitle.innerHTML = '<i class="fas fa-images"></i> الصور';
        imagesTitle.style.cssText = 'color: white; margin-bottom: 10px; font-size: 13px; font-weight: 600;';
        container.appendChild(imagesTitle);
        
        const gallery = document.createElement('div');
        gallery.className = 'image-gallery';
        gallery.style.cssText = 'display: grid; grid-template-columns: repeat(auto-fill, minmax(80px, 1fr)); gap: 10px; margin-bottom: 15px;';
        
        images.forEach((img, index) => {
            const thumb = document.createElement('div');
            thumb.style.cssText = `
                position: relative;
                cursor: pointer;
                border-radius: 8px;
                overflow: hidden;
                background: rgba(255,255,255,0.1);
                aspect-ratio: 1;
                transition: all 0.2s ease;
            `;
            
            const imgEl = document.createElement('img');
            imgEl.src = img.path || img.url;
            imgEl.style.cssText = 'width: 100%; height: 100%; object-fit: cover;';
            
            thumb.appendChild(imgEl);
            thumb.addEventListener('click', () => openImageModal(images, index));
            thumb.addEventListener('mouseover', () => {
                thumb.style.transform = 'scale(1.05)';
                thumb.style.boxShadow = '0 4px 16px rgba(255, 255, 255, 0.2)';
            });
            thumb.addEventListener('mouseout', () => {
                thumb.style.transform = 'scale(1)';
                thumb.style.boxShadow = 'none';
            });
            
            gallery.appendChild(thumb);
        });
        
        container.appendChild(gallery);
    }
    
    // Display other files
    if (otherFiles.length > 0) {
        const filesTitle = document.createElement('h4');
        filesTitle.innerHTML = '<i class="fas fa-file"></i> الملفات';
        filesTitle.style.cssText = 'color: white; margin-bottom: 10px; font-size: 13px; font-weight: 600;';
        container.appendChild(filesTitle);
        
        otherFiles.forEach(file => {
            const fileItem = document.createElement('div');
            fileItem.className = 'file-item';
            const isPdf = file.type === 'application/pdf';
            
            fileItem.innerHTML = `
                <i class="fas ${isPdf ? 'fa-file-pdf' : 'fa-file'}" style="color: ${isPdf ? '#FF9500' : '#00D9FF'}; font-size: 20px;"></i>
                <div class="file-info">
                    <span class="file-name">${file.name || file.file_name}</span>
                    <span class="file-size">${formatFileSize(file.size || 0)}</span>
                </div>
                <div class="file-actions">
                    <button class="btn-download" onclick="downloadFile('${file.path}', '${(file.name || file.file_name).replace(/'/g, "\\'")}')"><i class="fas fa-download"></i></button>
                </div>
            `;
            container.appendChild(fileItem);
        });
    }
}

// Open image modal
let currentImageIndex = 0;
let currentImages = [];

function openImageModal(images, index) {
    currentImages = images;
    currentImageIndex = index;
    const modal = document.getElementById('imageModal');
    const img = document.getElementById('imageModalImg');
    
    img.src = images[index].path || images[index].url;
    updateImageCounter();
    modal.classList.add('active');
}

function closeImageModal() {
    const modal = document.getElementById('imageModal');
    modal.classList.remove('active');
}

function nextImage() {
    currentImageIndex = (currentImageIndex + 1) % currentImages.length;
    const img = document.getElementById('imageModalImg');
    img.src = currentImages[currentImageIndex].path || currentImages[currentImageIndex].url;
    updateImageCounter();
}

function prevImage() {
    currentImageIndex = (currentImageIndex - 1 + currentImages.length) % currentImages.length;
    const img = document.getElementById('imageModalImg');
    img.src = currentImages[currentImageIndex].path || currentImages[currentImageIndex].url;
    updateImageCounter();
}

function updateImageCounter() {
    document.getElementById('imageCounter').textContent = `${currentImageIndex + 1}/${currentImages.length}`;
}

function removeFile(fileId) {
    if (!fileId) return;
    
    fetch(`${CONFIG.apiUrl}/files/${fileId}`, {
        method: 'DELETE',
        headers: {
            'ngrok-skip-browser-warning': 'true'
        }
    })
    .then(res => {
        if (res.ok) {
            state.uploadedFiles = state.uploadedFiles.filter(f => f.id !== fileId);
            renderUploadedFiles();
            showNotification('تم حذف الملف بنجاح', 'success');
        }
    })
    .catch(err => console.error('خطأ في حذف الملف:', err));
}

function formatFileSize(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function downloadFile(filePath, fileName) {
    const link = document.createElement('a');
    link.href = `/uploads/${filePath.split('/').pop()}`;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

// Save Land
function saveLand(e) {
    e.preventDefault();
    
    // If viewing existing land, update it instead
    if (state.selectedLandId) {
        updateLand();
        return;
    }
    
    console.log('🔍 بدء حفظ الأرض');
    console.log('📍 عدد النقاط:', state.drawingPoints.length);

    if (state.drawingPoints.length < 3) {
        showNotification('يجب تحديد حدود الأرض أولاً', 'error');
        return;
    }

    const landName = document.getElementById('landName').value;
    if (!landName.trim()) {
        showNotification('يجب إدخال اسم الأرض', 'error');
        return;
    }

    const areaValue = parseFloat(document.getElementById('areaInput').value) || 0;
    const province = document.getElementById('governorateInput').value;

    if (!areaValue || !province) {
        showNotification('يجب إدخال المساحة واختيار المحافظة', 'error');
        return;
    }

    const holderName = document.getElementById('holderName').value.trim();
    const holderPhone = document.getElementById('holderPhone').value.trim();
    
    // Validate phone if provided
    let fullPhoneNumber = null;
    if (holderPhone) {
        if (!/^\d{9}$/.test(holderPhone)) {
            showNotification('رقم الهاتف يجب أن يكون 9 أرقام', 'error');
            return;
        }
        fullPhoneNumber = '+967' + holderPhone;
    }

    const landData = {
        name: landName,
        description: document.getElementById('landDescription').value,
        province: province,
        area: areaValue,
        holderName: holderName || null,
        holderPhone: fullPhoneNumber,
        centerLat: state.currentLand?.centerLat || state.drawingPoints[0]?.[0] || 0,
        centerLng: state.currentLand?.centerLng || state.drawingPoints[0]?.[1] || 0,
        points: state.drawingPoints,
        files: state.uploadedFiles,
        createdAt: new Date().toISOString()
    };

    console.log('📦 بيانات الأرض:', landData);
    
    // Save to server
    saveLandToServer(landData);
    
    // Don't save to local storage if server is available
    // saveLandsToStorage();
    // renderLandsList();
    // updateStats();
    
    // Draw polygon on map permanently
    // drawLandOnMap(landData);
    
    showNotification('✅ جاري حفظ الأرض في قاعدة البيانات...', 'success');
    closeDetailsPanel();
    resetDrawing();
}

// Update Land
async function updateLand() {
    const landId = state.selectedLandId;
    if (!landId) return;

    const landName = document.getElementById('landName').value;
    if (!landName.trim()) {
        showNotification('يجب إدخال اسم الأرض', 'error');
        return;
    }

    const areaValue = parseFloat(document.getElementById('areaInput').value) || 0;
    const province = document.getElementById('governorateInput').value;

    if (!areaValue || !province) {
        showNotification('يجب إدخال المساحة واختيار المحافظة', 'error');
        return;
    }

    const holderName = document.getElementById('holderName').value.trim();
    const holderPhone = document.getElementById('holderPhone').value.trim();
    
    // Validate phone if provided
    let fullPhoneNumber = null;
    if (holderPhone) {
        if (!/^\d{9}$/.test(holderPhone)) {
            showNotification('رقم الهاتف يجب أن يكون 9 أرقام', 'error');
            return;
        }
        fullPhoneNumber = '+967' + holderPhone;
    }

    const updateData = {
        name: landName,
        description: document.getElementById('landDescription').value,
        province: province,
        area: areaValue,
        holderName: holderName || null,
        holderPhone: fullPhoneNumber,
        centerLat: state.drawingPoints[0]?.[0] || 0,
        centerLng: state.drawingPoints[0]?.[1] || 0,
        points: state.drawingPoints
    };

    try {
        const response = await fetch(`${CONFIG.apiUrl}/lands/${landId}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'ngrok-skip-browser-warning': 'true'
            },
            body: JSON.stringify(updateData)
        });

        if (response.ok) {
            showNotification('✅ تم تحديث الأرض بنجاح', 'success');
            
            // Update local state
            const landIndex = state.lands.findIndex(l => l.id === landId);
            if (landIndex !== -1) {
                state.lands[landIndex] = {...state.lands[landIndex], ...updateData};
            }
            
            closeDetailsPanel();
            resetForm();
            loadLandsFromServer();
        } else {
            const error = await response.json();
            showNotification('خطأ: ' + (error.error || 'فشل تحديث الأرض'), 'error');
        }
    } catch (error) {
        console.error('خطأ في تحديث الأرض:', error);
        showNotification('خطأ في الاتصال بالخادم', 'error');
    }
}

// Save Land to Server
async function saveLandToServer(landData) {
    try {
        console.log('📤 بدء إرسال الأرض إلى الخادم:', landData);
        
        const requestBody = {
            name: landData.name,
            description: landData.description,
            province: landData.province,
            area: landData.area,
            centerLat: state.currentLand?.centerLat || 0,
            centerLng: state.currentLand?.centerLng || 0,
            points: landData.points,
            createdAt: landData.createdAt
        };
        
        console.log('📋 بيانات الطلب:', requestBody);
        
        const response = await fetch(`${CONFIG.apiUrl}/lands`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'ngrok-skip-browser-warning': 'true'
            },
            body: JSON.stringify(requestBody)
        });
        
        console.log('📍 استجابة الخادم:', response.status, response.statusText);
        
        if (response.ok) {
            const result = await response.json();
            console.log('✅ تم حفظ الأرض في قاعدة البيانات:', result);
            showNotification('✅ تم حفظ الأرض بنجاح!', 'success');
            loadLandsFromServer(); // Refresh lands from server
        } else {
            const errorText = await response.text();
            console.error('❌ خطأ في حفظ الأرض:', response.statusText, errorText);
            showNotification('❌ خطأ في حفظ الأرض: ' + response.statusText, 'error');
        }
    } catch (error) {
        console.error('❌ خطأ في الاتصال بالخادم:', error);
        showNotification('❌ خطأ في الاتصال بالخادم: ' + error.message, 'error');
    }
}

// Draw Land on Map
function drawLandOnMap(land) {
    if (!land.points || land.points.length === 0) return;
    
    const polygon = L.polygon(land.points, {
        color: '#FF3B30',
        fillColor: '#FF3B30',
        fillOpacity: 0.2,
        weight: 2
    }).addTo(state.map);

    // Click handler for polygon
    polygon.on('click', (e) => {
        L.DomEvent.stopPropagation(e);
        console.log('✓ Polygon clicked for land:', land.id, land.name);
        viewLandDetails(land.id);
    });

    // Calculate center point
    let centerLat = 0, centerLng = 0;
    land.points.forEach(point => {
        centerLat += point[0];
        centerLng += point[1];
    });
    centerLat /= land.points.length;
    centerLng /= land.points.length;

    // Create custom popup content with full land details
    const popupContainer = document.createElement('div');
    popupContainer.style.cssText = `
        text-align: right;
        direction: rtl;
        width: 380px;
        max-height: 600px;
        overflow-y: auto;
        background: #f5f5f5;
        border-radius: 12px;
    `;

    // Title
    const titleDiv = document.createElement('div');
    titleDiv.textContent = land.name;
    titleDiv.style.cssText = `
        color: #1c1c1c;
        font-size: 16px;
        font-weight: 700;
        margin-bottom: 12px;
        font-family: 'Cairo', sans-serif;
        padding: 12px 16px 0;
    `;
    popupContainer.appendChild(titleDiv);

    // Info grid
    const infoContainer = document.createElement('div');
    infoContainer.style.cssText = `
        padding: 12px 16px;
        font-size: 13px;
        color: #333;
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 12px;
        font-family: 'Cairo', sans-serif;
    `;

    const addInfoField = (label, value) => {
        const field = document.createElement('div');
        field.style.cssText = `padding: 6px; background: white; border-radius: 6px;`;
        const labelEl = document.createElement('div');
        labelEl.style.cssText = `font-size: 11px; color: #666; margin-bottom: 2px; font-weight: 600;`;
        labelEl.textContent = label;
        const valueEl = document.createElement('div');
        valueEl.style.cssText = `font-size: 12px; color: #000; font-weight: 600;`;
        valueEl.textContent = value || 'غير محدد';
        field.appendChild(labelEl);
        field.appendChild(valueEl);
        infoContainer.appendChild(field);
    };

    addInfoField('المحافظة', land.province);
    addInfoField('المساحة', `${land.area} م²`);
    
    // Calculate local units for display
    if (land.province && land.area) {
        const localUnits = convertAreaToLocalUnit(land.area, land.province);
        if (localUnits && localUnits.value) {
            const unitName = land.province === 'صنعاء' ? 'لبنة' : 'حبل';
            addInfoField(unitName, localUnits.value.toFixed(2));
        }
    }

    if (land.description) {
        addInfoField('الوصف', land.description);
    }

    const lat = land.centerLat ? parseFloat(land.centerLat) : null;
    const lng = land.centerLng ? parseFloat(land.centerLng) : null;
    addInfoField('الموقع', `${lat ? lat.toFixed(4) : '-'}, ${lng ? lng.toFixed(4) : '-'}`);
    
    // Add holder information
    if (land.holderName || land.holderPhone) {
        const holderDiv = document.createElement('div');
        holderDiv.style.cssText = `
            padding: 12px 16px;
            border-top: 1px solid #ddd;
            border-bottom: 1px solid #ddd;
            font-family: 'Cairo', sans-serif;
        `;
        
        const holderTitle = document.createElement('div');
        holderTitle.textContent = 'الحائز الحالي';
        holderTitle.style.cssText = `
            font-size: 12px;
            font-weight: 700;
            color: #3b82f6;
            margin-bottom: 8px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        `;
        holderDiv.appendChild(holderTitle);
        
        if (land.holderName) {
            const nameDiv = document.createElement('div');
            nameDiv.style.cssText = `font-size: 13px; color: #000; font-weight: 600; margin-bottom: 4px;`;
            nameDiv.textContent = land.holderName;
            holderDiv.appendChild(nameDiv);
        }
        
        if (land.holderPhone) {
            const phoneDiv = document.createElement('div');
            const phoneLink = document.createElement('a');
            phoneLink.href = `tel:${land.holderPhone}`;
            phoneLink.textContent = land.holderPhone;
            phoneLink.style.cssText = `
                font-size: 12px;
                color: #3b82f6;
                font-weight: 600;
                text-decoration: none;
                cursor: pointer;
                display: inline-block;
                padding: 2px 0;
                border-bottom: 1px solid #3b82f6;
            `;
            phoneLink.addEventListener('mouseover', () => {
                phoneLink.style.color = '#2563eb';
            });
            phoneLink.addEventListener('mouseout', () => {
                phoneLink.style.color = '#3b82f6';
            });
            phoneDiv.appendChild(phoneLink);
            holderDiv.appendChild(phoneDiv);
        }
        
        popupContainer.appendChild(holderDiv);
    }

    popupContainer.appendChild(infoContainer);

    // Files/Images section
    if (land.files && land.files.length > 0) {
        const filesTitle = document.createElement('div');
        filesTitle.textContent = 'المرفقات والصور';
        filesTitle.style.cssText = `
            font-size: 12px;
            font-weight: 700;
            color: #333;
            padding: 8px 16px 4px;
            font-family: 'Cairo', sans-serif;
        `;
        popupContainer.appendChild(filesTitle);

        const filesContainer = document.createElement('div');
        filesContainer.style.cssText = `
            padding: 8px 16px;
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
        `;

        land.files.forEach(file => {
            const filePath = file.path || file.file_path || '';
            const isImage = filePath && /\.(jpg|jpeg|png|gif|webp)$/i.test(filePath);
            if (isImage) {
                const img = document.createElement('img');
                img.src = filePath;
                img.style.cssText = `
                    width: 60px;
                    height: 60px;
                    border-radius: 6px;
                    cursor: pointer;
                    object-fit: cover;
                    border: 2px solid #ddd;
                `;
                img.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const images = land.files.filter(f => {
                        const fpath = f.path || f.file_path || '';
                        return /\.(jpg|jpeg|png|gif|webp)$/i.test(fpath);
                    });
                    const index = images.indexOf(file);
                    openImageModal(images, index);
                });
                filesContainer.appendChild(img);
            }
        });

        popupContainer.appendChild(filesContainer);
    }

    // Action buttons
    const buttonsContainer = document.createElement('div');
    buttonsContainer.style.cssText = `
        display: flex;
        gap: 8px;
        padding: 12px 16px;
        border-top: 1px solid #ddd;
    `;

    // Edit button
    const editButton = document.createElement('button');
    editButton.textContent = 'تعديل';
    editButton.style.cssText = `
        flex: 1;
        padding: 8px;
        background: #4A90E2;
        border: none;
        border-radius: 6px;
        color: white;
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
        font-family: 'Cairo', sans-serif;
    `;
    editButton.addEventListener('click', (e) => {
        e.stopPropagation();
        viewLandDetails(land.id);
    });
    buttonsContainer.appendChild(editButton);

    // Delete button
    const deleteButton = document.createElement('button');
    deleteButton.textContent = 'حذف';
    deleteButton.style.cssText = `
        flex: 1;
        padding: 8px;
        background: #FF3B30;
        border: none;
        border-radius: 6px;
        color: white;
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
        font-family: 'Cairo', sans-serif;
    `;
    deleteButton.addEventListener('click', (e) => {
        e.stopPropagation();
        if (confirm('هل تريد حذف هذه الأرض؟')) {
            deleteLand(land.id);
        }
    });
    buttonsContainer.appendChild(deleteButton);

    popupContainer.appendChild(buttonsContainer);

    polygon.bindPopup(popupContainer, {
        className: 'land-popup',
        maxWidth: 300,
        autoPan: true,
        autoClose: false
    });

    // Add label with land name (small tooltip)
    const label = L.marker([centerLat, centerLng], {
        icon: L.divIcon({
            className: 'land-label',
            html: `<div class="land-label-text">${land.name}</div>`,
            iconSize: [180, 40],
            iconAnchor: [90, 20]
        })
    }).addTo(state.map);

    label.on('click', (e) => {
        L.DomEvent.stopPropagation(e);
        polygon.openPopup();
    });
}

// Draw Land Marker on Map (for predefined lands with single point)
function drawLandMarkerOnMap(land) {
    if (!land.points || land.points.length === 0) return;
    
    const point = land.points[0];
    const marker = L.circleMarker([point[0], point[1]], {
        radius: 12,
        fillColor: '#00D9FF',
        color: '#fff',
        weight: 2,
        fillOpacity: 0.9
    }).addTo(state.map);

    marker.bindPopup(`
        <div style="padding: 10px; text-align: right; direction: rtl;">
            <strong style="color: #00D9FF; font-size: 14px;">${land.name}</strong><br>
            <small style="color: rgba(255,255,255,0.7);">${land.province}</small><br>
            <small style="color: rgba(255,255,255,0.5);">${land.area} م²</small><br>
            <small style="color: #00D9FF; margin-top: 8px; display: block;">خط العرض: ${point[0].toFixed(6)}</small>
            <small style="color: #00D9FF;">خط الطول: ${point[1].toFixed(6)}</small>
        </div>
    `);

    marker.on('click', () => {
        viewLandDetails(land.id);
    });
}

// View Land Details
function viewLandDetails(landId) {
    // Convert to number if needed
    const id = parseInt(landId) || landId;
    console.log('🔍 viewLandDetails called with:', landId, 'converted to:', id);
    console.log('📊 Available lands:', state.lands.map(l => ({ id: l.id, name: l.name })));
    
    const land = state.lands.find(l => parseInt(l.id) === id || l.id === id);
    if (!land) {
        console.error('❌ Land not found:', id, 'Available lands:', state.lands.map(l => l.id));
        return;
    }
    
    console.log('✅ Land found:', land.name);

    state.selectedLandId = id;
    state.drawingPoints = land.points;
    state.uploadedFiles = land.files || [];
    
    // Update panel title
    const panelTitle = document.getElementById('panelTitle');
    if (panelTitle) {
        panelTitle.textContent = land.name;
    }

    // Populate form with editable fields
    document.getElementById('landName').value = land.name;
    document.getElementById('landDescription').value = land.description || '';
    document.getElementById('areaInput').value = land.area || 0;
    document.getElementById('governorateInput').value = land.province || '';
    
    // Populate holder information
    document.getElementById('holderName').value = land.holderName || '';
    if (land.holderPhone) {
        // Remove +967 prefix if it exists
        const phoneNumber = land.holderPhone.replace(/^\+967/, '');
        document.getElementById('holderPhone').value = phoneNumber;
    } else {
        document.getElementById('holderPhone').value = '';
    }
    
    // Handle centerLat and centerLng - ensure they're numbers before calling toFixed
    const lat = land.centerLat ? parseFloat(land.centerLat) : null;
    const lng = land.centerLng ? parseFloat(land.centerLng) : null;
    document.getElementById('autoLat').textContent = lat ? lat.toFixed(6) : '-';
    document.getElementById('autoLng').textContent = lng ? lng.toFixed(6) : '-';
    document.getElementById('landArea').value = land.area;

    // Update local unit display
    updateLocalUnitDisplay();

    // Hide file upload area when viewing existing land
    document.getElementById('fileUploadArea').style.display = 'none';
    
    // Update submit button text
    const submitBtn = document.querySelector('#landForm button[type="submit"]');
    if (submitBtn) {
        submitBtn.innerHTML = 'تحديث الأرض';
    }

    console.log('📄 Rendering files:', state.uploadedFiles);
    renderUploadedFiles();

    // Show navigate button and delete button
    document.getElementById('navigateBtn').style.display = 'block';
    document.getElementById('deleteLandBtn').style.display = 'block';

    // Highlight on map
    const centerPoint = land.points[0];
    if (centerPoint) {
        state.map.flyTo([centerPoint[0], centerPoint[1]], 16, { duration: 1.5 });
    }

    console.log('🎯 Opening details panel...');
    openDetailsPanel();
    highlightLandItem(id);
}

// Update Local Unit Display
function updateLocalUnitDisplay() {
    const areaInput = document.getElementById('areaInput');
    const governorateInput = document.getElementById('governorateInput');
    const localUnitInput = document.getElementById('localUnitInput');
    const localUnitLabel = document.getElementById('localUnitLabel');

    const area = parseFloat(areaInput.value) || 0;
    const governorate = governorateInput.value;

    if (area > 0 && governorate && LOCAL_UNITS[governorate]) {
        const conversion = convertAreaToLocalUnit(area, governorate);
        if (conversion) {
            localUnitLabel.textContent = conversion.local_unit;
            localUnitInput.placeholder = conversion.local_unit;
            localUnitInput.value = conversion.value.toFixed(2);
            
            // Update hidden field for saving
            document.getElementById('landArea').value = area;
        }
    } else {
        localUnitInput.value = '';
        localUnitLabel.textContent = '-';
    }
}

// Update area from local unit (reverse conversion)
function updateAreaFromLocalUnit() {
    const governorateInput = document.getElementById('governorateInput');
    const localUnitInput = document.getElementById('localUnitInput');
    const areaInput = document.getElementById('areaInput');

    const governorate = governorateInput.value;
    const localUnitValue = parseFloat(localUnitInput.value) || 0;

    if (localUnitValue > 0 && governorate && LOCAL_UNITS[governorate]) {
        const config = LOCAL_UNITS[governorate];
        const newArea = localUnitValue * config.unitValue;
        areaInput.value = newArea.toFixed(2);
        document.getElementById('landArea').value = newArea.toFixed(2);
    }
}

// Navigate to Land
function navigateToLand() {
    if (!state.userLocation) {
        showNotification('لا يمكن تحديد موقعك الحالي', 'error');
        return;
    }

    const land = state.lands.find(l => l.id === state.selectedLandId);
    if (!land) return;

    const destination = land.points[0];
    const url = `https://www.google.com/maps/dir/?api=1&origin=${state.userLocation.lat},${state.userLocation.lng}&destination=${destination[0]},${destination[1]}`;
    
    window.open(url, '_blank');
}

// Render Lands List
function renderLandsList() {
    const container = document.getElementById('landsList');
    
    if (state.lands.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <svg width="60" height="60" viewBox="0 0 60 60" fill="none">
                    <path d="M30 10L50 22V38L30 50L10 38V22L30 10Z" stroke="rgba(255,255,255,0.1)" stroke-width="2"/>
                </svg>
                <p>لا توجد أراضي مسجلة</p>
                <small>ابدأ بإضافة أرض جديدة</small>
            </div>
        `;
        return;
    }

    container.innerHTML = '';
    state.lands.forEach(land => {
        const landItem = document.createElement('div');
        landItem.className = 'land-item';
        landItem.innerHTML = `
            <div class="land-item-header">
                <span class="land-item-title">${land.name}</span>
                <span class="land-item-area">${land.area} م²</span>
            </div>
            <div class="land-item-info">
                <span class="land-item-province">${land.province || 'غير محدد'}</span>
                <span class="land-item-points">${land.points.length} نقطة</span>
            </div>
        `;
        landItem.addEventListener('click', () => viewLandDetails(land.id));
        container.appendChild(landItem);
    });
}

async function deleteLand(idParam) {
    const landId = idParam || state.selectedLandId;
    if (!landId) return;
    
    if (!confirm('هل تريد حذف هذه الأرض؟ لا يمكن التراجع عن هذا الإجراء')) {
        return;
    }
    
    try {
        const response = await fetch(`${CONFIG.apiUrl}/lands/${landId}`, {
            method: 'DELETE',
            headers: {
                'ngrok-skip-browser-warning': 'true'
            }
        });
        
        if (response.ok) {
            showNotification('تم حذف الأرض بنجاح', 'success');
            if (idParam) {
                // Reload from popup without closing panel
                state.lands = state.lands.filter(l => l.id != landId);
                loadLandsFromServer();
            } else {
                closeDetailsPanel();
                
                // Remove from local state
                state.lands = state.lands.filter(l => l.id !== landId);
                renderLandsList();
                updateStats();
                
                // Reload map
                state.map.eachLayer(layer => {
                    if (layer instanceof L.Polygon) {
                        state.map.removeLayer(layer);
                    }
                });
                loadLandsFromServer();
            }
        }
    } catch (error) {
        console.error('خطأ في حذف الأرض:', error);
        showNotification('خطأ في الاتصال بالخادم', 'error');
    }
}

function highlightLandItem(landId) {
    document.querySelectorAll('.land-item').forEach(item => {
        item.classList.remove('active');
    });
    
    const id = parseInt(landId) || landId;
    const index = state.lands.findIndex(l => parseInt(l.id) === id || l.id === id);
    if (index !== -1) {
        document.querySelectorAll('.land-item')[index].classList.add('active');
    }
}

// Filter Lands
function filterLands(e) {
    const query = e.target.value.toLowerCase();
    document.querySelectorAll('.land-item').forEach((item, index) => {
        const land = state.lands[index];
        const matches = land.name.toLowerCase().includes(query) || 
                       (land.province && land.province.toLowerCase().includes(query));
        item.style.display = matches ? 'block' : 'none';
    });
}

// Update Stats
function updateStats() {
    document.getElementById('totalLandsTop').textContent = state.lands.length;
    
    const totalArea = state.lands.reduce((sum, land) => sum + parseInt(land.area || 0), 0);
    document.getElementById('selectedAreaTop').textContent = totalArea.toLocaleString();
}

// Details Panel
function openDetailsPanel() {
    const detailsPanel = document.querySelector('.details-panel');
    const modalOverlay = document.querySelector('.modal-overlay');
    detailsPanel.classList.add('show');
    modalOverlay.classList.add('active');
    document.body.style.overflow = 'hidden';
}

function closeDetailsPanel() {
    const detailsPanel = document.querySelector('.details-panel');
    const modalOverlay = document.querySelector('.modal-overlay');
    detailsPanel.classList.remove('show');
    modalOverlay.classList.remove('active');
    document.body.style.overflow = 'auto';
    resetForm();
    resetDrawing();
}

function toggleDetailsPanel() {
    const detailsPanel = document.querySelector('.details-panel');
    if (detailsPanel.classList.contains('show')) {
        closeDetailsPanel();
    } else {
        closeDetailsPanel();
    }
}

// Toggle Sidebar
function toggleSidebar() {
    const sidebarLeft = document.querySelector('.sidebar-left');
    const sidebarOverlay = document.getElementById('sidebarOverlay');
    
    if (sidebarLeft.classList.contains('hidden')) {
        sidebarLeft.classList.remove('hidden');
        sidebarOverlay.classList.add('active');
    } else {
        sidebarLeft.classList.add('hidden');
        sidebarOverlay.classList.remove('active');
    }
}


// Fullscreen mode removed - not part of new design

// Reset Form
function resetForm() {
    document.getElementById('landForm').reset();
    state.uploadedFiles = [];
    state.selectedLandId = null;
    
    // Reset submit button text
    const submitBtn = document.querySelector('#landForm button[type="submit"]');
    if (submitBtn) {
        submitBtn.innerHTML = 'حفظ الأرض';
    }
    
    // Reset inputs
    document.getElementById('areaInput').value = '';
    document.getElementById('governorateInput').value = '';
    document.getElementById('localUnitInput').value = '';
    document.getElementById('holderName').value = '';
    document.getElementById('holderPhone').value = '';
    
    // Show file upload area again
    document.getElementById('fileUploadArea').style.display = 'block';
    
    renderUploadedFiles();
    document.getElementById('navigateBtn').style.display = 'none';
    document.getElementById('deleteLandBtn').style.display = 'none';
}

function resetDrawing() {
    state.drawingMode = false;
    state.drawingPoints = [];
    
    // Remove drawing mode class from map
    const mapElement = document.getElementById('map');
    if (mapElement) {
        mapElement.classList.remove('drawing-mode');
    }
    
    if (state.currentPolygon) {
        state.map.removeLayer(state.currentPolygon);
        state.currentPolygon = null;
    }
    
    if (state.centerMarker) {
        state.map.removeLayer(state.centerMarker);
        state.centerMarker = null;
    }
    
    state.tempMarkers.forEach(marker => state.map.removeLayer(marker));
    state.tempMarkers = [];
    state.currentCenter = null;
    
    const drawingIndicator = document.getElementById('drawingIndicator');
    if (drawingIndicator) {
        drawingIndicator.style.display = 'none';
    }
    
    // Show sidebar again if hidden
    if (state.sidebarHidden) {
        toggleSidebar();
    }
}

// Local Storage (replacing MySQL for now)
function saveLandsToStorage() {
    localStorage.setItem('yemenLands', JSON.stringify(state.lands));
}

function loadLandsFromStorage() {
    const stored = localStorage.getItem('yemenLands');
    if (stored) {
        state.lands = JSON.parse(stored);
        renderLandsList();
        updateStats();
        
        // Draw all lands on map
        state.lands.forEach(land => drawLandOnMap(land));
    }
}

// Load Lands from Server
async function loadLandsFromServer() {
    try {
        console.log('جاري تحميل الأراضي من الخادم...');
        console.log('📡 API URL:', CONFIG.apiUrl);
        const response = await fetch(`${CONFIG.apiUrl}/lands`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'ngrok-skip-browser-warning': 'true'
            }
        });
        
        if (response.ok) {
            const lands = await response.json();
            
            state.lands = lands || [];
            
            console.log(`✓ تم تحميل ${state.lands.length} أرض من الخادم`);
            
            renderLandsList();
            updateStats();
            
            // Clear existing polygons from map
            state.map.eachLayer(layer => {
                if (layer instanceof L.Polygon) {
                    state.map.removeLayer(layer);
                }
            });
            
            // Draw all lands on map
            state.lands.forEach(land => {
                if (land.points && land.points.length > 1) {
                    // Parse points if they are stored as JSON string
                    let points = land.points;
                    if (typeof points === 'string') {
                        try {
                            points = JSON.parse(points);
                        } catch (e) {
                            console.error('خطأ في parse النقاط:', e);
                            return;
                        }
                    }
                    drawLandOnMap({...land, points: points});
                }
            });
        } else {
            console.error('خطأ في جلب البيانات:', response.status, response.statusText);
            showNotification('خطأ في جلب الأراضي من قاعدة البيانات', 'error');
        }
    } catch (error) {
        console.error('خطأ في الاتصال بالخادم:', error);
        showNotification('خطأ في الاتصال بالخادم', 'error');
    }
}

// Utilities
function generateId() {
    return 'land_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

function showNotification(message, type = 'info') {
    // Create a temporary notification element if it doesn't exist
    let notifContainer = document.getElementById('notificationContainer');
    if (!notifContainer) {
        notifContainer = document.createElement('div');
        notifContainer.id = 'notificationContainer';
        notifContainer.style.cssText = `
            position: fixed;
            top: 80px;
            right: 20px;
            z-index: 2000;
            display: flex;
            flex-direction: column;
            gap: 10px;
        `;
        document.body.appendChild(notifContainer);
    }
    
    const notif = document.createElement('div');
    notif.style.cssText = `
        background: rgba(26, 26, 26, 0.95);
        border: 1px solid rgba(255, 255, 255, 0.2);
        border-radius: 8px;
        padding: 1rem;
        min-width: 300px;
        display: flex;
        align-items: center;
        gap: 0.75rem;
        animation: slideIn 0.3s ease;
        backdrop-filter: blur(20px);
    `;
    
    const colors = {
        success: '#10b981',
        error: '#ef4444',
        info: '#3b82f6'
    };
    
    notif.style.borderColor = colors[type];
    
    const icons = {
        success: 'fa-check-circle',
        error: 'fa-exclamation-circle',
        info: 'fa-info-circle'
    };
    
    notif.innerHTML = `
        <i class="fas ${icons[type]}" style="color: ${colors[type]}; font-size: 1.2rem;"></i>
        <span style="flex: 1; color: white; font-size: 0.9rem;">${message}</span>
    `;
    
    notifContainer.appendChild(notif);
    
    // Add animation
    if (!document.querySelector('style[data-notif-animation]')) {
        const style = document.createElement('style');
        style.setAttribute('data-notif-animation', 'true');
        style.textContent = `
            @keyframes slideIn {
                from {
                    opacity: 0;
                    transform: translateX(300px);
                }
                to {
                    opacity: 1;
                    transform: translateX(0);
                }
            }
        `;
        document.head.appendChild(style);
    }
    
    // Remove notification after 3 seconds
    setTimeout(() => {
        notif.style.animation = 'slideIn 0.3s ease reverse';
        setTimeout(() => notif.remove(), 300);
    }, 3000);
}

// Responsive UI Handlers
function setupResponsiveHandlers() {
    // Close sidebar when clicking overlay
    const sidebarOverlay = document.getElementById('sidebarOverlay');
    if (sidebarOverlay) {
        sidebarOverlay.addEventListener('click', () => {
            const sidebarLeft = document.querySelector('.sidebar-left');
            sidebarLeft.classList.add('hidden');
            sidebarOverlay.classList.remove('active');
        });
    }
    
    // Auto close details panel when clicking overlay
    const modalOverlay = document.querySelector('.modal-overlay');
    if (modalOverlay) {
        modalOverlay.addEventListener('click', closeDetailsPanel);
    }
    
    // Close panel when clicking close button
    const closeBtn = document.getElementById('panelCloseBtn');
    if (closeBtn) {
        closeBtn.addEventListener('click', closeDetailsPanel);
    }
}

// Export for global access
window.removeFile = removeFile;