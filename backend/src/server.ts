import routes from "./routes";
import express from "express";
import cors from "cors";
import path from "node:path";
import { errorHandler } from "./middleware/errorHandler";
import morgan from "morgan";

const server = express();
const PORT = process.env.PORT || 3000;

server.use(morgan("dev"));

// ── CORS ──────────────────────────────────────────────────────
server.use(
  cors({
    origin: process.env.CORS_ORIGIN || "http://localhost:4200",
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"]
  })
);

// ── Body parsers ──────────────────────────────────────────────
server.use(express.json({ limit: "5mb" }));
server.use(express.urlencoded({ extended: true, limit: "5mb" }));



// ── Static – archivos subidos ─────────────────────────────────
server.use(
  "/uploads",
  express.static(path.resolve(process.env.UPLOAD_DIR || "uploads"))
);
// Exponer la carpeta de mapas generados por la IA, ruta relativa que apunta a la carpeta Modulos_IA_TT/mapas_riesgo
server.use("/mapas_riesgo", express.static(path.resolve(__dirname, "../../Modulos_IA_TT/mapas_riesgo")));


// Exponer las imágenes subidas originales
server.use("/uploads", express.static(path.resolve(__dirname, "../../uploads"))); 
// (Ajusta la ruta "../../uploads" según donde se ubique realmente tu carpeta 'uploads' física)


// ── Health check ──────────────────────────────────────────────
server.get("/api/health", (_req, res) =>
  res.json({ ok: true, service: "incendios-api", ts: new Date().toISOString() })
);

// --- Rutas API ───────────────────────────────────────────────
server.use("/api", routes);

// ── 404 ───────────────────────────────────────────────────────
server.use((_req, res) =>
  res.status(404).json({ ok: false, error: "Ruta no encontrada" })
);

// ── Error handler ─────────────────────────────────────────────
server.use(errorHandler);

server.listen(PORT, () => {
  console.log(`\n🔥 Incendios API corriendo en http://localhost:${PORT}`);
  console.log(`   ENV: ${process.env.NODE_ENV || "development"}`);
  console.log(
    `   DB:  ${process.env.DB_NAME}@${process.env.DB_HOST}:${process.env.DB_PORT}\n`
  );
});

export default server;
