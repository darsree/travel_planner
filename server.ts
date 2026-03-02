import dotenv from "dotenv";
dotenv.config();
import express from "express";
import { createServer as createViteServer } from "vite";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import db from "./db.ts";
import { GoogleGenAI, Type } from "@google/genai";
import path from "path";

const JWT_SECRET = process.env.JWT_SECRET || "super-secret-travel-key";

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // --- Auth Middleware ---
  const authenticateToken = (req: any, res: any, next: any) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) return res.sendStatus(401);

    jwt.verify(token, JWT_SECRET, (err: any, user: any) => {
      if (err) return res.sendStatus(403);
      req.user = user;
      next();
    });
  };

  // --- Auth Routes ---
  app.post("/api/auth/signup", async (req, res) => {
    const { name, email, password } = req.body;
    try {
      const hashedPassword = await bcrypt.hash(password, 10);
      const stmt = db.prepare("INSERT INTO users (name, email, password) VALUES (?, ?, ?)");
      const info = stmt.run(name, email, hashedPassword);
      const token = jwt.sign({ id: info.lastInsertRowid, email, name }, JWT_SECRET);
      res.json({ token, user: { id: info.lastInsertRowid, name, email } });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  app.post("/api/auth/login", async (req, res) => {
    const { email, password } = req.body;
    const user: any = db.prepare("SELECT * FROM users WHERE email = ?").get(email);
    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ error: "Invalid credentials" });
    }
    const token = jwt.sign({ id: user.id, email: user.email, name: user.name }, JWT_SECRET);
    res.json({ token, user: { id: user.id, name: user.name, email: user.email } });
  });

  // --- Trip Routes ---
  app.get("/api/trips", authenticateToken, (req: any, res) => {
    const trips = db.prepare("SELECT * FROM trips WHERE user_id = ? ORDER BY start_date DESC").all(req.user.id);
    res.json(trips);
  });

  app.post("/api/trips", authenticateToken, (req: any, res) => {
    const { destination, start_date, end_date, budget, travelers, style } = req.body;
    const stmt = db.prepare(`
      INSERT INTO trips (user_id, destination, start_date, end_date, budget, travelers, style)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const info = stmt.run(req.user.id, destination, start_date, end_date, budget, travelers, style);
    res.json({ id: info.lastInsertRowid, ...req.body });
  });

  app.get("/api/trips/:id", authenticateToken, (req: any, res) => {
    const trip = db.prepare("SELECT * FROM trips WHERE id = ? AND user_id = ?").get(req.params.id, req.user.id);
    if (!trip) return res.status(404).json({ error: "Trip not found" });
    
    const itineraries = db.prepare("SELECT * FROM itineraries WHERE trip_id = ?").all(req.params.id);
    const expenses = db.prepare("SELECT * FROM expenses WHERE trip_id = ?").all(req.params.id);
    const places = db.prepare("SELECT * FROM saved_places WHERE trip_id = ?").all(req.params.id);
    
    res.json({ ...trip, itineraries, expenses, places });
  });

  app.delete("/api/trips/:id", authenticateToken, (req: any, res) => {
    const result = db.prepare("DELETE FROM trips WHERE id = ? AND user_id = ?").run(req.params.id, req.user.id);
    if (result.changes === 0) return res.status(404).json({ error: "Trip not found" });
    res.json({ success: true });
  });

  // --- Expense Routes ---
  app.post("/api/expenses", authenticateToken, (req: any, res) => {
    const { trip_id, category, amount, description, date } = req.body;
    // Verify trip ownership
    const trip = db.prepare("SELECT id FROM trips WHERE id = ? AND user_id = ?").get(trip_id, req.user.id);
    if (!trip) return res.status(403).json({ error: "Unauthorized" });

    const stmt = db.prepare("INSERT INTO expenses (trip_id, category, amount, description, date) VALUES (?, ?, ?, ?, ?)");
    const info = stmt.run(trip_id, category, amount, description, date);
    res.json({ id: info.lastInsertRowid, ...req.body });
  });

  // --- AI Itinerary Route ---
  app.post("/api/trips/:id/generate-itinerary", authenticateToken, async (req: any, res) => {
    const trip: any = db.prepare("SELECT * FROM trips WHERE id = ? AND user_id = ?").get(req.params.id, req.user.id);
    if (!trip) return res.status(404).json({ error: "Trip not found" });

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
      const prompt = `Generate a detailed day-wise travel itinerary for a trip to ${trip.destination}. 
      Duration: ${trip.start_date} to ${trip.end_date}. 
      Budget: ${trip.budget}. 
      Travelers: ${trip.travelers}. 
      Style: ${trip.style}.
      Include daily activities, food suggestions, and transportation tips.
      Format the response as a JSON array of objects, where each object represents a day with properties: day_number, activities (array of strings), food_suggestions (array of strings), and transport_tips (string).`;

      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                day_number: { type: Type.INTEGER },
                activities: { type: Type.ARRAY, items: { type: Type.STRING } },
                food_suggestions: { type: Type.ARRAY, items: { type: Type.STRING } },
                transport_tips: { type: Type.STRING }
              },
              required: ["day_number", "activities", "food_suggestions", "transport_tips"]
            }
          }
        }
      });

      const itineraryData = JSON.parse(response.text || "[]");
      
      // Clear existing itinerary
      db.prepare("DELETE FROM itineraries WHERE trip_id = ?").run(trip.id);
      
      // Save new itinerary
      const insertStmt = db.prepare("INSERT INTO itineraries (trip_id, day_number, activities) VALUES (?, ?, ?)");
      for (const day of itineraryData) {
        insertStmt.run(trip.id, day.day_number, JSON.stringify(day));
      }

      res.json(itineraryData);
    } catch (error: any) {
      console.error(error);
      res.status(500).json({ error: "Failed to generate itinerary" });
    }
  });

  // --- Dashboard Stats ---
  app.get("/api/dashboard/stats", authenticateToken, (req: any, res) => {
    const totalTrips = db.prepare("SELECT COUNT(*) as count FROM trips WHERE user_id = ?").get(req.user.id);
    const upcomingTrips = db.prepare("SELECT COUNT(*) as count FROM trips WHERE user_id = ? AND start_date >= date('now')").get(req.user.id);
    const totalSpent = db.prepare(`
      SELECT SUM(amount) as total 
      FROM expenses e 
      JOIN trips t ON e.trip_id = t.id 
      WHERE t.user_id = ?
    `).get(req.user.id);

    res.json({
      totalTrips: totalTrips.count,
      upcomingTrips: upcomingTrips.count,
      totalSpent: totalSpent.total || 0
    });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static("dist"));
    app.get("*", (req, res) => {
      res.sendFile(path.resolve("dist/index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
