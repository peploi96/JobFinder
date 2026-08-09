/**
 * chat.js
 * ---------------------------------------------------------------------------
 * Chat simulata candidato-azienda con richiesta di accettazione: chi riceve
 * il primo messaggio deve accettare (o rifiutare) prima che la conversazione
 * diventi bidirezionale.
 *
 * Stati di una conversazione:
 *  - "pending"  : creata da chi ha inviato il primo messaggio, in attesa
 *                 della decisione del destinatario. Solo chi ha iniziato può
 *                 continuare a scrivere; il destinatario vede la richiesta
 *                 e deve accettare o rifiutare prima di poter rispondere.
 *  - "accepted" : il destinatario ha accettato, la chat è aperta a entrambi.
 *  - "declined" : il destinatario ha rifiutato, la conversazione è chiusa
 *                 e non si possono inviare altri messaggi.
 * ---------------------------------------------------------------------------
 */

window.JF = window.JF || {};

JF.Chat = (function () {
  "use strict";

  /** Trova una conversazione esistente tra un candidato e un'azienda (indipendentemente da chi l'ha creata). */
  function findConversation(candidatoId, aziendaId) {
    return JF.Storage.getConversations().find(
      (c) => c.candidatoId === candidatoId && c.aziendaId === aziendaId
    ) || null;
  }

  function getConversationById(id) {
    return JF.Storage.getConversations().find((c) => c.id === id) || null;
  }

  /**
   * Avvia una conversazione (se non esiste già) inviando il primo messaggio.
   * Chi la avvia diventa "initiator": la conversazione nasce in stato "pending"
   * finché l'altra parte non la accetta o rifiuta.
   * @param {Object} initiator - utente che scrive (candidato o azienda)
   * @param {string} recipientId - id dell'altra parte
   * @param {string} testo - primo messaggio (può essere vuoto se si allega un file)
   * @param {string|null} jobId - offerta di contesto, se presente
   * @param {Object|null} attachment - { name, dataUrl, size, type } file allegato al primo messaggio
   * @returns {{ok:boolean, error?:string, conversation?:Object, message?:Object}}
   */
  function startConversation(initiator, recipientId, testo, jobId = null, attachment = null) {
    const trimmed = (testo || "").trim();
    if (!trimmed && !attachment) return { ok: false, error: "Scrivi un messaggio o allega un file prima di inviare la richiesta." };

    const candidatoId = initiator.tipo === "candidato" ? initiator.id : recipientId;
    const aziendaId = initiator.tipo === "azienda" ? initiator.id : recipientId;

    let conversation = findConversation(candidatoId, aziendaId);

    if (conversation && conversation.status === "declined") {
      return { ok: false, error: "L'altra parte ha rifiutato questa conversazione in passato." };
    }

    if (!conversation) {
      const now = new Date().toISOString();
      conversation = JF.Storage.addConversation({
        id: JF.Storage.generateId("conv"),
        candidatoId,
        aziendaId,
        jobId,
        status: "pending",
        initiatorId: initiator.id,
        initiatorTipo: initiator.tipo,
        createdAt: now,
        lastMessageAt: now,
      });
    } else if (jobId && !conversation.jobId) {
      conversation = JF.Storage.updateConversation(conversation.id, { jobId });
    }

    const result = sendMessage(conversation.id, initiator.id, initiator.tipo, trimmed, attachment);
    if (!result.ok) return result;

    return { ok: true, conversation, message: result.message };
  }

  /** Messaggi di una conversazione, ordinati cronologicamente. */
  function getMessages(conversationId) {
    return JF.Storage.getMessages()
      .filter((m) => m.conversationId === conversationId)
      .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  }

  /**
   * Invia un messaggio in una conversazione già esistente, con un eventuale
   * allegato (es. CV o altro documento). Il testo può essere vuoto se è
   * presente un allegato, ma non possono mancare entrambi.
   * Regole: in stato "declined" nessuno può scrivere; in stato "pending" solo
   * l'utente che ha avviato la richiesta può continuare a scrivere (il
   * destinatario deve prima accettare).
   * @param {Object|null} attachment - { name, dataUrl, size, type }
   */
  function sendMessage(conversationId, senderId, senderTipo, testo, attachment = null) {
    const trimmed = (testo || "").trim();
    if (!trimmed && !attachment) return { ok: false, error: "Scrivi un messaggio o allega un file." };

    const conversation = getConversationById(conversationId);
    if (!conversation) return { ok: false, error: "Conversazione non trovata." };

    if (conversation.status === "declined") {
      return { ok: false, error: "Questa conversazione è stata rifiutata: non è più possibile scrivere." };
    }
    if (conversation.status === "pending" && senderId !== conversation.initiatorId) {
      return { ok: false, error: "Devi prima accettare la richiesta di conversazione per poter rispondere." };
    }

    const message = {
      id: JF.Storage.generateId("msg"),
      conversationId,
      senderId,
      senderTipo,
      testo: trimmed,
      allegato: attachment || null,
      timestamp: new Date().toISOString(),
      letto: false,
    };
    JF.Storage.addMessage(message);
    JF.Storage.updateConversation(conversationId, { lastMessageAt: message.timestamp });
    return { ok: true, message };
  }

  /**
   * Il destinatario accetta o rifiuta la richiesta di conversazione.
   * @param {string} conversationId
   * @param {string} responderId - deve essere il destinatario, non l'iniziatore
   * @param {boolean} accept
   */
  function respondToRequest(conversationId, responderId, accept) {
    const conversation = getConversationById(conversationId);
    if (!conversation) return { ok: false, error: "Conversazione non trovata." };
    if (conversation.status !== "pending") {
      return { ok: false, error: "Questa richiesta è già stata gestita." };
    }
    if (responderId === conversation.initiatorId) {
      return { ok: false, error: "Non puoi accettare una richiesta che hai avviato tu stesso." };
    }

    const updated = JF.Storage.updateConversation(conversationId, { status: accept ? "accepted" : "declined" });
    return { ok: true, conversation: updated };
  }

  /** Segna come letti tutti i messaggi di una conversazione NON inviati dal lettore. */
  function markConversationAsRead(conversationId, readerId) {
    const messages = JF.Storage.getMessages().map((m) =>
      m.conversationId === conversationId && m.senderId !== readerId ? { ...m, letto: true } : m
    );
    JF.Storage.saveMessages(messages);
  }

  /**
   * Elenco delle conversazioni di un utente (candidato o azienda), arricchito
   * con i dati dell'altra parte, l'ultimo messaggio, i non letti e se è in
   * attesa di una decisione da parte dell'utente corrente.
   */
  function getConversationsForUser(userId, tipo) {
    const field = tipo === "azienda" ? "aziendaId" : "candidatoId";
    const otherField = tipo === "azienda" ? "candidatoId" : "aziendaId";
    const allMessages = JF.Storage.getMessages();

    return JF.Storage.getConversations()
      .filter((c) => c[field] === userId)
      .map((c) => {
        const otherUser = JF.Storage.getUserById(c[otherField]);
        const job = c.jobId ? JF.Storage.getJobById(c.jobId) : null;
        const messages = allMessages
          .filter((m) => m.conversationId === c.id)
          .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
        const lastMessage = messages[messages.length - 1] || null;
        const unreadCount = messages.filter((m) => m.senderId !== userId && !m.letto).length;
        const awaitingMyDecision = c.status === "pending" && c.initiatorId !== userId;
        const awaitingTheirDecision = c.status === "pending" && c.initiatorId === userId;

        return { ...c, otherUser, job, lastMessage, unreadCount, awaitingMyDecision, awaitingTheirDecision };
      })
      .sort((a, b) => new Date(b.lastMessageAt) - new Date(a.lastMessageAt));
  }

  /** Totale notifiche per il badge in navbar: messaggi non letti + richieste in attesa di una mia decisione. */
  function getNotificationCount(userId, tipo) {
    const conversations = getConversationsForUser(userId, tipo);
    return conversations.reduce((sum, c) => sum + (c.awaitingMyDecision ? 1 : c.unreadCount), 0);
  }

  return {
    findConversation,
    getConversationById,
    startConversation,
    getMessages,
    sendMessage,
    respondToRequest,
    markConversationAsRead,
    getConversationsForUser,
    getNotificationCount,
  };
})();
