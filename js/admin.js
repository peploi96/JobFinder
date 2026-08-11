/**
 * admin.js
 * ---------------------------------------------------------------------------
 * Logica della dashboard amministratore (pages/dashboard-admin.html):
 * panoramica della piattaforma ed eliminazione di offerte, aziende e
 * candidati. Le operazioni di cancellazione vera e propria (comprese le
 * cascate su candidature/conversazioni collegate) vivono in storage.js
 * (JF.Storage.adminDeleteJob / adminDeleteCompany / adminDeleteCandidate):
 * qui ci limitiamo a orchestrare l'interfaccia e chiedere conferma.
 * ---------------------------------------------------------------------------
 */

let currentAdmin = null;

document.addEventListener("DOMContentLoaded", () => {
  JF.App.initPage();
  currentAdmin = JF.Auth.requireAuth("admin");
  if (!currentAdmin) return; // requireAuth ha già reindirizzato al login

  renderMiniProfile();
  bindSidebarNav();
  renderOverview();
  renderJobsPanel();
  renderCompaniesPanel();
  renderCandidatesPanel();
});

function renderMiniProfile() {
  document.getElementById("miniAvatar").innerHTML = JF.Jobs.renderAvatarFill(currentAdmin);
  document.getElementById("miniName").textContent = currentAdmin.nome || "Amministratore";
  document.getElementById("miniEmail").textContent = currentAdmin.email;
}

function bindSidebarNav() {
  const buttons = document.querySelectorAll(".sidebar-nav button");
  buttons.forEach((btn) => {
    btn.addEventListener("click", () => {
      buttons.forEach((b) => b.classList.remove("is-active"));
      btn.classList.add("is-active");
      document.querySelectorAll(".dashboard-panel").forEach((panel) => panel.classList.remove("is-active"));
      document.getElementById(`panel-${btn.dataset.panel}`).classList.add("is-active");
    });
  });
}

// ---------------------------------------------------------------------
// Panoramica
// ---------------------------------------------------------------------

function renderOverview() {
  const jobs = JF.Storage.getJobs();
  const users = JF.Storage.getUsers();
  const companies = users.filter((u) => u.tipo === "azienda");
  const candidates = users.filter((u) => u.tipo === "candidato");
  const applications = JF.Storage.getApplications();
  const conversations = JF.Storage.getConversations();

  const stats = [
    { label: "Offerte pubblicate", value: jobs.length },
    { label: "Offerte attive", value: jobs.filter((j) => j.stato === "attiva").length },
    { label: "Aziende registrate", value: companies.length },
    { label: "Candidati registrati", value: candidates.length },
    { label: "Candidature inviate", value: applications.length },
    { label: "Conversazioni avviate", value: conversations.length },
  ];

  document.getElementById("adminStatsGrid").innerHTML = stats
    .map(
      (s) => `
        <div class="admin-stat-card">
          <div class="admin-stat-card__value">${s.value}</div>
          <div class="admin-stat-card__label">${s.label}</div>
        </div>
      `
    )
    .join("");
}

// ---------------------------------------------------------------------
// Offerte: elenco completo con eliminazione singola
// ---------------------------------------------------------------------

function renderJobsPanel() {
  const jobs = JF.Storage.getJobs().sort((a, b) => new Date(b.dataPubblicazione) - new Date(a.dataPubblicazione));
  document.getElementById("jobsCountLabel").textContent = `${jobs.length} offerte totali`;
  const list = document.getElementById("adminJobsList");

  if (jobs.length === 0) {
    list.innerHTML = `<div class="empty-state"><h3>Nessuna offerta presente</h3></div>`;
    return;
  }

  list.innerHTML = jobs
    .map((job) => {
      const company = JF.Storage.getUserById(job.aziendaId);
      const companyName = company ? company.ragioneSociale : "Azienda eliminata";
      const applicationsCount = JF.Storage.getApplications().filter((a) => a.jobId === job.id).length;
      return `
        <article class="manage-job-card">
          <div>
            <div class="manage-job-card__title">${JF.Jobs.escapeHtml(job.titolo)}</div>
            <div class="manage-job-card__meta" style="margin-top: 6px;">
              <span class="tag tag--muted">${JF.Jobs.escapeHtml(companyName)}</span>
              <span class="tag">${JF.Jobs.escapeHtml(job.localita)}</span>
              <span class="tag ${job.stato === "attiva" ? "tag--success" : "tag--muted"}">${job.stato === "attiva" ? "Attiva" : "Chiusa"}</span>
              <span class="tag tag--muted">${applicationsCount} candidature</span>
            </div>
          </div>
          <div class="manage-job-card__actions">
            <a class="btn btn--ghost btn--sm" href="job-detail.html?id=${encodeURIComponent(job.id)}">Vedi</a>
            <button class="btn btn--danger btn--sm" type="button" data-delete-job="${job.id}">Elimina</button>
          </div>
        </article>
      `;
    })
    .join("");

  list.querySelectorAll("[data-delete-job]").forEach((btn) => {
    btn.addEventListener("click", () => handleDeleteJob(btn.dataset.deleteJob));
  });
}

function handleDeleteJob(jobId) {
  const job = JF.Storage.getJobById(jobId);
  const applicationsCount = JF.Storage.getApplications().filter((a) => a.jobId === jobId).length;
  const confirmed = window.confirm(
    `Eliminare definitivamente l'offerta "${job ? job.titolo : ""}"?\n\n` +
      `Verranno eliminate anche le ${applicationsCount} candidature ricevute per questa offerta. L'operazione non è reversibile.`
  );
  if (!confirmed) return;

  JF.Storage.adminDeleteJob(jobId);
  renderJobsPanel();
  renderOverview();
  JF.App.showToast("Offerta eliminata");
}

