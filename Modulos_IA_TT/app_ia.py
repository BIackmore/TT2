import os
import time
import shutil
import uuid
from flask import Flask, request, jsonify
from dotenv import load_dotenv

# Importaciones de tus módulos
from main import evaluar_imagen_completa
from cnn_modulo import RedIncendios
from clima_modulo import IntegracionClimatica
import autoencoder

app = Flask(__name__)

# 1. Cargar modelos en memoria UNA SOLA VEZ al iniciar el servidor
print("Cargando modelos de IA en memoria...")
load_dotenv()
API_KEY = os.getenv("API_KEY_CLIMA")
modulo_clima = IntegracionClimatica(API_KEY)

modelo_cnn = RedIncendios()
modelo_cnn.cargar_modelo("cnn")
autoencoder.cargar_modelos_locales()
print("¡Modelos cargados! Servidor IA listo.")

# 2. Crear carpeta para guardar los mapas de riesgo si no existe
MAPAS_DIR = os.path.join(os.path.dirname(__file__), "mapas_riesgo")
os.makedirs(MAPAS_DIR, exist_ok=True)

@app.route('/analizar', methods=['POST'])
def analizar():
    data = request.json
    ruta_img = data.get('ruta_imagen')
    lat = data.get('lat')
    lon = data.get('lon')

    try:
        # Ejecutar tu lógica central
        resultado = evaluar_imagen_completa(ruta_img, lat, lon, modelo_cnn, modulo_clima)

        if resultado.get("status") == "aprobado":
            # Renombrar el archivo generado para que no se sobrescriba si hay múltiples peticiones
            ruta_original_mapa = resultado.get("ruta_imagen_generada")
            nuevo_nombre = f"mapa_{uuid.uuid4().hex}.png"
            ruta_final_mapa = os.path.join(MAPAS_DIR, nuevo_nombre)

            if os.path.exists(ruta_original_mapa):
                shutil.move(ruta_original_mapa, ruta_final_mapa)
                # Devolvemos solo el nombre del archivo para que el frontend lo pueda leer vía URL
                resultado["ruta_imagen_generada"] = nuevo_nombre 
                
        return jsonify(resultado)

    except Exception as e:
        print(f"Error en IA: {e}")
        return jsonify({"status": "error", "mensaje": str(e)}), 500


@app.route('/metricas-modelo', methods=['GET'])
def metricas_modelo():
    try:
        dir_test = os.path.join(os.path.dirname(__file__), "Dataset", "test")

        if not os.path.exists(dir_test):
            return jsonify({
                "status": "error",
                "mensaje": "No existe la carpeta Dataset/test para calcular la matriz de confusión."
            }), 404

        inicio = time.time()
        metricas = modelo_cnn.evaluar_y_metricas(dir_test)
        tiempo = round(time.time() - inicio, 2)

        metricas["status"] = "ok"
        metricas["tiempo_respuesta"] = tiempo

        return jsonify(metricas)

    except Exception as e:
        print(f"Error calculando métricas del modelo: {e}")
        return jsonify({"status": "error", "mensaje": str(e)}), 500
if __name__ == '__main__':
    # El servidor de IA escuchará en el puerto 5000
    app.run(port=5000, debug=False)