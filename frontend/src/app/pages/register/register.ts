import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { ThemeService } from '../../services/theme.service';

@Component({
  selector: 'app-register',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './register.html',
  styleUrl: './register.scss',
})
export class RegisterComponent {
  name = '';
  email = '';
  password = '';
  confirmPassword = '';
  showPw = false;
  showCp = false;
  loading = false;
  error = '';

  constructor(
    private auth: AuthService,
    private router: Router,
    public theme: ThemeService,
  ) {}

  onSubmit() {
  this.error = '';

  const nombreRegex = /^[A-Za-zÁÉÍÓÚáéíóúÑñ\s]+$/;
  const passwordRegex = /^(?=.*[A-Z])(?=.*[!@#$%^&*(),.?":{}|<>+\-]).{6,}$/;

  if (!this.name || !this.email || !this.password || !this.confirmPassword) {
    this.error = 'Completa todos los campos requeridos.';
    return;
  }

  if (!nombreRegex.test(this.name.trim())) {
    this.error = 'El nombre solo puede contener letras y espacios.';
    return;
  }

  if (!passwordRegex.test(this.password)) {
    this.error =
      'La contraseña debe tener mínimo 6 caracteres, una mayúscula y un carácter especial.';
    return;
  }

  if (this.password !== this.confirmPassword) {
    this.error = 'Las contraseñas no coinciden.';
    return;
  }

  this.loading = true;

  this.auth.register(this.name, this.email, this.password).subscribe({
    next: () => {
      this.loading = false;
      this.router.navigate(['/home']);
    },
    error: () => {
      this.loading = false;
      this.error = 'No se pudo registrar la cuenta.';
    },
  });
}
}
