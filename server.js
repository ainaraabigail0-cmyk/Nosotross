#!/usr/bin/env node
/**
 * "Nosotros" — app privada para dos personas.
 * Backend sin dependencias externas: solo módulos nativos de Node.
 *
 *   node server.js
 *
 * Los datos se guardan en data/nosotros.json (se crea solo).
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'nosotros.json');
// Acepta dos estructuras de repo: con carpeta public/ o con todo suelto en la raíz
// (la web de GitHub a veces no deja subir carpetas, así que ambas funcionan).
const PUBLIC_DIR = fs.existsSync(path.join(__dirname, 'public', 'index.html'))
  ? path.join(__dirname, 'public')
  : __dirname;

// ---------------------------------------------------------------- datos
function emptyDB() {
  return {
    rooms: {},      // codigo -> { codigo, creado, miembros:{token:{nombre,color}}, estado:{...} }
    messages: {},   // codigo -> [msg]
    journal: {},    // codigo -> [entrada]
    eventos: {},    // codigo -> [evento]
    tokens: {}      // token -> { codigo, nombre }
  };
}

let db;
try {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  db = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  db = Object.assign(emptyDB(), db);
} catch (e) {
  db = emptyDB();
}

let saveTimer = null;
function save() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    const tmp = DATA_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(db));
    fs.renameSync(tmp, DATA_FILE);
  }, 120);
}

// ---------------------------------------------------------------- preguntas de pareja
const PREGUNTAS = [
  '¿Cuál fue el momento en que te diste cuenta de que me querías?',
  '¿Qué detalle mío te hace sonreír sin que yo me dé cuenta?',
  'Si mañana tuviéramos un día entero libre y sin plata, ¿qué haríamos?',
  '¿Qué canción te hace acordar a nosotros y por qué?',
  '¿Cuál es el recuerdo nuestro que más te gusta revivir?',
  '¿Qué cosa te da miedo decirme y nunca me dijiste?',
  '¿Qué plan soñás hacer conmigo dentro de 5 años?',
  '¿Cuál fue nuestro peor día y cómo lo superamos?',
  '¿Qué comida mía (o que comimos juntos) no te vas a olvidar nunca?',
  'Si tuvieras que describirme con 3 palabras, ¿cuáles serían?',
  '¿Qué me perdonaste que todavía no te agradecí bien?',
  '¿Qué lugar del mundo te gustaría conocer conmigo?',
  '¿Cuál es tu foto favorita de nosotros dos?',
  '¿Qué aprendiste de vos estando conmigo?',
  '¿Qué rutina nuestra no querés que cambie nunca?',
  '¿Cuándo fue la última vez que te sorprendí?',
  '¿Qué canción pondrías si tuviéramos que bailar ahora?',
  '¿Qué es lo que más extrañás cuando no estamos juntos?',
  '¿Qué apodo tuyo te gusta más y por qué?',
  '¿Qué haríamos si ganáramos la lotería mañana?',
  '¿Qué te hace sentir más querido/a por mí?',
  '¿Cuál fue el viaje (o salida) más desastroso y divertido que tuvimos?',
  '¿Qué me dirías si supieras que no me enojo?',
  '¿Qué parte de mi físico te encanta y nunca te dije que notás?',
  '¿Qué tradición nuestra querés inventar?',
  '¿Cuál es el chiste interno que más te hace reír?',
  '¿Qué querés que hagamos este finde, sí o sí?',
  '¿Qué te da orgullo de nuestra relación?',
  '¿Qué mensaje mío releíste más veces?',
  'Si pudieras volver a vivir un día nuestro, ¿cuál sería?',
  '¿Qué te asusta de envejecer juntos?',
  '¿Cuál es tu olor o lugar favorito de casa?',
  '¿Qué querés que te cocine este mes?',
  '¿Qué canción no soportás que ponga?',
  '¿Qué sueño tuyo querés que yo te ayude a cumplir?',
  '¿Cuál fue la primera impresión que tuviste de mí?',
  '¿Qué detalle chiquito hago que te hace feliz?',
  '¿Qué nos falta para sentirnos todavía más cerca?',
  '¿Qué momento nuestro le contarías a nuestros nietos?',
  '¿Qué te gusta hacer conmigo que no harías con nadie más?'
];

function preguntaDelDia(codigo) {
  const base = new Date().toISOString().slice(0, 10);
  const seed = base + ':' + codigo;
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PREGUNTAS[h % PREGUNTAS.length];
}

// ---------------------------------------------------------------- utilidades
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8'
};

function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function readBody(req, limit = 4 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('payload demasiado grande'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch (e) {
        reject(new Error('JSON inválido'));
      }
    });
    req.on('error', reject);
  });
}

function normalizeCode(raw) {
  return String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
}

function nuevoCodigo() {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sin letras ambiguas
  let out = '';
  const bytes = crypto.randomBytes(6);
  for (let i = 0; i < 6; i++) out += abc[bytes[i] % abc.length];
  return out;
}

function colorPara(nombre) {
  const paleta = ['#ff5c8a', '#7c5cff', '#00b4d8', '#ff9f1c', '#2ec4b6', '#e63946'];
  let h = 0;
  for (const ch of nombre) h = (h * 33 + ch.charCodeAt(0)) >>> 0;
  return paleta[h % paleta.length];
}

function estadoPorDefecto(codigo) {
  return {
    creado: Date.now(),
    preguntaFecha: '',
    respuestas: {},       // nombre -> { texto, ts }
    regalos: [],          // { id, de, tipo, ts, leido }
    notasVoz: [],
    extraños: []          // pings "te extraño"
  };
}

function room(codigo) {
  if (!db.rooms[codigo]) {
    db.rooms[codigo] = {
      codigo,
      creado: Date.now(),
      miembros: {},
      estado: estadoPorDefecto(codigo)
    };
    db.messages[codigo] = [];
    db.journal[codigo] = [];
    db.eventos[codigo] = [];
    save();
  }
  const r = db.rooms[codigo];
  if (!r.estado) r.estado = estadoPorDefecto(codigo);
  return r;
}

function pushMsg(codigo, msg) {
  if (!db.messages[codigo]) db.messages[codigo] = [];
  db.messages[codigo].push(msg);
  if (db.messages[codigo].length > 5000) db.messages[codigo].splice(0, db.messages[codigo].length - 5000);
  save();
}

function broadcast(codigo, tipo, data) {
  const payload = { tipo, ...data };
  for (const [res, code] of sseClients) {
    if (code !== codigo) continue;
    try { res.write(`data: ${JSON.stringify(payload)}\n\n`); } catch (e) { /* socket muerto */ }
  }
}

