/**
 * geo.js
 * ---------------------------------------------------------------------------
 * Tutto ciò che riguarda le località: conversione nome città → coordinate GPS
 * (Nominatim/OpenStreetMap), calcolo distanze (Haversine) e un componente di
 * autocompletamento città riutilizzabile (Photon/Komoot, anch'esso basato su
 * OpenStreetMap). Modulo separato da jobs.js perché usato da tre punti diversi
 * dell'app: il filtro di ricerca, la maschera di inserimento offerta lato
 * azienda, e la mappa nel dettaglio offerta.
 *
 * Nota rete: Nominatim e Photon sono servizi pubblici gratuiti con policy di
 * uso corretto (rate limit ~1 richiesta/sec, no uso massivo). La cache in
 * memoria qui sotto serve proprio a ridurre le chiamate ripetute sulla stessa
 * città entro la sessione di navigazione.
 * ---------------------------------------------------------------------------
 */

window.JF = window.JF || {};

JF.Geo = (function () {
  "use strict";

  // Cache in memoria: si azzera ad ogni ricarica di pagina (non persistita).
  // Chiave: nome città normalizzato (minuscolo, trim) -> { lat, lon }
  const geocodeCache = {};
  // Richieste di geocodifica già in corso (chiave -> Promise): evita che più
  // chiamate concorrenti sulla stessa città (es. il filtro per raggio, che
  // controlla più offerte in parallelo) sparino ciascuna la propria richiesta
  // di rete prima che la prima abbia avuto il tempo di popolare la cache.
  const pendingRequests = {};

  // ---------------------------------------------------------------------
  // Coda di invio verso Nominatim: la loro policy d'uso chiede max ~1
  // richiesta al secondo e nessun burst. Il dedup sopra evita richieste
  // duplicate sulla STESSA città, ma con molte città diverse da geocodificare
  // (es. una ricerca per raggio con risultati sparsi in tutta Italia) le
  // richieste partirebbero comunque tutte insieme. Questa coda le serializza,
  // distanziandole di MIN_INTERVAL_MS l'una dall'altra, indipendentemente da
  // quante ne vengono richieste in parallelo dal resto del codice.
  const MIN_NOMINATIM_INTERVAL_MS = 1100;
  let nominatimQueue = Promise.resolve();
  let lastNominatimCallAt = 0;

  function throttledNominatimFetch(url, options) {
    const run = async () => {
      const waitFor = Math.max(0, lastNominatimCallAt + MIN_NOMINATIM_INTERVAL_MS - Date.now());
      if (waitFor > 0) await new Promise((resolve) => setTimeout(resolve, waitFor));
      lastNominatimCallAt = Date.now();
      return fetch(url, options);
    };
    // Incodiamo la richiesta in coda; usiamo .then(run, run) così un'eventuale
    // richiesta precedente fallita non blocca per sempre quelle successive.
    const result = nominatimQueue.then(run, run);
    nominatimQueue = result.catch(() => {}); // la coda prosegue comunque, l'errore resta solo su "result"
    return result;
  }

  function normalizeKey(name) {
    return (name || "").trim().toLowerCase();
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str ?? "";
    return div.innerHTML;
  }

  /** Permette di popolare la cache "a mano" (es. quando le coordinate arrivano già da un suggerimento di autocomplete). */
  function cacheCoordinates(cityName, lat, lon) {
    const key = normalizeKey(cityName);
    if (!key || typeof lat !== "number" || typeof lon !== "number") return;
    geocodeCache[key] = { lat, lon };
  }

  /**
   * Converte un nome di città in coordinate GPS tramite Nominatim (OpenStreetMap).
   * Il risultato viene cachato in memoria: chiamate successive sulla stessa
   * città non generano nuove richieste di rete. Le chiamate concorrenti sulla
   * stessa città (prima che la risposta arrivi) condividono la stessa
   * richiesta in corso invece di duplicarla.
   * @param {string} cityName
   * @returns {Promise<{lat:number, lon:number}|null>}
   */
  function geocodeCity(cityName) {
    const key = normalizeKey(cityName);
    if (!key) return Promise.resolve(null);
    if (geocodeCache[key]) return Promise.resolve(geocodeCache[key]);
    if (pendingRequests[key]) return pendingRequests[key]; // richiesta già in volo: la riusiamo

    const request = (async () => {
      try {
        const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=it&q=${encodeURIComponent(cityName)}`;
        const response = await throttledNominatimFetch(url, { headers: { "Accept-Language": "it" } });
        if (!response.ok) return null;

        const results = await response.json();
        if (!Array.isArray(results) || results.length === 0) return null;

        const coords = { lat: parseFloat(results[0].lat), lon: parseFloat(results[0].lon) };
        geocodeCache[key] = coords;
        return coords;
      } catch (err) {
        console.error("[Geo] Errore geocodifica Nominatim:", err);
        return null;
      } finally {
        delete pendingRequests[key];
      }
    })();

    pendingRequests[key] = request;
    return request;
  }

  /** Formula di Haversine: distanza in km in linea d'aria tra due punti GPS. */
  function haversineDistanceKm(lat1, lon1, lat2, lon2) {
    const toRad = (deg) => (deg * Math.PI) / 180;
    const R = 6371; // raggio medio della Terra in km
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  /**
   * Verifica se la città di un'offerta rientra nel raggio scelto rispetto alla
   * città cercata dall'utente. Geocodifica entrambe (con cache) e applica Haversine.
   * Se una delle due città non è geolocalizzabile, l'offerta viene esclusa per
   * sicurezza (es. "Remoto" non è una città reale).
   * @returns {Promise<boolean>}
   */
  async function isWithinRadius(originCityName, targetCityName, radiusKm) {
    if (!radiusKm) return true; // nessun raggio impostato: il filtro per distanza non si applica
    const [origin, target] = await Promise.all([geocodeCity(originCityName), geocodeCity(targetCityName)]);
    if (!origin || !target) return false;
    return haversineDistanceKm(origin.lat, origin.lon, target.lat, target.lon) <= radiusKm;
  }

  // ---------------------------------------------------------------------
  // Autocompletamento città (Photon / Komoot, basato su OpenStreetMap)
  // ---------------------------------------------------------------------

  const DEBOUNCE_MS = 300;
  const MIN_CHARS = 2;

  /**
   * Rende un <input> di testo un campo con autocompletamento città in tempo
   * reale. Riutilizzabile su qualsiasi input del sito (barra di ricerca
   * candidato, form offerta azienda, ...): usando sempre la stessa fonte dati
   * i nomi delle città restano coerenti in tutta l'app.
   *
   * @param {HTMLInputElement} input - il campo di testo da potenziare
   * @param {HTMLElement} [container] - elemento per la tendina dei suggerimenti;
   *        se omesso viene creato automaticamente subito dopo l'input
   * @param {Object} [options]
   * @param {Function} [options.onSelect] - callback(suggestion) alla selezione,
   *        suggestion = { name, label, lat, lon }
   */
  function setupLocationAutocomplete(input, container, options = {}) {
    if (!input) return;
    const { onSelect } = options;

    // Garantisce la struttura richiesta: input avvolto in .autocomplete-wrapper
    // (serve da riferimento di posizionamento per la tendina assoluta) e un
    // contenitore .autocomplete-suggestions per i risultati.
    let wrapper = input.closest(".autocomplete-wrapper");
    if (!wrapper) {
      wrapper = document.createElement("div");
      wrapper.className = "autocomplete-wrapper";
      input.parentNode.insertBefore(wrapper, input);
      wrapper.appendChild(input);
    }
    if (!container) {
      container = wrapper.querySelector(".autocomplete-suggestions");
      if (!container) {
        container = document.createElement("div");
        wrapper.appendChild(container);
      }
    }
    container.classList.add("autocomplete-suggestions");
    input.setAttribute("autocomplete", "off");

    let debounceTimer = null;
    let currentResults = [];
    let activeIndex = -1;
    let abortController = null;

    function closeDropdown() {
      container.innerHTML = "";
      container.classList.remove("is-open");
      currentResults = [];
      activeIndex = -1;
    }

    function renderDropdown() {
      if (currentResults.length === 0) {
        closeDropdown();
        return;
      }
      container.innerHTML = currentResults
        .map(
          (r, i) =>
            `<button type="button" class="autocomplete-suggestion ${i === activeIndex ? "is-active" : ""}" data-index="${i}">${escapeHtml(r.label)}</button>`
        )
        .join("");
      container.classList.add("is-open");

      container.querySelectorAll("[data-index]").forEach((btn) => {
        // mousedown (non click) per selezionare PRIMA che l'input perda il focus e chiuda la tendina
        btn.addEventListener("mousedown", (e) => {
          e.preventDefault();
          selectSuggestion(currentResults[Number(btn.dataset.index)]);
        });
      });
    }

    function selectSuggestion(suggestion) {
      input.value = suggestion.name;
      cacheCoordinates(suggestion.name, suggestion.lat, suggestion.lon);
      closeDropdown();
      input.dispatchEvent(new Event("change", { bubbles: true }));
      if (typeof onSelect === "function") onSelect(suggestion);
    }

    async function fetchSuggestions(query) {
      if (abortController) abortController.abort();
      abortController = new AbortController();

      try {
        const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&lang=it&limit=6&filter=countrycode:it`;
        const response = await fetch(url, { signal: abortController.signal });
        if (!response.ok) return;
        const data = await response.json();

        currentResults = (data.features || [])
          // Filtro di sicurezza lato client, indipendente dal parametro server-side
          .filter((f) => !f.properties.countrycode || f.properties.countrycode === "IT")
          .map((f) => {
            const p = f.properties;
            const extra = [p.city && p.city !== p.name ? p.city : null, p.state].filter(Boolean);
            return {
              name: p.name || query,
              label: extra.length ? `${p.name}, ${extra.join(", ")}` : p.name,
              lat: f.geometry.coordinates[1],
              lon: f.geometry.coordinates[0],
            };
          });

        activeIndex = -1;
        renderDropdown();
      } catch (err) {
        if (err.name !== "AbortError") console.error("[Geo] Errore autocomplete Photon:", err);
      }
    }

    input.addEventListener("input", () => {
      const query = input.value.trim();
      clearTimeout(debounceTimer);
      if (query.length < MIN_CHARS) {
        closeDropdown();
        return;
      }
      debounceTimer = setTimeout(() => fetchSuggestions(query), DEBOUNCE_MS);
    });

    input.addEventListener("keydown", (e) => {
      if (currentResults.length === 0) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        activeIndex = (activeIndex + 1) % currentResults.length;
        renderDropdown();
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        activeIndex = (activeIndex - 1 + currentResults.length) % currentResults.length;
        renderDropdown();
      } else if (e.key === "Enter") {
        if (activeIndex >= 0) {
          e.preventDefault();
          selectSuggestion(currentResults[activeIndex]);
        } else {
          closeDropdown(); // testo libero: lascia che sia il form a gestire l'invio
        }
      } else if (e.key === "Escape") {
        closeDropdown();
      }
    });

    document.addEventListener("click", (e) => {
      if (!wrapper.contains(e.target)) closeDropdown();
    });
  }

  return {
    geocodeCity,
    cacheCoordinates,
    haversineDistanceKm,
    isWithinRadius,
    setupLocationAutocomplete,
  };
})();
