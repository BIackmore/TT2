// Reemplaza todo el contenido simulado por este:
export const analizarImagen = async (rutaImagen: string, lat: number, lon: number) => {
  try {
    // Hacemos la petición POST al servidor Flask
    const response = await fetch("http://127.0.0.1:5000/analizar", {
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