/**
 * matching.js
 * ---------------------------------------------------------------------------
 * Calcola un punteggio di compatibilità tra un candidato e un'offerta.
 * Nessuna IA, nessuna percentuale: è un conteggio semplice e trasparente.
 *
 * Regola: +1 punto per ogni competenza del candidato che compare (come
 * parola/frase intera, case-insensitive) nel testo della "descrizione del
 * ruolo" o dei "requisiti" dell'offerta.
 *
 * Esempio: candidato con competenze ["React", "CSS", "Figma"] su un'offerta
 * la cui descrizione cita "React" e i cui requisiti citano "CSS" -> punteggio 2,
 * "Figma" non trovato.
 * ---------------------------------------------------------------------------
 */

window.JF = window.JF || {};

JF.Matching = (function () {
  "use strict";

  function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  /** Testo completo su cui cercare le competenze: descrizione + ogni riga dei requisiti. */
  function getJobSearchableText(job) {
    const requisitiText = Array.isArray(job.requisiti) ? job.requisiti.join(" ") : "";
    return `${job.descrizione || ""} ${requisitiText}`;
  }

  /**
   * Calcola il match tra un candidato e un'offerta.
   * @returns {{score:number, matchedSkills:string[], totalSkills:number, hasSkills:boolean}}
   */
  function computeMatch(candidate, job) {
    const candidateSkills = candidate && Array.isArray(candidate.competenze) ? candidate.competenze : [];

    if (!candidate || candidate.tipo !== "candidato" || !job || candidateSkills.length === 0) {
      return { score: 0, matchedSkills: [], totalSkills: candidateSkills.length, hasSkills: candidateSkills.length > 0 };
    }

    const text = getJobSearchableText(job);
    const matchedSkills = candidateSkills.filter((skill) => {
      const trimmed = (skill || "").trim();
      if (!trimmed) return false;
      const pattern = new RegExp(`\\b${escapeRegex(trimmed)}\\b`, "i");
      return pattern.test(text);
    });

    return {
      score: matchedSkills.length,
      matchedSkills,
      totalSkills: candidateSkills.length,
      hasSkills: true,
    };
  }

  /** Classe CSS del tag in base al punteggio assoluto (non percentuale). */
  function scoreTagClass(score) {
    if (score >= 3) return "tag--success";
    if (score >= 1) return "tag--warning";
    return "tag--muted";
  }

  /**
   * Restituisce le offerte attive compatibili con un candidato, ordinate per
   * punteggio decrescente, ciascuna arricchita con il proprio oggetto match.
   * @param {Object} candidate
   * @param {number} minScore - punteggio minimo per essere considerata compatibile (default 1)
   */
  function getCompatibleJobs(candidate, minScore = 1) {
    if (!candidate || candidate.tipo !== "candidato") return [];
    if (!Array.isArray(candidate.competenze) || candidate.competenze.length === 0) return [];

    return JF.Storage.getJobs()
      .filter((job) => job.stato === "attiva")
      .map((job) => ({ job, match: computeMatch(candidate, job) }))
      .filter((entry) => entry.match.score >= minScore)
      .sort((a, b) => b.match.score - a.match.score);
  }

  return { computeMatch, scoreTagClass, getCompatibleJobs };
})();
