"use client";

import React, { createContext, useCallback, useContext, useEffect, useSyncExternalStore } from 'react';

export type Language = 'en' | 'it';
type Translations = Record<string, string>;
type Params = Record<string, string | number>;

// Train station names are never translated: the Trenitalia station lookup only
// matches Italian names, so an English label ("Milan Central") would make the
// search fail or resolve to the wrong station. Shared by both dictionaries.
const TRAIN_STATION_OPTIONS = "Milano Centrale,Roma Termini,Torino ( Tutte Le Stazioni ),Napoli Centrale,Firenze S. M. Novella,Bologna Centrale,Venezia S. Lucia,Bari Centrale,Lecce,Alessandria,Zurigo HB";

const en: Translations = {
  teletransport: "TeleTransport",
  subtitle: "Time is money",
  settings: "Settings",

  guide_title: "How TeleTransport works",
  guide_intro: "TeleTransport ranks trains and flights by an Adjusted Cost: the ticket price plus a value in euros for the time a trip takes and for its inconveniences, such as an early start, a late arrival or a change. Train results come from the Trenitalia website, flight results from Google Flights through SerpApi.\n\nWith 'Include Return' checked, train searches list outbound and return trains in one table, while each flight row is a full round trip priced as a whole.\n\n📅 Date ranges: the outbound and return fields take a range of days (e.g. from the 3rd to the 5th) and every day in it is searched, so the best option across all of them comes first. To search a single day, double-click it.\n\nThis is how each setting works:",
  guide_serpapi_title: "🔑 SerpApi key (flights)",
  guide_serpapi_desc1: "Flight searches go through SerpApi. Without a key of your own you can try a few small searches on a shared demo quota, when it is available. For full searches a free key takes a minute: go to ",
  guide_serpapi_desc2: ", create an account, copy the API key from the dashboard and paste it into Settings. It stays in your browser and is only sent along with your flight searches.",
  guide_trains: "🚆 Trains Scoring",
  guide_flights: "✈️ Flights Scoring",
  time_value: "Time Value",
  time_value_desc: "What one hour of your time is worth. If a trip takes 3 hours and your time value is 20 €/h, 60 € is added to the ticket price. A higher value strongly penalizes slower options.",
  early_penalty: "Early Departure Penalty",
  early_penalty_desc: "Getting up early has a cost. If your Early Departure Time is 09:00 and a train leaves at 07:00, it leaves 2 hours early, and those hours are multiplied by the Early Departure Penalty (€/h).",
  late_penalty: "Late Arrival / Overnight Penalty",
  late_penalty_desc: "Arriving late is inconvenient. Every hour after your Late Arrival Time (e.g. 22:00) is multiplied by the Late Arrival Penalty (€/h), and the count keeps going past midnight up to the Overnight End Time (e.g. 05:00).",
  change_penalty: "Change/Connection Penalty",
  change_penalty_desc: "Each train change or flight connection adds a fixed amount, for the hassle and the risk of missing it.",
  airport_extras: "Airport Extra Costs",
  airport_extras_desc: "Getting to an airport costs money and time. You can attach extra costs to IATA codes: fuel is added as is, driving hours are multiplied by your Time Value (and by the companions' one for their hours).",
  companions_time: "Companions Time",
  companions_time_desc: "If someone drives you to the airport, their time has a value too. It prices the companions' driving hours in Airport Extra Costs.",
  guide_dates_title: "🗓️ Dates and Results Table",
  guide_date_pool: "Non-consecutive dates",
  guide_date_pool_desc: "Select a range, then press the calendar-plus button beside the field to store it and keep choosing. Each stored range becomes a chip under the field, removable with its ×, and the field is left free for one more range. This is how you search, say, 24-26 August together with 31 August-2 September in a single run, skipping the days in between. Outbound and return each keep their own pool, and a search may cover at most 14 days in total across all its ranges.",
  guide_sort_order: "Sort order",
  guide_sort_order_desc: "The two buttons above the table pick the order. The descending-bars icon ranks every solution by Adjusted Cost, best first. The calendar icon groups by departure day, with days in chronological order and the best solutions first within each day; a thicker line marks where a new day starts.",
  guide_results_count: "Results to show",
  guide_results_count_desc: "The selector under the table (3 to 100) means a different thing in each view: ranked by best it is the total number of rows, grouped by day it is the number of rows per day. So 5 while grouping by day shows the 5 best solutions of every day.",
  guide_exclude: "Hiding solutions",
  guide_exclude_desc: "The × at the end of a row drops that solution from the table and the next best one moves up into its place. Nothing is lost: the curved arrow brings back the last one you hid and the circular arrow, with the counter beside it, restores them all. A new search clears the hidden ones.",
  guide_row_link: "Opening a solution",
  guide_row_link_desc: "The route of every row is a link to the operator's own results for that route on that day, with the search already filled in: Trenitalia for trains, Google Flights for flights. A plain click always reuses the same operator tab instead of opening one per solution; ctrl+click (⌘+click on a Mac) or a middle click still opens a separate background tab when you want to compare two days side by side. The train link asks for one adult and is anchored to the hour the solution departs, so adjust passengers and fares once you are there. Prices on the operator's site are live and may have moved since your search.",
  guide_operator_login: "Staying logged in on Trenitalia",
  guide_operator_login_desc: "Trenitalia keeps your credential in one place and the page's signed-in state in another, and the second one belongs to a single tab. So a booking link opens already signed in when a Trenitalia tab is around, and signed out when none is. That is Trenitalia's own behaviour and only code running on their site could change it; the repository ships an optional userscript that does, under userscripts/.",
  close: "Close",

  trains_btn: "Trains",
  flights_btn: "Flights",
  origin: "Origin",
  origin_placeholder_train: "e.g. Milano Centrale (Italian name)",
  origin_placeholder_flight: "e.g. Zurich",
  destination: "Destination",
  dest_placeholder_train: "e.g. Roma Termini (Italian name)",
  dest_placeholder_flight: "e.g. Rome",
  swap_btn: "Swap",
  outbound_range: "Outbound Range",
  outbound_placeholder: "Select outbound dates",
  return_range: "Return Range",
  return_placeholder: "Select return dates",
  include_return: "Include Return",
  open_trenitalia: "Open Trenitalia",
  open_google_flights: "Open Google Flights",
  search_solutions: "Search Solutions",
  searching: "Searching...",
  stop_search: "Stop Search",
  no_solutions: "No solutions found for the selected criteria. Try changing dates or destinations.",
  route: "Route",
  departure: "Departure",
  arrival: "Arrival",
  duration: "Duration",
  price: "Price",
  adj_cost: "Adj Cost",
  return_label: "Return",
  results_to_show: "Results to show:",
  results_per_day: "Results per day:",
  add_range: "Add this range, then pick another",
  copy_table: "Copy Table (Markdown)",
  sort_best: "Sort by best",
  sort_day: "Group by day, best first within each day",
  exclude_row: "Hide this solution",
  restore_last: "Bring back the last hidden solution",
  restore_all: "Bring back every hidden solution",
  open_row_trenitalia: "Open this day on Trenitalia, search already filled in",
  open_row_flights: "Open this day on Google Flights, search already filled in",
  history: "History",

  err_outbound: "You must enter an outbound date (start).",
  err_return: "You must enter a return date or uncheck 'Include Return'.",
  err_max_range: "A search may cover at most {days} days in total, counting every range you added. Please narrow the selection.",
  err_generic: "Error during search",
  err_too_many_days: "A search may cover at most {days} days in total, counting every range you added. Please narrow the selection.",
  err_invalid_config: "The server rejected your saved settings ({message}). Check them in Settings.",
  err_rate_limited: "Too many searches in the last hour. Please try again later.",
  err_server_busy: "The server is busy with other train searches. Try again in a minute.",
  err_station_not_found: "No station found for \"{name}\". Train stations need their Italian name, e.g. Milano Centrale.",
  err_trains_upstream: "Trenitalia did not answer as expected. Try again shortly.",
  err_flights_upstream: "The flight search failed. Try again shortly.",
  err_serpapi_error: "SerpApi returned an error: {reason}",
  err_invalid_api_key: "That does not look like a SerpApi key. Check it in Settings.",
  err_api_key_required: "To search for flights, enter your SerpApi key in Settings.",
  err_demo_single_route: "Demo searches cover a single origin and destination. Add your own SerpApi key in Settings for more.",
  err_demo_search_too_large: "Demo searches cover up to 3 days one-way, or one outbound and one return day. Add your own SerpApi key in Settings for bigger searches.",
  err_demo_exhausted: "You have used today's demo flight searches. Add your own free SerpApi key in Settings to keep searching.",

  demo_banner: "No SerpApi key set: flight searches run on a shared demo quota ({left} left today), limited to one route and up to 3 days one-way or one outbound and return day. Add your own free key in Settings for full searches.",
  demo_none_left: "No SerpApi key set, and today's shared demo quota is used up. Add your own free key in Settings to search flights.",
  demo_unavailable: "Flight searches need a SerpApi key. Add your own free key in Settings.",

  history_empty: "No recent searches.",
  just_now: "Just now",
  minutes_ago: "{n} min ago",
  hours_ago: "{n} hours ago",
  yesterday: "Yesterday",
  days_ago: "{n} days ago",
  results_count: "{n} results",

  footer_disclaimer: "Independent project, not affiliated with Trenitalia, Google or SerpApi. Prices and times come from their public services and may change at any time.",
  footer_source: "Source code",

  theme_system: "Theme: Follow system",
  serpapi_label: "SerpApi Key (Google Flights)",
  serpapi_placeholder: "Enter your API key",
  scoring_trains: "Trains Scoring",
  scoring_flights: "Flights Scoring",
  val_time: "Time value (€/h)",
  early_ref: "Early Departure Time (e.g., 9)",
  early_pen: "Early Departure Penalty (€/h)",
  late_ref: "Late Arrival Time (e.g., 22)",
  overnight_ref: "Overnight End Time (e.g., 5)",
  late_pen: "Late Arrival Penalty (€/h)",
  change_pen: "Change Penalty (€)",
  conn_pen: "Connection Penalty (€)",
  comp_time: "Companions Time Value (€/h)",
  reminders_title: "Text Reminders",
  add_reminder: "+ Add Reminder",
  remove: "Remove",
  target_flights: "Flights Only",
  target_trains: "Trains Only",
  target_both: "Both",
  target_disabled: "Disabled",
  airport_extras_title: "Airport Extra Costs",
  airport_extras_info: "Add transfer costs (fuel and driving time) specific to each airport. They will be added to the total flight cost if the airport is part of the route.",
  iata_code: "IATA Code",
  fuel_eur: "Fuel (€)",
  your_time: "Your Time (h)",
  comp_time_h: "Comp. Time (h)",
  add_airport: "+ Add Airport Cost",
  ui_settings: "User Interface (Customize your Menus)",
  default_origin: "Default Origin",
  default_dest: "Default Destination",
  dropdown_options: "Dropdown Options (comma-separated)",
  dropdown_placeholder: "Leave empty to use the built-in list",
  iata_mapping: "IATA Codes Mapping (one per line, e.g.: linate=LIN)",
  save_settings: "Save Settings",
  saved_local: "Saved in this browser",
  language: "Language",
  language_en: "English",
  language_it: "Italiano",
  settings_origin_train: "e.g., Roma Termini",
  settings_dest_train: "e.g., Milano Centrale",
  settings_origin_flight: "e.g., Rome",
  settings_dest_flight: "e.g., Milan",
  settings_id_placeholder: "ID (e.g., voucher)",
  reminder_text_placeholder: "Reminder text",
  options_trains: TRAIN_STATION_OPTIONS,
  options_flights: "Zurich,Rome,Milan Linate,Milan Malpensa,Turin,Genoa,Venice,Bologna,Naples,Bari,Brindisi,Catania,Palermo",
  export_btn: "Export",
  import_btn: "Import",
  export_error: "Error during export.",
  import_success: "Settings imported successfully! The page will reload to apply changes.",
  import_invalid: "The file does not contain valid settings for TeleTransport.",
  import_corrupted: "Invalid or corrupted file.",
  start_end: "(Start - End)",
  save_destinations: "Save destinations",
  save_btn: "Save",
  add_origin: "Add origin",
  add_dest: "Add destination",
};

