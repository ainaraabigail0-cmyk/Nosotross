# Nosotros 💞 — la app de ustedes dos

Un espacio privado para dos personas: chat en tiempo real, fotos, notas de voz,
pregunta del día, regalitos, diario compartido y cuenta regresiva de fechas.

## Cómo funciona la conexión entre los dos celulares

La app NO vive en los teléfonos: vive en un **servidor en internet** con una dirección
única (ej: `https://nosotros-tuapp.onrender.com`). Los dos celulares se conectan a esa
dirección (por wifi o datos) y el servidor les reparte los mensajes en tiempo real.

- "Funciona offline" = la app abre al instante y sin internet podés leer lo ya recibido;
  lo que escribas sin señal **se envía solo cuando vuelve la conexión**.
- Para mandar/recibir mensajes nuevos sí hace falta internet (como cualquier chat).

## Probar en tu compu (antes de publicar)

```
cd nosotros
node server.js
```

Y abrí en el navegador: `http://localhost:3000`

Para probar con "dos personas": abrí dos pestañas (o pestaña + celular en la misma red)
y entrá con nombres distintos y el mismo código.

## Publicarla gratis en internet (paso a paso, sin saber programar)

### 1. Subir el código a GitHub (5 minutos, gratis, desde el navegador)
1. Creá una cuenta en github.com.
2. Tocá el `+` arriba a la derecha → **New repository** → nombre `nosotros` → **Create**.
3. Tocá **"uploading an existing file"**.
4. La web de GitHub no deja subir carpetas, así que subí los archivos **SUELTOS en la raíz**
   (la app funciona igual de las dos maneras): entrá a la carpeta `public` del zip
   descomprimido, seleccioná los 8 archivos y arrastralos; después arrastrá también
   `server.js` y `README.md`. Tienen que quedar los 10 sueltos arriba de todo.
   (Segunda tanda: botón **Add file → Upload files**.)
5. **Commit changes**. No subas la carpeta `data/` ni el zip.

### 2. Ponerla online en Render (gratis)
1. Creá cuenta en render.com con tu cuenta de GitHub.
2. **New → Web Service** → elegí el repo `nosotros`.
3. Configuración:
   - **Name**: nosotros
   - **Runtime**: Node
   - **Build command**: (vacío)
   - **Start command**: `node server.js`
   - **Instance type**: Free
4. **Create Web Service**. En un par de minutos te da una URL pública:
   `https://nosotros-xxxx.onrender.com`
5. Esa URL se la pasás a tu pareja. Fin. 🎉

> Alternativa si preferís: **Railway** o **Fly.io** también tienen planes gratis.
> Importante: los datos (mensajes, fotos) se guardan en un archivo del servidor.
> En el plan gratis de Render el disco se reinicia en cada deploy, así que la app es
> para charlar y vivir el momento; para historia larga, el plan starter de Render
> (USD 7/mes) le da disco persistente.

## Instalarla como app en el celular

**Android (Chrome):** abrí la URL → menú ⋮ → **"Instalar app" / "Agregar a pantalla de inicio"**.
**iPhone (Safari):** abrí la URL → botón **Compartir** → **"Agregar a pantalla de inicio"**.

Queda con ícono propio y se abre a pantalla completa, igual que una app de la Play Store,
pero sin pagar las tiendas.

## Usarla por primera vez

1. Uno entra con su nombre y deja el código vacío → la app crea el **código de pareja**.
2. Se lo mandás por WhatsApp ("Entrá a nuestro espacio 💞 código: K7QM2P").
3. La otra persona entra con su nombre y ese código.
4. Listo: quedan conectados para siempre con ese código.

## Qué incluye

- 💬 Chat en tiempo real con "escribiendo", reacciones y borrado
- 📷 Fotos (se comprimen solas)
- 🎙️ Notas de voz
- 💗 Botón "te extraño" (le llenan la pantalla de corazones a la otra persona)
- 💝 Regalitos (corazón, flor, abrazo, cartita…)
- ❓ Pregunta del día para responder de a dos
- 📔 Diario compartido con comentarios
- 📅 Fechas con cuenta regresiva (aniversario, cumple, etc.)
- 📴 Modo sin conexión: los mensajes se encolan y salen cuando vuelve internet

## Seguridad

La sala es privada con un código de 6 caracteres que solo conocen ustedes.
No hay cuentas, no hay emails, no hay nada público. Si un día quieren empezar
de cero, crean un código nuevo.
