/**
 * storage.js
 * ---------------------------------------------------------------------------
 * Layer di persistenza dati per JobFinder.
 *
 * IMPORTANTE (nota architetturale):
 * Tutto il progetto accede ai dati SOLO attraverso le funzioni esposte qui
 * (JF.Storage.*). Nessun altro file deve chiamare localStorage direttamente.
 * Questo permette, in futuro, di sostituire l'implementazione interna con
 * chiamate fetch() verso un backend reale senza modificare auth.js, jobs.js
 * o app.js: cambia solo questo file.
 * ---------------------------------------------------------------------------
 */

// Namespace globale dell'applicazione per evitare inquinamento dello scope globale
window.JF = window.JF || {};

JF.Storage = (function () {
  "use strict";

  // Chiavi usate in LocalStorage
  const KEYS = {
    USERS: "jobfinder_users",
    JOBS: "jobfinder_jobs",
    APPLICATIONS: "jobfinder_applications",
    CONVERSATIONS: "jobfinder_conversations",
    MESSAGES: "jobfinder_messages",
    SESSION: "jobfinder_session",
    SEED_FLAG: "jobfinder_seeded_v1",
  };

  // ---------------------------------------------------------------------
  // Helper generici di basso livello
  // ---------------------------------------------------------------------

  /** Verifica se LocalStorage è realmente utilizzabile in questo browser/contesto. */
  function isStorageAvailable() {
    try {
      const testKey = "__jobfinder_test__";
      localStorage.setItem(testKey, "1");
      localStorage.removeItem(testKey);
      return true;
    } catch (err) {
      return false;
    }
  }

  function readJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (err) {
      console.error(`[Storage] Errore lettura chiave "${key}":`, err);
      return fallback;
    }
  }

  function writeJSON(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (err) {
      console.error(`[Storage] Errore scrittura chiave "${key}":`, err);
      return false;
    }
  }

  /** Genera un ID univoco semplice (sufficiente per uso locale/demo). */
  function generateId(prefix) {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }

  // ---------------------------------------------------------------------
  // Utenti (candidati e aziende condividono la stessa collezione,
  // distinti dal campo "tipo")
  // ---------------------------------------------------------------------

  function getUsers() {
    return readJSON(KEYS.USERS, []);
  }

  function saveUsers(users) {
    return writeJSON(KEYS.USERS, users);
  }

  function getUserById(id) {
    return getUsers().find((u) => u.id === id) || null;
  }

  function getUserByEmail(email) {
    const normalized = (email || "").trim().toLowerCase();
    return getUsers().find((u) => u.email.toLowerCase() === normalized) || null;
  }

  function addUser(user) {
    const users = getUsers();
    users.push(user);
    saveUsers(users);
    return user;
  }

  function updateUser(id, updatedFields) {
    const users = getUsers();
    const index = users.findIndex((u) => u.id === id);
    if (index === -1) return null;
    users[index] = { ...users[index], ...updatedFields };
    saveUsers(users);
    return users[index];
  }

  // ---------------------------------------------------------------------
  // Offerte di lavoro
  // ---------------------------------------------------------------------

  function getJobs() {
    return readJSON(KEYS.JOBS, []);
  }

  function saveJobs(jobs) {
    return writeJSON(KEYS.JOBS, jobs);
  }

  function getJobById(id) {
    return getJobs().find((j) => j.id === id) || null;
  }

  function addJob(job) {
    const jobs = getJobs();
    jobs.push(job);
    saveJobs(jobs);
    return job;
  }

  function updateJob(id, updatedFields) {
    const jobs = getJobs();
    const index = jobs.findIndex((j) => j.id === id);
    if (index === -1) return null;
    jobs[index] = { ...jobs[index], ...updatedFields };
    saveJobs(jobs);
    return jobs[index];
  }

  function deleteJob(id) {
    const jobs = getJobs().filter((j) => j.id !== id);
    saveJobs(jobs);
    return true;
  }

  // ---------------------------------------------------------------------
  // Candidature
  // ---------------------------------------------------------------------

  function getApplications() {
    return readJSON(KEYS.APPLICATIONS, []);
  }

  function saveApplications(applications) {
    return writeJSON(KEYS.APPLICATIONS, applications);
  }

  function addApplication(application) {
    const applications = getApplications();
    applications.push(application);
    saveApplications(applications);
    return application;
  }

  function updateApplication(id, updatedFields) {
    const applications = getApplications();
    const index = applications.findIndex((a) => a.id === id);
    if (index === -1) return null;
    applications[index] = { ...applications[index], ...updatedFields };
    saveApplications(applications);
    return applications[index];
  }

  function deleteApplication(id) {
    const applications = getApplications().filter((a) => a.id !== id);
    saveApplications(applications);
    return true;
  }

  // ---------------------------------------------------------------------
  // Conversazioni e messaggi (chat candidato-azienda)
  // ---------------------------------------------------------------------

  function getConversations() {
    return readJSON(KEYS.CONVERSATIONS, []);
  }

  function saveConversations(conversations) {
    return writeJSON(KEYS.CONVERSATIONS, conversations);
  }

  function addConversation(conversation) {
    const conversations = getConversations();
    conversations.push(conversation);
    saveConversations(conversations);
    return conversation;
  }

  function updateConversation(id, updatedFields) {
    const conversations = getConversations();
    const index = conversations.findIndex((c) => c.id === id);
    if (index === -1) return null;
    conversations[index] = { ...conversations[index], ...updatedFields };
    saveConversations(conversations);
    return conversations[index];
  }

  function getMessages() {
    return readJSON(KEYS.MESSAGES, []);
  }

  function saveMessages(messages) {
    return writeJSON(KEYS.MESSAGES, messages);
  }

  function addMessage(message) {
    const messages = getMessages();
    messages.push(message);
    saveMessages(messages);
    return message;
  }

  // ---------------------------------------------------------------------
  // Amministrazione (ruolo "admin"): eliminazioni con cascata.
  // Isolate qui invece che nel modulo admin.js perché toccano più collezioni
  // insieme (utenti, offerte, candidature, conversazioni/messaggi): la logica
  // di coerenza dei dati resta comunque compito esclusivo dello storage layer.
  // ---------------------------------------------------------------------

  /**
   * Elimina una singola offerta e tutto ciò che dipende SOLO da essa:
   * le candidature ricevute. Le conversazioni tra le due persone non vengono
   * cancellate (sono una relazione candidato-azienda, non solo un dettaglio
   * dell'offerta): perdono semplicemente il riferimento a un'offerta che non
   * esiste più.
   */
  function adminDeleteJob(jobId) {
    saveJobs(getJobs().filter((j) => j.id !== jobId));
    saveApplications(getApplications().filter((a) => a.jobId !== jobId));
    saveConversations(
      getConversations().map((c) => (c.jobId === jobId ? { ...c, jobId: null } : c))
    );
    return true;
  }

  /**
   * Elimina un'azienda e, in cascata: tutte le sue offerte (con le rispettive
   * candidature), eventuali candidature rimaste agganciate direttamente
   * all'azienda, e le conversazioni (con i relativi messaggi) che la
   * coinvolgono.
   */
  function adminDeleteCompany(companyId) {
    getJobs()
      .filter((j) => j.aziendaId === companyId)
      .forEach((job) => adminDeleteJob(job.id));

    saveApplications(getApplications().filter((a) => a.aziendaId !== companyId));

    const conversationIdsToRemove = getConversations()
      .filter((c) => c.aziendaId === companyId)
      .map((c) => c.id);
    saveConversations(getConversations().filter((c) => c.aziendaId !== companyId));
    saveMessages(getMessages().filter((m) => !conversationIdsToRemove.includes(m.conversationId)));

    saveUsers(getUsers().filter((u) => u.id !== companyId));
    return true;
  }

  /**
   * Elimina un candidato e, in cascata: le sue candidature e le conversazioni
   * (con i relativi messaggi) che lo coinvolgono. I preferiti vivono dentro
   * l'oggetto utente stesso, quindi spariscono automaticamente con lui.
   */
  function adminDeleteCandidate(candidateId) {
    saveApplications(getApplications().filter((a) => a.candidatoId !== candidateId));

    const conversationIdsToRemove = getConversations()
      .filter((c) => c.candidatoId === candidateId)
      .map((c) => c.id);
    saveConversations(getConversations().filter((c) => c.candidatoId !== candidateId));
    saveMessages(getMessages().filter((m) => !conversationIdsToRemove.includes(m.conversationId)));

    saveUsers(getUsers().filter((u) => u.id !== candidateId));
    return true;
  }

  // ---------------------------------------------------------------------
  // Sessione (utente attualmente loggato)
  // ---------------------------------------------------------------------

  function getSession() {
    return readJSON(KEYS.SESSION, null);
  }

  function setSession(sessionData) {
    return writeJSON(KEYS.SESSION, sessionData);
  }

  function clearSession() {
    localStorage.removeItem(KEYS.SESSION);
  }

  // ---------------------------------------------------------------------
  // Seed iniziale: popola dati demo alla primissima apertura del sito,
  // così la homepage non è mai vuota.
  // ---------------------------------------------------------------------

  function seedIfNeeded() {
    if (readJSON(KEYS.SEED_FLAG, false)) return; // già fatto in passato

    const demoCompanies = [
      {
        id: "user_c1",
        tipo: "azienda",
        email: "hr@nordweb.it",
        password: "demo1234",
        ragioneSociale: "NordWeb Studio",
        settore: "Tecnologia",
        sitoWeb: "https://nordweb.it",
        bio: "Digital studio specializzato in prodotti web per PMI e startup.",
        createdAt: "2024-01-10T09:00:00.000Z",
      },
      {
        id: "user_c2",
        tipo: "azienda",
        email: "jobs@retailplus.it",
        password: "demo1234",
        ragioneSociale: "RetailPlus S.p.A.",
        settore: "Retail",
        sitoWeb: "https://retailplus.it",
        bio: "Catena retail con oltre 40 punti vendita in Italia.",
        createdAt: "2024-02-05T09:00:00.000Z",
      },
      {
        id: "user_c3",
        tipo: "azienda",
        email: "careers@dataforge.io",
        password: "demo1234",
        ragioneSociale: "DataForge",
        settore: "Data & AI",
        sitoWeb: "https://dataforge.io",
        bio: "Consulenza data engineering e machine learning per aziende enterprise.",
        createdAt: "2024-03-01T09:00:00.000Z",
      },
      {
        id: "user_c4",
        tipo: "azienda",
        email: "people@greenbuild.it",
        password: "demo1234",
        ragioneSociale: "GreenBuild",
        settore: "Edilizia sostenibile",
        sitoWeb: "https://greenbuild.it",
        bio: "Progettazione e costruzione di edifici a basso impatto ambientale.",
        createdAt: "2024-03-20T09:00:00.000Z",
      },
    ];

    const demoJobs = [
      {
        id: "job_1",
        aziendaId: "user_c1",
        titolo: "Frontend Developer",
        categoria: "Sviluppo",
        localita: "Milano",
        modalita: "Ibrido",
        tipoContratto: "Full-time",
        stipendioMin: 30000,
        stipendioMax: 40000,
        retribuzioneTipo: "Lordo",
        retribuzionePeriodo: "Anno",
        descrizione:
          "Cerchiamo un/una Frontend Developer da inserire nel team prodotto per sviluppare interfacce moderne e performanti per i nostri clienti enterprise.",
        requisiti: [
          "2+ anni di esperienza con HTML, CSS, JavaScript",
          "Conoscenza di un framework moderno (React o Vue)",
          "Attenzione ai dettagli UI/UX",
        ],
        dataPubblicazione: "2026-07-20T10:00:00.000Z",
        stato: "attiva",
      },
      {
        id: "job_2",
        aziendaId: "user_c1",
        titolo: "UI/UX Designer",
        categoria: "Design",
        localita: "Remoto",
        modalita: "Remoto",
        tipoContratto: "Full-time",
        stipendioMin: 28000,
        stipendioMax: 36000,
        retribuzioneTipo: "Lordo",
        retribuzionePeriodo: "Anno",
        descrizione:
          "Progetterai esperienze utente per applicazioni web B2B, dalla ricerca utente al design system, in collaborazione con il team di sviluppo.",
        requisiti: [
          "Portfolio con progetti UI/UX reali",
          "Ottima padronanza di Figma",
          "Esperienza con design system",
        ],
        dataPubblicazione: "2026-07-22T10:00:00.000Z",
        stato: "attiva",
      },
      {
        id: "job_3",
        aziendaId: "user_c2",
        titolo: "Addetto/a Vendite",
        categoria: "Vendite",
        localita: "Torino",
        modalita: "In sede",
        tipoContratto: "Part-time",
        stipendioMin: 16000,
        stipendioMax: 20000,
        retribuzioneTipo: "Lordo",
        retribuzionePeriodo: "Anno",
        descrizione:
          "Per il nostro punto vendita di Torino cerchiamo una persona dinamica e orientata al cliente per il reparto elettronica.",
        requisiti: [
          "Esperienza pregressa nella vendita al dettaglio",
          "Ottime doti relazionali",
          "Disponibilità nei weekend",
        ],
        dataPubblicazione: "2026-07-15T10:00:00.000Z",
        stato: "attiva",
      },
      {
        id: "job_4",
        aziendaId: "user_c2",
        titolo: "Store Manager",
        categoria: "Retail",
        localita: "Bologna",
        modalita: "In sede",
        tipoContratto: "Full-time",
        stipendioMin: 32000,
        stipendioMax: 38000,
        retribuzioneTipo: "Lordo",
        retribuzionePeriodo: "Anno",
        descrizione:
          "Gestirai il punto vendita di Bologna coordinando un team di 8 persone, con responsabilità su vendite, magazzino e customer care.",
        requisiti: [
          "Esperienza pregressa come responsabile punto vendita",
          "Capacità di leadership e gestione team",
          "Orientamento al risultato",
        ],
        dataPubblicazione: "2026-07-25T10:00:00.000Z",
        stato: "attiva",
      },
      {
        id: "job_5",
        aziendaId: "user_c3",
        titolo: "Data Engineer",
        categoria: "Data & AI",
        localita: "Roma",
        modalita: "Ibrido",
        tipoContratto: "Full-time",
        stipendioMin: 38000,
        stipendioMax: 50000,
        retribuzioneTipo: "Lordo",
        retribuzionePeriodo: "Anno",
        descrizione:
          "Costruirai pipeline dati scalabili per progetti di machine learning enterprise, lavorando a stretto contatto con il team data science.",
        requisiti: [
          "Esperienza con Python e SQL",
          "Conoscenza di strumenti ETL / orchestrazione dati",
          "Familiarità con architetture cloud (AWS/GCP/Azure)",
        ],
        dataPubblicazione: "2026-07-28T10:00:00.000Z",
        stato: "attiva",
      },
      {
        id: "job_6",
        aziendaId: "user_c3",
        titolo: "Junior Data Analyst",
        categoria: "Data & AI",
        localita: "Remoto",
        modalita: "Remoto",
        tipoContratto: "Stage",
        stipendioMin: 800,
        stipendioMax: 1000,
        retribuzioneTipo: "Lordo",
        retribuzionePeriodo: "Mese",
        descrizione:
          "Stage retribuito per analisti dati alle prime armi: analizzerai dataset reali e costruirai dashboard di reporting per i clienti.",
        requisiti: [
          "Conoscenze base di SQL ed Excel",
          "Curiosità analitica",
          "Neolaureato/a in materie STEM o economiche",
        ],
        dataPubblicazione: "2026-08-01T10:00:00.000Z",
        stato: "attiva",
      },
      {
        id: "job_7",
        aziendaId: "user_c4",
        titolo: "Ingegnere Civile",
        categoria: "Edilizia",
        localita: "Firenze",
        modalita: "In sede",
        tipoContratto: "Full-time",
        stipendioMin: 30000,
        stipendioMax: 42000,
        retribuzioneTipo: "Lordo",
        retribuzionePeriodo: "Anno",
        descrizione:
          "Seguirai la progettazione strutturale di edifici residenziali a basso impatto ambientale, dalla fase preliminare al cantiere.",
        requisiti: [
          "Laurea in Ingegneria Civile",
          "Conoscenza di software BIM",
          "Iscrizione all'albo (preferenziale)",
        ],
        dataPubblicazione: "2026-07-18T10:00:00.000Z",
        stato: "attiva",
      },
      {
        id: "job_8",
        aziendaId: "user_c4",
        titolo: "Project Manager Edilizia",
        categoria: "Edilizia",
        localita: "Milano",
        modalita: "Ibrido",
        tipoContratto: "Full-time",
        stipendioMin: 40000,
        stipendioMax: 55000,
        retribuzioneTipo: "Lordo",
        retribuzionePeriodo: "Anno",
        descrizione:
          "Coordinerai cantieri e team multidisciplinari per progetti di edilizia sostenibile, garantendo tempi, costi e qualità.",
        requisiti: [
          "5+ anni di esperienza in project management edilizio",
          "Certificazione PMP (gradita)",
          "Ottime capacità organizzative",
        ],
        dataPubblicazione: "2026-07-30T10:00:00.000Z",
        stato: "attiva",
      },
    ];

    const demoCandidate = {
      id: "user_cand1",
      tipo: "candidato",
      email: "giulia.bianchi@example.com",
      password: "demo1234",
      nome: "Giulia",
      cognome: "Bianchi",
      telefono: "333 1234567",
      bio: "Sviluppatrice frontend con esperienza in interfacce web moderne.",
      competenze: ["HTML", "CSS", "JavaScript", "React", "Figma"],
      cv: "",
      cvFile: null,
      preferiti: [],
      createdAt: "2026-06-15T09:00:00.000Z",
    };

    // Account amministratore: nessun form di registrazione pubblico lo crea,
    // esiste solo come dato seed (in un'app reale andrebbe creato con un
    // processo separato e più protetto, non tramite il sito pubblico).
    const demoAdmin = {
      id: "user_admin1",
      tipo: "admin",
      email: "admin@jobfinder.it",
      password: "admin1234",
      nome: "Amministratore",
      fotoProfilo: null,
      createdAt: "2024-01-01T09:00:00.000Z",
    };

    writeJSON(KEYS.USERS, [...demoCompanies, demoCandidate, demoAdmin]);
    writeJSON(KEYS.JOBS, demoJobs);
    writeJSON(KEYS.APPLICATIONS, []);

    const demoConversation = {
      id: "conv_demo1",
      candidatoId: "user_cand1",
      aziendaId: "user_c1",
      jobId: "job_1",
      status: "accepted",
      initiatorId: "user_c1",
      initiatorTipo: "azienda",
      createdAt: "2026-08-02T09:00:00.000Z",
      lastMessageAt: "2026-08-02T09:05:00.000Z",
    };
    const demoMessages = [
      {
        id: "msg_demo1",
        conversationId: "conv_demo1",
        senderId: "user_c1",
        senderTipo: "azienda",
        testo: "Ciao Giulia, abbiamo visto il tuo profilo e ci interessa molto per la posizione di Frontend Developer. Sei disponibile per una call questa settimana?",
        timestamp: "2026-08-02T09:00:00.000Z",
        letto: true,
      },
      {
        id: "msg_demo2",
        conversationId: "conv_demo1",
        senderId: "user_cand1",
        senderTipo: "candidato",
        testo: "Ciao! Sì, sono disponibile giovedì o venerdì pomeriggio, fatemi sapere cosa preferite.",
        timestamp: "2026-08-02T09:05:00.000Z",
        letto: false,
      },
    ];

    // Seconda conversazione demo, ancora "in attesa": mostra subito la UI di accetta/rifiuta
    const demoConversationPending = {
      id: "conv_demo2",
      candidatoId: "user_cand1",
      aziendaId: "user_c2",
      jobId: "job_3",
      status: "pending",
      initiatorId: "user_c2",
      initiatorTipo: "azienda",
      createdAt: "2026-08-03T15:00:00.000Z",
      lastMessageAt: "2026-08-03T15:00:00.000Z",
    };
    const demoMessagePending = {
      id: "msg_demo3",
      conversationId: "conv_demo2",
      senderId: "user_c2",
      senderTipo: "azienda",
      testo: "Ciao Giulia, il tuo profilo ci sembra interessante per la posizione di Addetto/a Vendite: ti va di parlarne?",
      timestamp: "2026-08-03T15:00:00.000Z",
      letto: false,
    };

    writeJSON(KEYS.CONVERSATIONS, [demoConversation, demoConversationPending]);
    writeJSON(KEYS.MESSAGES, [...demoMessages, demoMessagePending]);
    writeJSON(KEYS.SEED_FLAG, true);
  }

  /**
   * Backfill non distruttivo: garantisce che utenti/offerte creati con versioni
   * precedenti dello schema abbiano comunque i nuovi campi con valori di
   * default, invece di andare in errore. Va eseguita ad ogni caricamento:
   * è economica e idempotente.
   */
  function migrateData() {
    let usersChanged = false;
    const users = getUsers().map((u) => {
      const patched = { ...u };
      // Foto profilo (candidato) / logo (azienda): campo comune a entrambi i tipi di utente
      if (typeof patched.fotoProfilo === "undefined") { patched.fotoProfilo = null; usersChanged = true; }

      if (u.tipo !== "candidato") return patched;
      if (!Array.isArray(patched.competenze)) { patched.competenze = []; usersChanged = true; }
      if (typeof patched.cvFile === "undefined") { patched.cvFile = null; usersChanged = true; }
      if (!Array.isArray(patched.preferiti)) { patched.preferiti = []; usersChanged = true; }
      // Campi dismessi (versioni precedenti dello schema): li rimuoviamo se presenti
      if ("esperienzaAnni" in patched) { delete patched.esperienzaAnni; usersChanged = true; }
      if ("letteraMotivazionale" in patched) { delete patched.letteraMotivazionale; usersChanged = true; }
      return patched;
    });
    if (usersChanged) saveUsers(users);

    let jobsChanged = false;
    const jobs = getJobs().map((j) => {
      const patched = { ...j };
      if (typeof patched.retribuzioneTipo !== "string") { patched.retribuzioneTipo = "Lordo"; jobsChanged = true; }
      if (typeof patched.retribuzionePeriodo !== "string") { patched.retribuzionePeriodo = "Anno"; jobsChanged = true; }
      // Campi dismessi (versioni precedenti dello schema): li rimuoviamo se presenti
      if ("competenzeRichieste" in patched) { delete patched.competenzeRichieste; jobsChanged = true; }
      if ("esperienzaMinima" in patched) { delete patched.esperienzaMinima; jobsChanged = true; }
      return patched;
    });
    if (jobsChanged) saveJobs(jobs);

    // Conversazioni create prima dell'introduzione del flusso di accettazione:
    // le consideriamo già accettate (esistevano e basta, senza questo concetto).
    let conversationsChanged = false;
    const conversations = getConversations().map((c) => {
      const patched = { ...c };
      if (typeof patched.status !== "string") { patched.status = "accepted"; conversationsChanged = true; }
      if (typeof patched.initiatorId !== "string") { patched.initiatorId = patched.candidatoId; conversationsChanged = true; }
      if (typeof patched.initiatorTipo !== "string") { patched.initiatorTipo = "candidato"; conversationsChanged = true; }
      return patched;
    });
    if (conversationsChanged) saveConversations(conversations);
  }

  /**
   * Garantisce che l'account amministratore esista sempre, anche nei browser
   * che avevano già dati JobFinder salvati da prima dell'introduzione del
   * ruolo admin (seedIfNeeded() gira una sola volta: chi ha già i propri
   * dati salvati non lo rieseguirebbe mai, e migrateData() sistema solo i
   * campi di utenti già esistenti, non ne aggiunge di nuovi). Idempotente:
   * se l'admin esiste già non fa nulla.
   */
  function ensureAdminExists() {
    const users = getUsers();
    if (users.some((u) => u.tipo === "admin")) return;

    users.push({
      id: "user_admin1",
      tipo: "admin",
      email: "admin@jobfinder.it",
      password: "admin1234",
      nome: "Amministratore",
      fotoProfilo: null,
      createdAt: new Date().toISOString(),
    });
    saveUsers(users);
  }

  // API pubblica del modulo
  return {
    KEYS,
    generateId,
    isStorageAvailable,
    seedIfNeeded,
    migrateData,
    ensureAdminExists,
    // users
    getUsers,
    saveUsers,
    getUserById,
    getUserByEmail,
    addUser,
    updateUser,
    // jobs
    getJobs,
    saveJobs,
    getJobById,
    addJob,
    updateJob,
    deleteJob,
    // applications
    getApplications,
    saveApplications,
    addApplication,
    updateApplication,
    deleteApplication,
    // conversazioni e messaggi
    getConversations,
    saveConversations,
    addConversation,
    updateConversation,
    getMessages,
    saveMessages,
    addMessage,
    // amministrazione
    adminDeleteJob,
    adminDeleteCompany,
    adminDeleteCandidate,
    // session
    getSession,
    setSession,
    clearSession,
  };
})();

// Esegue seed e migrazione non appena il file viene caricato, su qualsiasi pagina.
// Se LocalStorage non è disponibile (es. alcuni browser in modalità file://),
// evitiamo di procedere: app.js mostrerà un avviso chiaro invece di rompersi in silenzio.
if (JF.Storage.isStorageAvailable()) {
  JF.Storage.seedIfNeeded();
  JF.Storage.migrateData();
  JF.Storage.ensureAdminExists();
}
