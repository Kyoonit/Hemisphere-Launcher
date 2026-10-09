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
│ · jeton de session chiffré (safeStorage)     │ session│ · prépare la publication (file d'attente)        │
└──────────────────────────────────────────────┘        │ · clés des coffres, délivrées à l'heure           │
                                                        │ Base D1 (SQLite)  ·  1 tâche planifiée / minute   │
                                                        └───────────────┬───────────────────────────────────┘
                                                                        │ lance le workflow (GitHub App : Actions seulement)
                                                                        ▼
                                                        GitHub Actions « Herald publish » (dépôt de contenu)
                                                        · demande la publication au serveur
                                                        · valide (zod), SIGNE (Ed25519, secret GitHub), commit
                                                                        ▼
                                                        GitHub, dépôt public de contenu : content/v2/…
                                                                        │ raw à l'adresse du commit (+ raw normal en secours)
                                                                        ▼
                                                        Launchers des joueurs (1.2+) ──pouls toutes les 2 min,
                                                                                       clé d'un coffre à l'heure──▶ Serveur Herald
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
| Requêtes Worker | 100 000 / jour | Pouls : 30 par heure et par launcher ouvert (ex. 200 joueurs × 3 h = 18 000 / jour) ; staff (synchro 15 s) ≈ 10 000 ; tâche/minute 1 440 ; clés de coffres : 1 par launcher en ligne et par coffre. Au-delà : les launchers retombent sur `raw` (5 min), rien ne casse |
| Temps de calcul | 10 ms par requête (l'attente réseau ne compte pas) | Mesuré en S2 : pouls et clés 0–1 ms, lancer une publication 4–7 ms. Valider + signer + écrire dans GitHub coûtait 6–14 ms : fait par GitHub Actions (plan A) |
| Sous-requêtes | 50 par requête | Une publication = quelques appels GitHub |
| Taille d'une requête | 100 Mo | Images envoyées une par une |
| Tâches planifiées | 5 par compte | **1** (chaque minute) |
| Secrets | 64, 5 Ko chacun | Clé GitHub App, clé maîtresse des coffres, jeton du publieur, « poivre » des codes. **Pas** la clé de signature |
| D1 : stockage | 500 Mo par base, 5 Go au total | Textes : négligeable. Images en morceaux de < 2 Mo (limite par ligne) |
| D1 : lectures / écritures | 5 M / 100 000 par jour | Très large |

**Dépassement** : le service répond « limite atteinte » jusqu'à minuit UTC. **Aucune facturation possible** sans carte.
Les joueurs ne sont pas touchés (ils lisent GitHub). R2 (stockage de fichiers Cloudflare) est **exclu** : il exige un
moyen de paiement.

**Plan A (choisi en S2, après mesure)** : le serveur ne signe pas. Il met la publication en file d'attente et lance
le workflow **GitHub Actions** « Herald publish » du dépôt de contenu (gratuit et sans limite de calcul pour un dépôt
public), qui valide, signe et commit. La clé de signature est un **secret GitHub** du dépôt de contenu. Mesuré : une
publication complète prend **≈ 12 s**.

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
| `publish_state` | séquence courante, dernier commit (donné par le pouls) |
| `publish_jobs` | file d'attente des publications : en attente, en cours, faite (commit), refusée (raison), remplacée |

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
2. Le serveur rassemble toutes les publications programmées ou en ligne non supprimées, chiffre les nouveaux coffres,
   met le tout en **file d'attente** et lance le workflow « Herald publish » (GitHub App, droit Actions seulement).
3. Le workflow (code : `tools/herald/publisher.ts`, empaqueté dans le dépôt de contenu) demande au serveur la
   publication la **plus récente** (les plus anciennes en attente sont « remplacées » : on publie toujours le dernier
   état), **valide avec le schéma zod partagé**, refuse si invalide (la raison remonte dans Herald), **signe**, commit
   avec le message « Herald: publish sequence N », pousse.
4. Il renvoie le commit au serveur, qui met à jour la **séquence** et le **pouls** : les launchers le voient en ≤ 2 min.
5. Un seul workflow à la fois (`concurrency`). Si le lancement échoue, la tâche minute le relance après 90 s.

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
| `maintenances[]` | `{ id, message, announceFrom?, start, end? }` — plusieurs maintenances programmables ; « démarrer maintenant » = `start` à l'instant ; « de nouveau en ligne » = `end` à l'instant |
| `restart` | `{ rules: [{ from, time, timeZone, durationMin }], exceptions: [{ date, timeZone, skip \| extra: { time, durationMin } }] }` — la règle en vigueur est celle dont `from` est la plus récente passée |
| `events[]` | champs actuels + `showFrom?`, `recurrence?: { weekly: { days, time, timeZone, durationMin, until? } }` |
| `banners[]` | `{ id, text, level: info \| important \| critical, showFrom?, showUntil? }` |
| `welcome[]` | `{ id, title?, text, showFrom?, showUntil? }` (le plus récent visible l'emporte, sinon le texte par défaut) |
| `backgrounds[]` | `{ id, name, image: { path, sha512, size }, showFrom?, showUntil?, mode: add \| replace }` (`replace` = seuls les fonds de la période s'affichent, ex. Noël) |
| `modPolicy` | conservé tel quel (plus modifiable dans Herald ; repris du flux actuel) |
| `vaults[]` | coffres : `{ id, kind, opensAt, file: { path, sha512, size }, plainSha256 }`, fichier `v2/vaults/<id>.bin` à côté du flux ; contenu = un élément de son type, revalidé avec son schéma à l'ouverture |
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
| Lecture du flux v2 | toutes les **2 minutes**, le launcher demande le **pouls** du serveur Herald (`GET /pulse` : séquence + commit, aucune donnée joueur). S'il a changé, il lit le flux **à l'adresse de ce commit** sur `raw.githubusercontent.com` (jamais en cache : lisible 0,3 s après la publication). Serveur injoignable → lecture `raw` normale (cache GitHub ≤ 5 min). **Mesuré en S2**, voir § 17 |
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

- Une **GitHub App « Herald Publisher »**, installée **uniquement** sur le dépôt de contenu, avec les seuls droits
  **Actions : écriture** (lancer le workflow) et **Contents : lecture** (et lecture du dépôt `herald-releases`). Sa clé
  privée est un secret du serveur. **Le serveur ne peut pas écrire de contenu** : seul le workflow le peut, avec le jeton
  temporaire que GitHub lui donne à chaque exécution.
- Le workflow `herald/publisher/herald-publish.yml` et le programme empaqueté `herald-publish.mjs`
  (`npm run herald:publisher:build`) sont copiés dans `.github/` du dépôt de contenu. Secrets du dépôt de contenu :
  `SIGNING_KEY`, `PUBLISHER_TOKEN` ; variable : `HERALD_URL`.
- Avantages : pas d'expiration à surveiller, droits minimaux, chaque publication est une exécution visible dans
  l'onglet Actions du dépôt.
- Les membres du staff n'ont **aucun** accès GitHub.

## 11. Sécurité (résumé)

| Menace | Protection |
|---|---|
| Vol d'un code de profil | Révocation immédiate dans Herald ; blocage après 5 échecs ; journal de tout |
| Membre malveillant | Permissions vérifiées par le serveur ; validation à plusieurs pour le pack ; tout est réversible (corbeille, historique) |
| Compromission du serveur Herald | Il **n'a pas** la clé de signature (plan A) : il peut seulement mettre en file une publication, que le workflow **valide avec le schéma du launcher** avant de signer. Compte Cloudflare de Kyonit avec 2FA. Les fichiers de mods restent limités par le launcher à Modrinth / notre dépôt, vérifiés par SHA-512, dans des dossiers autorisés |
| Compromission du compte GitHub du propriétaire | Il détient la clé de signature (secret du dépôt de contenu) : 2FA GitHub obligatoire ; les secrets ne sont jamais lisibles, même par le propriétaire |
| Faux contenu / faux serveur | Signature Ed25519 vérifiée par chaque launcher ; anti-retour (séquence) |
| Lecture en avance d'un secret | Coffre AES-GCM, clé détenue par le serveur jusqu'à l'heure |
| Fuite de secrets dans le dépôt | Aucun secret dans le code ; `wrangler.toml` sans secret ; `.gitignore` (`*.pem`, `.dev.vars`) |
| Vie privée des joueurs | Aucune donnée collectée ; appels de clés non journalisés |

## 12. Tester sans toucher aux joueurs

| Élément | Test |
|---|---|
| Serveur | En local avec `wrangler dev` (Worker + D1 simulés sur le PC) pour presque tout ; puis un Worker **herald-staging** séparé sur Cloudflare |
| Clé | **Clé de test** Ed25519 distincte (jamais la vraie) |
| Contenu | **Dépôt de test** séparé (`herald-test-content`), avec son propre workflow, la clé de test en secret, et une **GitHub App de test** installée sur lui seul : elle ne peut pas atteindre le dépôt du launcher (choisi en S2) |
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
| S2 | Créer le dépôt de test, la GitHub App de test (Actions : écriture, Contents : lecture), les secrets et la variable du dépôt de test (fait le 9/10) |
| S12 | Copier la vraie clé de signature dans les **secrets GitHub** du dépôt de contenu de production ; créer la GitHub App de production |
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

## 17. Mesures de la phase S2 (9 octobre 2026)

| Mesure | Résultat | Conséquence |
|---|---|---|
| Ed25519, AES-GCM, D1 dans le vrai moteur de Cloudflare (`workerd`, en local) | Fonctionnent ; signature acceptée par la vérification du launcher | Pas de bibliothèque de chiffrement à ajouter |
| Coffre : clé demandée à l'heure | Refusée avant (425 + délai), donnée 68 ms après l'heure, contenu intact | Affichage à la seconde confirmé |
| `raw.githubusercontent.com` (adresse de branche) | Nouveau contenu visible entre **3 s et 270 s** selon l'âge du cache (`max-age=300`) ; un paramètre `?t=` ne contourne **pas** le cache | Seul, trop lent pour une urgence |
| API GitHub sans compte | Plus fraîche (≈ 12 s) **mais** les réponses 304 consomment le quota (60 / heure / adresse IP, partagé par une même box) | **Abandonnée** pour les launchers |
| `raw` à l'adresse d'un commit | Lisible **0,3 s** après le push, à chaque essai | Retenu : pouls + adresse de commit = urgence en ≤ 2 min |
| Temps de calcul sur Cloudflare (limite 10 ms, serveur de staging) | Pouls, clés, coffres : **0 à 1 ms**. Publication **sans** GitHub : 2 à 7 ms. Publication **avec** le commit GitHub : **6 à 14 ms** (petits dépassements tolérés, mais sans garantie) | Trop juste : **plan A** choisi par le propriétaire (GitHub Actions signe et commit) |
| Horloges | Le PC de test avançait de ~370 ms sur Cloudflare : le serveur a refusé la clé « trop tôt » puis l'a donnée au délai indiqué | Le launcher doit corriger son horloge avec celle du serveur (prévu § 7) |
| Relais des mises à jour de Herald | **Reporté en S4** (il n'y a pas encore d'application à mettre à jour) | — |
| Plan A de bout en bout (staging) | Publication complète (serveur → GitHub Actions → commit signé → pouls) : **≈ 12 s** ; contenu invalide refusé avec sa raison (« news.0.image: image host not allowed ») ; lancer une publication coûte **4 à 7 ms** au serveur | Urgence : publication 12 s + pouls ≤ 2 min |
| Relance automatique | Une publication en attente sans workflow lancé a été publiée par la tâche minute en **36 s** | Une publication demandée n'est jamais perdue |
| Droits réels de l'App de test | `actions: write`, `contents: read`, dépôt sélectionné uniquement | Le serveur ne peut pas écrire de contenu |

**Décidé (S3)** : le contenu de production vit dans un **dépôt public dédié** (`Kyoonit/hemisphere-content`, créé à la
mise en service), monté comme le dépôt de test (contenu, workflow, programme de publication). Le launcher 1.2 y lit
le flux v2 (`HERALD_CONTENT_BASE`). Le pack de mods devra y être publié aussi (S10) pour que ce dépôt-ci puisse
passer en privé : le launcher lira alors le pack à la nouvelle adresse, avec l'ancienne en secours.

## 18. Phase S3 : le launcher lit le format v2 (9 octobre 2026)

Code : `src/shared/feedV2.ts` (le format), `src/shared/schedule.ts` (`resolveFeed` : ce que voit un joueur à un instant),
`src/shared/herald.ts` (pouls, adresse de commit, horloge), `src/main/core/remote/feedV2.ts` (lecture, coffres, réveil
à l'instant exact). Le launcher montre le flux v2 dès qu'il existe, sinon le flux v1 (aucun changement pour les
joueurs tant que rien n'est publié en v2). Un build de développement peut viser l'environnement de test
(`MAIN_VITE_HERALD_URL`, `MAIN_VITE_HERALD_CONTENT_BASE`, `MAIN_VITE_HERALD_PUBLIC_KEY`) : son cache est séparé
(`content-cache/v2-test`), le contenu de test ne peut jamais rester dans le vrai.

| Mesure (staging + launcher de dev) | Résultat |
|---|---|
| Publication v2 (serveur → GitHub Actions → commit) | 9 s ; la news programmée n'apparaît pas dans le flux, seulement son coffre (303 octets, texte illisible) |
| Clé avant l'heure / à l'heure | refusée (281 s restantes) / donnée 69 ms après l'ouverture |
| **Launcher de dev** | news secrète affichée à **08:18:00,564** (heure de Paris) pour une ouverture à 08:18:00, avec badge, carte « à la une », maintenance annoncée et bandeau reçus |
| Secours (clé republiée dans le flux) | 61 s après l'ouverture |

Pas encore à l'écran (prévu dans les phases suivantes, les données sont déjà là) : bandeau, message d'accueil, fonds
distants, maintenance annoncée, exceptions de restart, son des news.

## 19. Phase S4 : le squelette de Herald (9 octobre 2026)

- **Serveur** : profils, sessions, journal (`herald/server/src/accounts.ts`, migration `0004`). Codes aléatoires de 20
  caractères, stockés en HMAC ; jetons de session stockés en SHA-256 ; 5 codes faux = blocage 15 min ; révocation et
  nouveau code coupent les sessions à l'instant. Rôles et permissions partagés (`src/shared/heraldRoles.ts`), vérifiés
  par le serveur ; répartition par rôle = **première proposition**, à décider par le propriétaire.
- **Application** (`herald/app`) : connexion, onglets selon les permissions (un Lodge keeper en voit 4), Home (présence,
  activité), Team (personnes par rang, création avec code affiché une fois, rôle, permissions ajustées, révocation,
  nouveau code, journal), Mon fuseau horaire. Les autres onglets annoncent leur phase.
- **Installateur** `Herald-Setup-x.y.z.exe` (icône « H » verte) ; **mises à jour** relayées par le serveur depuis le
  dépôt privé `herald-releases`, réservées aux sessions valides, bouton orange comme le launcher.
- Testé : 21 vérifications de comptes de bout en bout ; l'application pilotée comme un utilisateur (connexion,
  session retrouvée après redémarrage, création d'un profil, éditeur de profil, vue Lodge keeper).

## 20. Phase S5 : news, bandeau, message d'accueil (9 octobre 2026)

- **Modèle partagé** (`src/shared/heraldPublications.ts`) : textes par langue (anglais obligatoire, autres langues
  ajoutées à la main avec leur statut « à faire / terminé » ; seules les terminées partent aux joueurs), image,
  lien, « à la une » pendant N jours, catégorie, importance du bandeau, « Quand » (dès la publication ou à une heure,
  dans un fuseau au choix ; jusqu'à quand), visibilité du brouillon. `feedItem` en fait l'élément du flux v2.
- **Serveur** (`publications.ts`, migration `0005`) : statuts Brouillon → En relecture → Prête (verrouillée) →
  Publiée, chaque version gardée pour toujours, enregistrement refusé s'il part d'une version dépassée, verrou souple
  « X est en train de modifier », commentaires, corbeille, journal. Nouvelle permission `publications.approve`
  (marquer « Prête ») : un Lodge keeper écrit et envoie en relecture, le staff valide et publie (proposition).
- **Images** : réduites et converties en WebP dans Herald (≤ 1,5 Mo), stockées dans D1. Une news visible a son image
  en clair (`v2/images/<sha256>.webp`) ; une news programmée a son image **chiffrée avec la clé de son coffre**
  (`v2/vaults/<id>-img.bin`, listée dans le coffre). Le launcher la télécharge en avance, la vérifie (SHA-512), la
  déchiffre à l'heure et la garde sur le PC (`hemi-content://`).
- **Publication** : l'état complet est republié ; un coffre est **réutilisé** tant que son élément, son contenu et son
  heure ne changent pas (aucun nouveau fichier). Le publieur récupère les fichiers sur le serveur et ne renvoie pas
  ceux déjà présents dans le dépôt.
- **Launcher** : bandeau d'annonce et message d'accueil sur l'accueil, images des news Herald. Les cartes de news, la
  page de lecture, le bandeau et l'accueil sont des composants partagés (`src/renderer/src/components/feed/`) :
  Herald les affiche tels quels dans ses aperçus.
- **Herald** : onglet Publications (liste, filtres, corbeille, éditeur avec aperçu aux moments clés, commentaires,
  historique, état de la publication en cours), onglet **Preview** (voyage dans le temps : n'importe quelle date,
  fuseau, langue, taille de fenêtre, liste des changements à venir), Home (« Needs attention », « Coming up »).

| Test | Résultat |
|---|---|
| Bout en bout local (`herald:e2e-publications`) | 33/33 : droits, versions, image, publication, programmation + image chiffrée ouverte à l'heure, réutilisation du coffre, retrait, corbeille, commentaires, historique, brouillon restreint, journal |
| Staging + vrai launcher de dev | News avec image, bandeau, message d'accueil affichés ; news programmée ouverte à son heure avec son image déchiffrée |
| Herald à l'écran | Création, éditeur, image (49 Ko WebP), Ready, publication, voyage dans le temps (message programmé visible au bon moment) |

Pas encore : événements dans l'aperçu (S7), maintenance (S6), fonds d'écran (S8), modèles et relances avancées (S11).

Retours du propriétaire (S5) : un seul bandeau s'affiche à la fois (le plus important, puis le plus récent) et
l'éditeur prévient quand un autre bandeau ou message d'accueil passe devant ; le message d'accueil peut remplacer tout
le titre, avec une ligne verte facultative (`accent` : `{player}` = nom du joueur, `{server}` = Hemisphere SMP) ; Preview avance ou recule d'une
heure ou d'un jour ; l'installateur de Herald a sa propre fenêtre d'installation (même principe que le launcher,
titre « HERALD », fond et couleurs différents).

## 21. Phase S6 : maintenance, restart, urgence (9 octobre 2026)

- **Onglet Server** de Herald :
  - état ouvert ou en maintenance, avec les deux boutons d'urgence « Start a maintenance now » (message, fin prévue facultative) et « The server is back online » ;
  - maintenances programmées : début, fin facultative, annonce aux joueurs à partir d'une date ;
  - restart quotidien : heure dans un fuseau, changement à partir d'une date, jour sans restart, restart en plus, et les prochains restarts calculés comme le launcher ;
  - retrait rapide d'une publication ;
  - historique.
- **Serveur** (`serverState.ts`, migration `0006`) : ces parties du flux sont dans `settings` et chaque version est gardée pour toujours. Les changements sont publiés aussitôt, sans relecture, car ce sont des outils du staff. Un changement préparé sur un état dépassé est refusé ; une urgence s'applique toujours au dernier état. Droits : urgence `maintenance.emergency` (Moderator inclus), programmation `maintenance.write`, restart `restart.write`.
- **Coffres** : une maintenance annoncée plus tard et un changement de restart daté sont publiés en avance, verrouillés jusqu'à leur heure.
- **Launcher** :
  - la maintenance annoncée s'affiche sous PLAY (« Maintenance prévue samedi 18:00 → 20:00 », à l'heure du joueur) ;
  - le calcul du restart (`src/shared/restart.ts`) prend les exceptions en compte : jour sauté, restart en plus (« Restart exceptionnel à … ») ;
  - les alertes de restart et la vérification en direct suivent le même calcul.
- **Aperçu Herald** : il montre la maintenance (en cours ou annoncée) et le panneau serveur avec le restart, au moment choisi. Le voyage dans le temps liste les débuts et fins de maintenance et les changements de restart.

| Test | Résultat |
|---|---|
| Bout en bout local (`herald:e2e-server`) | 19/19 : urgence (début, refus d'une deuxième, retour en ligne), maintenance annoncée puis en cours puis finie, maintenance verrouillée jusqu'à son annonce, changement de restart verrouillé, jour sans restart, droits (Lodge keeper, Moderator, Admin), état dépassé refusé, historique, journal |
| Staging + vrai launcher de dev | Maintenance annoncée affichée sous PLAY ; « Restart in 23m · Extra restart at 10:57 AM your time » |
| Herald à l'écran | Onglet Server (exceptions, changement à venir, prochains restarts), urgence par les boutons, aperçu avec maintenance et panneau serveur |

Retours du propriétaire (S6) :
- **Messages de maintenance en anglais seulement**, aucune traduction : les langues ne servent qu'aux publications.
- **Modèles de messages** comme sur la maquette (« Quick maintenance », « Crash »…), ou « Write my own… ». Le staff les modifie pour tout le monde (`templates.write`, réglage `templates.maintenance`, sans publication).
- **Une barre sous la barre de titre suit chaque changement en direct**, sur tous les onglets, toujours visible (rien à ouvrir, rien de caché), à la place de l'historique :
  - ce qu'était le changement (« Maintenance started », « Published “…” », « Daily restart changed »…), qui l'a fait et quand ; tout ce qui part vers les launchers passe par elle ;
  - le trajet : serveur Herald → GitHub Actions (vérifie, signe) → GitHub (commit) → launchers ;
  - le temps passé à chaque étape, et le compte à rebours jusqu'à ce que tous les launchers ouverts l'aient (2 min au plus) ;
  - l'estimation du temps total, à partir des derniers changements ;
  - un changement fait par un autre membre du staff y apparaît en quelques secondes ;
  - la migration `0007` note l'heure où GitHub Actions prend le travail.
- **Mesuré sur staging** : 8 s avant que GitHub démarre, 1 s pour vérifier et signer, puis jusqu'à 2 min pour les launchers.

## 22. Phase S7 : événements et calendrier (9 octobre 2026)

- **Événements** : quatrième type de publication (identifiants `e-…`, droit `events.write`, donc aussi les Lodge keepers). Champs :
  - titre, lieu dans le jeu, description et bouton de lien, traduisibles comme les news ;
  - début dans un fuseau et durée ;
  - une seule fois, ou **chaque semaine** les jours choisis, jusqu'à une date ou jusqu'au retrait ;
  - « Announced » : dès la publication, ou à partir d'une date (envoyé en avance dans un coffre, illisible avant). Un événement n'est jamais caché pendant qu'il a lieu.
- **Flux** : `feedItem` produit l'`EventV2` existant. Un événement hebdomadaire garde l'heure murale de son fuseau (`recurrence.weekly`), il ne bouge pas au changement d'heure. Les événements finis depuis plus de 7 jours quittent le flux ; 50 au plus, les plus proches d'abord.
- **Launcher** : rien ne change pour les joueurs. La liste des événements (page News) et la ligne « prochain événement » (panneau serveur de l'accueil) sont devenues des composants partagés (`components/feed/EventCards.tsx`), dessinés aussi par l'aperçu de Herald. Le début et la fin d'un événement comptent maintenant comme des changements de la vue (`nextChangeAt`).
- **Herald** :
  - éditeur : bloc « When » propre aux événements (jours de la semaine, dernière date, annonce), avec les vérifications (premier jour hors des jours choisis, déjà fini, annoncé après son début) ;
  - aperçu aux moments clés : annonce, la veille, pendant (« Live now »), après ;
  - **Publications → Calendar** : deux semaines dans le fuseau du membre, une ligne par type, plus les maintenances (annonce hachurée) et les restarts ; pointillés = pas encore publié ; clic = ouvrir ; avertissement pour chaque événement pendant une maintenance ou un restart ;
  - accueil « Coming up » : les publications qui apparaissent et les événements qui commencent dans les 14 jours ; voyage dans le temps : annonce, début et fin de chaque date.

| Test | Résultat |
|---|---|
| Tests unitaires (`tests/herald-events.test.ts`) | Format du flux accepté par le launcher, traductions, annonce, hebdomadaire à 20:00 Paris avant et après le 25 octobre (18:00 puis 19:00 UTC), vérifications, ordre et nettoyage du flux, restarts sur deux semaines |
| Staging (contenu de test) | Un événement hebdomadaire en clair dans le flux ; un événement annoncé 10 min plus tard dans un coffre `event`, son texte absent du flux en clair ; publication complète en 10 s |
| Herald à l'écran | Calendrier avec l'avertissement « Party pendant le restart de 17:00 », éditeur et aperçu (liste des événements du launcher, Live now), accueil, voyage dans le temps |

## 23. Phase S8 : fonds d'écran de l'accueil (9 octobre 2026)

- **Par période**, comme sur la maquette :
  - « All year » : les images de l'équipe s'ajoutent aux 4 images intégrées au launcher, qui restent le secours (pas d'internet, image pas encore téléchargée) ;
  - des périodes datées (Halloween, Noël…) : premier et dernier jour, de minuit à minuit dans un fuseau ; « Only these pictures » (seulement celles-là) ou « Add them to the all-year ones » ;
  - chaque image porte le lieu affiché en bas à gauche de l'accueil, comme les images intégrées.
- **Herald, onglet Backgrounds** : périodes à gauche, à droite la période choisie (nom, dates, mode, images, lieu de chaque image), ajout de plusieurs images à la fois (redimensionnées à 2560 × 1440 au plus et converties en WebP dans l'application, 1,5 Mo au plus), aperçu sur le vrai accueil avec l'image cliquée. Les changements sont préparés puis publiés en une fois (« Publish the changes »), comme l'onglet Server ; chaque version est gardée et le journal dit quelles périodes ont changé. Une ligne « Backgrounds » s'ajoute au calendrier.
- **Serveur** : réglage `backgrounds`, droit `backgrounds.write` ; une période à venir part dans des coffres, images chiffrées comprises (personne ne voit les images de Noël en avance).
- **Launcher (joueurs)** : images téléchargées une seule fois, vérifiées (SHA-512) et gardées ; sur une connexion limitée (option « économie de données »), elles attendent une connexion normale. Le changement de période se fait à la seconde près (début et fin comptent comme des changements de la vue). La règle de choix des images est partagée avec l'aperçu de Herald. Entrée « next » ajoutée aux nouveautés du launcher.
- **Publisher** : il accepte les images de fond comme fichiers à écrire à côté du flux ; copié dans le dépôt de test (`1c8515f`).

| Test | Résultat |
|---|---|
| Tests unitaires (`tests/herald-backgrounds.test.ts`) | Fenêtre d'une période au changement d'heure (20 oct. 00:00 Paris = 22:00 UTC, 3 nov. 00:00 = 23:00 UTC), éléments du flux, « only these » pendant Halloween et « All year » le reste du temps, périodes finies retirées, vérifications, fichiers listés par le publisher |
| Staging (contenu de test) | Image « All year » publiée en clair à côté du flux, SHA-512 conforme ; période de demain dans un coffre `background` avec son image chiffrée, légende absente du flux en clair |
| Herald à l'écran | Onglet Backgrounds (All year avec les images intégrées, période Halloween), aperçu du vrai accueil avec l'image et sa légende |

## 24. Phase S9 : réglages du launcher et code staff (9 octobre 2026)

- **Menu du profil → Launcher settings** (droits `settings.public` et `settings.staffCode`) :
  - **quel launcher ont les joueurs** : dernière version publiée sur GitHub ; tant qu'elle est antérieure à 1.2.0, Herald le dit clairement (ce qui est publié ici n'atteint pas encore les joueurs) ;
  - **support** : lien Discord uniquement (règle du flux), texte « comment demander de l'aide » ;
  - **Discord** : ID de l'application, avec un bouton « Check » qui demande son nom à Discord ;
  - **code staff** de l'onglet Developer du launcher : « Make a new code » ou « Back to the built-in code ».
- **Code staff** : fabriqué dans le processus principal de Herald, même forme et mêmes réglages scrypt que `npm run staff-code`. **Seule son empreinte part au serveur** ; le code est affiché une seule fois et n'est gardé nulle part. (Le calcul scrypt dépasserait aussi le budget CPU du serveur gratuit.) Les PC déjà déverrouillés le restent.
- **Serveur** : réglage `public` (versions gardées, journal sans jamais le code), publié aussitôt ; ces valeurs remplacent celles de la base du flux. Valeurs de départ = celles du launcher actuel (ID Discord).

| Test | Résultat |
|---|---|
| Tests unitaires (`tests/herald-public.test.ts`) | Format du code, code accepté par la même vérification que le launcher (y compris tapé en minuscules), liens Discord seulement, réglages dans le flux et la vue du launcher |
| Staging | Lien non Discord refusé, version dépassée refusée, support et ID Discord publiés dans le flux de test ; « Make a new code » dans Herald : code vérifié contre l'empreinte du serveur (sans l'afficher), puis retour au code intégré |

## 25. Phase S10 : pack de mods (9 octobre 2026)

- **Onglet Mod pack** (droits `pack.propose`, `pack.approve`) : le pack en ligne, le changement en attente, les derniers
  changements. Le format du pack ne change pas (`src/shared/manifest.ts`).
- **Éditeur** (dans Herald, sur le PC du staff) : chaque mod fixé sur une version Modrinth (recherche, liste des
  versions, « Check for updates », « Update all ») ; bibliothèques nécessaires ajoutées toutes seules ; conflits et
  versions faites pour un autre Minecraft **bloquants** ; fichiers de config (≤ 1 Mo, `default` / `enforced`) ;
  « What's new » EN/FR ; numéro proposé selon la règle du pack (patch / mineure / majeure). Logique Modrinth :
  `src/shared/heraldPack.ts`. (`npm run content:publish` garde sa propre copie : c'est la commande de secours.)
- **Nouveau Minecraft** (l'usage principal : un pack prêt dans la bonne version du jeu) : l'onglet compare le pack aux
  versions publiées par Mojang. Dès qu'une version plus récente sort, une carte montre si Fabric est prêt et quels
  mods ont déjà une version pour elle (prêt / seulement une bêta / pas encore), avec « Check again » ; l'accueil de
  Herald le signale aussi (« Needs attention »). « Prepare the pack for <version> » ouvre l'éditeur avec chaque mod
  passé à sa dernière version pour ce Minecraft, le loader Fabric recommandé, la liste des mods pas encore prêts
  (attendre, ou les laisser de côté), une version majeure (2.0.0) et une ligne « What's new ». Minecraft et Fabric se
  choisissent dans les listes officielles de Mojang et de Fabric. On publie quand le serveur tourne sur la nouvelle
  version : le launcher des joueurs affiche alors « Mettre à jour vers <version> » (l'ancienne reste jouable en solo).
  Mesure réelle (9/10/2026) sur la snapshot 26.4 : Fabric prêt, 3 mods sur 24 seulement.
- **Validation à deux** : un membre propose, **un autre** membre ayant `pack.approve` approuve, jamais celui qui a
  proposé. Par défaut, les Admins proposent ; l'Owner et le Developer approuvent. Une seule validation suffit. Un
  seul changement à la fois. Table `pack_proposals` (migration 0008), journal : proposé, approuvé, refusé, retiré.
- **Publication** : chaque publication emporte le changement approuvé jusqu'à ce qu'il soit en ligne. GitHub
  Actions **revérifie chaque mod auprès de Modrinth** (projet, version, adresse, SHA-512, taille), refuse si le pack
  en ligne a changé depuis le changement ou si la version existe déjà, puis écrit `clients/<v>/manifest.json`, ses
  fichiers et `index.json` signé. Sa séquence n'est jamais plus basse que celle du pack remplacé. Un refus dû au
  pack le sort des publications suivantes : les news continuent d'être publiées. Un approbateur peut alors réessayer
  ou refuser.
- **Déménagement** : le launcher lit le pack d'abord dans le dépôt de contenu de Herald, puis dans `content/` de ce
  dépôt (secours, tant que `Kyoonit/hemisphere-content` n'existe pas). **À la mise en service (S12)**, copier
  `content/index.json`, `index.json.sig` et `content/clients/` dans le dépôt de contenu **avant** le premier pack
  publié par Herald : les versions précédentes et la séquence suivent.
- **Launcher de test** : un build pointé sur l'environnement de test a désormais son propre dossier de données
  (`Hemisphere Launcher-herald-test`). Un pack de test ne peut jamais s'installer dans le vrai jeu, et ce launcher
  tourne à côté du launcher installé.

| Test | Résultat |
|---|---|
| Tests unitaires (`tests/herald-pack.test.ts`) | Bibliothèques ajoutées, conflits, mauvaise version de Minecraft, bibliothèques inutiles ; changements et numéro proposé ; contrôle Modrinth du publieur ; index signé accepté, séquence jamais plus basse, rien de republié deux fois, refus si le pack a changé ou si la version existe, fichiers de config exacts ; adresses autorisées |
| Staging (dépôt de test seulement) | Un approbateur ne peut pas approuver sa propre proposition, un Admin ne peut pas approuver, un deuxième changement est refusé tant qu'un autre attend ; approuvé par un autre membre → pack de test 1.0.3 publié par GitHub Actions (mods revérifiés sur Modrinth), index signé avec la clé de test, octets identiques à ceux approuvés, fichier de config présent ; changement fait sur l'ancien pack → refusé, et la publication suivante passe sans lui |
| Vrai cas trouvé | La dernière version de Zoomify demande une bibliothèque qui n'existe pas pour Minecraft 26.3 : Herald le signale comme bloquant |
| Launcher de test | Pack de test 1.0.3 lu et vérifié (clé de test) dans son propre dossier ; le cache du vrai launcher est resté sur 1.0.2 |
| Launcher normal | Le dépôt `hemisphere-content` n'existe pas encore (404) : le pack est lu à l'ancienne adresse, sans erreur |
| Herald | Onglet affiché, éditeur relu sur Modrinth (24 mods, dépendances, avertissement bêta), recherche avec icônes |
