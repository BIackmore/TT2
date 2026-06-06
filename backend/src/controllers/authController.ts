import bcrypt from "bcryptjs";
import crypto from "crypto";
import nodemailer from "nodemailer";
import { query } from "@/db";
import { RefreshTokenBody, User } from "@/types";
import { audit, issueAuthTokens, verifyRefreshToken } from "@/services";
import { Request, Response, NextFunction } from "express";

type UserWithRole = User & {
  activo?: boolean;
  contrasena?: string;
  perfil?: unknown;
  telefono?: string | null;
  rol_nombre?: string;
};

const getUserForToken = (user: UserWithRole) => {
  const tokenUser: {
    id_usuario: number;
    correo: string;
    nombre: string;
    rol?: string;
    rol_nombre?: string;
  } = {
    id_usuario: user.id_usuario,
    correo: user.correo,
    nombre: user.nombre
  };

  if (user.rol) tokenUser.rol = user.rol;
  if (user.rol_nombre) tokenUser.rol_nombre = user.rol_nombre;

  return tokenUser;
};

const getResponseUser = (user: UserWithRole) => ({
  id_usuario: user.id_usuario,
  nombre: user.nombre,
  correo: user.correo,
  rol: user.rol_nombre || user.rol,
  activo: user.activo,
  telefono: user.telefono,
  perfil: user.perfil
});

const getUserById = async (id_usuario: number) => {
  const { rows } = await query(
    `SELECT u.id_usuario, u.nombre, u.correo, u.activo, u.telefono,
            u.perfil, LOWER(r.nombre) AS rol_nombre
     FROM usuarios u
     JOIN roles r ON r.id_rol = u.id_rol
     WHERE u.id_usuario = $1`,
    [id_usuario]
  );

  return rows[0] as UserWithRole | undefined;
};

/** POST /api/auth/login */
const login = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { correo, password } = req.body;

    const { rows } = await query(
      `SELECT u.id_usuario, u.nombre, u.correo, u.contrasena, u.activo,
              u.perfil, u.telefono, LOWER(r.nombre) AS rol_nombre
       FROM usuarios u
       JOIN roles r ON r.id_rol = u.id_rol
       WHERE LOWER(u.correo) = LOWER($1)`,
      [correo]
    );

    if (!rows.length) {
      return res
        .status(401)
        .json({ ok: false, error: "Correo o contraseña incorrectos" });
    }

    const user = rows[0];

    if (!user.activo) {
      return res.status(403).json({
        ok: false,
        error: "Tu cuenta está desactivada. Contacta al administrador."
      });
    }

    const match = await bcrypt.compare(password, user.contrasena);
    if (!match) {
      return res
        .status(401)
        .json({ ok: false, error: "Correo o contraseña incorrectos" });
    }

    const tokens = issueAuthTokens(getUserForToken(user));

    await audit({
      tabla: "usuarios",
      operacion: "SELECT",
      registroId: user.id_usuario,
      cambiadoPor: user.correo,
      descripcion: "Inició sesión",
      datosDespues: { accion: "login", ip: req.ip as string }
    });

    res.json({
      ok: true,
      token: tokens.accessToken,
      ...tokens,
      user: getResponseUser(user)
    });
  } catch (err) {
    next(err);
  }
};

