import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { NavbarComponent } from '../../shared/navbar/navbar';
import { OfflineQueueService, QueuedImage } from '../../services/offline-queue.service';
import { HasDonePipe } from '../../shared/pipes/has-done.pipe';
import { AuthService } from '../../services/auth.service';
import { PlatformApiService, UploadImageResponse } from '../../api/platform-api.service';

@Component({
  selector: 'app-process-image',
  standalone: true,
  imports: [CommonModule, NavbarComponent, HasDonePipe],
  templateUrl: './process-image.html',
  styleUrl: './process-image.scss'
})
export class ProcessImageComponent implements OnInit, OnDestroy {
  selectedFile: File | null = null;
  preview: string | null = null;
  isDragging = false;
  loading = false;
  resultadoVisible = false;
  queuedItems: QueuedImage[] = [];
  error = '';



  isOnline = navigator.onLine;

private offlineHandler = () => {
  this.isOnline = false;
  this.cdr.detectChanges();
};

private onlineHandler = async () => {
  this.isOnline = true;

  const response = await this.offlineQ.processQueue();
  await this.refreshQueue();

  if (response) {
    this.loading = false;
    this.resultadoVisible = true;

    this.preview = response.originalBase64 || this.preview;
    this.applyResult(response.result);

    this.error = '';
  }

  this.cdr.detectChanges();
};


  // --- NUEVAS VARIABLES DE IA ---
  mapImage: string | null = null;
  finalClass = 'Alto';
  generalRisk = 0;
  visualRisk = 0;
  climaticRisk = 0;

  weatherParams = {
    temp: '--',
    humidity: '--',
    wind: '--'
  };

  constructor(
    public offlineQ: OfflineQueueService,
    private auth: AuthService,
    private platformApi: PlatformApiService,
    private router: Router,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit() {
  this.isOnline = navigator.onLine;
  this.refreshQueue();

  window.addEventListener('online', this.onlineHandler);
  window.addEventListener('offline', this.offlineHandler);
}

ngOnDestroy() {
  window.removeEventListener('online', this.onlineHandler);
  window.removeEventListener('offline', this.offlineHandler);
}

  async refreshQueue() { this.queuedItems = await this.offlineQ.getAllItems(); }
  
  onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const f = input.files?.[0];

    if (!f) return;

      const formatosPermitidos = ['image/png', 'image/jpeg'];

    if (!formatosPermitidos.includes(f.type)) {
      this.error = 'Solo se permiten imágenes PNG, JPG o JPEG.';
      input.value = '';
      return;
    }

    this.setFile(f);
  }

  onDrop(e: DragEvent) {
  e.preventDefault();
  this.isDragging = false;

  const f = e.dataTransfer?.files[0];
  if (!f) return;

  const formatosPermitidos = ['image/png', 'image/jpeg'];

  if (!formatosPermitidos.includes(f.type)) {
    this.error = 'Solo se permiten imágenes PNG, JPG o JPEG.';
    return;
  }

  this.setFile(f);
}

  onDragOver(e: DragEvent) { e.preventDefault(); this.isDragging = true; }
  onDragLeave() { this.isDragging = false; }

  setFile(file: File) {
    this.selectedFile = file;
    this.resultadoVisible = false;
    this.error = '';
    const r = new FileReader();
    r.onload = e => this.preview = e.target?.result as string;
    r.readAsDataURL(file);
  }

