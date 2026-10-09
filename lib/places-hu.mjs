// places-hu.mjs — nume maghiare pentru localitatile din textul unui meci.
// Lista e scrisa si verificata manual si sta in repo (nu depinde de fisiere locale).
// Contine doar Transilvania, Banat, Crisana si Maramures (+ Bucuresti): acolo exista
// nume maghiare consacrate. Orice localitate care nu e aici ramane cu numele oficial
// romanesc. Au fost lasate deoparte intentionat nume ambigue sau cuvinte uzuale
// (ex. Victoria, Unirea, Livada, Florești, Bălan).

const PLACES = [
  // Alba
  ["Alba Iulia", "Gyulafehérvár"], ["Aiud", "Nagyenyed"], ["Blaj", "Balázsfalva"], ["Sebeș", "Szászsebes"],
  ["Cugir", "Kudzsir"], ["Ocna Mureș", "Marosújvár"], ["Câmpeni", "Topánfalva"], ["Zlatna", "Zalatna"],
  ["Teiuș", "Tövis"], ["Abrud", "Abrudbánya"],
  // Arad
  ["Arad", "Arad"], ["Ineu", "Borosjenő"], ["Lipova", "Lippa"], ["Pecica", "Pécska"], ["Curtici", "Kürtös"],
  ["Nădlac", "Nagylak"], ["Chișineu-Criș", "Kisjenő"], ["Sântana", "Újszentanna"], ["Sebiș", "Borossebes"],
  ["Pâncota", "Pankota"],
  // Bihor
  ["Oradea", "Nagyvárad"], ["Salonta", "Nagyszalonta"], ["Marghita", "Margitta"], ["Beiuș", "Belényes"],
  ["Aleșd", "Élesd"], ["Valea lui Mihai", "Érmihályfalva"], ["Săcueni", "Székelyhíd"], ["Ștei", "Vaskohsziklás"],
  ["Vașcău", "Vaskoh"], ["Bihor", "Bihar"],
  // Bistrița-Năsăud
  ["Bistrița", "Beszterce"], ["Beclean", "Bethlen"], ["Năsăud", "Naszód"], ["Sângeorz-Băi", "Oláhszentgyörgy"],
  ["Bistrița-Năsăud", "Beszterce-Naszód"],
  // Brașov
  ["Brașov", "Brassó"], ["Codlea", "Feketehalom"], ["Făgăraș", "Fogaras"], ["Săcele", "Négyfalu"],
  ["Râșnov", "Barcarozsnyó"], ["Zărnești", "Zernest"], ["Rupea", "Kőhalom"], ["Predeal", "Predeál"],
  ["Ghimbav", "Vidombák"],
  // Caraș-Severin
  ["Reșița", "Resicabánya"], ["Caransebeș", "Karánsebes"], ["Oravița", "Oravicabánya"], ["Bocșa", "Boksánbánya"],
  ["Moldova Nouă", "Újmoldova"], ["Anina", "Stájerlakanina"], ["Oțelu Roșu", "Nándorhegy"],
  ["Caraș-Severin", "Krassó-Szörény"],
  // Cluj ("Cluj" singur inseamna de obicei orasul)
  ["Cluj-Napoca", "Kolozsvár"], ["Cluj", "Kolozsvár"], ["Turda", "Torda"], ["Dej", "Dés"],
  ["Câmpia Turzii", "Aranyosgyéres"], ["Gherla", "Szamosújvár"], ["Huedin", "Bánffyhunyad"],
  // Covasna
  ["Sfântu Gheorghe", "Sepsiszentgyörgy"], ["Târgu Secuiesc", "Kézdivásárhely"], ["Covasna", "Kovászna"],
  ["Baraolt", "Barót"], ["Întorsura Buzăului", "Bodzaforduló"],
  // Harghita
  ["Miercurea Ciuc", "Csíkszereda"], ["Odorheiu Secuiesc", "Székelyudvarhely"], ["Gheorgheni", "Gyergyószentmiklós"],
  ["Toplița", "Maroshévíz"], ["Cristuru Secuiesc", "Székelykeresztúr"], ["Vlăhița", "Szentegyháza"],
  ["Borsec", "Borszék"], ["Băile Tușnad", "Tusnádfürdő"], ["Harghita", "Hargita"],
  // Hunedoara ("Hunedoara" = orasul)
  ["Deva", "Déva"], ["Hunedoara", "Vajdahunyad"], ["Petroșani", "Petrozsény"], ["Lupeni", "Lupény"],
  ["Orăștie", "Szászváros"], ["Brad", "Brád"], ["Hațeg", "Hátszeg"], ["Simeria", "Piski"],
  ["Petrila", "Petrilla"], ["Uricani", "Urikány"],
  // Maramureș
  ["Baia Mare", "Nagybánya"], ["Sighetu Marmației", "Máramarossziget"], ["Borșa", "Borsa"],
  ["Vișeu de Sus", "Felsővisó"], ["Baia Sprie", "Felsőbánya"], ["Cavnic", "Kapnikbánya"],
  ["Târgu Lăpuș", "Magyarlápos"], ["Seini", "Szinérváralja"], ["Tăuții-Măgherăuș", "Miszmogyorós"],
  ["Maramureș", "Máramaros"],
  // Mureș
  ["Târgu Mureș", "Marosvásárhely"], ["Reghin", "Szászrégen"], ["Sighișoara", "Segesvár"],
  ["Târnăveni", "Dicsőszentmárton"], ["Luduș", "Marosludas"], ["Sovata", "Szováta"], ["Iernut", "Radnót"],
  ["Sângeorgiu de Pădure", "Erdőszentgyörgy"], ["Miercurea Nirajului", "Nyárádszereda"], ["Mureș", "Maros"],
  // Satu Mare
  ["Satu Mare", "Szatmárnémeti"], ["Carei", "Nagykároly"], ["Negrești-Oaș", "Avasfelsőfalu"],
  ["Tășnad", "Tasnád"], ["Ardud", "Erdőd"],
  // Sălaj
  ["Zalău", "Zilah"], ["Șimleu Silvaniei", "Szilágysomlyó"], ["Jibou", "Zsibó"], ["Cehu Silvaniei", "Szilágycseh"],
  ["Sălaj", "Szilágy"],
  // Sibiu
  ["Sibiu", "Nagyszeben"], ["Mediaș", "Medgyes"], ["Cisnădie", "Nagydisznód"], ["Avrig", "Felek"],
  ["Agnita", "Szentágota"], ["Dumbrăveni", "Erzsébetváros"], ["Copșa Mică", "Kiskapus"],
  ["Tălmaciu", "Nagytalmács"], ["Ocna Sibiului", "Vízakna"],
  // Timiș
  ["Timișoara", "Temesvár"], ["Lugoj", "Lugos"], ["Sânnicolau Mare", "Nagyszentmiklós"], ["Jimbolia", "Zsombolya"],
  ["Făget", "Facsád"], ["Buziaș", "Buziásfürdő"], ["Deta", "Detta"], ["Recaș", "Temesrékás"],
  ["Ciacova", "Csák"], ["Gătaia", "Gátalja"], ["Moșnița Nouă", "Újmosnica"], ["Giroc", "Gyiród"],
  ["Timiș", "Temes"],
  // in afara Transilvaniei: doar capitala are nume maghiar consacrat
  ["București", "Bukarest"],
];

// "Târgu Mureș" / "Targu Mures" / "TARGU-MURES" → "targu mures"
const norm = (s) =>
  String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// Longest names first, so "Cluj-Napoca" wins over "Cluj" and "Bistrița-Năsăud" over "Bistrița".
const INDEX = PLACES.map(([ro, hu]) => ({ ro, hu, key: ` ${norm(ro)} ` })).sort((a, b) => b.key.length - a.key.length);

// Cauta localitatile din lista in textele date (nume de echipe, oras, sala).
// Intoarce [{ ro, hu }] fara duplicate, in ordinea gasirii.
export function huPlaceNames(texts) {
  const found = new Map();
  for (const t of texts) {
    let s = ` ${norm(t)} `;
    for (const p of INDEX) {
      if (!s.includes(p.key)) continue;
      if (!found.has(p.ro)) found.set(p.ro, p.hu);
      s = s.split(p.key).join(" | "); // consuma potrivirea ca sa nu se mai potriveasca si "Cluj" din "Cluj-Napoca"
    }
  }
  return [...found].map(([ro, hu]) => ({ ro, hu }));
}
