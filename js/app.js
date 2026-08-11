/**
 * app.js
 * ---------------------------------------------------------------------------
 * Punto di ingresso comune a tutte le pagine: costruisce la navbar in base
 * allo stato di sessione, gestisce il menu mobile e fornisce utility di UI
 * condivise (toast). La logica di autenticazione vera e propria vive in
 * auth.js (Fase 3); qui ci limitiamo a *leggere* la sessione.
 * ---------------------------------------------------------------------------
 */

window.JF = window.JF || {};

JF.App = (function () {
  "use strict";

  /** Da chiamare in fondo a ogni pagina, dopo che il DOM è pronto. */
  function initPage() {
    if (!JF.Storage.isStorageAvailable()) {
      renderStorageWarning();
      return; // evitiamo di proseguire: senza storage l'app non può funzionare correttamente
    }
    renderNavbar();
    bindMobileMenu();
    bindSaveButtons();
    setFooterYear();
  }

  /** Banner bloccante mostrato quando il browser non consente l'uso di LocalStorage (es. Safari su file://). */
  function renderStorageWarning() {
    const banner = document.createElement("div");
    banner.style.cssText =
      "position:fixed;inset:0;z-index:9999;background:#14213d;color:#fff;display:flex;align-items:center;justify-content:center;padding:24px;text-align:center;font-family:sans-serif;";
    banner.innerHTML = `
      <div style="max-width:480px;">
        <h2 style="margin-bottom:12px;">Impossibile avviare JobFinder</h2>
        <p style="color:#c7d0ee;line-height:1.5;">
          Il tuo browser sta bloccando l'accesso a LocalStorage, necessario per salvare i dati di questa demo
          (succede spesso aprendo il file direttamente in Safari, o con impostazioni privacy molto restrittive).
          Prova ad aprire <code>index.html</code> con Chrome o Firefox, oppure tramite un piccolo server locale.
        </p>
      </div>
    `;
    document.body.appendChild(banner);
  }

  /**
   * Costruisce dinamicamente lo stato della navbar (loggato/ospite).
   * Ogni pagina include un <div id="navbar-root"></div>: qui lo popoliamo,
   * così la navbar è identica ovunque e va aggiornata in un solo posto.
   */
  function renderNavbar() {
    const root = document.getElementById("navbar-root");
    if (!root) return;

    // In questa fase JF.Auth non esiste ancora: gestiamo il caso in modo
    // che il codice non si rompa finché non arriva la Fase 3.
    const session = JF.Storage.getSession();
    const basePath = root.dataset.basePath || ""; // "" in root, "../" nelle pagine sotto /pages

    const rightSide = session
      ? renderLoggedNav(session, basePath)
      : renderGuestNav(basePath);

    root.innerHTML = `
      <nav class="navbar">
        <div class="container navbar__inner">
          <a class="navbar__logo" href="${basePath}index.html">
            <img src="${basePath}assets/images/logo-icon.png" alt="" class="navbar__logo-icon" width="32" height="32" />
            Job<span>Finder</span>
          </a>
          <button class="navbar__toggle" id="navbarToggle" aria-label="Apri menu" aria-expanded="false">
            <span></span><span></span><span></span>
          </button>
          <div class="navbar__menu" id="navbarMenu">
            <a href="${basePath}pages/jobs.html">Offerte</a>
            <a href="${basePath}index.html#categorie">Categorie</a>
            <a href="${basePath}index.html#aziende">Per le aziende</a>
            ${rightSide}
          </div>
        </div>
      </nav>
    `;
  }

  function renderGuestNav(basePath) {
    return `
      <a class="btn btn--ghost" href="${basePath}pages/login.html">Accedi</a>
      <a class="btn btn--primary" href="${basePath}pages/register.html">Registrati</a>
    `;
  }

  function renderLoggedNav(session, basePath) {
    const user = JF.Storage.getUserById(session.id);
    const dashboardUrl = `${basePath}pages/${JF.Auth.getDashboardPage(user)}`;
    const label = user ? (session.tipo === "azienda" ? user.ragioneSociale : user.nome) : "";
    const notifCount = JF.Chat ? JF.Chat.getNotificationCount(session.id, session.tipo) : 0;
    const badge = notifCount > 0 ? `<span class="navbar-msg-badge">${notifCount}</span>` : "";

    return `
      <a href="${basePath}pages/chat.html">Messaggi${badge}</a>
      <a class="btn btn--ghost navbar__user-link" href="${dashboardUrl}">
        ${JF.Jobs.renderAvatar(user, "navbar__user-avatar")}
        Ciao, ${JF.Jobs.escapeHtml(label || "")}
      </a>
      <button class="btn btn--primary" id="logoutBtn" type="button">Esci</button>
    `;
  }

  function bindMobileMenu() {
    document.addEventListener("click", (e) => {
      if (e.target.closest("#navbarToggle")) {
        const menu = document.getElementById("navbarMenu");
        const toggle = document.getElementById("navbarToggle");
        const isOpen = menu.classList.toggle("navbar__menu--open");
        toggle.setAttribute("aria-expanded", String(isOpen));
      }
      if (e.target.closest("#logoutBtn") && JF.Auth) {
        JF.Auth.logout();
      }
    });
  }

  /**
   * Gestore globale del pulsante "salva nei preferiti" presente su ogni job-card,
   * su qualsiasi pagina. Delegato su document così funziona anche per card
   * renderizzate dinamicamente dopo il caricamento iniziale.
   */
  function bindSaveButtons() {
    document.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-save-job]");
      if (!btn) return;

      const user = JF.Auth ? JF.Auth.getCurrentUser() : null;
      if (!user || user.tipo !== "candidato") {
        showToast("Accedi come candidato per salvare le offerte", "error");
        return;
      }

      const jobId = btn.dataset.saveJob;
      JF.Jobs.toggleFavorite(user.id, jobId);
      const nowFavorited = btn.classList.toggle("is-saved");
      showToast(nowFavorited ? "Offerta salvata nei preferiti" : "Offerta rimossa dai preferiti");

      // Notifica altre parti della pagina (es. lista preferiti in dashboard) che è cambiato qualcosa
      document.dispatchEvent(new CustomEvent("jf:favorites-changed", { detail: { jobId, favorited: nowFavorited } }));
    });
  }

  function setFooterYear() {
    const el = document.getElementById("footerYear");
    if (el) el.textContent = new Date().getFullYear();
  }

  /** Mostra un toast temporaneo in basso a destra (usato per conferme azioni). */
  function showToast(message, type = "success") {
    let container = document.getElementById("toastContainer");
    if (!container) {
      container = document.createElement("div");
      container.id = "toastContainer";
      container.className = "toast-container";
      document.body.appendChild(container);
    }
    const toast = document.createElement("div");
    toast.className = `toast toast--${type}`;
    toast.textContent = message;
    container.appendChild(toast);

    requestAnimationFrame(() => toast.classList.add("toast--visible"));
    setTimeout(() => {
      toast.classList.remove("toast--visible");
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }

  return { initPage, renderNavbar, showToast };
})();
