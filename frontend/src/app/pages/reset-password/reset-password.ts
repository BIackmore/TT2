import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink, ActivatedRoute } from '@angular/router';
import { ThemeService } from '../../services/theme.service';
import { AuthApiService } from '../../api/auth-api.service';

@Component({
  selector: 'app-reset-password',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './reset-password.html',
  styleUrl: './reset-password.scss'
})
export class ResetPasswordComponent implements OnInit {
  token = '';
  password = '';
  confirmPassword = '';

  loading = false;
  done = false;
  error = '';

  constructor(
    public theme: ThemeService,
    private route: ActivatedRoute,
    private router: Router,
    private authApi: AuthApiService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit() {
    this.token = this.route.snapshot.queryParamMap.get('token') || '';

    if (!this.token) {
      this.error = 'El enlace de recuperación no es válido.';
    }
  }

  onSubmit() {
    this.error = '';

    if (!this.password || this.password.length < 6) {
      this.error = 'La contraseña debe tener al menos 6 caracteres.';
      return;
    }

    if (this.password !== this.confirmPassword) {
      this.error = 'Las contraseñas no coinciden.';
      return;
    }

    this.loading = true;

    this.authApi.resetPassword(this.token, this.password).subscribe({
      next: () => {
        this.loading = false;
        this.done = true;
        this.error = '';
        this.cdr.detectChanges();
      },
      error: (err) => {
        this.loading = false;
        this.error = err.error?.error || 'No se pudo actualizar la contraseña.';
        this.cdr.detectChanges();
      }
    });
  }

  goLogin() {
    this.router.navigate(['/login']);
  }
}