/**
 * jobs.js
 * ---------------------------------------------------------------------------
 * Logica di dominio relativa alle offerte di lavoro: ricerca, filtri,
 * rendering delle card. Le operazioni di scrittura (crea/modifica/elimina)
 * vengono aggiunte nella dashboard azienda; qui teniamo per ora lettura,
 * ricerca e presentazione, usate da homepage e pagina elenco offerte.
 * ---------------------------------------------------------------------------
 */

window.JF = window.JF || {};

JF.Jobs = (function () {
  "use strict";

  /** Restituisce le offerte più recenti (ordinate per data pubblicazione desc). */
  function getLatestJobs(limit = 6) {
    return JF.Storage.getJobs()
      .filter((j) => j.stato === "attiva")
      .sort((a, b) => new Date(b.dataPubblicazione) - new Date(a.dataPubblicazione))
      .slice(0, limit);
  }

  /**
   * Filtra le offerte in base a criteri di ricerca.
   * @param {Object} criteria - { q, localita, categoria, tipoContratto }
   */
  function searchJobs(criteria = {}) {
    const { q = "", localita = "", categoria = "", tipoContratto = "" } = criteria;
    const query = q.trim().toLowerCase();
    const loc = localita.trim().toLowerCase();

    return JF.Storage.getJobs()
      .filter((job) => job.stato === "attiva")
      .filter((job) => {
        const matchQuery =
          !query ||
          job.titolo.toLowerCase().includes(query) ||
          job.descrizione.toLowerCase().includes(query) ||
          job.categoria.toLowerCase().includes(query);

        const matchLocalita = !loc || job.localita.toLowerCase().includes(loc);
        const matchCategoria = !categoria || job.categoria === categoria;
        const matchContratto = !tipoContratto || job.tipoContratto === tipoContratto;

        return matchQuery && matchLocalita && matchCategoria && matchContratto;
      })
      .sort((a, b) => new Date(b.dataPubblicazione) - new Date(a.dataPubblicazione));
  }

  /**
   * Come searchJobs, ma con supporto al filtro per raggio in km attorno a una
   * località (geocodifica + Haversine, entrambi asincroni via JF.Geo).
   * Se "radius" è vuoto/0, il filtro località resta il confronto testuale di
   * searchJobs (nessuna chiamata di rete). Le coordinate non vengono mai
   * esposte nel risultato: servono solo internamente per decidere se
   * un'offerta rientra o no nel raggio.
   * @param {Object} criteria - { q, localita, categoria, tipoContratto, radius }
   * @returns {Promise<Array>}
   */
  async function searchJobsWithRadius(criteria = {}) {
    const { q = "", localita = "", categoria = "", tipoContratto = "", radius = "" } = criteria;
    const query = q.trim().toLowerCase();
    const loc = localita.trim();
    const radiusKm = Number(radius) || 0;

    // Filtri sincroni indipendenti dalla località (testo libero, categoria, contratto)
    let results = JF.Storage.getJobs().filter((job) => {
      if (job.stato !== "attiva") return false;
      const matchQuery =
        !query ||
        job.titolo.toLowerCase().includes(query) ||
        job.descrizione.toLowerCase().includes(query) ||
        job.categoria.toLowerCase().includes(query);
      const matchCategoria = !categoria || job.categoria === categoria;
      const matchContratto = !tipoContratto || job.tipoContratto === tipoContratto;
      return matchQuery && matchCategoria && matchContratto;
    });

    if (loc && !radiusKm) {
      // "Solo questa città": stesso confronto testuale di sempre, nessuna chiamata di rete
      const locLower = loc.toLowerCase();
      results = results.filter((job) => job.localita.toLowerCase().includes(locLower));
    } else if (loc && radiusKm) {
      // Filtro per raggio: geocodifica città cercata + città di ogni offerta, poi Haversine
      const checks = await Promise.all(
        results.map(async (job) => ({
          job,
          within: await JF.Geo.isWithinRadius(loc, job.localita, radiusKm),
        }))
      );
      results = checks.filter((c) => c.within).map((c) => c.job);
    }

    return results.sort((a, b) => new Date(b.dataPubblicazione) - new Date(a.dataPubblicazione));
  }

  /** Elenco delle categorie disponibili, calcolato dai dati reali (non hardcoded). */
  function getCategories() {
    const jobs = JF.Storage.getJobs();
    return [...new Set(jobs.map((j) => j.categoria))].sort();
  }

  /** Elenco dei tipi di contratto disponibili, calcolato dai dati reali. */
  function getContractTypes() {
    const jobs = JF.Storage.getJobs();
    return [...new Set(jobs.map((j) => j.tipoContratto))].sort();
  }

  /** Formatta un range salariale in modo leggibile, con lordo/netto e periodo. */
  function formatSalary(job) {
    if (!job.stipendioMin && !job.stipendioMax) return "Stipendio non specificato";
    const fmt = (n) => n.toLocaleString("it-IT");
    const tipo = job.retribuzioneTipo || "Lordo";
    const periodoLabel = { Anno: "all'anno", Mese: "al mese", Giorno: "al giorno" }[job.retribuzionePeriodo] || "all'anno";
    return `${fmt(job.stipendioMin)} – ${fmt(job.stipendioMax)} € ${tipo.toLowerCase()} ${periodoLabel}`;
  }

  /** Formatta una data ISO in formato leggibile italiano relativo. */
  function formatDate(isoString) {
    const date = new Date(isoString);
    const now = new Date();
    const diffDays = Math.floor((now - date) / (1000 * 60 * 60 * 24));

    if (diffDays <= 0) return "Oggi";
    if (diffDays === 1) return "Ieri";
    if (diffDays < 7) return `${diffDays} giorni fa`;
    if (diffDays < 30) return `${Math.floor(diffDays / 7)} settimane fa`;
    return date.toLocaleDateString("it-IT", { day: "numeric", month: "short", year: "numeric" });
  }

  /** Restituisce le iniziali del nome azienda, usate come "logo" testuale nelle card. */
  function getCompanyInitials(ragioneSociale) {
    if (!ragioneSociale) return "?";
    return ragioneSociale
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0].toUpperCase())
      .join("");
  }

  /** Iniziali di un utente qualsiasi: candidato (nome+cognome) o azienda (ragione sociale). */
  function getUserInitials(user) {
    if (!user) return "?";
    if (user.tipo === "azienda") return getCompanyInitials(user.ragioneSociale);
    const initials = `${(user.nome || "")[0] || ""}${(user.cognome || "")[0] || ""}`.toUpperCase();
    return initials || "?";
  }

  /**
   * Markup di un avatar utente completo di tag: <img> se ha caricato una foto
   * profilo, altrimenti un div con le iniziali (comportamento di sempre).
   * La classe passata definisce dimensioni/forma/colori (riusa quelle già
   * esistenti per ogni contesto: job-card__logo, dashboard__avatar, ecc.).
   */
  function renderAvatar(user, className) {
    const photoUrl = user && user.fotoProfilo ? user.fotoProfilo.dataUrl : null;
    if (photoUrl) {
      return `<img src="${photoUrl}" alt="" class="${className} avatar-img" />`;
    }
    return `<div class="${className}" aria-hidden="true">${escapeHtml(getUserInitials(user))}</div>`;
  }

  /**
   * Come renderAvatar, ma restituisce solo il CONTENUTO interno (senza tag
   * contenitore): usato per riempire un elemento già esistente nel markup
   * statico della pagina (es. il div dell'avatar mini-profilo in dashboard).
   */
  function renderAvatarFill(user) {
    const photoUrl = user && user.fotoProfilo ? user.fotoProfilo.dataUrl : null;
    if (photoUrl) {
      return `<img src="${photoUrl}" alt="" class="avatar-img-fill" />`;
    }
    return escapeHtml(getUserInitials(user));
  }

  /**
   * Genera il markup HTML di una job-card.
   * Riutilizzata da homepage, pagina offerte e preferiti.
   * @param {Object} job
   * @param {Object} options
   * @param {string} options.basePath - "" se chiamata dalla root, "" se già dentro /pages
   * @param {boolean} options.favorited - se true, mostra il cuore come attivo
   * @param {boolean} options.showSave - se false, nasconde il pulsante preferiti (es. utente non loggato)
   */
  function renderJobCard(job, options = {}) {
    const { basePath = "", favorited = false, showSave = true, matchScore = null } = options;
    const company = JF.Storage.getUserById(job.aziendaId);
    const companyName = company ? company.ragioneSociale : "Azienda";
    const detailUrl = `${basePath}job-detail.html?id=${encodeURIComponent(job.id)}`;
    const matchBadge =
      matchScore !== null
        ? `<span class="tag ${JF.Matching.scoreTagClass(matchScore)}" title="Punteggio di compatibilità con il tuo profilo">Punteggio ${matchScore}</span>`
        : "";

    return `
      <article class="job-card" data-job-id="${job.id}">
        <div class="job-card__top">
          ${renderAvatar(company, "job-card__logo")}
          <div class="job-card__top-right">
            ${matchBadge}
            ${
              showSave
                ? `<button class="job-card__save ${favorited ? "is-saved" : ""}" type="button" aria-label="Salva offerta" data-save-job="${job.id}">
                    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="M6 4a1 1 0 0 0-1 1v15l7-4 7 4V5a1 1 0 0 0-1-1H6Z"/>
                    </svg>
                  </button>`
                : ""
            }
          </div>
        </div>
        <h3 class="job-card__title">
          <a href="${detailUrl}">${escapeHtml(job.titolo)}</a>
        </h3>
        <p class="job-card__company">${escapeHtml(companyName)}</p>
        <div class="job-card__meta">
          <span class="tag">${escapeHtml(job.localita)}</span>
          <span class="tag">${escapeHtml(job.tipoContratto)}</span>
          <span class="tag tag--muted">${escapeHtml(job.modalita)}</span>
        </div>
        <p class="job-card__salary">${formatSalary(job)}</p>
        <div class="job-card__footer">
          <span class="job-card__date">${formatDate(job.dataPubblicazione)}</span>
          <span class="job-card__category">${escapeHtml(job.categoria)}</span>
        </div>
      </article>
    `;
  }

  // ---------------------------------------------------------------------
  // Offerte per azienda (dashboard azienda)
  // ---------------------------------------------------------------------

  function getJobsByCompany(companyId) {
    return JF.Storage.getJobs()
      .filter((j) => j.aziendaId === companyId)
      .sort((a, b) => new Date(b.dataPubblicazione) - new Date(a.dataPubblicazione));
  }

  // ---------------------------------------------------------------------
  // Preferiti (salvati dal candidato sul proprio profilo utente)
  // ---------------------------------------------------------------------

  function isFavorite(user, jobId) {
    return !!user && Array.isArray(user.preferiti) && user.preferiti.includes(jobId);
  }

  /** Aggiunge/rimuove un'offerta dai preferiti dell'utente. Ritorna l'utente aggiornato. */
  function toggleFavorite(userId, jobId) {
    const user = JF.Storage.getUserById(userId);
    if (!user) return null;
    const preferiti = Array.isArray(user.preferiti) ? [...user.preferiti] : [];
    const index = preferiti.indexOf(jobId);
    if (index === -1) {
      preferiti.push(jobId);
    } else {
      preferiti.splice(index, 1);
    }
    return JF.Storage.updateUser(userId, { preferiti });
  }

  function getFavoriteJobs(user) {
    if (!user || !Array.isArray(user.preferiti)) return [];
    return user.preferiti
      .map((jobId) => JF.Storage.getJobById(jobId))
      .filter(Boolean);
  }

  // ---------------------------------------------------------------------
  // Candidature: creazione e lettura arricchita (con dati offerta/candidato)
  // ---------------------------------------------------------------------

  function hasApplied(jobId, candidatoId) {
    return JF.Storage.getApplications().some(
      (a) => a.jobId === jobId && a.candidatoId === candidatoId
    );
  }

  /**
   * Crea una candidatura simulata, con lettera motivazionale e CV allegati.
   * @param {string} jobId
   * @param {string} candidatoId
   * @param {Object} extra - { messaggio, cvFile: {name, dataUrl} | null }
   * Restituisce { ok, error?, application? }.
   */
  function applyToJob(jobId, candidatoId, extra = {}) {
    if (hasApplied(jobId, candidatoId)) {
      return { ok: false, error: "Hai già inviato una candidatura per questa offerta." };
    }
    const job = JF.Storage.getJobById(jobId);
    if (!job) return { ok: false, error: "Offerta non trovata." };

    const candidate = JF.Storage.getUserById(candidatoId);
    const match = JF.Matching ? JF.Matching.computeMatch(candidate, job) : null;

    const application = {
      id: JF.Storage.generateId("app"),
      jobId,
      candidatoId,
      aziendaId: job.aziendaId,
      dataInvio: new Date().toISOString(),
      stato: "inviata", // inviata -> visualizzata -> colloquio -> selezionato / rifiutato
      messaggio: extra.messaggio || "",
      cvFile: extra.cvFile || null, // snapshot del CV al momento dell'invio, { name, dataUrl }
      matchScore: match ? match.score : null, // fotografia della compatibilità al momento della candidatura
    };
    JF.Storage.addApplication(application);
    return { ok: true, application };
  }

  /** Candidature inviate da un candidato, arricchite con i dati dell'offerta. */
  function getApplicationsForCandidate(candidatoId) {
    return JF.Storage.getApplications()
      .filter((a) => a.candidatoId === candidatoId)
      .map((a) => ({ ...a, job: JF.Storage.getJobById(a.jobId) }))
      .sort((a, b) => new Date(b.dataInvio) - new Date(a.dataInvio));
  }

  /** Candidature ricevute da un'azienda, arricchite con offerta e candidato. */
  function getApplicationsForCompany(aziendaId) {
    return JF.Storage.getApplications()
      .filter((a) => a.aziendaId === aziendaId)
      .map((a) => ({
        ...a,
        job: JF.Storage.getJobById(a.jobId),
        candidato: JF.Storage.getUserById(a.candidatoId),
      }))
      .sort((a, b) => new Date(b.dataInvio) - new Date(a.dataInvio));
  }

  const STATUS_LABELS = {
    inviata: "Inviata",
    visualizzata: "Visualizzata",
    colloquio: "Colloquio",
    selezionato: "Selezionato",
    rifiutato: "Rifiutato",
  };

  const STATUS_TAG_CLASS = {
    inviata: "tag--muted",
    visualizzata: "tag--warning",
    colloquio: "tag--warning",
    selezionato: "tag--success",
    rifiutato: "tag--danger",
  };

  /** Ordine "ufficiale" della timeline, usato per disegnare i passaggi in sequenza. */
  const STATUS_TIMELINE = ["inviata", "visualizzata", "colloquio", "selezionato"];

  /**
   * Genera il markup di una mini-timeline orizzontale per lo stato di una candidatura.
   * Se lo stato è "rifiutato", la timeline si interrompe visivamente al passo raggiunto.
   */
  function renderApplicationTimeline(stato) {
    const isRejected = stato === "rifiutato";
    const currentIndex = isRejected ? -1 : STATUS_TIMELINE.indexOf(stato);

    const steps = STATUS_TIMELINE.map((step, i) => {
      const label = STATUS_LABELS[step];
      let stateClass = "timeline-step--pending";
      if (isRejected && i === 0) stateClass = "timeline-step--rejected-from";
      else if (!isRejected && i < currentIndex) stateClass = "timeline-step--done";
      else if (!isRejected && i === currentIndex) stateClass = "timeline-step--current";
      return `<div class="timeline-step ${stateClass}"><span class="timeline-step__dot"></span><span class="timeline-step__label">${label}</span></div>`;
    });

    return `
      <div class="application-timeline ${isRejected ? "application-timeline--rejected" : ""}">
        ${steps.join('<span class="timeline-connector"></span>')}
        ${isRejected ? `<div class="timeline-rejected-note">Candidatura non selezionata</div>` : ""}
      </div>
    `;
  }

  /** Previene injection HTML quando si stampano dati utente nel DOM. */
  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str ?? "";
    return div.innerHTML;
  }

  return {
    getLatestJobs,
    searchJobs,
    searchJobsWithRadius,
    getCategories,
    getContractTypes,
    formatSalary,
    formatDate,
    getCompanyInitials,
    getUserInitials,
    renderAvatar,
    renderAvatarFill,
    renderJobCard,
    escapeHtml,
    getJobsByCompany,
    isFavorite,
    toggleFavorite,
    getFavoriteJobs,
    hasApplied,
    applyToJob,
    getApplicationsForCandidate,
    getApplicationsForCompany,
    STATUS_LABELS,
    STATUS_TAG_CLASS,
    STATUS_TIMELINE,
    renderApplicationTimeline,
  };
})();
