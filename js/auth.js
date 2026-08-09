/**
 * auth.js
 * ---------------------------------------------------------------------------
 * Gestione utenti e sessione locale. Nota per il futuro: qui la "sessione"
 * è solo { id, tipo } salvata in LocalStorage — i dati completi dell'utente
 * si leggono sempre da JF.Storage.getUserById(session.id), così restano
 * aggiornati anche dopo una modifica profilo. Sostituendo login()/register()
 * con chiamate API reali (con token JWT al posto della password in chiaro),
 * il resto dell'app non cambia.
 * ---------------------------------------------------------------------------
 */

window.JF = window.JF || {};

JF.Auth = (function () {
  "use strict";

  /** Ritorna l'utente attualmente loggato (dati completi), o null. */
  function getCurrentUser() {
    const session = JF.Storage.getSession();
    if (!session) return null;
    return JF.Storage.getUserById(session.id);
  }

  function isLoggedIn() {
    return !!JF.Storage.getSession();
  }

  /**
   * Registra un nuovo utente (candidato o azienda) e avvia subito la sessione.
   * @param {"candidato"|"azienda"} tipo
   * @param {Object} data - campi del form
   * @returns {{ok: boolean, error?: string, user?: Object}}
   */
  function register(tipo, data) {
    const email = (data.email || "").trim().toLowerCase();

    if (!email || !data.password) {
      return { ok: false, error: "Email e password sono obbligatorie." };
    }
    if (data.password.length < 6) {
      return { ok: false, error: "La password deve avere almeno 6 caratteri." };
    }
    if (JF.Storage.getUserByEmail(email)) {
      return { ok: false, error: "Esiste già un account con questa email." };
    }

    const baseUser = {
      id: JF.Storage.generateId("user"),
      tipo,
      email,
      password: data.password, // demo: nessun hashing, solo per progetto locale
      fotoProfilo: null, // { name, dataUrl } quando l'utente carica un'immagine; null = usa le iniziali
      createdAt: new Date().toISOString(),
    };

    const user =
      tipo === "candidato"
        ? {
            ...baseUser,
            nome: data.nome || "",
            cognome: data.cognome || "",
            telefono: data.telefono || "",
            bio: "",
            competenze: [],
            cv: "",
            cvFile: null, // { name, dataUrl } quando l'utente carica un file
            preferiti: [], // array di jobId salvati come preferiti
          }
        : {
            ...baseUser,
            ragioneSociale: data.ragioneSociale || "",
            settore: data.settore || "",
            sitoWeb: data.sitoWeb || "",
            bio: data.bio || "",
          };

    JF.Storage.addUser(user);
    JF.Storage.setSession({ id: user.id, tipo: user.tipo });
    return { ok: true, user };
  }

  /**
   * Login simulato: verifica email + password contro i dati locali.
   */
  function login(email, password) {
    const user = JF.Storage.getUserByEmail(email);
    if (!user || user.password !== password) {
      return { ok: false, error: "Email o password non corretti." };
    }
    JF.Storage.setSession({ id: user.id, tipo: user.tipo });
    return { ok: true, user };
  }

  function logout() {
    JF.Storage.clearSession();
    // Determina il prefisso corretto in base a dove ci troviamo (root o /pages)
    const inPagesFolder = window.location.pathname.includes("/pages/");
    window.location.href = inPagesFolder ? "../index.html" : "index.html";
  }

  /**
   * Da chiamare in cima alle pagine riservate (dashboard).
   * Se l'utente non è loggato, o è del tipo sbagliato, reindirizza al login.
   * @param {"candidato"|"azienda"|null} requiredType - null = qualsiasi utente loggato
   */
  function requireAuth(requiredType = null) {
    const user = getCurrentUser();
    if (!user || (requiredType && user.tipo !== requiredType)) {
      window.location.href = "login.html";
      return null;
    }
    return user;
  }

  /** Aggiorna i dati del profilo dell'utente corrente. */
  function updateCurrentUser(fields) {
    const user = getCurrentUser();
    if (!user) return null;
    return JF.Storage.updateUser(user.id, fields);
  }

  return {
    getCurrentUser,
    isLoggedIn,
    register,
    login,
    logout,
    requireAuth,
    updateCurrentUser,
  };
})();