// ---------------------------------------------------------------- SSE
const sseClients = new Map();

function abrirSSE(req, res, codigo) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  res.write(`retry: 3000\n\n`);
  res.write(`data: ${JSON.stringify({ tipo: 'hola' })}\n\n`);
  sseClients.set(res, codigo);
  const ping = setInterval(() => {
    try { res.write(': ping\n\n'); } catch (e) { /* noop */ }
  }, 25000);
  req.on('close', () => {
    clearInterval(ping);
    sseClients.delete(res);
  });
}

// ---------------------------------------------------------------- helpers de vista
function vistaPublica(r) {
  const e = r.estado;
  const hoy = new Date().toISOString().slice(0, 10);
  if (e.preguntaFecha !== hoy) {
    e.preguntaFecha = hoy;
    e.respuestas = {};
    save();
  }
  return {
    codigo: r.codigo,
    miembros: Object.values(r.miembros).map((m) => ({ nombre: m.nombre, color: m.color })),
    pregunta: preguntaDelDia(r.codigo),
    respuestas: e.respuestas,
    regalos: e.regalos.slice(-30),
    extraños: e.extraños.slice(-30)
  };
}

// ---------------------------------------------------------------- rutas API
async function handleAPI(req, res, url) {
  const p = url.pathname;

  // --- entrar / crear pareja
  if (p === '/api/entrar' && req.method === 'POST') {
    const body = await readBody(req);
    const nombre = String(body.nombre || '').trim().slice(0, 24);
    let codigo = normalizeCode(body.codigo);
    if (!nombre) return json(res, 400, { error: 'Decime tu nombre.' });

    if (!codigo) {
      do { codigo = nuevoCodigo(); } while (db.rooms[codigo]);
    }
    if (codigo.length < 4) return json(res, 400, { error: 'Ese código es muy corto.' });

    const r = room(codigo);
    if (Object.keys(r.miembros).length >= 2) {
      const existe = Object.values(r.miembros).some((m) => m.nombre.toLowerCase() === nombre.toLowerCase());
      if (!existe) return json(res, 409, { error: 'Esta sala ya tiene 2 personas. Es solo para ustedes dos.' });
    }
    const token = crypto.randomBytes(24).toString('hex');
    r.miembros[token] = { nombre, color: colorPara(nombre), ts: Date.now() };
    db.tokens[token] = { codigo, nombre };
    save();

    const msg = {
      id: crypto.randomUUID(),
      tipo: 'sistema',
      de: nombre,
      texto: `${nombre} entró a nuestro espacio 💞`,
      ts: Date.now()
    };
    pushMsg(codigo, msg);
    broadcast(codigo, 'mensaje', { msg });
    return json(res, 200, { token, codigo, nombre, sala: vistaPublica(r) });
  }

  // --- auth
  const token = req.headers['x-token'] || '';
  const sesion = db.tokens[token];
  const authed = () => {
    if (sesion && db.rooms[sesion.codigo]) return null;
    json(res, 401, { error: 'Tu sesión expiró. Volvé a entrar con tu código.' });
    return true;
  };

  if (p === '/api/sala' && req.method === 'GET') {
    if (authed()) return;
    return json(res, 200, { sala: vistaPublica(db.rooms[sesion.codigo]) });
  }

  if (p === '/api/mensajes' && req.method === 'GET') {
    if (authed()) return;
    const desde = parseInt(url.searchParams.get('desde') || '0', 10) || 0;
    const todos = db.messages[sesion.codigo] || [];
    return json(res, 200, { mensajes: todos.filter((m) => m.ts > desde) });
  }

  if (p === '/api/enviar' && req.method === 'POST') {
    if (authed()) return;
    const body = await readBody(req);
    const tipo = ['texto', 'foto', 'nota', 'reaccion'].includes(body.tipo) ? body.tipo : 'texto';
    const msg = {
      id: crypto.randomUUID(),
      tipo,
      de: sesion.nombre,
      texto: String(body.texto || '').slice(0, 4000),
      ts: Date.now()
    };
    if (tipo === 'foto') msg.data = String(body.data || '').slice(0, 1_200_000);
    if (tipo === 'nota') {
      msg.audio = String(body.audio || '').slice(0, 2_500_000);
      msg.segundos = Number(body.segundos) || 0;
    }
    if (tipo === 'reaccion') {
      msg.ref = String(body.ref || '');
      msg.emoji = String(body.emoji || '❤️').slice(0, 8);
      const objetivo = (db.messages[sesion.codigo] || []).find((m) => m.id === msg.ref);
      if (objetivo) {
        objetivo.reacciones = objetivo.reacciones || {};
        objetivo.reacciones[sesion.nombre] = msg.emoji;
      }
    }
    pushMsg(sesion.codigo, msg);
    broadcast(sesion.codigo, 'mensaje', { msg });
    return json(res, 200, { ok: true, msg });
  }

  if (p === '/api/borrar' && req.method === 'POST') {
    if (authed()) return;
    const body = await readBody(req);
    const arr = db.messages[sesion.codigo] || [];
    const i = arr.findIndex((m) => m.id === body.id && m.de === sesion.nombre);
    if (i >= 0) {
      const [eliminado] = arr.splice(i, 1);
      save();
      broadcast(sesion.codigo, 'borrado', { id: eliminado.id });
    }
    return json(res, 200, { ok: true });
  }

  if (p === '/api/stream' && req.method === 'GET') {
    if (authed()) return;
    return abrirSSE(req, res, sesion.codigo);
  }

  // --- diario
  if (p === '/api/diario' && req.method === 'GET') {
    if (authed()) return;
    return json(res, 200, { entradas: db.journal[sesion.codigo] || [] });
  }

  if (p === '/api/diario' && req.method === 'POST') {
    if (authed()) return;
    const body = await readBody(req);
    const texto = String(body.texto || '').trim().slice(0, 6000);
    if (!texto) return json(res, 400, { error: 'Escribí algo primero.' });
    const entrada = {
      id: crypto.randomUUID(),
      de: sesion.nombre,
      texto,
      ts: Date.now(),
      comentarios: []
    };
    db.journal[sesion.codigo].unshift(entrada);
    db.journal[sesion.codigo] = db.journal[sesion.codigo].slice(0, 500);
    save();
    broadcast(sesion.codigo, 'diario', { entrada });
    return json(res, 200, { entrada });
  }

  if (p === '/api/diario/comentar' && req.method === 'POST') {
    if (authed()) return;
    const body = await readBody(req);
    const e = (db.journal[sesion.codigo] || []).find((x) => x.id === body.id);
    if (!e) return json(res, 404, { error: 'No existe esa entrada.' });
    const c = { id: crypto.randomUUID(), de: sesion.nombre, texto: String(body.texto || '').slice(0, 2000), ts: Date.now() };
    e.comentarios.push(c);
    save();
    broadcast(sesion.codigo, 'diario', { entrada: e });
    return json(res, 200, { entrada: e });
  }

  // --- regalos / te extraño
  if (p === '/api/regalo' && req.method === 'POST') {
    if (authed()) return;
    const body = await readBody(req);
    const r = db.rooms[sesion.codigo];
    const g = {
      id: crypto.randomUUID(),
      de: sesion.nombre,
      tipo: String(body.tipo || 'corazon').slice(0, 24),
      emoji: String(body.emoji || '💝').slice(0, 8),
      nota: String(body.nota || '').slice(0, 500),
      ts: Date.now(),
      leido: false
    };
    r.estado.regalos.push(g);
    r.estado.regalos = r.estado.regalos.slice(-100);
    save();
    broadcast(sesion.codigo, 'regalo', { regalo: g });
    return json(res, 200, { regalo: g });
  }

  if (p === '/api/te-extrano' && req.method === 'POST') {
    if (authed()) return;
    const r = db.rooms[sesion.codigo];
    const ping = { id: crypto.randomUUID(), de: sesion.nombre, ts: Date.now() };
    r.estado.extraños.push(ping);
    r.estado.extraños = r.estado.extraños.slice(-100);
    save();
    broadcast(sesion.codigo, 'extrano', { ping });
    return json(res, 200, { ping });
  }

  if (p === '/api/regalo/leer' && req.method === 'POST') {
    if (authed()) return;
    const body = await readBody(req);
    const r = db.rooms[sesion.codigo];
    const g = r.estado.regalos.find((x) => x.id === body.id);
    if (g) { g.leido = true; save(); }
    return json(res, 200, { ok: true });
  }

  if (p === '/api/respuesta' && req.method === 'POST') {
    if (authed()) return;
    const body = await readBody(req);
    const r = db.rooms[sesion.codigo];
    const texto = String(body.texto || '').trim().slice(0, 4000);
    const hoy = new Date().toISOString().slice(0, 10);
    if (r.estado.preguntaFecha !== hoy) { r.estado.preguntaFecha = hoy; r.estado.respuestas = {}; }
    if (!texto) delete r.estado.respuestas[sesion.nombre];
    else r.estado.respuestas[sesion.nombre] = { texto, ts: Date.now() };
    save();
    broadcast(sesion.codigo, 'respuesta', { respuestas: r.estado.respuestas });
    return json(res, 200, { respuestas: r.estado.respuestas });
  }

  // --- fechas / recordatorios
  if (p === '/api/fechas' && req.method === 'GET') {
    if (authed()) return;
    return json(res, 200, { fechas: db.eventos[sesion.codigo] || [] });
  }

  if (p === '/api/fechas' && req.method === 'POST') {
    if (authed()) return;
    const body = await readBody(req);
    const titulo = String(body.titulo || '').trim().slice(0, 80);
    const fecha = String(body.fecha || '').slice(0, 10);
    if (!titulo || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return json(res, 400, { error: 'Necesito un título y una fecha.' });
    const ev = {
      id: crypto.randomUUID(),
      titulo,
      fecha,
      anual: body.anual !== false,
      ts: Date.now()
    };
    db.eventos[sesion.codigo].push(ev);
    db.eventos[sesion.codigo].sort((a, b) => a.fecha.localeCompare(b.fecha));
    save();
    return json(res, 200, { fechas: db.eventos[sesion.codigo] });
  }

  if (p === '/api/fechas/borrar' && req.method === 'POST') {
    if (authed()) return;
    const body = await readBody(req);
    db.eventos[sesion.codigo] = (db.eventos[sesion.codigo] || []).filter((f) => f.id !== body.id);
    save();
    return json(res, 200, { fechas: db.eventos[sesion.codigo] });
  }

  if (p === '/api/salir' && req.method === 'POST') {
    if (authed()) return;
    const r = db.rooms[sesion.codigo];
    delete r.miembros[token];
    delete db.tokens[token];
    save();
    return json(res, 200, { ok: true });
  }

  return json(res, 404, { error: 'Ruta no encontrada' });
}

// ---------------------------------------------------------------- servidor
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (url.pathname.startsWith('/api/')) {
    try {
      await handleAPI(req, res, url);
    } catch (e) {
      json(res, 400, { error: e.message || 'Error' });
    }
    return;
  }

  // archivos estáticos
  let file = url.pathname === '/' ? '/index.html' : url.pathname;
  const full = path.join(PUBLIC_DIR, path.normalize(file).replace(/^(\.\.[/\\])+/, ''));
  if (!full.startsWith(PUBLIC_DIR)) {
    res.writeHead(403); return res.end('no');
  }
  // nunca servir el código del servidor, el readme ni los datos privados
  const relPrimero = path.relative(PUBLIC_DIR, full).split(path.sep)[0];
  if (relPrimero === 'data' || relPrimero === 'server.js' || relPrimero === 'README.md' || relPrimero.startsWith('.')) {
    res.writeHead(404); return res.end('no encontrado');
  }
  fs.readFile(full, (err, data) => {
    if (err) {
      // SPA fallback
      fs.readFile(path.join(PUBLIC_DIR, 'index.html'), (e2, d2) => {
        if (e2) { res.writeHead(404); return res.end('no encontrado'); }
        res.writeHead(200, { 'Content-Type': MIME['.html'] });
        res.end(d2);
      });
      return;
    }
    const ext = path.extname(full).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': ext === '.html' ? 'no-store' : 'public, max-age=300'
    });
    res.end(data);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`Nosotros corriendo en http://${HOST}:${PORT}`);
});
