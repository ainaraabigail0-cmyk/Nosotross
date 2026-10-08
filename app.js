/* ══════════ Nosotros — lógica del cliente ══════════ */
(() => {
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));

  const LS = { token: 'nosotros.token', codigo: 'nosotros.codigo', nombre: 'nosotros.nombre' };
  let token = localStorage.getItem(LS.token) || '';
  let miNombre = localStorage.getItem(LS.nombre) || '';
  let miCodigo = localStorage.getItem(LS.codigo) || '';
  let sala = null;
  let es = null;              // EventSource
  let pollTimer = null;
  let ultimoTs = 0;
  let mensajesPorId = new Map();
  let colaOffline = [];       // mensajes esperando conexión
  let mediaRecorder = null, audioChunks = [], notaBlob = null, notaStart = 0, notaTick = null;
  let deferredInstall = null;

  // ───────── helpers
  const api = async (ruta, opts = {}) => {
    const r = await fetch(ruta, {
      method: opts.method || 'GET',
      headers: { 'Content-Type': 'application/json', 'x-token': token },
      body: opts.body ? JSON.stringify(opts.body) : undefined
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || 'Error de red');
    return data;
  };

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const hora = (ts) => new Date(ts).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });

  const fechaLarga = (ts) => {
    const d = new Date(ts), hoy = new Date();
    const ayer = new Date(hoy); ayer.setDate(hoy.getDate() - 1);
    const fmt = (x) => x.toLocaleDateString('es-AR', { day: 'numeric', month: 'long' });
    if (d.toDateString() === hoy.toDateString()) return 'Hoy';
    if (d.toDateString() === ayer.toDateString()) return 'Ayer';
    if (d.getFullYear() === hoy.getFullYear()) return fmt(d);
    return d.toLocaleDateString('es-AR');
  };

  let toastTimer = null;
  const toast = (msg) => {
    const t = $('#toast');
    t.innerHTML = msg;
    t.classList.remove('oculto');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.add('oculto'), 2600);
  };

  const vibrar = (p) => { if (navigator.vibrate) navigator.vibrate(p); };

  // ───────── LOGIN
  async function entrar() {
    const nombre = $('#nombre').value.trim();
    const codigo = $('#codigo').value.trim();
    const err = $('#login-error');
    err.classList.add('oculto');
    if (!nombre) { err.textContent = 'Escribí tu nombre para entrar.'; err.classList.remove('oculto'); return; }
    const btn = $('#btn-entrar');
    btn.disabled = true; btn.textContent = 'Entrando…';
    try {
      const d = await api('/api/entrar', { method: 'POST', body: { nombre, codigo } });
      token = d.token; miNombre = d.nombre; miCodigo = d.codigo;
      localStorage.setItem(LS.token, token);
      localStorage.setItem(LS.nombre, miNombre);
      localStorage.setItem(LS.codigo, miCodigo);
      arrancar(d.sala);
    } catch (e) {
      err.textContent = e.message;
      err.classList.remove('oculto');
    } finally {
      btn.disabled = false; btn.textContent = 'Entrar a nuestro espacio';
    }
  }

  function mostrarLogin() {
    $('#app').classList.add('oculto');
    $('#login').classList.remove('oculto');
    $('#nombre').value = miNombre;
    $('#codigo').value = miCodigo;
  }

  // ───────── ARRANQUE
  function arrancar(salaData) {
    sala = salaData;
    $('#login').classList.add('oculto');
    $('#app').classList.remove('oculto');
    $('#codigo-grande').textContent = miCodigo;
    renderSala();
    cargarHistorial();
    conectarStream();
    cargarDiario(); cargarFechas();
  }

  function renderSala() {
    if (!sala) return;
    const nombres = sala.miembros.map((m) => m.nombre);
    const otro = nombres.find((n) => n !== miNombre);
    $('#pareja-nombres').textContent = otro ? `${miNombre} & ${otro}` : `${miNombre} (esperando a tu pareja)`;
    $('#estado').textContent = otro ? 'en línea juntos' : 'esperando a tu pareja';
    $('#pregunta-texto').textContent = sala.pregunta;
    $('#mi-respuesta').value = (sala.respuestas[miNombre] || {}).texto || '';
    renderRespuestas();
    renderRegalos();
  }

  // ───────── TIEMPO REAL (SSE) + respaldo por polling
  function conectarStream() {
    if (es) { try { es.close(); } catch (e) {} }
    try {
      es = new EventSource('/api/stream');
      es.onmessage = (ev) => {
        const d = JSON.parse(ev.data);
        recibir(d);
        setEstado(true);
      };
      es.onerror = () => { setEstado(false); };
    } catch (e) {
      es = null;
    }
    // respaldo: por si SSE no anda (algunos proxies), pedimos novedades cada 4s
    clearInterval(pollTimer);
    pollTimer = setInterval(async () => {
      if (!navigator.onLine) return;
      try {
        const d = await api(`/api/mensajes?desde=${ultimoTs}`);
        d.mensajes.forEach((m) => { if (!mensajesPorId.has(m.id)) recibir({ tipo: 'mensaje', msg: m }); });
        setEstado(true);
      } catch (e) { setEstado(false); }
    }, 4000);
  }

  function setEstado(ok) {
    $('#estado').textContent = ok
      ? (sala && sala.miembros.length > 1 ? 'en línea juntos' : 'esperando a tu pareja')
      : 'sin conexión — los mensajes se guardan';
    $('#pareja-dot').classList.toggle('off', !ok);
  }

  function recibir(d) {
    switch (d.tipo) {
      case 'mensaje': if (!mensajesPorId.has(d.msg.id)) pintarMensaje(d.msg); break;
      case 'borrado': {
        mensajesPorId.delete(d.id);
        const el = document.querySelector(`[data-id="${d.id}"]`);
        if (el) el.remove();
        break;
      }
      case 'diario': renderDiarioEntrada(d.entrada); break;
      case 'regalo':
        sala.regalos.push(d.regalo); renderRegalos();
        if (d.regalo.de !== miNombre) { lluvia(d.regalo.emoji, 14); vibrar([60, 40, 60]); }
        break;
      case 'extrano':
        if (d.ping.de !== miNombre) {
          lluvia('💗', 22); vibrar([80, 50, 80, 50, 80]);
          toast(`💗 <b>${esc(d.ping.de)}</b> te extraña`);
        }
        break;
      case 'respuesta': sala.respuestas = d.respuestas; renderRespuestas(); break;
    }
  }

  // ───────── MENSAJES
  async function cargarHistorial() {
    try {
      const d = await api('/api/mensajes?desde=0');
      d.mensajes.forEach(pintarMensaje);
      bajar();
    } catch (e) { /* sin datos todavía */ }
  }

  function pintarMensaje(m) {
    mensajesPorId.set(m.id, m);
    if (m.ts > ultimoTs) ultimoTs = m.ts;
    if (m.tipo === 'reaccion') return; // las reacciones se pintan sobre su mensaje

    const cont = $('#mensajes');
    const prev = cont.lastElementChild;
    if (!prev || !prev.dataset.dia || prev.dataset.dia !== fechaLarga(m.ts)) {
      const sep = document.createElement('div');
      sep.className = 'dia-sep'; sep.dataset.dia = fechaLarga(m.ts);
      sep.textContent = fechaLarga(m.ts);
      cont.appendChild(sep);
    }

    const mia = m.de === miNombre;
    const el = document.createElement('div');
    el.dataset.id = m.id;
    el.className = 'burbuja ' + (m.tipo === 'sistema' ? 'sistema' : (mia ? 'mia' : 'suya'));

    let cuerpo = '';
    if (m.tipo === 'sistema') cuerpo = esc(m.texto);
    else {
      if (!mia && sala && sala.miembros.length > 1) {
        const otro = sala.miembros.find((x) => x.nombre === m.de);
        cuerpo += `<span class="de-nombre" style="color:${(otro || {}).color || '#ff8fb3'}">${esc(m.de)}</span>`;
      }
      if (m.tipo === 'foto' && m.data) cuerpo += `<img src="${m.data}" alt="foto">`;
      if (m.tipo === 'nota' && m.audio) {
        cuerpo += `<div class="audio-wrap"><audio controls preload="none" src="${m.audio}"></audio></div>`;
      }
      if (m.texto) cuerpo += esc(m.texto).replace(/\n/g, '<br>');
      cuerpo += `<div class="meta">${m.pendiente ? '⏳ ' : ''}${hora(m.ts)}</div>`;
    }
    el.innerHTML = cuerpo;

    if (m.tipo !== 'sistema') {
      const acc = document.createElement('div');
      acc.className = 'acciones';
      acc.innerHTML = `<button class="mini-btn" data-act="react">❤️</button>` +
                      (mia ? `<button class="mini-btn" data-act="borrar">🗑</button>` : '');
      el.appendChild(acc);
    }
    if (m.reacciones) pintarReacciones(el, m.reacciones);

    cont.appendChild(el);
    if (m.de !== miNombre && document.hidden) vibrar([40]);
    bajar();
  }

  function pintarReacciones(el, reacciones) {
    let box = el.querySelector('.reacciones');
    if (!box) { box = document.createElement('div'); box.className = 'reacciones'; el.appendChild(box); }
    box.innerHTML = Object.values(reacciones).map((e) => `<span class="reaccion">${esc(e)}</span>`).join('');
  }

  const bajar = () => { const s = $('#mensajes'); s.scrollTop = s.scrollHeight; };

  async function enviarMsg(payload) {
    if (!navigator.onLine) {
      colaOffline.push(payload);
      pintarMensaje({ ...payload, id: 'local-' + Date.now() + Math.random(), de: miNombre, ts: Date.now(), pendiente: true });
      actualizarCola();
      return;
    }
    try {
      await api('/api/enviar', { method: 'POST', body: payload });
    } catch (e) {
      colaOffline.push(payload); actualizarCola();
      toast('Sin conexión. Lo mando en cuanto vuelva.');
    }
  }

  function actualizarCola() {
    $('#cola-count').textContent = colaOffline.length;
    $('#cola-offline').classList.toggle('oculto', colaOffline.length === 0);
  }

  window.addEventListener('online', async () => {
    if (!colaOffline.length) return;
    const pendientes = colaOffline; colaOffline = []; actualizarCola();
    for (const p of pendientes) {
      try { await api('/api/enviar', { method: 'POST', body: p }); }
      catch (e) { colaOffline.push(p); }
    }
    actualizarCola();
    if (!colaOffline.length) toast('✅ Mensajes enviados');
  });

  // ───────── composer
  function enviarTexto() {
    const ta = $('#input-msg');
    const texto = ta.value.trim();
    if (!texto) return;
    ta.value = ''; ta.style.height = 'auto';
    enviarMsg({ tipo: 'texto', texto });
  }

  // foto
  function leerFoto(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const reader = new FileReader();
      reader.onload = () => {
        img.onload = () => {
          const max = 1280;
          let { width, height } = img;
          if (width > max || height > max) {
            const k = max / Math.max(width, height);
            width = Math.round(width * k); height = Math.round(height * k);
          }
          const c = document.createElement('canvas');
          c.width = width; c.height = height;
          c.getContext('2d').drawImage(img, 0, 0, width, height);
          resolve(c.toDataURL('image/jpeg', 0.72));
        };
        img.onerror = reject;
        img.src = reader.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  // nota de voz
  async function abrirNota() {
    if (!navigator.mediaDevices || !window.MediaRecorder) {
      toast('Tu navegador no permite grabar audio 😕');
      return;
    }
    $('#modal-nota').classList.remove('oculto');
    $('#nota-wave').innerHTML = Array.from({ length: 18 }, () => '<i></i>').join('');
  }

  async function grabar() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioChunks = [];
      mediaRecorder = new MediaRecorder(stream);
      mediaRecorder.ondataavailable = (e) => e.data.size && audioChunks.push(e.data);
      mediaRecorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        notaBlob = new Blob(audioChunks, { type: mediaRecorder.mimeType || 'audio/webm' });
        $('#nota-preview').src = URL.createObjectURL(notaBlob);
        $('#nota-preview').classList.remove('oculto');
        $('#nota-enviar').classList.remove('oculto');
      };
      mediaRecorder.start();
      notaStart = Date.now();
      $('#nota-grabar').classList.add('oculto');
      $('#nota-parar').classList.remove('oculto');
      $('#nota-enviar').classList.add('oculto');
      $('#nota-preview').classList.add('oculto');
      notaTick = setInterval(() => {
        const s = Math.floor((Date.now() - notaStart) / 1000);
        $('#nota-timer').textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
        const act = mediaRecorder && mediaRecorder.state === 'recording';
        $$('#nota-wave i').forEach((b) => { b.style.height = act ? (6 + Math.random() * 26) + 'px' : '8px'; });
      }, 120);
    } catch (e) {
      toast('Necesito permiso para el micrófono 🎙️');
      $('#modal-nota').classList.add('oculto');
    }
  }

  function pararGrabacion() {
    clearInterval(notaTick);
    if (mediaRecorder && mediaRecorder.state === 'recording') mediaRecorder.stop();
    $('#nota-grabar').classList.remove('oculto');
    $('#nota-parar').classList.add('oculto');
  }

  async function enviarNota() {
    if (!notaBlob) return;
    const reader = new FileReader();
    reader.onload = () => {
      enviarMsg({
        tipo: 'nota',
        audio: reader.result,
        segundos: Math.floor((Date.now() - notaStart) / 1000)
      });
      cerrarNota();
    };
    reader.readAsDataURL(notaBlob);
  }

  function cerrarNota() {
    clearInterval(notaTick);
    if (mediaRecorder && mediaRecorder.state === 'recording') mediaRecorder.stop();
    notaBlob = null;
    $('#nota-timer').textContent = '0:00';
    $('#modal-nota').classList.add('oculto');
  }

  // ───────── NOSOTROS
  function renderRespuestas() {
    const box = $('#respuestas');
    const entradas = Object.entries(sala.respuestas || {});
    if (!entradas.length) { box.innerHTML = '<p class="muted">Todavía nadie respondió la pregunta de hoy.</p>'; return; }
    box.innerHTML = entradas.map(([quien, r]) => `
      <div class="respuesta-bloque">
        <div class="quien" style="color:${quien === miNombre ? 'var(--rosa)' : 'var(--violeta)'}">${esc(quien)}${quien === miNombre ? ' (vos)' : ''}</div>
        <p>${esc(r.texto)}</p>
      </div>`).join('');
  }

  function renderRegalos() {
    const lista = (sala.regalos || []).slice().reverse().slice(0, 12);
    $('#lista-regalos').innerHTML = lista.length
      ? lista.map((g) => `
        <div class="item-regalo">
          <span class="emoji">${esc(g.emoji)}</span>
          <span class="txt"><b>${esc(g.de)}</b> te mandó ${esc(g.nota || 'un regalito')} · ${hora(g.ts)}</span>
        </div>`).join('')
      : '<p class="muted">Mandale algo lindo cuando quieras.</p>';
  }

  function lluvia(emoji, n) {
    const cont = $('#corazones');
    for (let i = 0; i < n; i++) {
      const c = document.createElement('div');
      c.className = 'corazon-flotante';
      c.textContent = emoji;
      c.style.left = Math.random() * 100 + '%';
      c.style.fontSize = (20 + Math.random() * 24) + 'px';
      c.style.animationDuration = (2.2 + Math.random() * 1.6) + 's';
      c.style.animationDelay = (Math.random() * .6) + 's';
      cont.appendChild(c);
      setTimeout(() => c.remove(), 4600);
    }
  }

  // ───────── DIARIO
  let entradasDiario = new Map();
  async function cargarDiario() {
    try {
      const d = await api('/api/diario');
      entradasDiario.clear();
      $('#lista-diario').innerHTML = '';
      d.entradas.slice().reverse().forEach(renderDiarioEntrada);
    } catch (e) {}
  }

  function renderDiarioEntrada(e) {
    entradasDiario.set(e.id, e);
    let el = document.querySelector(`[data-entrada="${e.id}"]`);
    if (!el) {
      el = document.createElement('div');
      el.className = 'entrada';
      el.dataset.entrada = e.id;
      $('#lista-diario').prepend(el);
    }
    const color = e.de === miNombre ? 'var(--rosa)' : 'var(--violeta)';
    el.innerHTML = `
      <div class="entrada-head">
        <span class="entrada-quien" style="color:${color}">${esc(e.de)}</span>
        <span class="entrada-fecha">${fechaLarga(e.ts)} · ${hora(e.ts)}</span>
      </div>
      <p>${esc(e.texto)}</p>
      ${(e.comentarios || []).map((c) => `<div class="comentario"><b>${esc(c.de)}:</b> ${esc(c.texto)}</div>`).join('')}
      <div class="comentar">
        <input type="text" placeholder="Comentar…" maxlength="2000">
        <button>➤</button>
      </div>`;
    el.querySelector('.comentar button').onclick = () => {
      const inp = el.querySelector('.comentar input');
      const texto = inp.value.trim();
      if (!texto) return;
      inp.value = '';
      api('/api/diario/comentar', { method: 'POST', body: { id: e.id, texto } }).catch(() => toast('No se pudo comentar'));
    };
  }

  // ───────── FECHAS
  async function cargarFechas() {
    try {
      const d = await api('/api/fechas');
      renderFechas(d.fechas);
    } catch (e) {}
  }

  function diasPara(fechaISO, anual) {
    const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
    let [y, m, dd] = fechaISO.split('-').map(Number);
    let dest = new Date(y, m - 1, dd);
    if (anual) {
      dest = new Date(hoy.getFullYear(), m - 1, dd);
      if (dest < hoy) dest = new Date(hoy.getFullYear() + 1, m - 1, dd);
    }
    return Math.round((dest - hoy) / 86400000);
  }

  function renderFechas(fechas) {
    const box = $('#lista-fechas');
    if (!fechas.length) { box.innerHTML = '<p class="muted">Agregá su aniversario, cumpleaños o el día que se conocieron.</p>'; return; }
    box.innerHTML = fechas.map((f) => {
      const dias = diasPara(f.fecha, f.anual);
      const [y, m, dd] = f.fecha.split('-');
      const meses = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
      const texto = dias === 0 ? '¡Es hoy! 🎉' : (dias === 1 ? 'falta 1 día' : `faltan ${dias} días`);
      return `
      <div class="fecha-item">
        <div class="fecha-num"><b>${dd}</b><span>${meses[m - 1]}</span></div>
        <div class="fecha-info"><b>${esc(f.titulo)}</b><span>${texto}</span></div>
        <button class="borrar-fecha" data-id="${f.id}">✕</button>
      </div>`;
    }).join('');
    box.querySelectorAll('.borrar-fecha').forEach((b) => {
      b.onclick = async () => {
        const d = await api('/api/fechas/borrar', { method: 'POST', body: { id: b.dataset.id } });
        renderFechas(d.fechas);
      };
    });
  }

  // ───────── TABS
  $$('.tab').forEach((t) => {
    t.onclick = () => {
      $$('.tab').forEach((x) => x.classList.remove('activo'));
      t.classList.add('activo');
      $$('.vista').forEach((v) => v.classList.add('oculto'));
      $('#vista-' + t.dataset.vista).classList.remove('oculto');
      if (t.dataset.vista === 'chat') bajar();
    };
  });

  // ───────── eventos
  $('#btn-entrar').onclick = entrar;
  $('#codigo').addEventListener('input', (e) => { e.target.value = e.target.value.toUpperCase(); });
  $('#codigo').addEventListener('keydown', (e) => { if (e.key === 'Enter') entrar(); });
  $('#nombre').addEventListener('keydown', (e) => { if (e.key === 'Enter') entrar(); });

  $('#btn-enviar').onclick = enviarTexto;
  $('#input-msg').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviarTexto(); }
  });
  $('#input-msg').addEventListener('input', (e) => {
    e.target.style.height = 'auto';
    e.target.style.height = Math.min(e.target.scrollHeight, 110) + 'px';
  });

  $('#mensajes').addEventListener('click', async (e) => {
    const btn = e.target.closest('.mini-btn');
    if (!btn) return;
    const burbuja = btn.closest('.burbuja');
    const id = burbuja.dataset.id;
    if (btn.dataset.act === 'react') {
      await api('/api/enviar', { method: 'POST', body: { tipo: 'reaccion', ref: id, emoji: '❤️' } })
        .catch(() => toast('No se pudo reaccionar'));
      const m = mensajesPorId.get(id);
      if (m) { m.reacciones = { ...(m.reacciones || {}), [miNombre]: '❤️' }; pintarReacciones(burbuja, m.reacciones); }
      lluvia('❤️', 6);
    }
    if (btn.dataset.act === 'borrar') {
      await api('/api/borrar', { method: 'POST', body: { id } }).catch(() => {});
    }
  });

  $('#btn-foto').onclick = () => $('#file-foto').click();
  $('#file-foto').onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    toast('Procesando foto…');
    try {
      const data = await leerFoto(file);
      await enviarMsg({ tipo: 'foto', data, texto: '' });
    } catch (err) { toast('No pude leer esa foto'); }
    e.target.value = '';
  };

  $('#btn-nota').onclick = abrirNota;
  $('#nota-grabar').onclick = grabar;
  $('#nota-parar').onclick = pararGrabacion;
  $('#nota-enviar').onclick = enviarNota;
  $('#nota-cancelar').onclick = cerrarNota;

  $('#btn-extrano').onclick = () => {
    api('/api/te-extrano', { method: 'POST' }).then(() => { lluvia('💗', 16); toast('💗 Le avisé que la extrañás'); })
      .catch(() => toast('Sin conexión'));
  };

  $$('.regalo').forEach((b) => {
    b.onclick = () => {
      api('/api/regalo', { method: 'POST', body: { tipo: b.dataset.tipo, emoji: b.dataset.emoji, nota: '' } })
        .then(() => { lluvia(b.dataset.emoji, 10); toast(`${b.dataset.emoji} Regalito enviado`); })
        .catch(() => toast('Sin conexión'));
    };
  });

  $('#btn-resp-guardar').onclick = () => {
    const texto = $('#mi-respuesta').value.trim();
    if (!texto) { toast('Escribí algo primero 🙂'); return; }
    api('/api/respuesta', { method: 'POST', body: { texto } })
      .then((d) => { sala.respuestas = d.respuestas; renderRespuestas(); toast('Respuesta guardada 💞'); })
      .catch((e) => toast(e.message));
  };
  $('#btn-resp-borrar').onclick = () => {
    $('#mi-respuesta').value = '';
    api('/api/respuesta', { method: 'POST', body: { texto: '' } })
      .then((d) => { sala.respuestas = d.respuestas; renderRespuestas(); });
  };

  $('#btn-diario').onclick = () => {
    const texto = $('#diario-texto').value.trim();
    if (!texto) { toast('Escribí algo primero 🙂'); return; }
    api('/api/diario', { method: 'POST', body: { texto } })
      .then(() => { $('#diario-texto').value = ''; toast('Guardado en el diario 📔'); })
      .catch((e) => toast(e.message));
  };

  $('#btn-evento').onclick = () => {
    const titulo = $('#evento-titulo').value.trim();
    const fecha = $('#evento-fecha').value;
    api('/api/fechas', { method: 'POST', body: { titulo, fecha, anual: $('#evento-anual').checked } })
      .then((d) => { renderFechas(d.fechas); $('#evento-titulo').value = ''; toast('Fecha agregada 📅'); })
      .catch((e) => toast(e.message));
  };

  $('#btn-ajustes').onclick = () => $('#modal-ajustes').classList.remove('oculto');
  $('#modal-ajustes').onclick = (e) => { if (e.target.id === 'modal-ajustes') $('#modal-ajustes').classList.add('oculto'); };
  $('#modal-nota').onclick = (e) => { if (e.target.id === 'modal-nota') cerrarNota(); };

  $('#btn-copiar-codigo').onclick = async () => {
    const txt = `Entrá a nuestro espacio 💞\n${location.origin}\nCódigo: ${miCodigo}`;
    try { await navigator.clipboard.writeText(txt); toast('Copiado — pegáselo a tu pareja'); }
    catch (e) { toast('Copialo a mano: ' + miCodigo); }
  };

  $('#btn-salir').onclick = async () => {
    try { await api('/api/salir', { method: 'POST' }); } catch (e) {}
    localStorage.clear();
    location.reload();
  };

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); deferredInstall = e;
    $('#btn-instalar').classList.remove('oculto');
  });
  $('#btn-instalar').onclick = async () => {
    if (!deferredInstall) {
      toast('En iPhone: botón Compartir → "Agregar a inicio"');
      return;
    }
    deferredInstall.prompt();
    await deferredInstall.userChoice;
    deferredInstall = null;
  };
  $('#btn-instalar').classList.add('oculto');

  window.addEventListener('offline', () => setEstado(false));
  window.addEventListener('online', () => setEstado(true));

  // service worker (para que abra rápido y sin conexión)
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }

  // ───────── init
  if (token) {
    api('/api/sala').then((d) => arrancar(d.sala)).catch(() => { localStorage.clear(); mostrarLogin(); });
  } else {
    mostrarLogin();
  }
})();
