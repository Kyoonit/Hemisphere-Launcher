# Herald — architecture (phase S1)

> Suite de `docs/herald/DECISIONS.md` (S0, approuvé). Ce document décrit **comment** Herald sera construit : pièces,
> données, sécurité, format du contenu v2, coffres, tests, déménagement. Maquettes des écrans :
> `design/herald-wireframes.html`. Aucun code n'est écrit en S1. Statut : **approuvé le 9 octobre 2026**.
>
> Dépôt public : aucun secret ici.

---

## 1. Vue d'ensemble

```
┌──────────────── PC du staff ────────────────┐        ┌──────── Cloudflare (gratuit, sans carte) ────────┐
│ Herald (Electron + React + Tailwind)         │ HTTPS  │ Serveur Herald (Worker)                           │
│ · éditeurs, aperçus, voyage dans le temps    │──────▶ │ · profils, sessions, rôles, permissions           │
│ · images : recadrage + compression           │ jeton  │ · publications, versions, commentaires, journal   │
│ · pack : résolution Modrinth                 │ de     │ · corbeille, modèles, présence, relances          │
│ · jeton de session chiffré (safeStorage)     │ session│ · construit, valide (zod), signe (Ed25519)        │
└──────────────────────────────────────────────┘        │ · clés des coffres, délivrées à l'heure           │
                                                        │ Base D1 (SQLite)  ·  1 tâche planifiée / minute   │
                                                        └───────────────┬───────────────────────────────────┘
                                                                        │ commit (GitHub App « Herald Publisher »)
                                                                        ▼
                                                        GitHub, dépôt public de contenu : content/v2/…
                                                                        │ API GitHub (requêtes conditionnelles)
                                                                        ▼                         + raw en secours
                                                        Launchers des joueurs (1.2+) ──clé d'un coffre, à l'heure──▶ Serveur Herald
```

Principes :
1. **Les joueurs dépendent de GitHub, pas du serveur Herald.** Seule exception : la clé d'un coffre à son ouverture,
   avec GitHub en secours.
2. **Une seule logique, partagée.** Les formats (zod) et la logique « qu'est-ce qui est visible à tel instant, dans
   tel fuseau » vivent dans `src/shared/` et sont utilisés **tels quels** par le launcher, le serveur et l'aperçu de
   Herald. L'aperçu « voyage dans le temps » appelle exactement la fonction du launcher avec un autre instant et un
   autre fuseau : il ne peut pas mentir.
3. **Tout ce qui est programmé est publié en avance.** Le serveur ne publie que quand le staff change quelque chose
   (et pour les secours des coffres). Rien ne dépend d'une tâche qui tournerait pile à l'heure.
4. **Le serveur est l'autorité.** L'application Herald n'est qu'une interface : rôles, permissions, validations et
   schémas sont revérifiés par le serveur.

## 2. Les pièces et leur emplacement

Dans **ce dépôt** (il deviendra privé, § 13), un dossier `herald/` :

```
herald/
  app/            application Electron (main, preload, renderer) — son propre electron-vite et electron-builder
  server/         Worker Cloudflare (TypeScript) + migrations D1 + wrangler.toml (sans secret)
  README.md       comment lancer, tester, publier Herald
src/shared/       formats et logique partagés (feed v2, planning, coffres) ← utilisés par launcher, app et serveur
tools/content/    commandes de secours (mises à jour pour le format v2)
```

- Une seule installation `npm` à la racine (mêmes versions de zod, React, Tailwind, Electron que le launcher).
  Nouvelles dépendances de développement : `wrangler` (outil Cloudflare). Aucune dépendance native.
- Scripts : `npm run herald:dev`, `herald:build`, `herald:dist`, `herald:server:dev` (serveur local), `herald:release`.
- Les composants d'aperçu (carte de news, page de lecture, bandeau, accueil, événements) sont **extraits** des écrans
  du launcher en composants « purs » (sans chargement de données), utilisés par le launcher **et** par Herald. Cette
  extraction ne change rien à l'affichage du launcher (vérifié par les tests et par captures avant/après).
