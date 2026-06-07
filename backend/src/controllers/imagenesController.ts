import { query } from "@/db";
import { audit } from "@/services/auditService";
// import { analyzeImage } from "@/services";
import { Request, Response, NextFunction } from "express";
import path from "node:path";
import sharp from "sharp";
import fs from "node:fs";
import { ImagesGetAllQuery } from "@/types";

import { pool } from "../db";
import { analizarImagen } from "../services/iaService";
import exifr from "exifr";
import sizeOf from "image-size";

/** POST /api/imagenes/upload  – sube imagen y lanza análisis IA */
export const uploadAndAnalyze = async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ ok: false, error: "No se subió ninguna imagen" });
    }

    const userId = (req as any).user?.id_usuario; 
    const rutaImagen = path.resolve(req.file.path);
    
    // --- NUEVO: EXTRACCIÓN DE METADATOS BÁSICOS DEL ARCHIVO ---
    const nombreOriginal = req.file.originalname; // El nombre original real sin los números raros de multer
    const tamanoBytes = req.file.size; // Tamaño en bytes directamente de multer
    
    // Extraer el formato basado en la extensión original (ej. 'jpg', 'png')
    const formato = path.extname(nombreOriginal).replace('.', '').toLowerCase() || req.file.mimetype.split('/')[1];

    // --- EXTRACCIÓN DE DIMENSIONES (ANCHO Y ALTO) ---
    let width = null;
    let height = null;
    try {
      //lee la imagen a un Buffer primero usando 'fs' 
      const imageBuffer = fs.readFileSync(rutaImagen);
      const dimensions = sizeOf(imageBuffer);
      width = dimensions.width;
      height = dimensions.height;
    } catch(err) {
      console.error("No se pudieron extraer las dimensiones:", err);
    }

    // --- 1. EXTRAER COORDENADAS GEOGRÁFICAS (EXIF) DE LA IMAGEN ---
    let lat = null;
    let lon = null;
    
    try {
      const gpsData = await exifr.gps(rutaImagen);
      if (gpsData) {
        lat = gpsData.latitude;
        lon = gpsData.longitude;
      }
    } catch (exifError) {
      console.error("Error leyendo metadatos de la imagen:", exifError);
    }

    // --- 2. VALIDACIÓN: RECHAZAR SI NO HAY COORDENADAS ---
    if (lat === null || lon === null) {
      return res.status(400).json({ 
        ok: false, 
        error: "La imagen no contiene Metadatos de ubicación (Latitud y Longitud), por lo que no puede ser analizada." 
      });
    }

    // --- 3. GUARDAR DATOS EN LA TABLA "imagenes" ---
    const metadataJson = JSON.stringify({ latitud: lat, longitud: lon });
    
    // Actualizamos el Query para incluir las nuevas columnas
    const insertImgQuery = `
      INSERT INTO imagenes 
      (id_usuario, nombre_archivo, ruta_archivo, geom, metadata, formato, resolucion_width, resolucion_height, tamano_bytes)
      VALUES ($1, $2, $3, ST_SetSRID(ST_MakePoint($4, $5), 4326), $6, $7, $8, $9, $10)
      RETURNING id_imagen;
    `;
    
    const imgResult = await pool.query(insertImgQuery, [
      userId, 
      nombreOriginal, // Usamos el nombre original limpio
      rutaImagen,     // La ruta se guarda como está en tu PC (con el número generado por multer) para poder buscarla
      lon, 
      lat, 
      metadataJson,
      formato,
      width,
      height,
      tamanoBytes
    ]);
    const idImagen = imgResult.rows[0].id_imagen;

    // --- 4. MANDAR A ANALIZAR AL SERVIDOR DE IA (PYTHON) ---
    const iaResult: any = await analizarImagen(rutaImagen, lat, lon);

    if (iaResult.status !== "aprobado") {
      return res.status(400).json({ ok: false, error: iaResult.mensaje });
    }

    // --- 5. GUARDAR LOS RESULTADOS EN LA TABLA 'analisis' ---
    const jsonResult = JSON.stringify(iaResult);
    
    const etiqueta = (iaResult.etiqueta_final || '').toLowerCase();
    let id_riesgo = 1; // Bajo
    if (etiqueta.includes('alto')) id_riesgo = 3;
    else if (etiqueta.includes('medio')) id_riesgo = 2;

    // Actualizamos el Query para incluir riesgo visual y climático
    const insertAnalisisQuery = `
      INSERT INTO analisis 
      (id_imagen, id_riesgo, porcentaje_afectacion, resultado_json, riesgo_visual, riesgo_climatico)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id_analisis;
    `;
    
    const analResult = await pool.query(insertAnalisisQuery, [
      idImagen,
      id_riesgo,
      iaResult.nivel_riesgo_final_pct,
      jsonResult,
      iaResult.riesgo_visual_pct,     // <--- Insertamos el Riesgo Visual
      iaResult.riesgo_climatico_pct   // <--- Insertamos el Riesgo Climático
    ]);

    // --- 6. DEVOLVER RESPUESTA AL FRONTEND ---
    res.json({
      ok: true,
      imagen: { id_imagen: idImagen, lat: lat, lon: lon },
      analisis: {
        id_analisis: analResult.rows[0].id_analisis,
        ...iaResult
      }
    });

  } catch (error) {
    console.error("Error en uploadAndAnalyze:", error);
    res.status(500).json({ ok: false, error: "Error interno del servidor al procesar la imagen." });
  }
};