// ---------------------------------------------------------------------
// Aziende: elenco completo con eliminazione a cascata
// ---------------------------------------------------------------------

function renderCompaniesPanel() {
  const companies = JF.Storage.getUsers().filter((u) => u.tipo === "azienda");
  document.getElementById("companiesCountLabel").textContent = `${companies.length} aziende registrate`;
  const list = document.getElementById("adminCompaniesList");

  if (companies.length === 0) {
    list.innerHTML = `<div class="empty-state"><h3>Nessuna azienda registrata</h3></div>`;
    return;
  }

  list.innerHTML = companies
    .map((company) => {
      const jobsCount = JF.Storage.getJobs().filter((j) => j.aziendaId === company.id).length;
      return `
        <article class="manage-job-card">
          <div style="display:flex; align-items:center; gap:12px;">
            ${JF.Jobs.renderAvatar(company, "job-card__logo")}
            <div>
              <div class="manage-job-card__title">${JF.Jobs.escapeHtml(company.ragioneSociale || "—")}</div>
              <div class="manage-job-card__meta" style="margin-top: 6px;">
                <span class="tag tag--muted">${JF.Jobs.escapeHtml(company.email)}</span>
                <span class="tag">${jobsCount} offerte</span>
              </div>
            </div>
          </div>
          <div class="manage-job-card__actions">
            <a class="btn btn--ghost btn--sm" href="company-profile.html?id=${encodeURIComponent(company.id)}">Vedi profilo</a>
            <button class="btn btn--danger btn--sm" type="button" data-delete-company="${company.id}">Elimina azienda</button>
          </div>
        </article>
      `;
    })
    .join("");

  list.querySelectorAll("[data-delete-company]").forEach((btn) => {
    btn.addEventListener("click", () => handleDeleteCompany(btn.dataset.deleteCompany));
  });
}

function handleDeleteCompany(companyId) {
  const company = JF.Storage.getUserById(companyId);
  const jobsCount = JF.Storage.getJobs().filter((j) => j.aziendaId === companyId).length;
  const confirmed = window.confirm(
    `Eliminare definitivamente l'azienda "${company ? company.ragioneSociale : ""}"?\n\n` +
      `Verranno eliminate anche le sue ${jobsCount} offerte, tutte le candidature ricevute e le conversazioni collegate. ` +
      `L'operazione non è reversibile.`
  );
  if (!confirmed) return;

  JF.Storage.adminDeleteCompany(companyId);
  renderCompaniesPanel();
  renderJobsPanel();
  renderOverview();
  JF.App.showToast("Azienda eliminata");
}

// ---------------------------------------------------------------------
// Candidati: elenco completo con eliminazione a cascata
// ---------------------------------------------------------------------

function renderCandidatesPanel() {
  const candidates = JF.Storage.getUsers().filter((u) => u.tipo === "candidato");
  document.getElementById("candidatesCountLabel").textContent = `${candidates.length} candidati registrati`;
  const list = document.getElementById("adminCandidatesList");

  if (candidates.length === 0) {
    list.innerHTML = `<div class="empty-state"><h3>Nessun candidato registrato</h3></div>`;
    return;
  }

  list.innerHTML = candidates
    .map((candidate) => {
      const appsCount = JF.Storage.getApplications().filter((a) => a.candidatoId === candidate.id).length;
      const fullName = `${candidate.nome || ""} ${candidate.cognome || ""}`.trim() || "—";
      return `
        <article class="manage-job-card">
          <div style="display:flex; align-items:center; gap:12px;">
            ${JF.Jobs.renderAvatar(candidate, "job-card__logo")}
            <div>
              <div class="manage-job-card__title">${JF.Jobs.escapeHtml(fullName)}</div>
              <div class="manage-job-card__meta" style="margin-top: 6px;">
                <span class="tag tag--muted">${JF.Jobs.escapeHtml(candidate.email)}</span>
                <span class="tag">${appsCount} candidature</span>
              </div>
            </div>
          </div>
          <div class="manage-job-card__actions">
            <a class="btn btn--ghost btn--sm" href="candidate-profile.html?id=${encodeURIComponent(candidate.id)}">Vedi profilo</a>
            <button class="btn btn--danger btn--sm" type="button" data-delete-candidate="${candidate.id}">Elimina candidato</button>
          </div>
        </article>
      `;
    })
    .join("");

  list.querySelectorAll("[data-delete-candidate]").forEach((btn) => {
    btn.addEventListener("click", () => handleDeleteCandidate(btn.dataset.deleteCandidate));
  });
}

function handleDeleteCandidate(candidateId) {
  const candidate = JF.Storage.getUserById(candidateId);
  const fullName = candidate ? `${candidate.nome} ${candidate.cognome}`.trim() : "";
  const appsCount = JF.Storage.getApplications().filter((a) => a.candidatoId === candidateId).length;
  const confirmed = window.confirm(
    `Eliminare definitivamente il profilo di "${fullName}"?\n\n` +
      `Verranno eliminate anche le sue ${appsCount} candidature e le conversazioni collegate. L'operazione non è reversibile.`
  );
  if (!confirmed) return;

  JF.Storage.adminDeleteCandidate(candidateId);
  renderCandidatesPanel();
  renderOverview();
  JF.App.showToast("Candidato eliminato");
}
