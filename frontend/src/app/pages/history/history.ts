import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { NavbarComponent } from '../../shared/navbar/navbar';
import { AuthService } from '../../services/auth.service';
import { Router } from '@angular/router';
import { PlatformAnalysis, PlatformApiService } from '../../api/platform-api.service';

@Component({
  selector: 'app-history',
  standalone: true,
  imports: [CommonModule, RouterLink, NavbarComponent],
  templateUrl: './history.html',
  styleUrl: './history.scss'
})
export class HistoryComponent implements OnInit {
  analyses: PlatformAnalysis[] = [];
  loading = false;
  error = '';

  constructor(
    private auth: AuthService,
    private router: Router,
    private platformApi: PlatformApiService,
    private cdr: ChangeDetectorRef,
  ) {}

  ngOnInit() {
    if (!this.auth.getUser()) {
      this.router.navigate(['/login']);
      return;
    }

    this.loading = true;
    this.platformApi.getAnalyses({ limit: 50 }).subscribe({
      next: (response) => {
        this.loading = false;
        this.analyses = response.data;

        this.cdr.detectChanges();
      },
      error: () => {
        this.loading = false;
        this.error = 'No se pudo cargar el historial.';

        this.cdr.detectChanges();
      },
    });
  }

  getBadgeClass(level: string): string {
    if (level === 'alto') return 'b-danger';
    if (level === 'medio') return 'b-warn';
    return 'b-ok';
  }

  formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return 'N/D';

  const d = new Date(dateStr);

  if (isNaN(d.getTime())) return String(dateStr);

  const dia = String(d.getDate()).padStart(2, '0');
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  const anio = d.getFullYear();

  return `${dia}/${mes}/${anio}`;
}
}
