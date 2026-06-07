import { Component, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ThemeService } from '../../services/theme.service';
import { AuthApiService } from '../../api/auth-api.service';

@Component({
  selector: 'app-forgot-password',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './forgot-password.html',
  styleUrl: './forgot-password.scss'
})
export class ForgotPasswordComponent {
  email = '';
  loading = false;
  sent = false;
  error = '';

  constructor(
    public theme: ThemeService,
    private authApi: AuthApiService,
    private cdr: ChangeDetectorRef
  ) {}

  onSubmit() {
    this.error = '';

    if (!this.email) {
      this.error = 'Ingresa tu correo electrónico.';
      return;
    }

    const emailRx = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!emailRx.test(this.email)) {
      this.error = 'El formato del correo no es válido.';
      return;
    }

    this.loading = true;

    this.authApi.forgotPassword(this.email).subscribe({
      next: () => {
        this.loading = false;
        this.sent = true;
        this.error = '';

        this.cdr.detectChanges();
      },

      error: (err) => {
        this.loading = false;
        this.error =
          err.error?.error ||
          'No se pudo enviar el correo de recuperación.';

        this.cdr.detectChanges();
      },
    });
  }
}