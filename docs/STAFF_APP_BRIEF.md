# Outil de publication du staff — document de cadrage

> **À lire en premier dans la nouvelle conversation.** Ce document contient tout ce qu'il faut savoir pour démarrer
> l'outil de publication du staff d'Hemisphere SMP (la « phase 27 » de la roadmap du launcher), **sans** relire
> l'historique du launcher. Rédigé le 9 octobre 2026, launcher en version **1.1**.
>
> **Ce dépôt est public** : ce fichier ne contient aucun secret (clé de signature, code staff, jetons). Il dit
> seulement où ils se trouvent.

---

## 0. Comment démarrer la nouvelle conversation

Message conseillé pour ouvrir la conversation :

> Lis `docs/STAFF_APP_BRIEF.md` en entier. On démarre l'outil de publication du staff par la **phase S0 (idées
> uniquement, aucun code)**. Propose-moi tes idées et tes questions comme décrit dans le document, puis attends mon
> « APPROVED » avant toute autre phase.

Règles de travail pour **toute** cette nouvelle conversation :

1. **Réponses en français** (le propriétaire du projet écrit en français ; le code, les commentaires et la doc
   technique restent en anglais, comme dans le reste du dépôt).
2. **Travail par phases, avec prudence** : chaque phase se termine par un récapitulatif, puis **on s'arrête** et on
   attend un message explicite du propriétaire (« APPROVED », « NEXT », « CONTINUE », « GO AHEAD »…) avant la phase
   suivante. Pas d'anticipation sur la phase suivante.
3. **La phase S0 ne produit que des idées** : aucun fichier de code, aucune dépendance installée, aucune modification
   du contenu publié.
4. **Rien n'est publié pour de vrai sans accord explicite** : tant que l'outil n'est pas validé, tout se teste sur
   un contenu de test séparé (voir § 6.4), **jamais** sur le flux réel des joueurs.
5. Commit + push sur `main` autorisés à la fin d'une phase validée (le propriétaire l'a autorisé pour ce dépôt).

---

## 1. Le contexte en une page

- **Hemisphere SMP** : serveur Minecraft survie (communauté depuis 2015), adresse `play.hemispheresurvival.club`,
  site `https://hemispheresurvival.club/`, Discord du serveur. Minecraft **26.3**, mods **Fabric**.