const it: Translations = {
  teletransport: "TeleTransport",
  subtitle: "Il tempo è denaro",
  settings: "Impostazioni",

  guide_title: "Come funziona TeleTransport",
  guide_intro: "TeleTransport ordina treni e voli per Costo Adjusted: il prezzo del biglietto più un valore in euro per il tempo che il viaggio richiede e per i suoi disagi, come una partenza all'alba, un arrivo a tarda notte o un cambio. I risultati dei treni arrivano dal sito di Trenitalia, quelli dei voli da Google Flights tramite SerpApi.\n\nCon 'Includi Ritorno' selezionato, le ricerche di treni mostrano andata e ritorno nella stessa tabella, mentre ogni riga dei voli è un'andata e ritorno completa con il suo prezzo totale.\n\n📅 Range di date: i campi di andata e ritorno accettano un intervallo di giorni (es. dal 3 al 5) e li cercano tutti, così la soluzione migliore fra tutti i giorni compare per prima. Per cercare un solo giorno, fai doppio click su quel giorno.\n\nEcco come funziona ogni impostazione:",
  guide_serpapi_title: "🔑 API Key SerpApi (voli)",
  guide_serpapi_desc1: "Le ricerche di voli passano da SerpApi. Senza una chiave tua puoi provare qualche ricerca piccola su una quota demo condivisa, quando è disponibile. Per le ricerche complete una chiave gratuita richiede un minuto: vai su ",
  guide_serpapi_desc2: ", crea un account, copia la API key dalla dashboard e incollala nelle Impostazioni. Resta nel tuo browser e viene inviata solo insieme alle tue ricerche di voli.",
  guide_trains: "🚆 Scoring Treni",
  guide_flights: "✈️ Scoring Voli",
  time_value: "Valore del Tempo",
  time_value_desc: "Quanto vale un'ora del tuo tempo. Se un viaggio dura 3 ore e il valore del tempo è 20 €/h, vengono aggiunti 60 € al prezzo del biglietto. Un valore alto penalizza fortemente le soluzioni più lente.",
  early_penalty: "Penalità Partenza Presto",
  early_penalty_desc: "Svegliarsi presto ha un costo. Se l'Ora Partenza Presto è le 09:00 e un treno parte alle 07:00, parte con 2 ore di anticipo, e quelle ore vengono moltiplicate per la Penalità Partenza Presto (€/h).",
  late_penalty: "Penalità Arrivo Tardi e Notturno",
  late_penalty_desc: "Arrivare tardi è scomodo. Ogni ora dopo l'Ora Arrivo Tardi (es. 22:00) viene moltiplicata per la Penalità Arrivo Tardi (€/h), e il conteggio prosegue oltre la mezzanotte fino all'Ora Fine Arrivo Notturno (es. 05:00).",
  change_penalty: "Penalità per Cambi e Scali",
  change_penalty_desc: "Ogni cambio di treno o scalo aereo aggiunge un importo fisso, per il fastidio e il rischio di perdere la coincidenza.",
  airport_extras: "Costi Extra Aeroporti",
  airport_extras_desc: "Raggiungere un aeroporto costa tempo e denaro. Puoi associare costi extra ai codici IATA: il carburante viene sommato così com'è, le ore di guida vengono moltiplicate per il tuo Valore del Tempo (e per quello degli accompagnatori per le loro ore).",
  companions_time: "Tempo Accompagnatori",
  companions_time_desc: "Se qualcuno ti accompagna in aeroporto, anche il suo tempo ha un valore. Serve a dare un prezzo alle ore di guida degli accompagnatori nei Costi Extra Aeroporti.",
  guide_dates_title: "🗓️ Date e Tabella dei Risultati",
  guide_date_pool: "Date non consecutive",
  guide_date_pool_desc: "Seleziona un intervallo, poi premi il bottone col calendario e il più accanto al campo per memorizzarlo e continuare a scegliere. Ogni intervallo memorizzato diventa un chip sotto il campo, che puoi togliere con la sua ×, e il campo resta libero per un altro intervallo. È così che cerchi per esempio dal 24 al 26 agosto insieme al 31 agosto - 2 settembre in una sola ricerca, saltando i giorni in mezzo. Andata e ritorno hanno ciascuno il proprio pool, e una ricerca può coprire al massimo 14 giorni in totale sommando tutti i suoi intervalli.",
  guide_sort_order: "Ordinamento",
  guide_sort_order_desc: "I due bottoni sopra la tabella scelgono l'ordine. L'icona con le barre decrescenti ordina tutte le soluzioni per Costo Adjusted, dalla migliore alla peggiore. L'icona del calendario raggruppa per giorno di partenza, con i giorni in ordine cronologico e dentro ogni giorno le soluzioni migliori per prime; una riga più marcata segna dove inizia un giorno nuovo.",
  guide_results_count: "Risultati da mostrare",
  guide_results_count_desc: "Il selettore sotto la tabella (da 3 a 100) significa una cosa diversa nelle due viste: ordinando per migliore è il numero totale di righe, raggruppando per giorno è il numero di righe per ogni giorno. Quindi 5 con il raggruppamento per giorno mostra le 5 soluzioni migliori di ciascun giorno.",
  guide_exclude: "Escludere soluzioni",
  guide_exclude_desc: "La × in fondo a una riga la toglie dalla tabella e al suo posto sale la successiva migliore. Niente va perso: la freccia curva rimette l'ultima che hai nascosto e la freccia circolare, con il contatore accanto, le ripristina tutte. Una nuova ricerca azzera le esclusioni.",
  guide_row_link: "Aprire una soluzione",
  guide_row_link_desc: "La rotta di ogni riga è un link ai risultati dell'operatore per quella tratta in quel giorno, con la ricerca già compilata: Trenitalia per i treni, Google Flights per i voli. Un click normale riusa sempre la stessa scheda dell'operatore invece di aprirne una per soluzione; ctrl+click (⌘+click su Mac) o il click centrale aprono comunque una scheda separata in secondo piano, quando vuoi confrontare due giorni affiancati. Il link dei treni chiede un adulto ed è ancorato all'ora di partenza della soluzione, quindi passeggeri e tariffe si sistemano una volta arrivato lì. I prezzi sul sito dell'operatore sono in tempo reale e possono essersi mossi dalla tua ricerca.",
  guide_operator_login: "Restare loggato su Trenitalia",
  guide_operator_login_desc: "Trenitalia tiene le tue credenziali in un posto e lo stato di login della pagina in un altro, e il secondo appartiene a una singola scheda. Per questo un link di prenotazione si apre già loggato se una scheda Trenitalia è aperta, e sloggato se non ce n'è nessuna. È un comportamento di Trenitalia e solo del codice in esecuzione sul loro sito potrebbe cambiarlo; nel repository c'è uno userscript opzionale che lo fa, sotto userscripts/.",
  close: "Chiudi",

  trains_btn: "Treni",
  flights_btn: "Voli",
  origin: "Origine",
  origin_placeholder_train: "es. Milano Centrale",
  origin_placeholder_flight: "es. Zurigo",
  destination: "Destinazione",
  dest_placeholder_train: "es. Roma Termini",
  dest_placeholder_flight: "es. Roma",
  swap_btn: "Inverti",
  outbound_range: "Range Andata",
  outbound_placeholder: "Seleziona date andata",
  return_range: "Range Ritorno",
  return_placeholder: "Seleziona date ritorno",
  include_return: "Includi Ritorno",
  open_trenitalia: "Apri Trenitalia",
  open_google_flights: "Apri Google Flights",
  search_solutions: "Cerca Soluzioni",
  searching: "Ricerca in corso...",
  stop_search: "Interrompi Ricerca",
  no_solutions: "Nessuna soluzione trovata per i criteri selezionati. Prova a cambiare date o destinazioni.",
  route: "Rotta",
  departure: "Partenza",
  arrival: "Arrivo",
  duration: "Durata",
  price: "Prezzo",
  adj_cost: "Costo Adj",
  return_label: "Ritorno",
  results_to_show: "Risultati da mostrare:",
  results_per_day: "Risultati per giorno:",
  add_range: "Aggiungi questo intervallo, poi scegline un altro",
  copy_table: "Copia Tabella (Markdown)",
  sort_best: "Ordina per migliore",
  sort_day: "Raggruppa per giorno, migliori prima dentro ogni giorno",
  exclude_row: "Nascondi questa soluzione",
  restore_last: "Ripristina l'ultima soluzione nascosta",
  restore_all: "Ripristina tutte le soluzioni nascoste",
  open_row_trenitalia: "Apri questo giorno su Trenitalia, ricerca già compilata",
  open_row_flights: "Apri questo giorno su Google Flights, ricerca già compilata",
  history: "Cronologia",

  err_outbound: "Devi inserire una data di andata (inizio).",
  err_return: "Devi inserire una data di ritorno o togliere la spunta da 'Includi Ritorno'.",
  err_max_range: "Una ricerca può coprire al massimo {days} giorni in totale, sommando tutti gli intervalli aggiunti. Restringi la selezione.",
  err_generic: "Errore durante la ricerca",
  err_too_many_days: "Una ricerca può coprire al massimo {days} giorni in totale, sommando tutti gli intervalli aggiunti. Restringi la selezione.",
  err_invalid_config: "Il server ha rifiutato le impostazioni salvate ({message}). Controllale nelle Impostazioni.",
  err_rate_limited: "Troppe ricerche nell'ultima ora. Riprova più tardi.",
  err_server_busy: "Il server è occupato con altre ricerche di treni. Riprova fra un minuto.",
  err_station_not_found: "Nessuna stazione trovata per \"{name}\". Le stazioni vanno scritte col nome italiano, es. Milano Centrale.",
  err_trains_upstream: "Trenitalia non ha risposto come previsto. Riprova fra poco.",
  err_flights_upstream: "La ricerca dei voli non è riuscita. Riprova fra poco.",
  err_serpapi_error: "SerpApi ha restituito un errore: {reason}",
  err_invalid_api_key: "Non sembra una API key di SerpApi. Controllala nelle Impostazioni.",
  err_api_key_required: "Per cercare voli è necessario inserire la propria API Key di SerpApi nelle Impostazioni.",
  err_demo_single_route: "Le ricerche demo coprono una sola origine e una sola destinazione. Aggiungi la tua API key di SerpApi nelle Impostazioni per fare di più.",
  err_demo_search_too_large: "Le ricerche demo coprono fino a 3 giorni di sola andata, oppure un giorno di andata e uno di ritorno. Aggiungi la tua API key di SerpApi nelle Impostazioni per ricerche più ampie.",
  err_demo_exhausted: "Hai usato le ricerche demo di oggi. Aggiungi la tua API key gratuita di SerpApi nelle Impostazioni per continuare.",

  demo_banner: "Nessuna API key di SerpApi: le ricerche di voli usano una quota demo condivisa ({left} rimaste oggi), limitata a una tratta e a 3 giorni di sola andata oppure un giorno di andata e uno di ritorno. Aggiungi la tua chiave gratuita nelle Impostazioni per le ricerche complete.",
  demo_none_left: "Nessuna API key di SerpApi, e la quota demo condivisa di oggi è esaurita. Aggiungi la tua chiave gratuita nelle Impostazioni per cercare voli.",
  demo_unavailable: "Le ricerche di voli richiedono una API key di SerpApi. Aggiungi la tua chiave gratuita nelle Impostazioni.",

  history_empty: "Nessuna ricerca recente.",
  just_now: "Pochi secondi fa",
  minutes_ago: "{n} min fa",
  hours_ago: "{n} ore fa",
  yesterday: "Ieri",
  days_ago: "{n} giorni fa",
  results_count: "{n} soluzioni",

  footer_disclaimer: "Progetto indipendente, non affiliato a Trenitalia, Google o SerpApi. Prezzi e orari provengono dai loro servizi pubblici e possono cambiare in qualsiasi momento.",
  footer_source: "Codice sorgente",

  theme_system: "Tema: Segui il sistema",
  serpapi_label: "API Key SerpApi (Google Flights)",
  serpapi_placeholder: "Inserisci la tua API key",
  scoring_trains: "Scoring Treni",
  scoring_flights: "Scoring Voli",
  val_time: "Valore del tempo (€/h)",
  early_ref: "Ora Partenza Presto (es. 9)",
  early_pen: "Penalità Partenza Presto (€/h)",
  late_ref: "Ora Arrivo Tardi (es. 22)",
  overnight_ref: "Ora Fine Arrivo Notturno (es. 5)",
  late_pen: "Penalità Arrivo Tardi (€/h)",
  change_pen: "Penalità per Cambio (€)",
  conn_pen: "Penalità per Scalo/Connessione (€)",
  comp_time: "Valore Tempo Accompagnatori (€/h)",
  reminders_title: "Promemoria Testuali",
  add_reminder: "+ Aggiungi Promemoria",
  remove: "Rimuovi",
  target_flights: "Solo Voli",
  target_trains: "Solo Treni",
  target_both: "Entrambi",
  target_disabled: "Disattivo",
  airport_extras_title: "Costi Extra Aeroporti",
  airport_extras_info: "Aggiungi i costi di trasferimento (carburante e tempo di guida) specifici per ogni aeroporto. Verranno sommati al costo totale del volo se l'aeroporto fa parte della tratta.",
  iata_code: "Codice IATA",
  fuel_eur: "Carburante (€)",
  your_time: "Tuo Tempo (h)",
  comp_time_h: "Tempo Accomp. (h)",
  add_airport: "+ Aggiungi Costo Aeroporto",
  ui_settings: "Interfaccia Utente (Personalizza i tuoi Menu)",
  default_origin: "Origine di Default",
  default_dest: "Destinazione di Default",
  dropdown_options: "Opzioni Menu a tendina (separate da virgola)",
  dropdown_placeholder: "Lascia vuoto per usare la lista predefinita",
  iata_mapping: "Mappatura Codici IATA (uno per riga, es: linate=LIN)",
  save_settings: "Salva Impostazioni",
  saved_local: "Salvato in questo browser",
  language: "Lingua",
  language_en: "English",
  language_it: "Italiano",
  settings_origin_train: "es. Roma Termini",
  settings_dest_train: "es. Milano Centrale",
  settings_origin_flight: "es. Roma",
  settings_dest_flight: "es. Milano",
  settings_id_placeholder: "ID (es. voucher)",
  reminder_text_placeholder: "Testo del promemoria",
  options_trains: TRAIN_STATION_OPTIONS,
  options_flights: "Zurigo,Roma,Milano Linate,Milano Malpensa,Torino,Genova,Venezia,Bologna,Napoli,Bari,Brindisi,Catania,Palermo",
  export_btn: "Esporta",
  import_btn: "Importa",
  export_error: "Errore durante l'esportazione.",
  import_success: "Impostazioni importate con successo! La pagina verrà ricaricata per applicare le modifiche.",
  import_invalid: "Il file non contiene impostazioni valide per TeleTransport.",
  import_corrupted: "File non valido o corrotto.",
  start_end: "(Inizio - Fine)",
  save_destinations: "Salva destinazioni",
  save_btn: "Salva",
  add_origin: "Aggiungi origine",
  add_dest: "Aggiungi destinazione",
};

