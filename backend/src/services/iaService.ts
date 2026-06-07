const IA_URL = process.env.IA_URL || "http://127.0.0.1:5000";

// Reemplaza todo el contenido simulado por este:
export const analizarImagen = async (
  rutaImagen: string,
  lat: number,
  lon: number
) => {
  try {
    const response = await fetch(`${IA_URL}/analizar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ruta_imagen: rutaImagen, lat, lon })
    });

    const data = await response.json();
    return data;
  } catch (error) {
    console.error("Error conectando con el Motor de IA (Flask):", error);
    throw new Error("No se pudo conectar con el motor de Inteligencia Artificial.");
  }
};

export const obtenerMetricasModelo = async () => {
  try {
    const response = await fetch(`${IA_URL}/metricas-modelo`);
    const data = await response.json();
    return data;
  } catch (error) {
    console.error("Error obteniendo métricas del modelo:", error);
    throw new Error("No se pudieron obtener las métricas del modelo IA.");
  }
};