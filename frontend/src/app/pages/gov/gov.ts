import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { forkJoin } from 'rxjs';
import { jsPDF } from 'jspdf'; // Librería de PDFs

import { AuthService } from '../../services/auth.service';
import { PlatformApiService } from '../../api/platform-api.service';
import { ShellComponent, NavItem } from '../../shared/shell/shell';
import { OfflineQueueService } from '../../services/offline-queue.service';

@Component({
  selector: 'app-gov',
  standalone: true,
  imports: [CommonModule, FormsModule, ShellComponent],
  templateUrl: './gov.html',
  styleUrl: './gov.scss'
})
export class GovComponent implements OnInit {
  activeTab = 'procesar';
  loading = false;
  error = '';

  // 1. CONFIGURACIÓN EXACTA DE PESTAÑAS SOLICITADAS (Eliminadas bitácora y métricas)
  navItems: NavItem[] = [
    { tab:'procesar',      label:'Procesar Imagen',        icon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>' },
    { tab:'historial-gov', label:'Mi Historial',           icon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>' },
    { tab:'monitoreo',     label:'Monitoreo de Imágenes',  icon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>' },
  ];

  // 2. VARIABLES FALTANTES QUE CAUSABAN LOS ERRORES EN TU HTML
  miHistorial: any[] = [];
  todasImagenes: any[] = [];
  mSearch = '';

  // --- VARIABLES DE PROCESAMIENTO ---
  selectedFile: File | null = null;
  preview: string | null = null;
  isDragging = false;
  loadingProcess = false;
  resultadoVisible = false;
  errorProcess = '';

  mapImage: string | null = null;
  finalClass = 'Alto';
  generalRisk = 0;
  visualRisk = 0;
  climaticRisk = 0;
  weatherParams = { temp: '--', humidity: '--', wind: '--' };

  reportData = { nombre: '', extension: '', size: '', date: '', width: 0, height: 0, lat: 'N/D', lon: 'N/D' };

  constructor(
    private auth: AuthService,
    private platformApi: PlatformApiService,
    private router: Router,
    public offlineQ: OfflineQueueService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit() {
    if (!this.auth.getUser()) {
      this.router.navigate(['/login']);
      return;
    }
    this.loadDashboardData();
  }

  // 3. GETTER QUE FILTRA LAS IMÁGENES SEGÚN TU BARRA DE BÚSQUEDA (Evita el error 'filteredImagenes')
  get filteredImagenes() {
    if (!this.mSearch) return this.todasImagenes;
    const s = this.mSearch.toLowerCase();

    return this.todasImagenes.filter(img => {
      // 1. Extraemos y normalizamos el Nombre de la Imagen (cubriendo todos los alias)
      const nombreImg = (img.nombre_archivo || img.nombre || img.imagen || '').toLowerCase();
      
      // 2. Extraemos y normalizamos el Nombre del Usuario
      const usuario = (img.usuario || '').toLowerCase();
      
      // 3. Extraemos el Nivel de Riesgo (y si viene como número, lo traducimos a texto)
      const riesgo = (img.nivel_riesgo || this.translateRiesgo(img.id_riesgo) || '').toLowerCase();

      // Retornamos true si la búsqueda del usuario coincide con ALGUNA de las 3 opciones
      return nombreImg.includes(s) || usuario.includes(s) || riesgo.includes(s);
    });
  }

  // CARGA DE DATOS PARA LAS PESTAÑAS (Historial y Monitoreo)
  loadDashboardData() {
    this.loading = true;
    forkJoin({
      analyses: this.platformApi.getAnalyses({ limit: 100 }),
      images: this.platformApi.getImages({ limit: 300 })  
    }).subscribe({
      next: ({ analyses, images }) => {
        this.loading = false;
        // Se llena miHistorial para que tu *ngFor="let img of miHistorial" del HTML funcione
        if (analyses.data) this.miHistorial = analyses.data;
        // Se llena todasImagenes para el Monitoreo
        if (images.data) this.todasImagenes = images.data;
        this.cdr.detectChanges();
      },
      error: () => {
        this.loading = false;
        this.error = 'No se pudieron cargar los datos del panel.';
        this.cdr.detectChanges();
      }
    });
  }

  // 4. FUNCIONES DE EXPORTACIÓN
  exportHistorial() {
    if (!this.miHistorial || this.miHistorial.length === 0) return;

    const processedData = this.miHistorial.map(row => {
      return {
        id_analisis: row.id_analisis,
        nombre_archivo: row.nombre_archivo || row.imagen || 'Sin nombre',
        ruta_archivo: row.ruta_archivo || 'N/D',
        usuario: row.usuario || 'Tú',
        nivel_riesgo: this.translateRiesgo(row.id_riesgo || row.nivel_riesgo),
        porcentaje_afectacion: `${row.porcentaje_afectacion || 0}%`,
        riesgo_visual: row.riesgo_visual != null ? `${row.riesgo_visual}%` : 'N/D',
        riesgo_climatico: row.riesgo_climatico != null ? `${row.riesgo_climatico}%` : 'N/D',
        ancho: row.resolucion_width || 'N/D',
        alto: row.resolucion_height || 'N/D',
        fecha: this.formatDate(row.fecha || row.fecha_analisis)
      };
    });

    this.exportToCsv(processedData, 'Mi_Historial_Analisis.csv');
  }

  exportMonitoreo() {
    if (!this.filteredImagenes || this.filteredImagenes.length === 0) return;

    const processedData = this.filteredImagenes.map(row => {
      return {
        id_imagen: row.id_imagen || 'N/D',
        nombre_archivo: row.nombre_archivo || row.nombre || 'Sin nombre',
        ruta_archivo: row.ruta_archivo || 'N/D',
        usuario: row.usuario || 'N/D',
        latitud: row.lat || 'N/D',
        longitud: row.lng || 'N/D',
        nivel_riesgo: this.translateRiesgo(row.id_riesgo || row.nivel_riesgo),
        porcentaje_afectacion: `${row.porcentaje_afectacion || 0}%`,
        riesgo_visual: row.riesgo_visual != null ? `${row.riesgo_visual}%` : 'N/D',
        riesgo_climatico: row.riesgo_climatico != null ? `${row.riesgo_climatico}%` : 'N/D',
        ancho: row.resolucion_width || 'N/D', // Preservamos los nombres traducidos
        alto: row.resolucion_height || 'N/D',  // Preservamos los nombres traducidos
        tamano_bytes: row.tamano_bytes || 0,   // Muestra el valor en bytes real de la BD sin conversiones
        id_analisis: row.id_analisis || 'N/D',
        fecha_carga: this.formatDate(row.fecha || row.fecha_carga)
      };
    });

    this.exportToCsv(processedData, 'Monitoreo_General_Imagenes.csv');
  }

  // Generador universal de CSV (Elimina la necesidad del ExportService roto)
  // Procesador universal de CSV con codificación UTF-8 para acentos y eñes
  private exportToCsv(data: any[], filename: string) {
    if (!data || data.length === 0) return;
    
    // Extrae las llaves limpias del nuevo objeto mapeado arriba
    const headers = Object.keys(data[0]).join(',');
    
    // Procesa las filas envolviendo los textos en comillas para evitar errores con las comas
    const rows = data.map(row => 
      Object.values(row).map(v => {
        const str = String(v).replace(/"/g, '""'); // Escapa comillas internas si existen
        return `"${str}"`;
      }).join(',')
    ).join('\n');
    
    const csvContent = `${headers}\n${rows}`;
    
    // El Byte Order Mark (BOM) '\uFEFF' le avisa a Excel que el archivo tiene acentos en Español
    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  // ═══ LÓGICA DE PROCESAR IMAGEN Y PDFs (INTACTA Y FUNCIONAL) ═══
  onFileSelected(event: Event) {
    const f = (event.target as HTMLInputElement).files?.[0];
    if (f) this.setFile(f);
  }

  onDrop(e: DragEvent) {
    e.preventDefault(); this.isDragging = false;
    const f = e.dataTransfer?.files[0];
    if (f?.type.startsWith('image/')) this.setFile(f);
  }

  onDragOver(e: DragEvent) { e.preventDefault(); this.isDragging = true; }
  onDragLeave() { this.isDragging = false; }

  setFile(file: File) {
    this.selectedFile = file;
    this.resultadoVisible = false;
    this.errorProcess = '';

    this.reportData.nombre = file.name;
    this.reportData.extension = file.name.split('.').pop() || 'N/D';
    this.reportData.size = this.formatSize(file.size);
    this.reportData.date = new Date().toLocaleString('es-MX');

    const r = new FileReader();
    r.onload = e => {
      this.preview = e.target?.result as string;
      const img = new Image();
      img.onload = () => {
        this.reportData.width = img.width;
        this.reportData.height = img.height;
      };
      img.src = this.preview;
    };
    r.readAsDataURL(file);
  }

  async analyze() {
    if (!this.selectedFile) return;
    this.loadingProcess = true;
    this.resultadoVisible = false;
    this.errorProcess = '';

    if (!this.offlineQ.isOnline) {
      await this.offlineQ.enqueueImage(this.selectedFile, this.auth.getUser()?.correo);
      this.loadingProcess = false;
      this.reset();
      return;
    }

    this.platformApi.uploadImage(this.selectedFile).subscribe({
      next: (response: any) => {
        this.loadingProcess = false;
        this.resultadoVisible = true;
        this.applyResult(response);
        this.cdr.detectChanges();
      },
      error: (err: any) => {
        this.loadingProcess = false;
        const errorMessage = err.error?.error || 'No se pudo procesar la imagen. Intenta de nuevo.';
        this.reset();
        this.errorProcess = errorMessage;
        this.cdr.detectChanges();
      },
    });
  }

  reset() {
    this.selectedFile = null;
    this.preview = null;
    this.resultadoVisible = false;
    this.errorProcess = '';
  }

  private applyResult(response: any) {
    const iaData = response.analisis || {};

    this.reportData.lat = response.imagen?.lat ?? 'N/D';
    this.reportData.lon = response.imagen?.lon ?? 'N/D';

    const etiqueta = iaData.etiqueta_final ? iaData.etiqueta_final.replace('_', ' ') : 'Bajo';
    this.finalClass = this.capitalize(etiqueta);
    this.generalRisk = Math.round(iaData.nivel_riesgo_final_pct || 0);
    this.visualRisk = Math.round(iaData.riesgo_visual_pct || 0);
    this.climaticRisk = Math.round(iaData.riesgo_climatico_pct || 0);

    if (iaData.ruta_imagen_generada) {
      this.mapImage = `http://localhost:3000/mapas_riesgo/${iaData.ruta_imagen_generada}`;
    } else {
      this.mapImage = this.preview;
    }

    this.weatherParams = {
      temp: iaData.variables_climaticas?.temperatura ? `${iaData.variables_climaticas.temperatura}°C` : 'N/D',
      humidity: iaData.variables_climaticas?.humedad ? `${iaData.variables_climaticas.humedad}%` : 'N/D',
      wind: iaData.variables_climaticas?.viento ? `${iaData.variables_climaticas.viento} km/h` : 'N/D'
    };
  }

  // --- GENERACIÓN DEL PDF OFICIAL ---
  async generarReportePDF() {
    const doc = new jsPDF('p', 'mm', 'a4');
    let y = 20;

    doc.setFontSize(18);
    doc.text('Reporte: Análisis del Nivel de Riesgo de Incendio', 105, y, { align: 'center' });
    y += 15;

    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.text('Datos de la Imagen:', 20, y);
    doc.setFont('helvetica', 'normal');
    y += 8;
    doc.text(`Nombre Original: ${this.reportData.nombre}`, 20, y);
    y += 7;
    doc.text(`Extensión: ${this.reportData.extension.toUpperCase()}   |   Tamaño: ${this.reportData.size}`, 20, y);
    y += 7;
    doc.text(`Dimensiones (Resolución): ${this.reportData.width}x${this.reportData.height} píxeles`, 20, y);
    y += 7;
    doc.text(`Fecha de Análisis: ${this.reportData.date}`, 20, y);
    y += 7;
    doc.text(`Coordenadas de Ubicación: Latitud ${this.reportData.lat}, Longitud ${this.reportData.lon}`, 20, y);
    y += 14;

    doc.setFont('helvetica', 'bold');
    doc.text('Resultados de Análisis de Inteligencia Artificial:', 20, y);
    doc.setFont('helvetica', 'normal');
    y += 8;
    doc.text(`Clase Final Asignada: ${this.finalClass}`, 20, y);
    y += 7;
    doc.text(`Nivel de Riesgo General: ${this.generalRisk}%`, 20, y);
    y += 7;
    doc.text(`Riesgo Visual (Red Neuronal Convolucional): ${this.visualRisk}%`, 20, y);
    y += 7;
    doc.text(`Riesgo Climático (Módulo Climática): ${this.climaticRisk}%`, 20, y);
    y += 14;

    doc.setFont('helvetica', 'bold');
    doc.text('Variables Climáticas de la Zona:', 20, y);
    doc.setFont('helvetica', 'normal');
    y += 8;
    doc.text(`Temperatura: ${this.weatherParams.temp}`, 20, y);
    y += 7;
    doc.text(`Humedad: ${this.weatherParams.humidity}`, 20, y);
    y += 7;
    doc.text(`Velocidad del Viento: ${this.weatherParams.wind}`, 20, y);
    y += 18;

    if (this.preview) {
      doc.setFont('helvetica', 'bold');
      doc.text('Imagen Original:', 20, y);
      try {
        doc.addImage(this.preview, 'JPEG', 20, y + 5, 80, 55);
      } catch(e) {}
    }

    if (this.mapImage) {
      doc.setFont('helvetica', 'bold');
      doc.text('Mapa Térmico de Riesgo (Grad-CAM):', 110, y);
      try {
        const mapBase64 = await this.getBase64ImageFromUrl(this.mapImage);
        doc.addImage(mapBase64, 'PNG', 110, y + 5, 80, 55);
      } catch(e) {
         doc.setFontSize(10);
         doc.setFont('helvetica', 'normal');
         doc.text('(El mapa no pudo ser incrustado en el PDF)', 110, y + 20);
      }
    }

    doc.save(`Reporte_Riesgo_${this.reportData.nombre.split('.')[0] || 'Oficial'}.pdf`);
  }

  private getBase64ImageFromUrl(imageUrl: string): Promise<string> {
    if (imageUrl.startsWith('data:image')) return Promise.resolve(imageUrl);
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'Anonymous';
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0);
          resolve(canvas.toDataURL('image/png'));
        } else {
          reject('Sin contexto Canvas');
        }
      };
      img.onerror = reject;
      img.src = imageUrl;
    });
  }

  formatSize(bytes: number) { return bytes < 1048576 ? (bytes/1024).toFixed(1)+' KB' : (bytes/1048576).toFixed(1)+' MB'; }
  getRiskColor(risk: number): string { if (risk >= 70) return '#DC2626'; if (risk >= 40) return '#F59E0B'; return '#10B981'; }
  getFinalClassStyle(): string { const c = this.finalClass.toLowerCase(); if (c === 'alto') return 'badge-danger'; if (c === 'medio') return 'badge-warning'; return 'badge-success'; }
  getSvgOffset(risk: number): number { const circ = 282.7; return circ - (risk / 100) * circ; }
  private capitalize(val: string): string { if (!val) return ''; return val.charAt(0).toUpperCase() + val.slice(1).toLowerCase(); }


//  HELPERS PARA HISTORIAL Y MONITOREO 

// --- HELPERS PARA MAPEO DE BASE DE DATOS E INTERFAZ ---

  getBadgeClass(level: any): string {
    if (!level) return 'badge-success';
    const l = String(level).toLowerCase();
    if (l.includes('alto') || l === '3') return 'badge-danger';
    if (l.includes('medio') || l === '2') return 'badge-warning';
    return 'badge-success';
  }

  translateRiesgo(idRiesgo: any): string {
    const r = String(idRiesgo);
    if (r === '3') return 'Alto';
    if (r === '2') return 'Medio';
    return 'Bajo';
  }

  formatDate(dateStr: any): string {
    if (!dateStr) return 'N/D';
    
    // Si la base de datos (PostgreSQL) ya nos envía la fecha formateada (ej. "29/05/2026")
    // detenemos el procesamiento y la mostramos tal cual para evitar el "Invalid Date".
    if (typeof dateStr === 'string' && dateStr.includes('/')) {
      return dateStr;
    }

    // Si llega como un Timestamp o formato ISO estándar, la convertimos.
    const d = new Date(dateStr);
    if (!isNaN(d.getTime())) {
      return d.toLocaleDateString('es-MX', {
        day: '2-digit', month: '2-digit', year: 'numeric'
      });
    }
    
    return dateStr;
  }

  getImageUrl(img: any): string {
    if (!img) return '';
    
    // Buscamos agresivamente en TODAS las posibles propiedades que tu backend usa
    const pathTarget = img.ruta_archivo || img.ruta_imagen || img.ruta || img.imagen || img.nombre_archivo;

    if (pathTarget) {
      // Limpiamos la ruta y nos quedamos solo con el nombre del archivo final
      const filename = pathTarget.split('\\').pop()?.split('/').pop();
      if (filename && filename.includes('.')) {
        return `http://localhost:3000/uploads/${filename}`;
      }
    }
    return '';
  }

}