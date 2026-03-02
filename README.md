# AI Smart Travel Planner

A comprehensive travel planning application that uses AI to generate personalized itineraries.

## Features
- **AI Itinerary Generation**: Personalized daily schedules based on your preferences.
- **Expense Tracking**: Manage your budget and track spending.
- **Interactive Maps**: Visualize your destination and saved places.
- **PDF Export**: Download your itinerary for offline use.
- **Weather Forecast**: Stay prepared with weather updates for your trip.

## Tech Stack
- **Frontend**: React, Tailwind CSS, Framer Motion, Lucide Icons.
- **Backend**: Node.js, Express.
- **Database**: SQLite (via better-sqlite3).
- **AI**: Google Gemini API.

## Setup
1. The application uses `better-sqlite3` for a relational database experience.
2. Gemini API key is required for AI features (automatically handled in this environment).
3. For maps, we use Leaflet (OpenStreetMap).

## Environment Variables
- `GEMINI_API_KEY`: Your Google Gemini API key.
- `JWT_SECRET`: Secret for signing authentication tokens.
- `APP_URL`: The base URL of the application.