/** POST /api/auth/register  (usuario común = rol 'user') */
const register = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { nombre, correo, password } = req.body;

    const exists = await query(
      "SELECT 1 FROM usuarios WHERE LOWER(correo)=LOWER($1)",
      [correo]
    );
    if (exists.rows.length) {
      return res
        .status(409)
        .json({ ok: false, error: "Ya existe una cuenta con ese correo" });
    }

    const hash = await bcrypt.hash(password, 12);
    const hoy = new Date().toLocaleDateString("es-MX");

    const { rows } = await query(
      `INSERT INTO usuarios (nombre, correo, contrasena, id_rol, perfil)
       VALUES ($1, $2, $3, (SELECT id_rol FROM roles WHERE LOWER(nombre)='user'), $4)
       RETURNING id_usuario, nombre, correo`,
      [
        nombre,
        correo.toLowerCase(),
        hash,
        JSON.stringify({ estado: "activo", fechaCreacion: hoy })
      ]
    );

    const user = rows[0];
    const full = { ...user, rol_nombre: "user", rol: "user" };
    const tokens = issueAuthTokens(getUserForToken(full));

    await audit({
      tabla: "usuarios",
      operacion: "INSERT",
      registroId: user.id_usuario,
      cambiadoPor: correo,
      descripcion: "Registro de usuario común"
    });

    res.status(201).json({
      ok: true,
      token: tokens.accessToken,
      ...tokens,
      user: { ...user, rol: "user" }
    });
  } catch (err) {
    next(err);
  }
};

/** POST /api/auth/register-gov  (usuario gubernamental – solo admin puede crear) */
const registerGov = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const {
      nombre,
      correo,
      password,
      organizacion,
      numTrabajador,
      dependencia,
      cargo,
      telefono
    } = req.body;

    // Verificar correo
    const existCorreo = await query(
      "SELECT 1 FROM usuarios WHERE LOWER(correo)=LOWER($1)",
      [correo]
    );
    if (existCorreo.rows.length) {
      return res
        .status(409)
        .json({ ok: false, error: "Ya existe una cuenta con ese correo" });
    }

    // Verificar numTrabajador (guardado en perfil JSONB)
    const existNum = await query(
      `SELECT 1 FROM usuarios WHERE perfil->>'numTrabajador' = $1`,
      [numTrabajador]
    );
    if (existNum.rows.length) {
      return res.status(409).json({
        ok: false,
        error: "El número de trabajador ya está registrado"
      });
    }

    const hash = await bcrypt.hash(password, 12);
    const hoy = new Date().toLocaleDateString("es-MX");
    const perfil = {
      organizacion,
      numTrabajador,
      dependencia,
      cargo,
      estado: "activo",
      fechaCreacion: hoy
    };

    const { rows } = await query(
      `INSERT INTO usuarios (nombre, correo, contrasena, id_rol, telefono, perfil)
       VALUES ($1,$2,$3,(SELECT id_rol FROM roles WHERE LOWER(nombre)='gov'),$4,$5)
       RETURNING id_usuario, nombre, correo`,
      [
        nombre,
        correo.toLowerCase(),
        hash,
        telefono || null,
        JSON.stringify(perfil)
      ]
    );

    await audit({
      tabla: "usuarios",
      operacion: "INSERT",
      registroId: rows[0].id_usuario,
      cambiadoPor: req.user.correo,
      descripcion: "Admin registró usuario gubernamental"
    });

    res.status(201).json({ ok: true, user: { ...rows[0], rol: "gov" } });
  } catch (err) {
    next(err);
  }
};

/** GET /api/auth/me */
const me = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = await getUserById(req.user.id_usuario);
    if (!user)
      return res
        .status(404)
        .json({ ok: false, error: "Usuario no encontrado" });
    res.json({ ok: true, user: getResponseUser(user) });
  } catch (err) {
    next(err);
  }
};

const refresh = async (
  req: Request<{}, {}, RefreshTokenBody>,
  res: Response,
  next: NextFunction
) => {
  try {
    const { refreshToken } = req.body;

    let payload;
    try {
      payload = verifyRefreshToken(refreshToken);
    } catch (_err) {
      return res
        .status(401)
        .json({ ok: false, error: "Refresh token inválido o expirado" });
    }

    const user = await getUserById(payload.id_usuario);

    if (!user) {
      return res
        .status(404)
        .json({ ok: false, error: "Usuario no encontrado" });
    }

    if (user.activo === false) {
      return res.status(403).json({
        ok: false,
        error: "Tu cuenta está desactivada. Contacta al administrador."
      });
    }

    const tokens = issueAuthTokens(getUserForToken(user));

    await audit({
      tabla: "usuarios",
      operacion: "SELECT",
      registroId: user.id_usuario,
      cambiadoPor: user.correo,
      descripcion: "Renovó sesión",
      datosDespues: { accion: "refresh", ip: req.ip as string }
    });

    res.json({ ok: true, token: tokens.accessToken, ...tokens });
  } catch (err) {
    next(err);
  }
};

