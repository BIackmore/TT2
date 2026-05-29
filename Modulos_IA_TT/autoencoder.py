import os

os.environ['TF_ENABLE_ONEDNN_OPTS'] = '0'
os.environ['TF_CPP_MIN_LOG_LEVEL'] = '3'

import cv2
import numpy as np
import tensorflow as tf
from tensorflow.keras import layers, models

# Configuración de variables globales
TAMANO_IMAGEN = 128
DATASET_PATH_CNN = r"D:\Documents\8o_semestre\TT_incendios\CNN_incendios\Dataset_Filtro_Contexto"
DATASET_PATH_AE = r"D:\Documents\8o_semestre\TT_incendios\CNN_incendios\dataset_Autoencoder"

cnn_filtro = None
autoencoder_modelo = None

def crear_cnn():
    modelo = models.Sequential([
        layers.Conv2D(32, (3,3), input_shape=(TAMANO_IMAGEN, TAMANO_IMAGEN, 3)),
        layers.LeakyReLU(alpha=0.1),
        layers.MaxPooling2D(),
        layers.Conv2D(64, (3,3)),
        layers.LeakyReLU(alpha=0.1),
        layers.MaxPooling2D(),
        layers.Conv2D(128, (3,3)),
        layers.LeakyReLU(alpha=0.1),
        layers.MaxPooling2D(),
        layers.Flatten(),
        layers.Dense(128),
        layers.LeakyReLU(alpha=0.1),
        layers.Dense(1, activation='sigmoid')
    ])
    modelo.compile(optimizer='adam', loss='binary_crossentropy', metrics=['accuracy'])
    return modelo

def crear_autoencoder():
    input_img = layers.Input(shape=(TAMANO_IMAGEN, TAMANO_IMAGEN, 3))
    
    # Encoder
    x = layers.Conv2D(64, (3,3), padding='same')(input_img)
    x = layers.LeakyReLU(alpha=0.1)(x)
    x = layers.MaxPooling2D((2,2), padding='same')(x)
    x = layers.Conv2D(32, (3,3), padding='same')(x)
    x = layers.LeakyReLU(alpha=0.1)(x)
    x = layers.MaxPooling2D((2,2), padding='same')(x)
    
    # Decoder
    x = layers.Conv2D(32, (3,3), padding='same')(x)
    x = layers.LeakyReLU(alpha=0.1)(x)
    x = layers.UpSampling2D((2,2))(x)
    x = layers.Conv2D(64, (3,3), padding='same')(x)
    x = layers.LeakyReLU(alpha=0.1)(x)
    x = layers.UpSampling2D((2,2))(x)
    
    decoded = layers.Conv2D(3, (3,3), activation='tanh', padding='same')(x)
    autoencoder = models.Model(input_img, decoded)
    autoencoder.compile(optimizer='adam', loss='mae')
    return autoencoder

def cargar_dataset(ruta_base):
    # Apuntar automáticamente a la carpeta de Entrenamiento
    ruta_entrenamiento = os.path.join(ruta_base, "Entrenamiento")
    # Validación por si las carpetas de Entrenamiento no existen o tienen otro nombre
    if not os.path.exists(ruta_entrenamiento):
        print(f"Aviso: No se encontró la carpeta 'Entrenamiento' en {ruta_base}. Se usará la ruta base.")
        ruta_entrenamiento = ruta_base

    dataset = tf.keras.utils.image_dataset_from_directory(
        ruta_entrenamiento,
        image_size=(TAMANO_IMAGEN, TAMANO_IMAGEN),
        batch_size=32
    )
    # ver clases
    print(f"Clases detectadas en {ruta_entrenamiento}:", dataset.class_names)
    normalizacion = layers.Rescaling(1./127.5, offset=-1)
    dataset = dataset.map(lambda x,y: (normalizacion(x), y))
    return dataset

def entrenar_cnn():
    global cnn_filtro
    if cnn_filtro is None:
        cnn_filtro = crear_cnn()
    dataset = cargar_dataset(DATASET_PATH_CNN)
    cnn_filtro.fit(dataset, epochs=20)
    cnn_filtro.save("modelo_Filtro_cnn.h5")
    print("Modelo CNN guardado localmente.")

def entrenar_autoencoder():
    global autoencoder_modelo
    if autoencoder_modelo is None:
        autoencoder_modelo = crear_autoencoder()
    dataset = cargar_dataset(DATASET_PATH_AE)
    dataset = dataset.map(lambda x,y: (x, x))
    autoencoder_modelo.fit(dataset, epochs=30)
    autoencoder_modelo.save("modelo_Filtro_Autoencoder.h5")
    print("Modelo Autoencoder guardado localmente.")

def cargar_modelos_locales():
    global cnn_filtro, autoencoder_modelo
    if os.path.exists("modelo_Filtro_cnn.h5") and os.path.exists("modelo_Filtro_Autoencoder.h5"):
        cnn_filtro = models.load_model("modelo_Filtro_cnn.h5", compile=False)
        autoencoder_modelo = models.load_model("modelo_Filtro_Autoencoder.h5", compile=False)
        return True
    return False

def verificar_contexto(ruta):
    global cnn_filtro
    if cnn_filtro is None:
        return False
        
    img_original = cv2.imread(ruta)
    if img_original is None:
        print("Error: No se pudo leer la imagen (ruta inválida o formato no soportado).")
        return False
        
    img_original = cv2.cvtColor(img_original, cv2.COLOR_BGR2RGB)
    img = cv2.resize(img_original, (TAMANO_IMAGEN, TAMANO_IMAGEN))
    img = img / 127.5 - 1
    entrada = np.expand_dims(img, axis=0)
    
    pred = cnn_filtro.predict(entrada, verbose=0)[0][0]
    return pred > 0.5 

def verificar_riesgo_inicial(ruta):
    global autoencoder_modelo
    if autoencoder_modelo is None:
        return False
        
    img = cv2.imread(ruta)
    if img is None:
        return False
        
    img = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
    img = cv2.resize(img, (TAMANO_IMAGEN, TAMANO_IMAGEN))
    #img = cv2.medianBlur(img, 3)
    img = img.astype("float32") / 127.5 - 1
    entrada_pre = np.expand_dims(img, axis=0)
    
    reconstruida = autoencoder_modelo.predict(entrada_pre, verbose=0)
    error = np.mean((entrada_pre - reconstruida)**2)
    
    return error >= 0.01