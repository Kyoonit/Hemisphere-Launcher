# Herald — décisions de la phase S0

> Outil de publication du staff d'Hemisphere SMP. Document issu de la phase **S0 (idées uniquement)**, rédigé le
> 9 octobre 2026 avec le propriétaire du projet. Il **remplace** les §§ 3 à 6 et 8 de `docs/STAFF_APP_BRIEF.md`
> partout où les deux divergent (le brief supposait une publication 100 % GitHub ; voir § 18).
>
> **Dépôt public** : ce document ne contient aucun secret (clé, code, jeton). Statut : **approuvé le 9 octobre 2026**.

---

## 1. Nom et périmètre

- Nom : **Herald** (générique, sans référence à Hemisphere ou à Minecraft).
- Application **réservée au staff**, distincte du launcher, **en anglais uniquement** (interface).
- Rôle : publier tout ce que les joueurs voient dans le launcher (news, maintenances, événements, restart, bandeau,
  message d'accueil, screenshots du menu, pack de mods, réglages publics), le préparer à
  plusieurs, le programmer, et réagir en urgence.
- **Windows uniquement** pour l'instant.

## 2. Architecture retenue

```
Herald (PC du staff) ──nom + code──▶ Serveur Herald (Cloudflare Workers + base D1, offre gratuite)
                                     · profils, rôles, permissions, présence
                                     · brouillons, commentaires, statuts, corbeille, historique, journal
                                     · vérifie les permissions et la validation à plusieurs
                                     · signe (Ed25519, même clé qu'aujourd'hui) et envoie le contenu sur GitHub
                                     · garde les clés des coffres et les délivre à l'heure (§ 6.3)
                                                 ▼
                                     GitHub, dossier content/ public (comme aujourd'hui)
                                                 ▼
                                     Launchers des joueurs : lisent GitHub, vérifient la signature
```

- **Les joueurs lisent GitHub**, comme aujourd'hui (gratuit, illimité, éprouvé). Seule exception : la petite clé
  d'un coffre au moment de son ouverture (§ 6.3), avec GitHub en secours.
- Si le serveur Herald tombe : **aucun effet pour les joueurs** ; le staff ne peut plus publier ; les commandes
  actuelles (`content:feed`, `content:publish`) restent disponibles en secours pour les développeurs.
- Les calculs lourds (résolution des mods sur Modrinth, préparation du pack, images) se font **dans l'application
  Herald**, sur le PC du staff ; le serveur vérifie, signe et publie (limite de calcul de l'offre gratuite).
- La clé privée de signature est copiée par le propriétaire dans les **secrets du serveur** (en plus de sa
  sauvegarde hors ligne). Même clé : aucune mise à jour du launcher n'est nécessaire pour ce point.

## 3. Coût : 0 € par mois

- Compte Cloudflare **sans aucune carte bancaire** : aucune facturation possible ; en cas de dépassement, le service
  se bloque jusqu'au lendemain au lieu de facturer.
- Seuls des services utilisables sans moyen de paiement sont retenus (Workers, D1, tâches planifiées). Les quotas
  exacts seront vérifiés et documentés en phase S1.

## 4. Comptes, rôles, permissions, présence

- **Profils créés à la main** par l'Owner (et le Developer) dans un écran « Staff » de Herald : un **nom**, un
  **rôle**, des **permissions**, et un **code généré au hasard**, affiché une seule fois, stocké seulement sous forme
  d'empreinte. Pas de double authentification.
- Un profil peut être **révoqué**, changer de **rôle**, recevoir un **nouveau code**.
- **Permissions** = celles du rôle, plus des ajouts ou retraits individuels.
- Rôles, du plus haut au plus bas :

| Rôle | Qui / quoi |
|---|---|
| **Owner** | Liable |
| **Developer** | Kyonit |
| **Admin** | Covee, Netcrafts, Frunobulax, Trav |
| **Modérateur** | FireLegendDad |
| **Lodge keeper** | Iceorbs, Kingly, Scruffy, Blu. **Pas membres du staff.** Écrit des articles et programme des événements pour animer le serveur ; ne touche jamais au fonctionnement du launcher (maintenance, restart, mods, réglages…) |

  Le détail des permissions de chaque rôle sera défini plus tard (point ouvert, § 19).
- Tout le staff peut modifier les publications des autres (selon les permissions).
- **Présence** : chaque membre voit qui est en ligne dans Herald, sinon « vu pour la dernière fois le … ».
- Tout le staff a accès au mode Développeur du launcher (inchangé).

## 5. Publications

### 5.1 Types
| Type | Détail |
|---|---|
| **News** | Catégorie, image, lien, « à la une » avec **durée** (ex. 3 jours), modification et suppression toujours possibles |
| **Maintenance** | Premier affichage (annonce) → début → fin facultative (sans fin : le staff la termine à la main) |
| **Événements** | Uniques ou **récurrents** (« tous les samedis à 20:00 »), lieu, lien |
| **Bandeau d'annonce** | Une ligne courte sur l'accueil, programmable, couleur selon l'importance |
| **Message d'accueil** | Remplace le texte de bienvenue de l'accueil, programmable (saisons, fêtes) |
| **Screenshots du menu** | Ajouter, supprimer, programmer par période (Halloween, Noël…) ; § 9 |
| **Restart** | Heure + fuseau au choix, changement programmé avec date d'effet, exceptions ; § 10 |
| **Pack de mods** | Liste des mods par défaut, versions, configs ; **validation à plusieurs** |
| **Réglages publics** | Lien du support, ID Discord, code staff (généré, affiché une fois) |

### 5.2 Cycle de vie et collaboration
- Statuts : **Brouillon → En relecture → Prête → Programmée / Publiée**. Une publication « Prête » est **verrouillée** :
  il faut la rouvrir (action tracée) pour la modifier.
- **Langues** : l'anglais est obligatoire ; d'autres langues s'ajoutent à la main par un sélecteur, chacune avec son
  propre statut (« FR : à faire / terminé »). Un membre peut traduire la publication d'un autre. **Aucune traduction
  automatique.**
- **Commentaires** sur chaque publication.
- **Visibilité** : un brouillon peut être réservé à certains rôles (ex. admins uniquement).
- **Relances** visibles par **tout le monde dans Herald**, quel que soit le rôle : brouillons sans modification depuis
  X jours, publications programmées bientôt mais pas encore « Prêtes ». Aucune alerte hors de Herald pour l'instant.
- **Modèles** (« Maintenance 30 min », « Build contest »…).

### 5.3 Traçabilité
- **Historique complet, gardé pour toujours**, y compris ce qui est supprimé.
- **Corbeille** : tout élément supprimé est récupérable à tout moment.
- **Journal d'activité partagé** par tout le staff : qui a créé, modifié, validé, publié, supprimé ou restauré quoi,
  et quand.

### 5.4 Vues
- **Frise / calendrier** de tout ce qui est programmé, en cours ou terminé, avec les recouvrements signalés
  (« événement pendant une maintenance »).
- **Aperçu fidèle** avec les vrais composants du launcher (carte « à la une », carte normale, page de lecture, chaque
  langue, petite et grande fenêtre), images comprises (recadrage, poids).
- **Aperçu « voyage dans le temps »** (prioritaire) : « montre-moi le launcher d'un joueur de Sydney le 30/10 à
  14:00 ».
- **État en ligne** : ce que les launchers voient réellement en ce moment.

## 6. Programmation, heures et fuseaux

### 6.1 Saisie et affichage côté staff
- Chaque membre voit toutes les heures dans **son** fuseau : celui de son PC par défaut, ou un **fuseau personnalisé**
  choisi dans ses réglages (UTC, New York…).
- Chaque saisie affiche son fuseau (« 24/12 18:00 · UTC ») et permet de choisir un autre fuseau pour cette saisie.
- L'heure saisie par le staff fait foi : c'est **l'instant exact** de la publication.

### 6.2 Stockage et affichage côté joueur
- Événement **unique** : stocké comme un instant exact. Élément **récurrent** (restart, événement hebdomadaire) :
  stocké avec son heure **et son fuseau**, pour ne pas glisser au changement d'heure.
- Chaque launcher convertit avec **l'horloge et le fuseau du PC du joueur** : le 24/12, 18:00 à Paris s'affiche
  12:00 à New York et 04:00 le 25/12 à Sydney.
- Le contenu programmé est **envoyé en avance** aux launchers et gardé en local : aucun retard à l'affichage.
- Correction d'horloge : le launcher apprend l'écart entre l'horloge du PC et l'heure du serveur (réponse du serveur),
  pour qu'un PC mal réglé n'affiche pas trop tôt ou trop tard.

### 6.3 Toutes les publications programmées sont secrètes (modifié en S1)
Pas de choix « Précise / Secrète » : **tout contenu programmé est envoyé en avance dans un coffre** et ne devient
lisible qu'à son heure (décision du propriétaire en S1, remplace le choix par publication prévu en S0).

- **Coffre** : la publication (texte et images) est envoyée **en avance, chiffrée** (AES, une clé par
  publication). La clé reste sur le serveur Herald. Comme le launcher **sait à quelle heure le coffre s'ouvre**, il
  demande la clé **exactement à l'heure prévue** ; le serveur ne la donne qu'à partir de cette heure. La publication
  s'affiche donc à **18:00:00 (à une seconde près)** chez tous les joueurs en ligne.
  - Secours : la clé est aussi publiée sur GitHub à l'heure prévue ; un launcher qui n'a pas pu joindre le serveur
    l'obtient alors à sa vérification suivante (2 min).
  - Joueur hors ligne à l'heure prévue : la publication s'ouvre dès son retour en ligne.
  - L'appel de la clé ne contient aucune donnée sur le joueur et n'est pas journalisé (pas de télémétrie).
  - La clé ne peut pas être cachée dans le launcher : son code est lisible (dépôt public aujourd'hui, et fichiers
    d'installation Electron lisibles même avec un dépôt privé). Le coffre est donc la seule protection sérieuse.

## 7. Urgence

- Le launcher vérifie les nouveautés **toutes les 2 minutes** (au lieu de 10), requête conditionnelle quasi gratuite.
  Délai d'une urgence imprévue : environ **5 à 7 minutes** (cache GitHub compris).
- Boutons d'urgence, sans revue : **démarrer une maintenance maintenant**, **« le serveur est de nouveau en
  ligne »**, **retirer une publication**.

## 8. Notifications dans le launcher

- Le **badge rouge** au-dessus de News est **activé par défaut**. Il compte aussi les publications programmées au
  moment où elles apparaissent.
- Un **petit son** quand une news arrive en direct alors que le launcher est ouvert, **activé par défaut**.
- Les deux sont désactivables dans les Réglages du launcher. **Exception approuvée** à la règle « notifications
  désactivées par défaut ».

## 9. Screenshots du menu principal

- Gérés depuis Herald : ajout, suppression, programmation par période.
- Le launcher les télécharge **une seule fois**, les garde en local et respecte le mode économie de bande passante.
  Les fonds intégrés actuels restent **en secours** (pas d'internet, rien de publié).
- Aperçu dans Herald avec le vrai accueil par-dessus (lisibilité).
- **Changement d'une décision antérieure** : les fonds n'étaient pas modifiables à distance.

## 10. Restart

- Heure + **fuseau au choix** (UTC, Paris, le sien…), durée.
- **Changement programmé** avec date d'effet (utile aux changements d'heure si l'hébergeur fonctionne en UTC).
- **Exceptions** : annuler le restart d'un jour, ajouter un restart exceptionnel.
- État actuel : affiché **17:00 Europe/Paris** (le serveur redémarre en réalité vers 17:05 pendant 30 s à 1 min) ;
  le propriétaire garde **17:00** car l'hébergeur doit bientôt changer l'horaire. Si l'hébergeur fonctionne en UTC,
  l'heure réelle se décalera d'une heure le **25 octobre 2026** : à corriger dans le flux le moment venu (le launcher
  1.1 accepte déjà le fuseau `UTC`).

## 11. Compatibilité (priorité)

- Le seul point de contact entre Herald et le launcher est **le format du contenu signé**, défini dans `src/shared/`
  et **réutilisé tel quel** par Herald (jamais copié).
- Règle : on **ajoute** des champs, on n'en retire et n'en renomme **jamais**.
- Le launcher 1.1 ignore les champs inconnus : il afficherait **immédiatement** une publication programmée. Toute
  nouvelle fonction exige donc une **version minimale du launcher**, et Herald **refuse** une fonction que le dernier
  launcher publié ne comprend pas.
- Une seule mise à jour du launcher (**1.2**) apporte tout ce qu'il faut, **avant l'ouverture aux joueurs** (seul le
  staff utilise le launcher aujourd'hui) :
  - dates de premier affichage / fin d'affichage, maintenance annoncée, récurrences, durée « à la une » ;
  - coffres et correction d'horloge ;
  - vérification toutes les 2 minutes ;
  - bandeau d'annonce, message d'accueil, screenshots distants ;
  - son des news ;
  - adresse du contenu **réglable** (préparation du déménagement, § 14).
- La publication de la release du launcher reste faite par le propriétaire (`npm run release`).

## 12. Distribution et mises à jour de Herald

- Installateur Windows propre à Herald, **distribué en privé** au sein du staff.
- Mises à jour **comme le launcher** (bouton orange « Mettre à jour »), sur un **canal séparé** qui ne peut jamais
  perturber les mises à jour du launcher des joueurs. Objectif : très peu de mises à jour une fois l'outil stable.
- Versions et historique de Herald séparés de ceux du launcher.

## 13. Sécurité

- La clé privée de signature n'existe que sur le PC du propriétaire (sauvegarde) et dans les secrets du serveur
  Herald. Jamais dans Herald, jamais dans le dépôt.
- Codes des profils : générés au hasard, affichés une fois, stockés en empreinte.
- Le serveur vérifie lui-même rôles et permissions (l'application seule ne suffit pas).
- Le serveur valide tout avec les schémas zod partagés avant de signer.
- Les brouillons ne sont jamais publics (ils vivent sur le serveur Herald, pas dans le dépôt).
- Aucune donnée sur les joueurs n'est collectée.

## 14. Déménagement vers un GitHub officiel d'Hemisphere (idée seulement, pas une décision)

Souhait : passer ce dépôt en **privé** et publier depuis un GitHub **officiel d'Hemisphere**. Proposition à
détailler en S1 :
1. Créer une **organisation GitHub gratuite** (ex. « Hemisphere-SMP »), administrée par Liable et Kyonit.
2. Y créer un dépôt **public** qui ne contient que le contenu signé et les releases du launcher (pas de code).
3. Le launcher 1.2 (publié depuis l'ancien dépôt) lit déjà la nouvelle adresse ; une fois tous les launchers en 1.2,
   ce dépôt-ci peut passer en privé.
4. Herald publie vers une destination **réglable** : il fonctionne avant et après le déménagement.

## 15. Ce que Herald ne fait pas

- Publier une mise à jour **du launcher** (`npm run release`, propriétaire uniquement).
- Contenir ou afficher la clé privée, les jetons, les codes en clair (sauf au moment où on les génère).
- Collecter des données sur les joueurs.
- Être livré aux joueurs.

## 16. Reporté ou abandonné

- Traduction automatique : **abandonnée** (traduction manuelle par le staff).
- Connexion par Discord ou GitHub : **non** (profils manuels).
- Alertes Discord / webhook : **reportées** (alertes dans Herald uniquement).
- Version web, macOS, Linux : **reportées**.
- Double authentification : **non**.
- Politique des mods dans Herald : **retirée** (S1). La règle actuelle du flux reste en place telle quelle, et reste
  modifiable par les commandes de secours si un jour c'est nécessaire.
- Choix « Précise / Secrète » : **retiré** (S1), tout est secret (§ 6.3).

## 17. Tests sans toucher aux joueurs (inchangé, obligatoire)

- Serveur Herald **de test** séparé, **clé de test** distincte, dossier de **contenu de test**, build de dev du
  launcher pointé dessus. Toutes les phases se testent là.
- **Jamais de contenu de test dans le flux réel.** Le passage au vrai flux se fait une fois, à la fin, avec l'accord
  du propriétaire.

## 18. Ce qui change par rapport au brief et aux décisions antérieures

- Brief §§ 4.3, 5, 6 : signature par GitHub Actions, connexion GitHub (device flow / GitHub App), rôles dans
  `roles.json`, pull requests → **remplacés** par le serveur Herald (§ 2). Le canal de mise à jour séparé est gardé.
- Brief § 5 : l'option « application web » est abandonnée ; l'emplacement `staff/` dans ce dépôt reste à confirmer
  en S1 (il dépend du déménagement, § 14).
- Launcher : fonds d'écran désormais gérables à distance (§ 9) ; badge et son des news activés par défaut (§ 8) ;
  vérification toutes les 2 minutes (§ 7).

## 19. Points ouverts (pour plus tard, ne bloquent pas S1)

- Détail des permissions de chaque rôle (en particulier : un Lodge keeper publie-t-il seul ou avec validation ?).
- Qui valide le pack de mods et combien de validations sont nécessaires.
- Horaire réel du restart chez l'hébergeur et éventuel passage en UTC.
- Création de l'organisation GitHub officielle et date du déménagement.

## 20. Découpage proposé en phases (à confirmer en S1)

| Phase | Contenu | Touche au contenu réel ? |
|---|---|---|
| **S0 · Idées** | Ce document | Non |
| **S1 · Architecture** | Serveur Herald en détail (quotas gratuits, données, sécurité), format du contenu v2, coffres, déménagement, maquettes des écrans | Non |
| **S2 · Infrastructure de test** | Compte et serveur de test, clé de test, contenu de test, une publication de test bout à bout sans interface | Non |
| **S3 · Launcher : format v2** | Programmation, coffres, correction d'horloge, 2 min, adresse réglable (sur le contenu de test) | Non |
| **S4 · Squelette Herald** | Fenêtre, thème, connexion par code, profils, rôles, présence | Non |
| **S5 · News, bandeau, message d'accueil** | Éditeurs, langues, statuts, aperçus, voyage dans le temps | Non (test) |
| **S6 · Maintenance, restart, urgence** | | Non (test) |
| **S7 · Événements et calendrier** | Récurrences, frise | Non (test) |
| **S8 · Screenshots du menu** | Launcher + Herald | Non (test) |
| **S9 · Réglages publics, code staff** | | Non (test) |
| **S10 · Pack de mods** | Modrinth, dépendances, versions, validation à plusieurs | Non (test) |
| **S11 · Traçabilité et confort** | Corbeille, historique, journal, modèles, relances, état en ligne | Non (test) |
| **S12 · Mise en service** | Clé réelle sur le serveur, launcher 1.2 publié par le propriétaire, installateur Herald, guide, première vraie publication **avec l'accord du propriétaire** | **Oui, une fois validé** |

Chaque phase se termine par un récapitulatif (fait, testé, non testé), puis un **arrêt** jusqu'à validation.
