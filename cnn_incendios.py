import torch
import torch.nn as nn
import torch.optim as optim
import torchvision.transforms as transforms
from torchvision.datasets import ImageFolder
from torch.utils.data import DataLoader, Subset
import random
import os
import numpy as np
import matplotlib.pyplot as plt
from sklearn.metrics import accuracy_score, precision_score, recall_score, f1_score, confusion_matrix, ConfusionMatrixDisplay
from PIL import Image


# CONFIGURACIÓN

DEVICE = torch.device("cuda" if torch.cuda.is_available() else "cpu")

BATCH_SIZE = 16
IMAGE_SIZE = 128
EPOCHS = 5
DATASET_PATH = r"D:\Documents\8o_semestre\TT_incendios\dataset_riesgo_incendios"
MODEL_PATH = 'mejor_modelo_incendios.pth'


# TRANSFORMACIONES

transform = transforms.Compose([
    transforms.Resize((IMAGE_SIZE, IMAGE_SIZE)),
    transforms.ToTensor(),
    transforms.Normalize(mean=[0.5, 0.5, 0.5], std=[0.5, 0.5, 0.5])
])


# DATASETS Y DATALOADERS

try:
    train_dataset = ImageFolder(root=os.path.join(DATASET_PATH, "train"), transform=transform)
    val_dataset = ImageFolder(root=os.path.join(DATASET_PATH, "val"), transform=transform)
    test_dataset = ImageFolder(root=os.path.join(DATASET_PATH, "test"), transform=transform)
    
    # Extraer los nombres de las clases generados automáticamente por las carpetas
    CLASES = test_dataset.classes
except Exception as e:
    print(f"Error al cargar el dataset. Verifique la ruta: {e}")
    CLASES = ["riesgo_alto", "riesgo_bajo", "riesgo_medio", "riesgo_muy_alto"]

# Subset para entrenamiento rápido
subset_size = 300
if 'train_dataset' in locals():
    indices = random.sample(range(len(train_dataset)), min(subset_size, len(train_dataset)))
    train_subset = Subset(train_dataset, indices)
    train_loader = DataLoader(train_subset, batch_size=BATCH_SIZE, shuffle=True)
    val_loader = DataLoader(val_dataset, batch_size=BATCH_SIZE, shuffle=False)
    test_loader = DataLoader(test_dataset, batch_size=BATCH_SIZE, shuffle=False)


# estructura de la CNN
class CNN(nn.Module):
    def __init__(self):
        super(CNN, self).__init__()
        self.conv1 = nn.Conv2d(3, 16, 3, padding=1)
        self.conv2 = nn.Conv2d(16, 32, 3, padding=1)
        self.pool = nn.MaxPool2d(2, 2)
        self.fc1 = nn.Linear(32 * 32 * 32, 64)
        self.fc2 = nn.Linear(64, 4) 
        self.relu = nn.ReLU()

    def forward(self, x):
        x = self.pool(self.relu(self.conv1(x)))
        x = self.pool(self.relu(self.conv2(x)))
        x = x.view(x.size(0), -1)
        x = self.relu(self.fc1(x))
        x = self.fc2(x)
        return x


# FUNCIONES AUXILIARES

def mostrar_imagen_tensor(tensor_img, titulo):
    """Desnormaliza y muestra una imagen en formato tensor de PyTorch."""
    img = tensor_img.cpu() / 2 + 0.5  # Desnormalizar
    npimg = img.numpy()
    plt.imshow(np.transpose(npimg, (1, 2, 0)))
    plt.title(titulo)
    plt.axis('off')
    plt.show()

def calcular_y_mostrar_metricas(y_true, y_pred, titulo_matriz="Matriz de Confusión"):
    """Calcula métricas de clasificación y muestra la matriz de confusión."""
    acc = accuracy_score(y_true, y_pred)
    # Se utiliza average='weighted' para manejar el desbalance de clases si existe
    prec = precision_score(y_true, y_pred, average='weighted', zero_division=0)
    rec = recall_score(y_true, y_pred, average='weighted', zero_division=0)
    f1 = f1_score(y_true, y_pred, average='weighted', zero_division=0)

    print("\n--- Métricas de Evaluación ---")
    print(f"Accuracy:  {acc:.4f}")
    print(f"Precision: {prec:.4f}")
    print(f"Recall:    {rec:.4f}")
    print(f"F1 Score:  {f1:.4f}")
    print("------------------------------")

    cm = confusion_matrix(y_true, y_pred)
    disp = ConfusionMatrixDisplay(confusion_matrix=cm, display_labels=CLASES)
    disp.plot(cmap=plt.cm.Blues, xticks_rotation=45)
    plt.title(titulo_matriz)
    plt.tight_layout()
    plt.show()


#ENTRENAMIENTO Y EVALUACIÓN