const forgotPassword = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { correo } = req.body;

    if (!correo) {
      return res.status(400).json({ ok: false, error: "El correo es obligatorio" });
    }

    const user = await query(
  "SELECT id_usuario, id_rol FROM usuarios WHERE LOWER(correo)=LOWER($1)",
  [correo]
);

    if (!user.rows.length) {
      return res.status(404).json({ ok: false, error: "No existe una cuenta con ese correo" });
    }

    if (user.rows[0].id_rol === 1) {
  return res.status(403).json({
    ok: false,
    error: "Los administradores no pueden recuperar contraseña mediante correo. El cambio debe realizarse directamente en la base de datos."
  });
}

    const token = crypto.randomBytes(32).toString("hex");

    await query(
      `INSERT INTO password_resets (correo, token, expira_en)
       VALUES ($1, $2, NOW() + INTERVAL '15 minutes')`,
      [correo, token]
    );
const resetUrl = `${process.env.FRONTEND_URL}/reset-password?token=${token}`;

console.log("MAIL_USER:", process.env.MAIL_USER);
console.log("MAIL_PASS length:", process.env.MAIL_PASS?.length);

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.MAIL_USER,
    pass: process.env.MAIL_PASS,
  },
  tls: {
    rejectUnauthorized: false,
  },
});

    await transporter.sendMail({
      from: `"Sistema de Prevención de Incendios" <${process.env.MAIL_USER}>`,
      to: correo,
      subject: "Recuperación de contraseña",
      html: `
        <h2>Recuperación de contraseña</h2>
        <p>Haz clic en el siguiente enlace para cambiar tu contraseña:</p>
        <a href="${resetUrl}">${resetUrl}</a>
        <p>Este enlace expira en 15 minutos.</p>
      `,
    });

    return res.json({
      ok: true,
      message: "Si el correo existe, se enviaron instrucciones para recuperar la contraseña."
    });
  } catch (err) {
    next(err);
  }
};

const resetPassword = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { token, password } = req.body;

    if (!token || !password) {
      return res.status(400).json({ ok: false, error: "Token y contraseña son obligatorios" });
    }

    const reset = await query(
      `SELECT * FROM password_resets
       WHERE token = $1
       AND usado = FALSE
       AND expira_en > NOW()`,
      [token]
    );

    if (!reset.rows.length) {
      return res.status(400).json({ ok: false, error: "Token inválido o expirado" });
    }

    const correo = reset.rows[0].correo;
    const user = await query(
  "SELECT id_rol FROM usuarios WHERE LOWER(correo)=LOWER($1)",
  [correo]
);

if (user.rows[0]?.id_rol === 1) {
  return res.status(403).json({
    ok: false,
    error: "La contraseña de administradores solo puede modificarse directamente en la base de datos."
  });
}

  const passwordRegex = /^(?=.*[A-Z])(?=.*[!@#$%^&*(),.?":{}|<>+\-]).{6,}$/;

if (!passwordRegex.test(password)) {
  return res.status(400).json({
    ok: false,
    error:
      "La contraseña debe tener mínimo 6 caracteres, una mayúscula y un carácter especial."
  });
}
    const passwordHash = await bcrypt.hash(password, 10);

    await query(
      `UPDATE usuarios
       SET contrasena = $1
       WHERE LOWER(correo)=LOWER($2)`,
      [passwordHash, correo]
    );

    await query(
      `UPDATE password_resets
       SET usado = TRUE
       WHERE token = $1`,
      [token]
    );

    return res.json({
      ok: true,
      message: "Contraseña actualizada correctamente"
    });
  } catch (err) {
    next(err);
  }
};




export default { login, register, registerGov, me, refresh,  forgotPassword, resetPassword, };