- **Hemisphere Launcher** (ce dépôt, `https://github.com/Kyoonit/Hemisphere-Launcher`) : le launcher officiel des
  joueurs. Electron 44.7 + TypeScript + React 19 + Tailwind 4 (thème du site : gray-900/800, green-400/600, coins 8 px),
  i18next (anglais + français), zod pour valider toutes les données, vitest pour les tests.
  - Il installe Minecraft + Fabric + Java, synchronise les mods d'Hemisphere, affiche les news, les événements,
    le statut du serveur, le compte à rebours du restart quotidien, etc.
  - Version actuelle : **1.1** (publiée le 9 octobre 2026). Les mises à jour du launcher passent par les releases
    GitHub et s'installent toutes seules chez les joueurs (bouton orange « Mettre à jour »).
  - Connexion Microsoft des joueurs : **en attente de l'approbation Mojang** (API). En attendant, seul le staff
    peut entrer, avec un compte de test hors ligne (Ctrl+Maj+S sur l'écran de connexion + le code staff).
- **Le contenu du launcher** (news, maintenance, événements, liste des mods…) n'est **pas** dans le code du
  launcher : il est publié à part, **signé**, dans le dossier `content/` de ce même dépôt. Les launchers le
  téléchargent depuis GitHub, vérifient la signature, et l'affichent. C'est ce contenu que l'outil du staff doit
  permettre de publier **sans ligne de commande**.

### Ce qui se fait aujourd'hui « à la main » (et que l'outil doit remplacer)

| Tâche | Aujourd'hui | Fichier source | Commande |
|---|---|---|---|
| News, maintenance, heure du restart, événements, politique des mods, lien support Discord, ID Discord, code staff | éditer un JSON | `content-src/feed.json` | `npm run content:feed` puis commit + push de `content/` |
| Version du pack (Hemisphere Client) : version Minecraft, Fabric, liste des mods, fichiers de config, « What's new » du pack | éditer un JSON | `content-src/client.json` (+ `content-src/files/…`) | `npm run content:publish` (`-- --dry-run` pour prévisualiser) puis commit + push de `content/` et `content-src/` |
| Images des news | déposer un fichier | `content-src/news-images/<fichier>` | (copié par `content:feed`) |
| Changer le code staff | outil | — | `npm run staff-code` → coller `"staffCode"` dans `content-src/feed.json` → `content:feed` |

Guide complet de l'existant : **`docs/CONTENT.md`** (à lire en entier avant la phase S2).

---

## 2. Comment fonctionne le contenu signé (indispensable)

### 2.1 Chaîne de confiance

```
content-src/feed.json  ──npm run content:feed──▶  content/feed.json + content/feed.json.sig
content-src/client.json ─npm run content:publish─▶ content/index.json + index.json.sig
                                                   content/clients/<version>/manifest.json
                    git commit + push sur main
                                  ▼
https://raw.githubusercontent.com/Kyoonit/Hemisphere-Launcher/main/content/   (CONTENT_BASE)
                                  ▼
Launchers des joueurs : vérifient la signature Ed25519 avec la clé publique intégrée, valident avec zod, utilisent.
```

- **Signature** : Ed25519. Clé **privée** : `C:\Users\<propriétaire>\.hemisphere\content-signing-key.pem`, sur le PC du
  propriétaire uniquement (variable `HEMI_SIGNING_KEY` pour un autre chemin). Clé **publique** intégrée au launcher :
  `src/main/core/remote/publicKey.ts`. **Ne jamais commiter la clé privée** (`.gitignore` bloque `*.pem`).
  Qui possède la clé privée peut faire installer n'importe quel fichier chez tous les joueurs.
- **Changer de clé** = une mise à jour du launcher (nouvelle clé publique) : à éviter, et à planifier si l'outil
  doit signer ailleurs (voir § 6).
- **Anti-retour en arrière** : `sequence` augmente à chaque publication ; un launcher refuse un contenu plus ancien
  que celui qu'il a déjà validé. Le dernier contenu valide est gardé en cache (fonctionne hors ligne).
- **Cache GitHub** : les fichiers « raw » sont mis en cache environ **5 minutes** ; les launchers revérifient le flux
  toutes les **10 minutes** (requêtes conditionnelles ETag : rien n'est retéléchargé si rien n'a changé) et le pack
  toutes les **30 minutes** (préparation en arrière-plan) et à chaque JOUER.
- **Développement** : un build de dev du launcher peut lire un autre dossier de contenu grâce à
  `MAIN_VITE_CONTENT_BASE` (fichier `.env`) — c'est la base d'un **contenu de test** (§ 6.4).

### 2.2 Les formats exacts (schémas zod, source de vérité)

Les schémas sont dans **`src/shared/`** et sont **partagés** entre le launcher et les outils : l'outil du staff doit
les **réutiliser tels quels** (jamais de copie), pour que tout ce qu'il publie soit forcément accepté par les launchers.

**Flux** — `src/shared/feed.ts`, `FeedSchema` (schema 1) :

| Champ | Contenu |
|---|---|
| `schema` | `1` |
| `sequence` | entier qui augmente à chaque publication (calculé par l'outil de publication) |
| `updatedAt` | date ISO |
| `maintenance` | `{ active, message: {en, fr…}, until? (ISO avec fuseau) }` |
| `restart` | `{ time: "HH:MM", timeZone: "Europe/Paris", durationMin: 1..120 }` ou `null` (restart quotidien, affiché dans l'heure de chaque joueur) |
| `news[]` (max 100) | `{ id: [a-z0-9-], date: YYYY-MM-DD, category: update\|event\|server\|community, title, body (texte, paragraphes séparés par une ligne vide), image? (content/ ou hemispheresurvival.club, https), link? {label, url https}, featured? }` |
| `modPolicy?` | `{ rules[] (max 500): { project: id Modrinth, name, verdict: blocked\|askStaff, reason } }` — mods interdits ou « demander au staff » dans la recherche de mods du launcher |
| `support?` | `{ url: lien Discord (ticket), howTo? }` — où vont les signalements de problèmes |
| `events[]?` (max 50) | `src/shared/events.ts` `EventSchema` : `{ id, title, body?, start (ISO + fuseau), end?, where?, link? }` ; sans `end` = 2 h ; rappel 15 min avant |
| `discordAppId?` | ID de l'application Discord (statut « Joue sur Hemisphere SMP ») — actuellement `1557889951620931644` |
| `staffCode?` | `{ salt, hash }` empreinte scrypt d'un nouveau code staff (jamais le code lui-même) |

Textes localisés : `LocalizedSchema` = `{ en: obligatoire, fr: …, autres langues… }`.

**Pack (Hemisphere Client)** — `src/shared/manifest.ts` :

- `ContentIndexSchema` (`content/index.json`, signé) : `{ schema, sequence, updatedAt, latest: ClientRef, previous: ClientRef|null, previousCanJoin }`.
  `ClientRef` = `{ clientVersion (x.y.z), minecraft, manifest: "clients/x.y.z/manifest.json", sha512, size }`.
- `ClientManifestSchema` (`content/clients/<v>/manifest.json`, intégrité par le sha512 de l'index) :
  `{ schema, clientVersion, createdAt, minecraft, loader: {type: "fabric", version}, mods[], files[], changelog?[] }`.
  - `mods[]` (max 300) : `{ id, name, description, category: performance|voice|visual|comfort|library, recommended, defaultEnabled, requires[], version, file: {path "mods/*.jar", url, sha512, size}, source?: {modrinth: {projectId, versionId}} }`.
  - `files[]` (max 1000) : fichiers de config / packs : `{ path, url, sha512, size, policy: enforced|default }`.
  - Sécurité intégrée : chemins limités à `mods/`, `config/`, `resourcepacks/`, `shaderpacks/` (pas de `..`, pas de
    chemin absolu, pas de nom réservé Windows) ; téléchargements uniquement depuis `cdn.modrinth.com` ou `content/`
    de ce dépôt, en HTTPS, vérifiés par SHA-512.
- **Source éditée par le staff** : `content-src/client.json` (format plus simple que le manifeste) :
  `{ clientVersion, minecraft, fabricLoader, previousCanJoin, changelog, mods: [{ modrinth: "<slug>", category, recommended, default, description: {en, fr}, version?, allowBeta? }], files: [{ path, policy }] }`.
  `tools/content/publish.ts` résout chaque mod sur Modrinth (dernière **release** compatible, ou la version
  épinglée), ajoute les dépendances requises, calcule les hash, écrit et signe.
  Règle de version du pack : `1.0.0 → 1.0.1` mises à jour de mods, `1.1.0` nouveaux mods, `2.0.0` nouvelle version
  de Minecraft ; une version publiée n'est jamais réécrite.

### 2.3 Ce qui est en ligne aujourd'hui (état au 9 octobre 2026)

- **Flux** : séquence **6** ; 3 news (`welcome-launcher`, `client-1-0-1`, `daily-restart`) ; maintenance désactivée ;
  restart **17:00 Europe/Paris, 5 min** ; `modPolicy` : 2 règles « interdit » (X to Xray, Xray – orevision ; Litematica
  Printer, auto-clickers et Freecam sont autorisés, donc sans règle) ; `discordAppId` publié ; pas d'événements publiés
  (ceux visibles en dev sont fictifs, menu Développeur).
- **Pack** : Hemisphere Client **1.0.2**, Minecraft **26.3**, Fabric Loader **0.19.5**, 24 entrées de mods :
  fabric-api, sodium, lithium, ferrite-core, immediatelyfast, entityculling, moreculling, cloth-config, dynamic-fps,
  simple-voice-chat, audioplayer, iris, continuity, entitytexturefeatures, sodium-extra, reeses-sodium-options,
  locator-heads, zoomify, yacl, fabric-language-kotlin, modmenu, placeholder-api, appleskin, chat-heads.
  (Mods exclus par décision : Jade, Mouse Tweaks, Shulker Box Tooltip, BetterF3, Controlling, Xaero's, MiniHUD,
  Tweakeroo, Litematica. Idée en suspens : ajouter **ModernFix**, décision staff.)

---

## 3. Le nom de l'application

Propositions (toutes cohérentes avec l'univers Minecraft et le rôle « publier vers tous les joueurs ») :

| Nom | Idée | Avis |
|---|---|---|
| **Hemisphere Beacon** | La balise (beacon) de Minecraft : un faisceau visible de tout le monde, comme une publication | **Recommandé** : court, parlant, évoque la diffusion |
| Hemisphere Quill | Le livre et la plume : on écrit les news | Joli, mais centré sur l'écriture, moins sur les mods |
| Hemisphere Atelier | L'atelier où le staff prépare le contenu | Clair en français, moins « Minecraft » |
| Hemisphere Lectern | Le pupitre où on pose un livre pour tous | Original, peu connu des non-joueurs |
| Hemisphere Studio | Générique | Sûr mais fade |

À éviter : « Forge » (confusion avec Minecraft Forge), « Console » (confusion avec la console du serveur),
« Panel » (confusion avec le panel d'hébergement).

---

## 4. Idées de fonctionnalités (base de discussion pour la phase S0)

> Tout ceci est une **liste d'idées**, pas un engagement. La phase S0 sert à trier : garder, reporter, abandonner.

### 4.1 Écrire et publier (le cœur)
- **News** : éditeur EN/FR côte à côte, catégorie, date, image (glisser-déposer → `content-src/news-images/`),
  bouton/lien, « à la une ». **Aperçu identique au launcher** (mêmes composants React que l'écran News).
- **Maintenance** : un interrupteur, un message EN/FR, une heure de fin (dans le fuseau du staff, convertie).
  Aperçu de la bannière telle que les joueurs la voient.
- **Restart quotidien** : heure, fuseau, durée ; aperçu « dans l'heure des joueurs » (Paris, New York…).
- **Événements** : calendrier, début/fin avec fuseau, lieu, lien ; aperçu de la carte de l'accueil et du calendrier.
- **Politique des mods** : rechercher un mod Modrinth, le marquer « interdit » ou « demander au staff » avec une raison.
- **Lien du support** (ticket Discord), **ID Discord**, **code staff** (générer un nouveau code ; l'empreinte va
  dans le flux, le code s'affiche une seule fois).
- **Vérification avant envoi** : les mêmes schémas zod que le launcher, messages clairs (« l'image doit venir du
  site ou du contenu Hemisphere »…).
- **Différences avant publication** : « voici ce qui change » (ajouté / modifié / supprimé), lisible par un humain.

### 4.2 Le pack de mods (le plus sensible)
- Éditeur du pack : ajouter un mod par recherche Modrinth, choisir la version (compatibilité Minecraft/Fabric
  vérifiée), catégorie, recommandé, activé par défaut, description EN/FR, épingler une version, bêta autorisée.
- Dépendances ajoutées automatiquement, conflits détectés, taille totale du pack.
- Nouvelle version du pack : numéro proposé automatiquement (patch / mineure / majeure selon le changement),
  « What's new » du pack (EN/FR).
- Fichiers de configuration (`config/`, `resourcepacks/`, `shaderpacks/`) avec la politique `default` / `enforced`.
- Passage à une nouvelle version de Minecraft : l'interrupteur `previousCanJoin` (« les joueurs encore sur l'ancien
  pack peuvent rejoindre »).
- **Validation à deux** pour tout changement du pack (un membre propose, un admin approuve).

### 4.3 Sécurité, traçabilité, sécurité encore
- **La clé de signature ne quitte jamais un endroit sûr** : idée principale = **GitHub Actions signe et publie**
  avec la clé dans les **secrets du dépôt** ; l'outil ne fait que modifier `content-src/` (voir § 6).
- Connexion de chaque membre avec **son compte GitHub** (flux « device code », sans serveur) : on sait qui publie,
  on retire un accès en un clic.
- **Rôles** : rédacteur (news, événements), modérateur (maintenance, politique des mods), admin (pack, code staff,
  ID Discord, validation).
- **Historique et retour arrière** : chaque publication = un commit ; « revenir à la version d'hier » en un clic.
- **Journal** : qui a publié quoi, quand (l'historique Git le fait déjà ; l'outil le rend lisible).
- Brouillons locaux, et protection contre deux membres qui modifient en même temps (conflits).

### 4.4 Confort
- **Publication programmée** (une news ou une maintenance à une heure donnée) — demande un automate côté GitHub
  (Actions planifiées), à étudier.
- **Notification Discord** du staff à chaque publication (webhook), facultative.
- Modèles (« maintenance de 30 min », « événement build contest »…).
- Aide à la traduction EN ↔ FR (suggestion, à relire) — à discuter.
- Vue « état en ligne » : ce que les launchers voient vraiment maintenant (flux et pack en ligne, cache GitHub).
- Statut du serveur et du restart (comme dans le launcher).

### 4.5 Ce que l'outil ne doit **pas** faire
- Publier une mise à jour **du launcher** : c'est `npm run release`, lancé par le propriétaire (§ 7).
- Contenir ou afficher la clé privée, les jetons, le code staff en clair (sauf au moment où on le génère).
- Collecter des données sur les joueurs (le launcher n'a aucune télémétrie ; on garde ce principe).
- Être livré aux joueurs : l'outil a son **propre installateur**, réservé au staff.

---

## 5. Où ranger l'outil (décision recommandée)

| Option | Pour | Contre | Avis |
|---|---|---|---|
| Dans le launcher (menu Développeur) | Rien à installer | Code de publication livré à **tous les joueurs** ; clé à distribuer sur les PC du staff | **Non** |
| Nouveau dépôt | Séparation nette | Les formats (`src/shared/`) seraient copiés et finiraient par diverger | Non |
| **Application à part dans ce dépôt** (`staff/`) | Réutilise exactement les schémas et la logique de `src/shared/` et `tools/content/` ; un seul historique | Le dépôt grossit un peu | **Recommandé** |

Proposition technique (à valider en phase S1) : application **Electron + React + Tailwind** (même pile que le
launcher : composants d'aperçu réutilisables), dossier `staff/`, son propre `electron-builder` et son propre
installateur (« Hemisphere-Beacon-Setup-x.y.exe »), versions indépendantes du launcher.
Alternative à discuter : application web (GitHub Pages) — plus simple à distribuer, mais la connexion GitHub
demande un petit serveur (échange de jeton) ; Electron peut utiliser le flux « device code » sans serveur.

---

## 6. Sécurité : le modèle proposé (à valider avant tout code)

### 6.1 Principe
```
Membre du staff ──(son compte GitHub)──▶ Outil ──▶ modifie content-src/ (commit sur une branche ou main)
                                                         ▼
                                   GitHub Actions (workflow « publish-content »)
                                   · valide avec les schémas zod
                                   · résout les mods sur Modrinth (pour le pack)
                                   · signe avec la clé privée stockée en SECRET du dépôt
                                   · commit content/ sur main
                                                         ▼
                                   Launchers (comme aujourd'hui, rien ne change pour eux)
```
- La clé privée est copiée **une fois** par le propriétaire dans les secrets du dépôt (`HEMI_SIGNING_KEY`), en plus
  de sa sauvegarde hors ligne. **La même clé** : aucune mise à jour du launcher n'est nécessaire.
- Le workflow refuse tout ce qui ne passe pas les schémas, et ne signe que `content-src/` → `content/`.
- **Protection de branche** sur `main` pour `content-src/client.json` : un changement du pack doit être approuvé
  (pull request + revue d'un admin) avant d'être signé.

### 6.2 Accès du staff
- Chaque membre a un compte GitHub ajouté comme collaborateur (droits limités : écrire dans `content-src/` via
  l'outil ; les règles CODEOWNERS / protection de branche encadrent ce qui demande une revue).
- L'outil se connecte par **GitHub device flow** (code à saisir sur github.com) : aucun mot de passe dans l'outil ;
  jeton stocké chiffré par le système (safeStorage).
- Retirer un membre = le retirer du dépôt.

### 6.3 Points de vigilance
- Le dépôt est **public** : tout ce qui est commité est visible (brouillons compris). Les brouillons restent en
  local ou dans une branche, à décider.
- Un compte staff compromis ne doit pas pouvoir changer le pack sans revue (d'où la protection de branche).
- Le workflow ne doit jamais afficher la clé dans les journaux.
- Les images de news sont publiques dès le commit.

### 6.4 Tester sans toucher aux joueurs (obligatoire)
- **Contenu de test** séparé : une branche `content-staging` (ou un dossier `content-staging/`) signée avec une
  **clé de test** distincte, et un build de dev du launcher pointé dessus via `MAIN_VITE_CONTENT_BASE` et une clé
  publique de test. Toutes les phases se testent là. **Jamais de contenu de test dans le flux réel.**
- Le passage au vrai flux se fait une seule fois, à la fin, avec l'accord du propriétaire.

---

## 7. Ce qu'il faut savoir sur le dépôt et les habitudes (pour ne rien casser)

### 7.1 Structure utile
```
src/shared/          schémas et logique partagés (feed.ts, manifest.ts, events.ts, modBrowser.ts…) ← à réutiliser
src/main/            processus principal du launcher (core/remote/feed.ts, content.ts : lecture + vérification)
src/renderer/src/    interface du launcher (screens/News.tsx, components/Events.tsx… réutilisables pour l'aperçu)
tools/content/       keygen.ts, feed.ts (publie le flux), publish.ts (publie le pack), keyPath.ts
tools/release.mjs    publication du LAUNCHER (ne pas confondre) ; tools/release-check.mjs
content-src/         sources éditées par le staff (feed.json, client.json, news-images/, files/)
content/             contenu publié et signé (lu par les launchers) — ne jamais l'éditer à la main
docs/CONTENT.md      guide actuel du staff (à remplacer progressivement par l'outil)
docs/RELEASE.md      publication du launcher
locales/en.json, fr.json   textes du launcher (tools/i18n-check.mjs vérifie que les deux langues ont les mêmes clés)
tests/               vitest (npx vitest run) — 228 tests au 9 oct.
```

### 7.2 Commandes
- `npm run typecheck`, `npx vitest run`, `node tools/i18n-check.mjs`, `npx electron-vite build` (launcher).
- `npm run content:feed`, `npm run content:publish [-- --dry-run]`, `npm run content:keygen` (ne jamais `--force`),
  `npm run staff-code`.
- `npm run release` / `npm run release:fix` : **publication du launcher, lancée uniquement par le propriétaire**
  avec son jeton GitHub (procédé validé : construction, envoi des 3 fichiers, vérification, mise à jour automatique
  des launchers installés).

### 7.3 Règles du dépôt (issues de l'expérience)
- **Ne jamais lancer `npx prettier`** ni aucun formateur : le dépôt n'a pas de configuration, le style est écrit à la
  main (guillemets simples, pas de point-virgule, lignes longues ~160+). Imiter le code voisin.
- **Version du launcher** : elle ne change **qu'à une release** (1.1, 1.2…). Les changements visibles par les
  joueurs sont ajoutés dans `src/shared/launcherChangelog.json` avec `"version": "next"` dans l'entrée du jour.
  (Pour l'outil du staff : versions et historique **séparés**, à définir en phase S1.)
- **Ne jamais commiter de secret** : clé privée (`*.pem`), jetons, code staff en clair.
- **Ne jamais publier de contenu de test** dans le flux réel.
- Ne jamais utiliser SendKeys (automatisation clavier) pour tester.
- Les messages de commit se terminent par la ligne d'attribution habituelle.

### 7.4 Pièges techniques déjà rencontrés
- **Node 24 sous Windows** : un `process.exit()` pendant une requête réseau peut planter (« Assertion failed …
  UV_HANDLE_CLOSING ») → utiliser `process.exitCode` et laisser le programme se terminer.
- **GitHub ferme les connexions inactives** : après une longue étape (construction), la requête suivante échoue
  (« other side closed ») → réessayer les requêtes GitHub.
- **Envois de gros fichiers vers GitHub** : faire ses propres envois avec reprise et vérifier après coup (ce que fait
  `tools/release.mjs`).
- **Échappement shell** : écrire les scripts de modification avec un fichier (outil Write) plutôt qu'avec `node -e`
  et des guillemets imbriqués ; ne jamais mettre d'accents graves dans une commande entre guillemets doubles.
- **Environnement de test de Claude** : les programmes lancés depuis Claude voient `%APPDATA%` redirigé vers un
  dossier privé (`…\Packages\Claude_…\LocalCache\Roaming`) : un installateur lancé depuis Claude crée des raccourcis
  invisibles pour Windows. Les tests d'installation réels se font par un double-clic du propriétaire.
- Après une modification du processus principal d'Electron, il faut **relancer** l'application (un rechargement de
  la page ne suffit pas).

### 7.5 Données utiles
- Dépôt : `Kyoonit/Hemisphere-Launcher` (public), branche `main`, propriétaire GitHub **Kyoonit**.
- `CONTENT_BASE` : `https://raw.githubusercontent.com/Kyoonit/Hemisphere-Launcher/main/content/`.
- Clé privée de contenu : `C:\Users\<propriétaire>\.hemisphere\content-signing-key.pem` (hors dépôt, sauvegardée).
- Application Discord « Hemisphere SMP » : ID `1557889951620931644` (logo et bannière dans `docs/discord/`).
- Restart quotidien : 17:00 Europe/Paris, durée 5 min (`restart.durationMin`).
- Code staff du launcher : connu du propriétaire, **jamais écrit dans le dépôt** (empreinte scrypt dans
  `src/shared/dev.ts`, remplaçable par `staffCode` dans le flux).

---

## 8. Découpage proposé en phases (prudent, chaque phase validée avant la suivante)

| Phase | Contenu | Livrable | Touche au contenu réel ? |
|---|---|---|---|
| **S0 · Idées** | Trier les idées du § 4, choisir le nom, les rôles, le modèle de sécurité, ce qui est prioritaire ; questions au propriétaire | Un document de décisions (aucun code) | Non |
| **S1 · Architecture** | Pile technique, emplacement (`staff/`), connexion GitHub, workflow de signature, contenu de test, plan des écrans (maquettes) | Document d'architecture + maquettes | Non |
| **S2 · Infrastructure de test** | Clé de test, contenu de test (`content-staging`), workflow GitHub Actions qui valide et signe le contenu de test, build de dev du launcher qui le lit | Une publication de test bout à bout, sans interface | Non (test seulement) |
| **S3 · Squelette de l'application** | Fenêtre, thème Hemisphere, connexion GitHub, lecture du contenu (test) en lecture seule | Application qui affiche l'état actuel | Non |
| **S4 · News + maintenance** | Éditeurs, aperçu identique au launcher, différences avant envoi, publication (test) | Publier une news de test, la voir dans le launcher de dev | Non (test) |
| **S5 · Événements + restart** | Calendrier, fuseaux, aperçus | Idem | Non (test) |
| **S6 · Politique des mods, support, Discord, code staff** | Éditeurs + génération du code staff | Idem | Non (test) |
| **S7 · Pack de mods** | Éditeur du pack, Modrinth, dépendances, versions, validation à deux | Publier un pack de test | Non (test) |
| **S8 · Historique, retour arrière, journal, notifications** | Confort et traçabilité | — | Non (test) |
| **S9 · Mise en service** | Clé réelle dans les secrets GitHub, protection de branche, installateur staff, guide, première vraie publication **avec l'accord du propriétaire** | Outil utilisé par le staff | **Oui, une fois validé** |

Chaque phase se termine par : ce qui a été fait, ce qui a été testé (et comment), ce qui ne l'a pas été, puis
**arrêt** jusqu'à validation.

---

## 9. Questions à poser au propriétaire en phase S0

1. Le nom : **Hemisphere Beacon** ou une autre proposition ?
2. Qui l'utilisera (combien de personnes, quels rôles) ? Tous les membres du staff ont-ils un compte GitHub ?
3. Priorités : news / événements / maintenance d'abord, le pack de mods ensuite ? D'accord pour reporter la
   publication programmée et la traduction automatique ?
4. Sécurité : d'accord pour mettre la clé de signature dans les secrets GitHub (signature par GitHub Actions) plutôt
   que sur les PC du staff ? Qui valide les changements du pack (toi seul ? plusieurs admins) ?
5. Distribution : application installable (Electron, Windows) ou web ? Le staff est-il uniquement sur Windows ?
6. Brouillons : visibles par tout le staff (branche du dépôt public) ou seulement en local ?
7. Notifications Discord à chaque publication : oui / non, quel salon ?
8. Faut-il garder les commandes actuelles (`content:feed`, `content:publish`) en secours ? (Recommandé : oui.)

---

## 10. État du projet launcher au moment du passage de relais (pour référence)

- Launcher **1.1** publié ; mises à jour automatiques **vérifiées** (1.0.19 → 1.1 via le bouton orange).
- Fonctionnalités principales en place : installation/synchronisation, news, événements, statut et restart en
  direct, contenu (mods, packs de ressources, shaders, presets), captures, signalement de problèmes, notifications,
  statut Discord, mode léger et libération de la RAM pendant le jeu, économie de bande passante, menu Développeur
  (staff, code + Ctrl+Maj+S), historique des mises à jour du launcher (News > Mises à jour du launcher).
- En attente : approbation Mojang (connexion des joueurs) ; phases 26 (skins), 28 (langues, macOS/Linux) du launcher.
- Cette conversation-ci continue de s'occuper du **launcher** ; la nouvelle conversation s'occupe de **l'outil du
  staff**. Les deux travaillent dans le même dépôt : faire des commits ciblés et `git pull` avant de commencer.
