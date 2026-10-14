"use client";
import { useActionState } from "react";
import { login } from "./actions";

export default function LoginPage() {
  const [state, action, pending] = useActionState(login, undefined);
  return (
    <div className="wrap">
      <div className="brandbar">CABZ<b>·</b>CRM personal</div>
      <div className="card login">
        <div className="tag">Solo tú entras</div>
        <h1 style={{ marginBottom: 6 }}>Tu dinero, en un solo sitio</h1>
        <form action={action} className={pending ? "spin" : ""}>
          <label htmlFor="email">Correo</label>
          <input id="email" name="email" type="email" autoComplete="username" required />
          <label htmlFor="password">Contraseña</label>
          <input id="password" name="password" type="password" autoComplete="current-password" required />
          {state?.error && <div className="err" role="alert">{state.error}</div>}
          <div className="center" style={{ marginTop: 18 }}>
            <button className="btn" type="submit" disabled={pending}>{pending ? "Entrando…" : "Entrar"}</button>
          </div>
        </form>
        <p className="hint" style={{ textAlign: "center", marginTop: 14 }}>
          El registro está cerrado. Si olvidaste la contraseña, cámbiala desde Supabase → Authentication → Users.
        </p>
      </div>
    </div>
  );
}