const dictionaries: Record<Language, Translations> = { en, it };

const LANGUAGE_KEY = 'app_language';
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener('storage', listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', listener);
  };
}

function readLanguage(): Language {
  try {
    return localStorage.getItem(LANGUAGE_KEY) === 'it' ? 'it' : 'en';
  } catch {
    return 'en';
  }
}

interface LanguageContextProps {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (key: string, params?: Params) => string;
}

const LanguageContext = createContext<LanguageContextProps>({
  language: 'en',
  setLanguage: () => {},
  t: (key: string) => key,
});

export const useLanguage = () => useContext(LanguageContext);

export const LanguageProvider = ({ children }: { children: React.ReactNode }) => {
  // The server renders English; the stored choice is applied on hydration.
  const language = useSyncExternalStore(subscribe, readLanguage, () => 'en' as Language);

  // Keep <html lang> in sync so screen readers and search engines see the
  // language actually on screen. The boot script in layout.tsx covers the
  // first paint; this covers switching language during the session.
  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  const setLanguage = useCallback((lang: Language) => {
    localStorage.setItem(LANGUAGE_KEY, lang);
    listeners.forEach(listener => listener());
  }, []);

  const t = useCallback((key: string, params?: Params) => {
    const text = dictionaries[language][key] ?? key;
    return params ? text.replace(/\{(\w+)\}/g, (match, name) => String(params[name] ?? match)) : text;
  }, [language]);

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t }}>
      {children}
    </LanguageContext.Provider>
  );
};