def entrenar_modelo():
    print("\nIniciando entrenamiento...")
    model = CNN().to(DEVICE)
    criterion = nn.CrossEntropyLoss()
    optimizer = optim.Adam(model.parameters(), lr=0.001)

    best_val_loss = float('inf')

    for epoch in range(EPOCHS):
        model.train()
        running_loss = 0.0
        for images, labels in train_loader:
            images, labels = images.to(DEVICE), labels.to(DEVICE)
            optimizer.zero_grad()
            outputs = model(images)
            loss = criterion(outputs, labels)
            loss.backward()
            optimizer.step()
            running_loss += loss.item()
            
        avg_train_loss = running_loss / len(train_loader)

        model.eval()
        val_loss = 0.0
        with torch.no_grad():
            for images, labels in val_loader:
                images, labels = images.to(DEVICE), labels.to(DEVICE)
                outputs = model(images)
                loss = criterion(outputs, labels)
                val_loss += loss.item()
                
        avg_val_loss = val_loss / len(val_loader)
        
        print(f"Epoch [{epoch+1}/{EPOCHS}] Train Loss: {avg_train_loss:.4f} | Val Loss: {avg_val_loss:.4f}")
        
        if avg_val_loss < best_val_loss:
            best_val_loss = avg_val_loss
            torch.save(model.state_dict(), MODEL_PATH)
            print("Modelo actualizado y guardado.")

    print("Entrenamiento finalizado. Evaluando modelo final en conjunto de Test...")
    model.load_state_dict(torch.load(MODEL_PATH, weights_only=True))
    model.eval()
    
    y_true = []
    y_pred = []
    
    with torch.no_grad():
        for images, labels in test_loader:
            images = images.to(DEVICE)
            outputs = model(images)
            _, predicted = torch.max(outputs.data, 1)
            y_true.extend(labels.numpy())
            y_pred.extend(predicted.cpu().numpy())
            
    calcular_y_mostrar_metricas(y_true, y_pred, "Matriz de Confusión - Entrenamiento Final")

def evaluar_imagen_aleatoria(model):
    print("\nObteniendo imagen aleatoria del conjunto de prueba...")
    idx = random.randint(0, len(test_dataset) - 1)
    imagen, etiqueta_real = test_dataset[idx]
    
    # Añadir dimensión de batch (1, C, H, W)
    imagen_batch = imagen.unsqueeze(0).to(DEVICE)
    
    with torch.no_grad():
        output = model(imagen_batch)
        _, prediccion = torch.max(output.data, 1)
        
    clase_real = CLASES[etiqueta_real]
    clase_predicha = CLASES[prediccion.item()]
    
    titulo = f"Real: {clase_real} | Predicción: {clase_predicha}"
    print(f"Resultado -> {titulo}")
    
    if clase_real == clase_predicha:
        print("Métrica: Predicción Correcta (Acierto)")
    else:
        print("Métrica: Predicción Incorrecta (Fallo)")
        
    mostrar_imagen_tensor(imagen, titulo)

def evaluar_lote_aleatorio(model, tamaño_lote=30):
    print(f"\nEvaluando lote aleatorio de {tamaño_lote} imágenes...")
    # Crear un loader temporal solo para extraer un lote del tamaño especificado
    lote_loader = DataLoader(test_dataset, batch_size=tamaño_lote, shuffle=True)
    
    # Obtener un solo batch
    images, labels = next(iter(lote_loader))
    images = images.to(DEVICE)
    
    with torch.no_grad():
        outputs = model(images)
        _, predicted = torch.max(outputs.data, 1)
        
    y_true = labels.numpy()
    y_pred = predicted.cpu().numpy()
    
    calcular_y_mostrar_metricas(y_true, y_pred, f"Matriz de Confusión - Lote de {tamaño_lote}")

def evaluar_imagen_local(model):
    ruta = input("\nIngrese la ruta absoluta de la imagen: ").strip()
    
    # Eliminar comillas si la ruta fue copiada y pegada con ellas
    if ruta.startswith('"') and ruta.endswith('"'):
        ruta = ruta[1:-1]
        
    if not os.path.exists(ruta):
        print("Error: El archivo no existe o la ruta es incorrecta.")
        return
        
    try:
        imagen_pil = Image.open(ruta).convert('RGB')
        imagen_tensor = transform(imagen_pil)
        imagen_batch = imagen_tensor.unsqueeze(0).to(DEVICE)
        
        with torch.no_grad():
            output = model(imagen_batch)
            _, prediccion = torch.max(output.data, 1)
            
        clase_predicha = CLASES[prediccion.item()]
        print(f"Predicción del modelo: {clase_predicha}")
        
        mostrar_imagen_tensor(imagen_tensor, f"Predicción: {clase_predicha}")
        
    except Exception as e:
        print(f"Error al procesar la imagen: {e}")


# SISTEMA DE MENÚS

def menu_cargar_modelo(model):
    while True:
        print("\n=== MENÚ: MODELO CARGADO ===")
        print("1. Prueba con 1 imagen aleatoria (Test)")
        print("2. Prueba con lote de 30 imágenes aleatorias (Test)")
        print("3. Prueba con imagen local")
        print("4. Volver al menú principal")
        
        opcion = input("Seleccione una opción: ").strip()
        
        if opcion == '1':
            evaluar_imagen_aleatoria(model)
        elif opcion == '2':
            evaluar_lote_aleatorio(model, tamaño_lote=30)
        elif opcion == '3':
            evaluar_imagen_local(model)
        elif opcion == '4':
            break
        else:
            print("Opción no válida.")

def menu_principal():
    print(f"Dispositivo configurado: {DEVICE}")
    while True:
        print("\n=== MENÚ PRINCIPAL ===")
        print("1. Entrenar modelo desde cero")
        print("2. Cargar modelo existente")
        print("3. Salir")
        
        opcion = input("Seleccione una opción: ").strip()
        
        if opcion == '1':
            entrenar_modelo()
        elif opcion == '2':
            if os.path.exists(MODEL_PATH):
                print("Cargando modelo...")
                model = CNN().to(DEVICE)
                model.load_state_dict(torch.load(MODEL_PATH, weights_only=True))
                model.eval()
                print("Modelo cargado exitosamente.")
                menu_cargar_modelo(model)
            else:
                print(f"Error: No se encontró el archivo '{MODEL_PATH}'. Entrene el modelo primero.")
        elif opcion == '3':
            print("Finalizando ejecución.")
            break
        else:
            print("Opción no válida.")

if __name__ == "__main__":
    menu_principal()