/** GET /api/imagenes  – listado con filtros */
const getAll = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const {
      zona,
      nivel,
      usuario,
      page = "1",
      limit = "20"
    } = req.query as ImagesGetAllQuery;

    const pageNumber = Number.parseInt(page, 10);
    const limitNumber = Number.parseInt(limit, 10);
    const offset = (pageNumber - 1) * limitNumber;

    const filtros: string[] = [];
    const params: Array<string | number> = [];
    let paramIdx = 1;

    if (req.user.rol === "user") {
      filtros.push(`i.id_usuario = $${paramIdx++}`);
      params.push(req.user.id_usuario);
    }

    if (zona) {
      filtros.push(`a.resultado_json->>'zona' ILIKE $${paramIdx++}`);
      params.push(`%${zona}%`);
    }
    if (nivel) {
      filtros.push(`LOWER(nr.clave) = LOWER($${paramIdx++})`);
      params.push(nivel);
    }
    if (usuario && req.user.rol === "admin") {
      filtros.push(`u.nombre ILIKE $${paramIdx++}`);
      params.push(`%${usuario}%`);
    }

    const where = filtros.length ? `WHERE ${filtros.join(" AND ")}` : "";

    const { rows } = await query(
     `SELECT
  i.id_imagen,
  i.uuid,
  i.nombre_archivo AS nombre,
  i.ruta_archivo,
  u.nombre AS usuario,
  ST_X(i.geom) AS lng,
  ST_Y(i.geom) AS lat,
  a.resultado_json->>'zona' AS zona,
  LOWER(nr.clave) AS nivel_riesgo,
  nr.color_hex,
  ROUND((a.umbral_confianza*100)::numeric) AS confianza,
  i.resolucion_width || 'x' || i.resolucion_height AS resolucion,
  ROUND((i.tamano_bytes/1048576.0)::numeric,1) || ' MB' AS tamano,
  TO_CHAR(i.fecha_carga,'DD/MM/YYYY') AS fecha,
  a.id_analisis,
  a.id_riesgo,
  a.porcentaje_afectacion,
  a.riesgo_visual,
  a.riesgo_climatico,
  i.resolucion_width,
  i.resolucion_height,
  i.tamano_bytes
FROM imagenes i
JOIN usuarios u ON u.id_usuario = i.id_usuario
JOIN analisis a ON a.id_imagen = i.id_imagen
LEFT JOIN niveles_riesgo nr ON nr.id_riesgo = a.id_riesgo
${where}
ORDER BY i.fecha_carga DESC
LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
[...params, limitNumber, offset]
    );

    const { rows: countRows } = await query(
      `SELECT COUNT(*) FROM imagenes i
       JOIN usuarios u ON u.id_usuario = i.id_usuario
       LEFT JOIN analisis a ON a.id_imagen = i.id_imagen
       LEFT JOIN niveles_riesgo nr ON nr.id_riesgo = a.id_riesgo
       ${where}`,
      params
    );

    res.json({
      ok: true,
      data: rows,
      total: parseInt(countRows[0].count),
      page: pageNumber,
      limit: limitNumber
    });
  } catch (err) {
    next(err);
  }
};

/** GET /api/imagenes/:id – detalle completo con análisis */
const getOne = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { rows } = await query(
      `SELECT i.*, u.nombre AS usuario_nombre, u.correo AS usuario_correo,
              a.id_analisis, a.porcentaje_afectacion, a.resultado_json,
              a.zonas_detectadas, a.umbral_confianza, a.modelo_version, a.fecha_analisis,
              LOWER(nr.clave) AS nivel_riesgo, nr.descripcion AS nivel_desc, nr.color_hex
       FROM imagenes i
       JOIN usuarios u ON u.id_usuario = i.id_usuario
       LEFT JOIN analisis a ON a.id_imagen = i.id_imagen
       LEFT JOIN niveles_riesgo nr ON nr.id_riesgo = a.id_riesgo
       WHERE i.id_imagen = $1`,
      [req.params.id]
    );
    if (!rows.length)
      return res.status(404).json({ ok: false, error: "Imagen no encontrada" });

    // Verificar acceso
    const img = rows[0];
    if (req.user.rol === "user" && img.id_usuario !== req.user.id_usuario) {
      return res
        .status(403)
        .json({ ok: false, error: "Sin acceso a esta imagen" });
    }

    res.json({ ok: true, data: img });
  } catch (err) {
    next(err);
  }
};

/** DELETE /api/imagenes/:id */
const deleteImage = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { rows } = await query("SELECT * FROM imagenes WHERE id_imagen=$1", [
      req.params.id
    ]);
    if (!rows.length)
      return res.status(404).json({ ok: false, error: "Imagen no encontrada" });

    const img = rows[0];
    if (req.user.rol === "user" && img.id_usuario !== req.user.id_usuario) {
      return res.status(403).json({ ok: false, error: "Sin acceso" });
    }

    // Eliminar archivo físico
    try {
      fs.unlinkSync(img.ruta_archivo);
    } catch (_) {}

    await query("DELETE FROM imagenes WHERE id_imagen=$1", [req.params.id]);

    await audit({
      tabla: "imagenes",
      operacion: "DELETE",
      registroId: img.id_imagen,
      cambiadoPor: req.user.correo,
      descripcion: "Eliminó imagen",
      datosAntes: img
    });

    res.json({ ok: true, message: "Imagen eliminada" });
  } catch (err) {
    next(err);
  }
};

/** GET /api/imagenes/:id/file – servir el archivo de imagen */
const serveFile = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { rows } = await query(
      "SELECT ruta_archivo, id_usuario FROM imagenes WHERE id_imagen=$1",
      [req.params.id]
    );
    if (!rows.length)
      return res.status(404).json({ ok: false, error: "Imagen no encontrada" });

    const img = rows[0];
    if (req.user.rol === "user" && img.id_usuario !== req.user.id_usuario) {
      return res.status(403).json({ ok: false, error: "Sin acceso" });
    }

    if (!fs.existsSync(img.ruta_archivo)) {
      return res
        .status(404)
        .json({ ok: false, error: "Archivo no encontrado en disco" });
    }

    res.sendFile(path.resolve(img.ruta_archivo));
  } catch (err) {
    next(err);
  }
};

export default { uploadAndAnalyze, getAll, getOne, deleteImage, serveFile };
