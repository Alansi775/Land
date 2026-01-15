# Land Registry System

A comprehensive property and land management platform designed to help people organize and manage their real estate and land holdings efficiently. Know exactly where your properties are located, who owns them, and access all the information you need instantly.

## Features

- Interactive map with Leaflet.js for visualizing properties
- Draw and define property boundaries with precision
- Store comprehensive property information (name, area, location, owner details)
- Responsive user interface with dark mode design
- Real-time updates and instant data synchronization
- Secure API backend with MySQL database
- Complete property search and filtering capabilities
- Property history and record management

## Quick Start

### Backend Setup

```bash
cd backend
npm install
npm start
```

The backend API server will start and be ready to handle requests.

### Frontend Setup

```bash
cd frontend
# Open index.html in your browser
# Or use a local server:
python -m http.server 8000
```

Then visit your local server in your browser.

## Deployment

### Using ngrok for Remote Backend Access

1. **Install ngrok:**
```bash
brew install ngrok/ngrok/ngrok
```

2. **Start ngrok tunnel:**
```bash
ngrok http 3000
```

3. **Update config.js with your ngrok URL:**
```javascript
const API_CONFIG = {
    apiUrl: 'https://your-ngrok-url.ngrok.io/api'
};
```

4. **Push to GitHub:**
```bash
git add .
git commit -m "Update API configuration"
git push
```

### Deploy to GitHub Pages

1. Enable GitHub Pages in your repository settings
2. Select `main` branch as the source
3. Access your site at: `https://USERNAME.github.io/Land/`

## Technologies Used

- **Frontend:** HTML5, CSS3, JavaScript (Vanilla)
- **Backend:** Node.js, Express.js
- **Database:** MySQL
- **Mapping:** Leaflet.js
- **UI Components:** Font Awesome 6.4.0

## Supported Browsers

- Chrome/Edge (latest version)
- Firefox (latest version)
- Safari (latest version)

## Project Structure

```
land/
├── frontend/          # Frontend application
│   ├── index.html    # Main HTML page
│   ├── styles.css    # Stylesheet
│   └── script.js     # JavaScript logic
├── backend/          # API backend
│   ├── server.js     # Main server file
│   ├── package.json  # Dependencies
│   └── .env          # Environment variables
└── database/         # Database files
    └── schema.sql    # Database schema
```

## Installation and Setup

### 1. Database Setup

```bash
mysql -u root -p < database/schema.sql
```

Or manually run the SQL commands from `database/schema.sql` in your MySQL client.

### 2. Install Dependencies

```bash
cd backend
npm install
```

### 3. Start the Server

```bash
npm start
```

For development with automatic reload:

```bash
npm run dev
```

### 4. Open the Frontend

1. Navigate to the `frontend` folder
2. Open `index.html` in your browser
3. Or use a local server (like Live Server)

## Environment Variables

Configure your `.env` file with the following settings:

```
PORT=5000
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=root
DB_NAME=myapp
```

## API Endpoints

### GET /
Test server connectivity

### GET /api/data
Retrieve all properties

### POST /api/items
Add a new property
```json
{
    "title": "Property Name",
    "description": "Property Description"
}
```

### POST /api/contact
Submit a contact message
```json
{
    "name": "Your Name",
    "email": "your.email@example.com",
    "message": "Your Message"
}
```

## Key Features

- Property management and organization
- Real-time data synchronization
- MySQL database integration
- RESTful API
- Error handling and validation
- Responsive design

## Important Notes

- Ensure MySQL is running before starting the server
- Update credentials in `.env` file as needed
- Make sure ports 5000 and 3306 are available
- Backup your database regularly

## Troubleshooting

If you encounter issues:
1. Verify that MySQL is running
2. Check that all dependencies are installed successfully
3. Ensure the database exists and tables are created
4. Review error logs for detailed information

---

Property Management Made Simple
