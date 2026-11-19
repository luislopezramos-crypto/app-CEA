/* Chat de CEA: la asistente contesta al momento y la recepción puede entrar en la conversación.
   Se abre con el botón flotante o con cualquier elemento [data-open-chat] de la página. */
(function () {
  'use strict';
  if (window.__norayChat) return;
  window.__norayChat = true;

  var KEY = 'noray-chat-visitor';
  var visitorId;
  try {
    visitorId = localStorage.getItem(KEY);
    if (!visitorId) {
      visitorId = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + '-' + Math.random().toString(36).slice(2));
      localStorage.setItem(KEY, visitorId);
    }
  } catch (e) {
    visitorId = String(Date.now()) + '-' + Math.random().toString(36).slice(2, 12);
  }

  var state = { open: false, assistant: 'Ana', clinic: 'CEA', agent: null, messages: [], typing: false, loaded: false };
  var socket = null;

  var css = `
  :host { all: initial; }
  * { box-sizing: border-box; }
  .launcher {
    position: fixed; right: 20px; bottom: 20px; z-index: 2147483000;
    display: flex; align-items: center; gap: 10px; height: 56px; padding: 0 20px 0 16px; border: 0; border-radius: 999px;
    background: var(--c-ink); color: var(--c-paper); font: 600 15px/1 var(--c-sans); cursor: pointer;
    box-shadow: 0 10px 30px rgba(20, 20, 18, .22); transition: transform .15s ease, box-shadow .15s ease;
  }
  .launcher:hover { transform: translateY(-2px); box-shadow: 0 14px 34px rgba(20, 20, 18, .26); }
  .launcher:active { transform: translateY(0); }
  .launcher .pulse { width: 9px; height: 9px; border-radius: 50%; background: var(--c-live); box-shadow: 0 0 0 0 var(--c-live); animation: pulse 2.4s infinite; }
  .launcher[hidden] { display: none; }
  @keyframes pulse { 0% { box-shadow: 0 0 0 0 rgba(122, 170, 128, .6); } 70% { box-shadow: 0 0 0 10px rgba(122, 170, 128, 0); } 100% { box-shadow: 0 0 0 0 rgba(122, 170, 128, 0); } }
  .panel {
    position: fixed; right: 20px; bottom: 20px; z-index: 2147483001; width: 380px; height: min(620px, calc(100vh - 40px));
    display: flex; flex-direction: column; overflow: hidden; border-radius: 18px; background: var(--c-paper);
    box-shadow: 0 24px 60px rgba(20, 20, 18, .25), 0 0 0 1px rgba(20, 20, 18, .06);
    font: 400 15px/1.45 var(--c-sans); color: var(--c-ink);
    transform-origin: bottom right; animation: open .28s cubic-bezier(.2, .9, .3, 1.1);
  }
  .panel[hidden] { display: none; }
  @keyframes open { from { opacity: 0; transform: translateY(10px) scale(.97); } to { opacity: 1; transform: none; } }
  header { display: flex; align-items: center; gap: 12px; padding: 16px 16px 14px 18px; background: var(--c-ink); color: var(--c-paper); }
  .mark { width: 38px; height: 38px; border-radius: 50%; background: var(--c-accent); display: grid; place-items: center; font: 500 18px/1 var(--c-serif); flex: none; }
  .who { flex: 1; display: grid; gap: 2px; }
  .who strong { font: 500 17px/1.2 var(--c-serif); }
  .who span { font-size: 12.5px; opacity: .75; display: flex; align-items: center; gap: 6px; }
  .who span i { width: 7px; height: 7px; border-radius: 50%; background: var(--c-live); display: inline-block; }
  .close { width: 36px; height: 36px; border: 0; border-radius: 50%; background: transparent; color: inherit; cursor: pointer; display: grid; place-items: center; opacity: .8; }
  .close:hover { background: rgba(255, 255, 255, .1); opacity: 1; }
  .agent { padding: 8px 18px; background: var(--c-clay-soft); color: var(--c-clay); font-size: 13px; font-weight: 500; }
  .agent[hidden] { display: none; }
  .body { flex: 1; overflow-y: auto; padding: 18px 16px 8px; display: flex; flex-direction: column; gap: 8px; }
  .msg { max-width: 84%; padding: 9px 13px; border-radius: 16px; white-space: pre-wrap; overflow-wrap: anywhere; animation: in .22s ease; }
  @keyframes in { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
  .msg.bot { align-self: flex-start; background: var(--c-surface); border-bottom-left-radius: 5px; }
  .msg.me { align-self: flex-end; background: var(--c-accent); color: var(--c-paper); border-bottom-right-radius: 5px; }
  .msg.staff { align-self: flex-start; background: var(--c-clay-soft); border-bottom-left-radius: 5px; }
  .msg small { display: block; font-size: 11.5px; font-weight: 600; color: var(--c-clay); margin-bottom: 2px; }
  .typing { align-self: flex-start; display: flex; gap: 4px; padding: 13px 14px; background: var(--c-surface); border-radius: 16px; border-bottom-left-radius: 5px; }
  .typing span { width: 6px; height: 6px; border-radius: 50%; background: var(--c-muted); animation: blink 1.2s infinite; }
  .typing span:nth-child(2) { animation-delay: .2s; } .typing span:nth-child(3) { animation-delay: .4s; }
  @keyframes blink { 50% { opacity: .25; } }
  .suggest { display: flex; flex-wrap: wrap; gap: 6px; padding: 4px 16px 10px; }
  .suggest[hidden] { display: none; }
  .suggest button { border: 1px solid var(--c-line); background: transparent; color: var(--c-ink); border-radius: 999px; padding: 7px 12px; font: 500 13px/1 var(--c-sans); cursor: pointer; min-height: 34px; transition: border-color .15s, background .15s; }
  .suggest button:hover { border-color: var(--c-ink); background: var(--c-surface); }
  form { display: flex; gap: 8px; padding: 10px 12px 12px; border-top: 1px solid var(--c-line); background: var(--c-paper); }
  textarea { flex: 1; resize: none; border: 1px solid var(--c-line); border-radius: 12px; padding: 10px 12px; font: 400 15px/1.35 var(--c-sans); color: var(--c-ink); background: #fff; max-height: 110px; min-height: 44px; }
  textarea:focus { outline: none; border-color: var(--c-accent); box-shadow: 0 0 0 3px var(--c-accent-soft); }
  .send { width: 44px; height: 44px; flex: none; border: 0; border-radius: 12px; background: var(--c-accent); color: var(--c-paper); cursor: pointer; display: grid; place-items: center; transition: transform .1s, opacity .15s; }
  .send:disabled { opacity: .45; cursor: default; }
  .send:not(:disabled):active { transform: scale(.96); }
  .foot { padding: 0 16px 10px; font-size: 11.5px; color: var(--c-muted); text-align: center; }
  :focus-visible { outline: 2px solid var(--c-accent); outline-offset: 2px; }
  @media (max-width: 520px) {
    .panel { right: 0; bottom: 0; width: 100vw; height: 100dvh; border-radius: 0; }
    .launcher { right: 16px; bottom: 16px; height: 52px; padding: 0 18px 0 14px; }
  }
  @media (prefers-reduced-motion: reduce) { * { animation: none !important; transition: none !important; } }
  `;

  function el(tag, attrs, html) {
    var n = document.createElement(tag);
    for (var k in attrs || {}) n.setAttribute(k, attrs[k]);
    if (html != null) n.innerHTML = html;
    return n;
  }

  // Colores y letras: los de la web si están definidos, si no los de la marca.
  function token(names, fallback) {
    var cs = getComputedStyle(document.documentElement);
    for (var i = 0; i < names.length; i++) {
      var v = cs.getPropertyValue(names[i]).trim();
      if (v) return v;
    }
    return fallback;
  }

  var host = el('div', { id: 'noray-chat' });
  var root = host.attachShadow({ mode: 'open' });
  root.appendChild(el('style', {}, css));

  var launcher = el('button', { class: 'launcher', type: 'button', 'aria-label': 'Abrir el chat con la asistente' },
    '<span class="pulse" aria-hidden="true"></span><span class="label">Chatea con Ana</span>');
  var panel = el('section', { class: 'panel', role: 'dialog', 'aria-label': 'Chat con la clínica', hidden: '' });
  panel.innerHTML =
    '<header><span class="mark" aria-hidden="true">A</span><div class="who"><strong class="name">Ana</strong>' +
    '<span><i aria-hidden="true"></i> Contesta al momento, de día y de noche</span></div>' +
    '<button class="close" type="button" aria-label="Cerrar el chat"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="m6 6 12 12M18 6 6 18"/></svg></button></header>' +
    '<div class="agent" hidden></div>' +
    '<div class="body" aria-live="polite"></div>' +
    '<div class="suggest"></div>' +
    '<form><label style="position:absolute;left:-9999px" for="noray-input">Escribe tu mensaje</label>' +
    '<textarea id="noray-input" rows="1" placeholder="Escribe tu pregunta…"></textarea>' +
    '<button class="send" type="submit" aria-label="Enviar" disabled><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M4 12 20 4l-6 16-2.5-6.5z"/></svg></button></form>' +
    '<div class="foot">Asistente virtual. No promete resultados ni plazos: eso lo define el abogado en la primera asesoría.</div>';
  root.appendChild(launcher);
  root.appendChild(panel);

  var $ = function (s) { return panel.querySelector(s); };
  var body = $('.body'), input = $('textarea'), sendBtn = $('.send'), agentBar = $('.agent'), suggest = $('.suggest');

  var SUGGESTIONS = ['¿Cuánto cuesta una asesoría?', '¿Qué horario tienen?', '¿Cómo se paga?', 'Quiero pedir cita'];
  SUGGESTIONS.forEach(function (s) {
    var b = el('button', { type: 'button' });
    b.textContent = s;
    b.addEventListener('click', function () { send(s); });
    suggest.appendChild(b);
  });

  function applyTheme() {
    var t = {
      '--c-ink': token(['--ink', '--p-ink'], '#1d1b17'),
      '--c-paper': token(['--bg', '--p-bg'], '#f4efe4'),
      '--c-surface': token(['--surface', '--p-surface'], '#ebe4d4'),
      '--c-accent': token(['--accent', '--p-accent'], '#56704f'),
      '--c-muted': token(['--muted', '--p-muted'], '#66635d'),
      '--c-line': token(['--line', '--border', '--color-line'], '#ddd5c6'),
      '--c-sans': token(['--font-text', '--font-body', '--font-sans'], 'system-ui, -apple-system, sans-serif'),
      '--c-serif': token(['--font-display'], 'Newsreader, Georgia, serif'),
      '--c-live': '#7aaa80',
      '--c-clay': '#9a5236',
      '--c-clay-soft': '#f1e2d6',
    };
    t['--c-accent-soft'] = 'color-mix(in srgb, ' + t['--c-accent'] + ' 18%, transparent)';
    for (var k in t) host.style.setProperty(k, t[k]);
  }

  function render() {
    body.innerHTML = '';
    if (!state.messages.length) {
      var hello = el('div', { class: 'msg bot' });
      hello.textContent = 'Hola, soy ' + state.assistant + ', la asistente de ' + state.clinic +
        '. Te ayudo con precios, horarios y servicios, y si quieres te paso la petición de cita. ¿En qué te puedo servir?';
      body.appendChild(hello);
    }
    state.messages.forEach(function (m) {
      var cls = m.author === 'paciente' ? 'me' : m.author === 'recepcion' ? 'staff' : 'bot';
      var n = el('div', { class: 'msg ' + cls });
      if (m.author === 'recepcion') {
        var sm = el('small');
        sm.textContent = (m.authorName || 'Recepción') + ' · recepción';
        n.appendChild(sm);
      }
      n.appendChild(document.createTextNode(m.text));
      body.appendChild(n);
    });
    if (state.typing) body.appendChild(el('div', { class: 'typing', 'aria-label': 'Escribiendo' }, '<span></span><span></span><span></span>'));
    suggest.hidden = state.messages.some(function (m) { return m.author === 'paciente'; });
    agentBar.hidden = !state.agent;
    agentBar.textContent = state.agent ? 'Te atiende ' + state.agent + ', de recepción' : '';
    $('.name').textContent = state.assistant;
    body.scrollTop = body.scrollHeight;
  }

  function loadScript(src, cb) {
    var s = document.createElement('script');
    s.src = src;
    s.onload = cb;
    s.onerror = function () { console.warn('[chat] No se pudo cargar ' + src); };
    document.head.appendChild(s);
  }

  function connect() {
    if (socket || !window.io) return;
    socket = window.io({ path: '/socket.io' });
    socket.on('connect', function () { socket.emit('chat:join', { visitorId: visitorId }); });
    socket.on('chat:message', function (m) {
      state.messages.push(m);
      if (m.author !== 'paciente') state.typing = false;
      render();
      if (!state.open && m.author !== 'paciente') launcher.querySelector('.label').textContent = 'Tienes respuesta';
    });
    socket.on('chat:typing', function (d) { state.typing = !!d.typing; render(); });
    socket.on('chat:agent', function (d) { state.agent = d.name || null; render(); });
    socket.on('chat:error', function (d) { state.messages.push({ author: 'ia', text: d.error }); render(); });
  }

  function init() {
    fetch('/api/public/clinic').then(function (r) { return r.json(); }).then(function (d) {
      state.assistant = d.assistant || state.assistant;
      state.clinic = d.clinic || state.clinic;
      render();
    }).catch(function () {});
    fetch('/api/public/chat?visitor=' + encodeURIComponent(visitorId)).then(function (r) { return r.json(); }).then(function (d) {
      state.messages = d.messages || [];
      state.agent = d.agent || null;
      state.loaded = true;
      render();
    }).catch(function () { state.loaded = true; });
    if (window.io) connect(); else loadScript('/socket.io/socket.io.js', connect);
  }

  function open(prefill) {
    state.open = true;
    panel.hidden = false;
    launcher.hidden = true;
    launcher.querySelector('.label').textContent = 'Chatea con Ana';
    render();
    if (prefill && !input.value) { input.value = prefill; sendBtn.disabled = false; }
    setTimeout(function () { input.focus(); }, 50);
  }
  function close() {
    state.open = false;
    panel.hidden = true;
    launcher.hidden = false;
    launcher.focus();
  }

  function send(text) {
    text = (text || '').trim();
    if (!text) return;
    if (!socket || !socket.connected) {
      state.messages.push({ author: 'ia', text: 'No hay conexión ahora mismo. Inténtalo de nuevo en unos segundos.' });
      render();
      return;
    }
    state.messages.push({ author: 'paciente', text: text });
    socket.emit('chat:send', { text: text });
    input.value = '';
    sendBtn.disabled = true;
    autosize();
    render();
  }

  function autosize() {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 110) + 'px';
  }

  launcher.addEventListener('click', function () { open(); });
  $('.close').addEventListener('click', close);
  panel.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });
  $('form').addEventListener('submit', function (e) { e.preventDefault(); send(input.value); });
  input.addEventListener('input', function () { sendBtn.disabled = !input.value.trim(); autosize(); });
  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input.value); }
  });
  document.addEventListener('click', function (e) {
    var t = e.target.closest && e.target.closest('[data-open-chat]');
    if (!t) return;
    e.preventDefault();
    var label = (t.getAttribute('data-open-chat') || t.textContent || '').toLowerCase();
    open(/cita/.test(label) ? 'Quiero pedir cita' : '');
  });

  function mount() {
    document.body.appendChild(host);
    applyTheme();
    render();
    init();
    if (location.hash === '#chat') open();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();