  async analyze() {
    console.log('navigator.onLine:', navigator.onLine);
console.log('offlineQ.isOnline:', this.offlineQ.isOnline);
    if (!this.selectedFile) return;
    this.loading = true;
    this.resultadoVisible = false;
    this.error = '';

    if (!navigator.onLine) {
  const fileToQueue = this.selectedFile;

  await this.offlineQ.enqueueImage(fileToQueue, this.auth.getUser()?.correo);
  await this.refreshQueue();

  this.loading = false;
  this.reset();
  this.error = 'Sin conexión. La imagen se guardó en la cola offline.';
  this.cdr.detectChanges();

  return;
}

    this.platformApi.uploadImage(this.selectedFile).subscribe({
      next: (response) => {
        this.loading = false;
        this.resultadoVisible = true;
        this.applyResult(response);
        this.cdr.detectChanges();
      },
      error: (err) => {
  this.loading = false;

  if (err.status === 0 && this.selectedFile) {
    const fileToQueue = this.selectedFile;

    this.offlineQ.enqueueImage(fileToQueue, this.auth.getUser()?.correo).then(async () => {
      await this.refreshQueue();
      this.reset();
      this.error = 'Sin conexión. La imagen se guardó en la cola offline.';
      this.cdr.detectChanges();
    });

    return;
  }

  const errorMessage = err.error?.error || 'No se pudo procesar la imagen. Intenta de nuevo.';

  this.reset();
  this.error = errorMessage;
  this.cdr.detectChanges();
},
    });
  }

  reset() {
    this.selectedFile = null;
    this.preview = null;
    this.resultadoVisible = false;
    this.error = '';
  }

  async clearDone() { await this.offlineQ.clearDone(); await this.refreshQueue(); }

  async retryItem(id: string) {
    const item = this.queuedItems.find(i => i.id === id);
    if (item) { item.status = 'pending'; await this.offlineQ.dbPut(item); }
    await this.offlineQ.processQueue(); await this.refreshQueue();
  }

  async deleteItem(id: string) { await this.offlineQ.deleteItem(id); await this.refreshQueue(); }

  get pendingCount() { return this.queuedItems.filter(i => i.status === 'pending').length; }

  formatSize(bytes: number) { return bytes < 1048576 ? (bytes/1024).toFixed(1)+' KB' : (bytes/1048576).toFixed(1)+' MB'; }

  // --- TRADUCCIÓN DE DATOS REALES DE LA IA ---
  private applyResult(response: any) {
    const iaData = response.analisis || {};

    // 1. Clase Final Asignada (Ej: "Riesgo_alto" -> "Riesgo alto")
    const etiqueta = iaData.etiqueta_final ? iaData.etiqueta_final.replace('_', ' ') : 'Bajo';
    this.finalClass = this.capitalize(etiqueta);

    // 2. Porcentajes de Riesgo (Redondeados para las gráficas)
    this.generalRisk = Math.round(iaData.nivel_riesgo_final_pct || 0);
    this.visualRisk = Math.round(iaData.riesgo_visual_pct || 0);
    this.climaticRisk = Math.round(iaData.riesgo_climatico_pct || 0);

    // 3. Mapa de Riesgo (Buscamos la imagen en el servidor de Node)
    if (iaData.ruta_imagen_generada) {
      // Concatenamos la ruta estática que expusimos en server.ts
      this.mapImage = `http://localhost:3000/mapas_riesgo/${iaData.ruta_imagen_generada}`;
    } else {
      this.mapImage = this.preview; // Fallback por si acaso
    }

    // 4. Variables Climáticas
    this.weatherParams = {
      temp: iaData.variables_climaticas?.temperatura ? `${iaData.variables_climaticas.temperatura}°C` : 'N/D',
      humidity: iaData.variables_climaticas?.humedad ? `${iaData.variables_climaticas.humedad}%` : 'N/D',
      wind: iaData.variables_climaticas?.viento ? `${iaData.variables_climaticas.viento} km/h` : 'N/D'
    };
  }

  // --- MÉTODOS AUXILIARES DE LA UI ---
  getRiskColor(risk: number): string {
    if (risk >= 70) return '#DC2626'; // Rojo - Alto
    if (risk >= 40) return '#F59E0B'; // Naranja - Medio
    return '#10B981'; // Verde - Bajo
  }

  getFinalClassStyle(): string {
    const clase = this.finalClass.toLowerCase();
    if (clase === 'alto') return 'badge-danger';
    if (clase === 'medio') return 'badge-warning';
    return 'badge-success';
  }

  // Cálculo SVG: (2 * Pi * radio). Para un radio de 45, la circunferencia es ~282.7
  getSvgOffset(risk: number): number {
    const circumference = 282.7;
    return circumference - (risk / 100) * circumference;
  }

  private capitalize(value: string): string {
    if (!value) return '';
    return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
  }
}