- Versions de Herald : `1.0`, `1.1`… indépendantes du launcher ; historique dans `herald/app/changelog.json`.

## 3. Le serveur Herald (Cloudflare Workers + D1)

### 3.1 Quotas gratuits (vérifiés le 9/10/2026) et usage prévu

| Ressource (offre gratuite) | Limite | Usage prévu |
|---|---|---|
| Requêtes Worker | 100 000 / jour | Staff (synchro toutes les 15 s quand Herald est ouvert) ≈ 10 000 ; tâche/minute 1 440 ; clés de coffres : 1 par launcher en ligne et par coffre |
| Temps de calcul | 10 ms par requête (l'attente réseau ne compte pas) | Signature et petits JSON : OK. **Point à mesurer en S2** : construire + valider + signer un gros flux |
| Sous-requêtes | 50 par requête | Une publication = quelques appels GitHub |
| Taille d'une requête | 100 Mo | Images envoyées une par une |
| Tâches planifiées | 5 par compte | **1** (chaque minute) |
| Secrets | 64, 5 Ko chacun | Clé de signature, clé GitHub App, « poivre » des codes |
| D1 : stockage | 500 Mo par base, 5 Go au total | Textes : négligeable. Images en morceaux de < 2 Mo (limite par ligne) |
| D1 : lectures / écritures | 5 M / 100 000 par jour | Très large |

**Dépassement** : le service répond « limite atteinte » jusqu'à minuit UTC. **Aucune facturation possible** sans carte.
Les joueurs ne sont pas touchés (ils lisent GitHub). R2 (stockage de fichiers Cloudflare) est **exclu** : il exige un
moyen de paiement.

**Plan B si 10 ms ne suffisent pas pour publier** (mesuré en S2) : le serveur prépare tout, puis déclenche un
workflow **GitHub Actions** (gratuit et sans limite de calcul pour un dépôt public) qui valide, signe et commit. La
clé de signature irait alors dans les secrets GitHub au lieu de Cloudflare. Délai ajouté : ~30 s à 1 min.

### 3.2 Données (tables D1)

| Table | Contenu |
|---|---|
| `profiles` | id, nom, rôle, permissions ajoutées / retirées, empreinte du code, révoqué, créé par / le, vu pour la dernière fois |
| `sessions` | empreinte du jeton, profil, créée le, dernière activité, expire le |
| `publications` | id, type, statut, visibilité (rôles), programmation, données (JSON), version, verrou d'édition, supprimée le |
| `publication_versions` | chaque version enregistrée d'une publication (historique complet, jamais effacé) |
| `comments` | commentaires par publication |
| `approvals` | validations à plusieurs (pack, etc.) |
| `images`, `image_chunks` | images envoyées (WebP), en morceaux de 1,5 Mo, avec SHA-512 |
| `vaults` | id, publication, heure d'ouverture, clé AES (chiffrée par un secret du serveur), clé publiée en secours le |
| `settings` | restart (règles, exceptions), réglages publics, destination GitHub, version minimale du launcher |
| `templates` | modèles |
| `activity` | journal partagé : qui, quoi, quand, avant / après |
| `publish_state` | séquence courante, dernier commit, verrou de publication |

Suppression = `supprimée le` renseigné (**corbeille**) ; restauration = champ vidé. Rien n'est jamais effacé.

### 3.3 Points d'accès (API)

Toutes les routes, sauf `login` et `vault-key`, exigent un jeton de session ; chaque route vérifie la permission.

| Route | Rôle |
|---|---|
| `POST /login` | nom + code → jeton de session |
| `POST /logout`, `GET /me` | session, profil, permissions effectives |
| `GET /sync?since=…` | changements depuis la dernière synchro (publications, commentaires, présence, relances, journal) |
| `…/publications` | créer, modifier (avec numéro de version), changer de statut, verrouiller, supprimer, restaurer, commenter |
| `POST /images` | envoyer une image (déjà compressée par l'application) |
| `POST /publish` | publier maintenant l'état « programmé / publié » |
| `POST /emergency/…` | maintenance maintenant, serveur de nouveau en ligne, retirer une publication |
| `…/profiles` | créer (code généré, affiché une fois), révoquer, changer rôle / permissions, nouveau code |
| `GET /status` | état en ligne : ce que GitHub sert réellement |
| `GET /vault-key/:id` | **public** : la clé d'un coffre, seulement si son heure est passée ; sinon « pas encore » + heure du serveur |
| `GET /update/…` | mises à jour de Herald (§ 9), réservées aux sessions valides |

Modifications simultanées : chaque publication a un **numéro de version** ; un enregistrement basé sur une version
dépassée est refusé (« X a modifié cette publication, recharger »). Pendant l'édition, un **verrou souple** affiche
« X est en train de modifier » (renouvelé toutes les 30 s, libéré à la fermeture).

### 3.4 Publier

1. Un membre autorisé clique **Publier** (ou une urgence, ou la tâche minute pour un secours de coffre).
2. Le serveur prend le verrou de publication, rassemble toutes les publications programmées ou en ligne non
   supprimées, construit `feed.json` v2, **valide avec le schéma zod partagé**, refuse si invalide.
3. Il chiffre les nouveaux coffres, prépare les nouvelles images, incrémente la **séquence**, **signe**.
4. Il crée **un seul commit** (API Git de GitHub : fichiers + flux + signature d'un coup) avec le message
   « Herald: <action> by <nom> ».
5. Il note le commit dans le journal et libère le verrou.

Les éléments expirés depuis plus de 7 jours sortent du flux (ils restent dans l'historique de Herald).

## 4. Comptes, sessions, permissions

- **Code** : 20 caractères aléatoires (alphabet sans caractères ambigus), affiché **une fois** à la création ou au
  renouvellement. Stocké en **HMAC-SHA-256 avec un « poivre »** (secret du serveur). Un code aléatoire de cette longueur
  ne se devine pas : un hachage lent n'est pas nécessaire.
- **Connexion** : nom + code. 5 échecs → blocage 15 min du profil (et ralentissement par adresse).
- **Session** : jeton aléatoire de 256 bits, stocké dans Herald chiffré par Windows (`safeStorage`) ; le serveur ne
  garde que son empreinte. Expire après **30 jours sans utilisation**. Révoquer un profil coupe toutes ses sessions.
- **Premier compte** : le profil Owner (Liable) est créé par une commande d'installation du serveur ; ensuite tout
  se fait dans Herald.
- **Permissions** : catalogue de droits élémentaires ; chaque rôle a un ensemble par défaut ; chaque profil peut en
  gagner ou en perdre. Catalogue prévu (la répartition par rôle sera décidée plus tard) :

| Domaine | Droits |
|---|---|
| News, événements | écrire, valider (prête), publier/programmer, supprimer, restaurer |
| Bandeau, message d'accueil, screenshots | écrire, publier |
| Maintenance | programmer, **urgence** (démarrer / terminer maintenant) |
| Restart | modifier, exceptions |
| Pack de mods | proposer, **approuver** |
| Réglages publics | support, ID Discord, code staff |
| Brouillons restreints | voir les brouillons réservés |
| Administration | profils (créer, révoquer, rôles), modèles, corbeille |

  Garde-fous fixes : personne ne peut se donner à lui-même un droit qu'il n'a pas ; seul l'Owner peut modifier
  le profil Owner ; les Lodge keepers ne peuvent jamais recevoir les droits maintenance, restart, mods, réglages
  ni administration.

## 5. Format du contenu v2 (le contrat avec le launcher)

### 5.1 Pourquoi un nouveau fichier
Le launcher 1.1 lit `content/feed.json` et ignorerait les dates de programmation (il afficherait tout trop tôt). Le
format v2 est donc publié à **une autre adresse** : `content/v2/feed.json` (+ `.sig`), lue seulement par les launchers
1.2+. L'ancien `feed.json` est **figé** au passage (avec une news « mettez à jour votre launcher » ; de toute façon les
launchers se mettent à jour seuls). Le pack de mods (`index.json`, manifestes) **ne change pas de format**.

Règles pour toujours : on **ajoute** des champs, on ne retire ni ne renomme rien ; un champ ajouté plus tard porte
une `minLauncher` et Herald refuse de l'utiliser tant que ce launcher n'est pas publié.

### 5.2 Contenu (schéma 2, résumé)

| Champ | Contenu |
|---|---|
| `schema`, `sequence`, `updatedAt` | comme aujourd'hui (`schema: 2`) |
| `news[]` | champs actuels + `showFrom?`, `showUntil?`, `featuredUntil?`, `langs?` (ne montrer qu'aux joueurs de ces langues) |
| `maintenances[]` | `{ id, message, announceFrom?, start, end?, showUntil? }` — plusieurs maintenances programmables ; « démarrer maintenant » = `start` à l'instant ; « de nouveau en ligne » = `end` à l'instant |
| `restart` | `{ rules: [{ from, time, timeZone, durationMin }], exceptions: [{ date, timeZone, skip \| extra: { time, durationMin } }] }` — la règle en vigueur est celle dont `from` est la plus récente passée |
| `events[]` | champs actuels + `showFrom?`, `recurrence?: { weekly: { days, time, timeZone, durationMin, until? } }` |
| `banners[]` | `{ id, text, level: info \| important \| critical, showFrom?, showUntil? }` |
| `welcome[]` | `{ id, title?, text, showFrom?, showUntil? }` (le plus récent visible l'emporte, sinon le texte par défaut) |
| `backgrounds[]` | `{ id, name, image: { url, sha512, size }, showFrom?, showUntil?, mode: add \| replace }` (`replace` = seuls les fonds de la période s'affichent, ex. Noël) |
| `modPolicy` | conservé tel quel (plus modifiable dans Herald ; repris du flux actuel) |
| `vaults[]` | coffres : `{ id, kind, opensAt, file: { url, sha512, size }, plainSha256 }` |
| `vaultKeys` | `{ id: clé }` des coffres déjà ouverts (secours) |
| `support`, `discordAppId`, `staffCode` | inchangés |

Toutes les dates sont des instants ISO avec fuseau ; les récurrences gardent heure + fuseau (pas de glissement au
changement d'heure). Limites de taille revues (flux jusqu'à 512 Ko ; images et coffres sont des fichiers à part).

### 5.3 Logique partagée (`src/shared/schedule.ts`)
`visibleAt(feed, instant, { timeZone, lang })` renvoie exactement ce qu'un joueur voit à cet instant : news visibles
et « à la une », maintenance annoncée / en cours, prochain restart, événements (récurrences dépliées), bandeau,
message d'accueil, fonds. Utilisée par le launcher (avec l'heure réelle corrigée), par Herald (aperçu, voyage dans le
temps, frise) et par les tests (changements d'heure, fuseaux extrêmes, minuit, années bissextiles).

## 6. Coffres (toutes les publications programmées)

1. À la publication, le serveur tire une clé AES-256 aléatoire, chiffre la publication (texte + images intégrées) en
   **AES-256-GCM** et publie le fichier chiffré `content/v2/vault/<id>.bin`. Le flux signé contient son SHA-512 et
   l'empreinte SHA-256 du contenu en clair (garantit qu'une seule clé l'ouvre).
2. Le launcher télécharge le coffre **en avance** et le garde. Il programme une minuterie à `opensAt`.
3. À l'heure (corrigée, § 7), il appelle `GET /vault-key/<id>`. Le serveur compare **sa propre horloge** : trop tôt →
   « pas encore, réessaie dans N s » ; sinon → la clé. Le launcher déchiffre, vérifie l'empreinte, affiche : **à la
   seconde près**.
4. Secours : la tâche minute du serveur ajoute la clé dans `vaultKeys` du flux public ; un launcher qui n'a pas pu
   joindre le serveur l'ouvre à sa vérification suivante.
5. Hors ligne à l'heure → ouverture au retour en ligne. Aucune donnée joueur envoyée, aucun journal des appels.
6. Modifier une publication avant son heure = nouveau coffre (l'ancien n'est jamais ouvert).
7. **Tout** ce qui est programmé passe par un coffre : news, événements, bandeaux, messages d'accueil, fonds,
   annonces de maintenance, changements de restart. Ce qui est déjà visible (heure passée) est en clair dans le flux.
   Conséquence acceptée : si le serveur Herald est injoignable à l'heure, l'affichage attend le secours GitHub
   (quelques minutes).

## 7. Côté launcher (version 1.2)

| Changement | Détail |
|---|---|
| Lecture du flux v2 | via l'**API GitHub** en requête conditionnelle toutes les **2 minutes** (une réponse « rien de changé » ne compte pas dans le quota GitHub, et l'API est plus fraîche que `raw`) ; `raw` en secours. À valider en S2 |
| Correction d'horloge | écart calculé avec l'en-tête `Date` des réponses GitHub et l'heure renvoyée par le serveur Herald |
| Programmation | `visibleAt` réévalué à chaque changement de minute et aux instants exacts prévus |
| Coffres | téléchargement en avance, minuterie, clé, déchiffrement, cache local |
| Nouveaux éléments | bandeau d'annonce, message d'accueil, fonds distants (cache local, mode économie respecté, fonds intégrés en secours), maintenances annoncées |
| News | badge activé par défaut ; **son** à l'arrivée en direct (réglable) |
| Adresse du contenu | réglable à la compilation, et **redirigeable** par un champ signé (déménagement, § 13) |
| Dev | adresse et clé publique de test acceptées **uniquement** dans les builds de développement |

Les textes nouveaux du launcher vont dans `locales/en.json` et `fr.json` ; l'entrée « next » du changelog du launcher
est complétée. La release 1.2 reste faite par le propriétaire.

## 8. L'application Herald

- **Electron 44 + React 19 + Tailwind 4**, thème Hemisphere (gris foncé, vert), interface **en anglais**.
- **Processus principal** : jeton de session (`safeStorage`), appels au serveur, résolution Modrinth du pack (logique
  de `tools/content/publish.ts` déplacée dans `src/shared` / un module commun), mises à jour.
- **Interface** (maquette `design/herald-wireframes.html`, v2) : onglets en haut, comme le launcher, **7 au maximum** ;
  chaque onglet n'affiche d'abord que l'essentiel, le reste est dans « More options », des fenêtres ou des panneaux.

| Onglet | Contenu |
|---|---|
| **Home** | Ce qui est en ligne maintenant · « Needs attention » (pour tout le monde) · « Coming up » |
| **Publications** | News, événements, bandeaux, messages d'accueil ; vue **Liste** ou **Calendrier** ; corbeille via le filtre « Deleted ». Ouvrir une publication → **éditeur** (langues, texte, image, « When », « More options », commentaires dans un panneau, aperçu fidèle avec 4 moments clés) |
| **Preview** | Le **voyage dans le temps** : le launcher d'un joueur de n'importe quel fuseau, à n'importe quelle date et heure, avec la liste des changements à venir (clic = saut) |
| **Server** | État (en ligne / maintenance) + bouton d'urgence ; maintenances planifiées ; restart quotidien (changement daté, jour sauté, restart en plus) |
| **Backgrounds** | Périodes listées à gauche (Toute l'année, Halloween, Noël…), images et réglages de la période à droite, aperçu sur le vrai accueil |
| **Mod pack** | Version en ligne, proposition en cours, validations |
| **Team** | Personnes (par rôle, présence) · Activité · Corbeille ; création de profils |

  Menu du profil (en haut à droite) : mon fuseau horaire, réglages du launcher (support, Discord, code staff,
  compatibilité), déconnexion. L'écran de connexion n'est **pas** un onglet : il remplace tout tant qu'on n'est pas
  connecté. Les onglets qu'un rôle ne peut pas utiliser sont **masqués** (un Lodge keeper voit Home, Publications,
  Preview, Team).
- **Aperçu** : il reprend **les vrais composants du launcher** (barre, accueil, page News, cartes) et la même fonction
  `visibleAt` : ce qu'on voit dans Herald est ce que voit le joueur.
- **Fuseaux** : sélecteur avec recherche sur **tous les fuseaux IANA** (~445 : villes, pays, `UTC`, décalages fixes
  UTC−12 à UTC+14), décalage et heure actuelle affichés pour chacun.
- **Images** : recadrage aux formats réels du launcher, conversion WebP et compression dans l'application (canvas,
  sans dépendance), poids affiché, avertissement au-delà de 1,5 Mo.
- **Heures** : toutes les heures dans le fuseau du membre (PC ou personnalisé) ; chaque saisie montre son fuseau et
  peut en changer ; les équivalents choisis par le membre (ex. New York, Sydney, UTC) sont affichés sous chaque date.
- **Synchro** : toutes les 15 s quand la fenêtre est active (60 s en arrière-plan) ; présence mise à jour en même temps.

## 9. Distribution et mises à jour de Herald

- Installateur NSIS `Herald-Setup-x.y.exe`, distribué en privé.
- Les fichiers de version sont stockés dans un **dépôt GitHub privé** (`herald-releases`). Herald les reçoit **via le
  serveur Herald** (`/update/…`), qui les relaie avec sa propre clé GitHub et **seulement pour une session valide** :
  aucune clé dans l'application, aucun fichier public, et aucun risque de mélange avec les mises à jour du launcher.
- Même expérience que le launcher : téléchargement en arrière-plan, bouton orange « Update ».
- Publication d'une version de Herald : `npm run herald:release` (même procédé éprouvé que `tools/release.mjs`), par
  un développeur.
- À vérifier en S2 : le relais d'un installateur (~100 Mo) par le Worker (flux sans calcul, donc compatible a priori).

## 10. Accès à GitHub depuis le serveur

- Une **GitHub App « Herald Publisher »**, installée **uniquement** sur le dépôt de contenu, avec le seul droit
  « Contents : lecture/écriture » (et lecture du dépôt `herald-releases`). Sa clé privée est un secret du serveur.
- Avantages : pas d'expiration à surveiller, droits minimaux, commits signés « herald-publisher[bot] ».
- Les membres du staff n'ont **aucun** accès GitHub.

## 11. Sécurité (résumé)

| Menace | Protection |
|---|---|
| Vol d'un code de profil | Révocation immédiate dans Herald ; blocage après 5 échecs ; journal de tout |
| Membre malveillant | Permissions vérifiées par le serveur ; validation à plusieurs pour le pack ; tout est réversible (corbeille, historique) |
| Compromission du serveur Herald | Il détient la clé de signature : compte Cloudflare réservé à l'Owner et au Developer, 2FA **sur le compte Cloudflare** ; les fichiers de mods restent limités par le launcher à Modrinth / notre dépôt, vérifiés par SHA-512, dans des dossiers autorisés |
| Faux contenu / faux serveur | Signature Ed25519 vérifiée par chaque launcher ; anti-retour (séquence) |
| Lecture en avance d'un secret | Coffre AES-GCM, clé détenue par le serveur jusqu'à l'heure |
| Fuite de secrets dans le dépôt | Aucun secret dans le code ; `wrangler.toml` sans secret ; `.gitignore` (`*.pem`, `.dev.vars`) |
| Vie privée des joueurs | Aucune donnée collectée ; appels de clés non journalisés |

## 12. Tester sans toucher aux joueurs

| Élément | Test |
|---|---|
| Serveur | En local avec `wrangler dev` (Worker + D1 simulés sur le PC) pour presque tout ; puis un Worker **herald-staging** séparé sur Cloudflare |
| Clé | **Clé de test** Ed25519 distincte (jamais la vraie) |
| Contenu | Branche **`content-staging`** (ou dépôt de test) : jamais `main/content/` |
| Launcher | Build de dev pointé sur le contenu de test, avec la clé publique de test (accepté seulement en dev) |
| Logique | Tests vitest : planning, fuseaux, changements d'heure, coffres, permissions, schémas, migrations |

Le vrai flux n'est utilisé qu'à la mise en service (S12), avec l'accord du propriétaire.

## 13. Déménagement vers un GitHub officiel (idée, pas une décision)

Pour l'instant ce n'est **qu'une idée**. Herald publie dans ce dépôt. Pour garder la porte ouverte sans coût, le
launcher 1.2 contient déjà l'**adresse de contenu redirigeable par un champ signé** : un déménagement futur ne
demanderait pas de mise à jour spéciale. Si un jour c'est décidé, la marche serait :

1. Créer l'organisation GitHub gratuite (ex. `Hemisphere-SMP`), administrée par Liable et Kyonit.
2. Y créer le dépôt **public** de contenu et de releases du launcher (sans code), et le dépôt **privé**
   `herald-releases`.
3. Le launcher 1.2 lit le contenu à la nouvelle adresse et cherche ses mises à jour dans le nouveau dépôt ; il est
   publié une dernière fois depuis l'ancien dépôt pour que tous les launchers 1.1 le reçoivent.
4. Quand plus aucun launcher 1.1 n'est attendu, ce dépôt-ci passe en privé (l'ancien `feed.json` figé reste en ligne
   jusque-là).
5. Plus simple encore, après la 1.2 : publier la redirection signée vers la nouvelle adresse, sans mise à jour.

## 14. Actions manuelles du propriétaire (le moment venu, guidées pas à pas)

| Quand | Action |
|---|---|
| S2 | Kyonit crée le compte Cloudflare **à son nom, sans carte**, et active la 2FA du compte |
| S2 | Créer la GitHub App de test et la branche / le dépôt de test |
| S12 | Copier la vraie clé de signature dans les secrets du serveur de production |
| S12 | (Si choisi) créer l'organisation GitHub et ses dépôts |
| S12 | Publier le launcher 1.2 (`npm run release`) |
| S12 | Créer les profils du staff et leur transmettre les codes en privé |

## 15. Phases suivantes (rappel, ajusté)

| Phase | Contenu |
|---|---|
| S2 | Infrastructure de test : serveur local + staging, clé de test, contenu de test, publication bout à bout sans interface ; **mesures** (10 ms, API GitHub, relais des mises à jour) |
| S3 | Launcher : format v2, planning partagé, coffres, 2 min, correction d'horloge, adresse réglable (sur le contenu de test) |
| S4 | Squelette Herald : fenêtre, connexion, profils, rôles, présence, mises à jour |
| S5 → S11 | Fonctions, dans l'ordre de `DECISIONS.md` § 20 |
| S12 | Mise en service avec l'accord du propriétaire |

## 16. Réponses obtenues en S1

1. Compte Cloudflare : **au nom de Kyonit**.
2. Organisation GitHub officielle : **une idée, pas une décision** (§ 13).
3. Maquettes v2 approuvées, avec l'équipe triée par rang (Owner, Developer, Admins, Moderator, Lodge keepers) et le
   réglage « Also show the time for players in » terminé (fuseaux ajoutés / retirés, exemple en direct).
