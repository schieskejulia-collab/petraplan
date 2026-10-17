export type ClaimCheckTemplate = {
  id: string;
  label: string;
  source: string;
  fundstelleHint: string;
  definition: Record<string, string>;
};

// Derived check prompts, not SAP rules, case evidence, or authority grants.
// The source locator remains blank until the actual case field is identified.
export const CLAIM_CHECK_TEMPLATES: ClaimCheckTemplate[] = [
  {
    id: 'identity-assignment',
    label: 'Identitätszuordnung',
    source: 'SAP Identity Management Master Guide, Version 1.6, 17.05.2024, Abschnitt 3.2.9, Seite 20',
    fundstelleHint: 'Konkrete Feldadresse der Quell-ID oder des Zuordnungsbelegs. System, Mandant, Objekttyp und Schlüssel gemeinsam prüfen.',
    definition: {
      question: 'Bezeichnen die gemeinsame Adresse und die ursprüngliche Quell-ID dasselbe Objekt in diesem Fall?',
      required_information: 'Quellsystem, Mandant beziehungsweise Namensraum, Objekttyp, ursprünglicher Schlüssel, gemeinsame Adresse und versionierter Zuordnungsbeleg.',
      required_address: '',
      check_condition: 'Ein nachvollziehbarer Zuordnungsbeleg verbindet die Kennungen für denselben Objekttyp, Namensraum und Zeitstand; die Identitätsregel gilt für diesen Fall.',
      counter_condition: 'Die Kennungen verweisen nachweislich auf unterschiedliche Objekte, oder die Zuordnung verletzt ihre ausdrücklich dokumentierte Identitätsregel. Mehrere Quell-IDs allein beweisen noch keine Kollision.',
      coverage_requirement: 'Alle für diese Identitätsregel erforderlichen Schlüsselbestandteile, Zuordnungen und ihre Gültigkeitsbereiche liegen vor; Wiederverwendung und erlaubte Mehrfachzuordnungen sind geprüft.',
      next_check: 'Quellschlüssel und Mapping-Beleg lesen, System-/Mandantenkontext vergleichen und mögliche abweichende Zuordnungen im erklärten Suchbereich prüfen.',
    },
  },
  {
    id: 'attribute-mapping',
    label: 'Feld-Mapping und Transformation',
    source: 'SAP Identity Management Master Guide, Version 1.6, 17.05.2024, Abschnitt 3.2.9, Seite 20',
    fundstelleHint: 'Konkrete Adresse des Quellfeldes oder des Transformationsbelegs. Für weitere Eingangsgrößen eigene Anforderungen ergänzen.',
    definition: {
      question: 'Erhält die konkrete Feldzuordnung die für diese Aussage benötigte Bedeutung und Darstellung?',
      required_information: 'Quell- und Zielfeld, Rohwert, Datentyp, Format, Einheit, Code-System, Mapping-Regel mit Version und benötigte Eingangsgrößen.',
      required_address: '',
      check_condition: 'Die dokumentierte Mapping-Regel gilt im konkreten Kontext; alle benötigten Eingangsgrößen sind belegt, und die Transformation erhält die für diese Frage maßgebliche Information.',
      counter_condition: 'Eine falsche Einheit, andere Bedeutung, nicht gedeckte Code-Zuordnung oder entscheidungsrelevanter Informationsverlust widerspricht der behaupteten Gleichwertigkeit.',
      coverage_requirement: 'Die tatsächlich verwendete Mapping-Version, sämtliche benötigten Eingangsgrößen sowie relevante Grenzfälle und Ausnahmen sind dokumentiert.',
      next_check: 'Rohdarstellung und Zielwert anhand der konkreten Mapping-Version vergleichen; Einheiten, Codes und möglichen Informationsverlust gesondert prüfen.',
    },
  },
  {
    id: 'data-ownership',
    label: 'Datenverantwortung und Quellenzuständigkeit',
    source: 'SAP Identity Management Master Guide, Version 1.6, 17.05.2024, Abschnitt 5.1, Seite 27',
    fundstelleHint: 'Adresse des gültigen Zuständigkeits- oder Ownership-Belegs für genau das betroffene Attribut.',
    definition: {
      question: 'Ist die verwendete Quelle für dieses Attribut und diesen Geltungsbereich ausdrücklich zuständig?',
      required_information: 'Betroffenes Attribut, Quellenidentität, dokumentierte Datenverantwortung, organisatorischer Kontext, Gültigkeitszeitraum und Regelversion.',
      required_address: '',
      check_condition: 'Ein gültiger Zuständigkeitsbeleg weist der Quelle beziehungsweise verantwortlichen Stelle genau dieses Attribut in diesem Kontext zu. Zuständigkeit allein beweist nicht die Richtigkeit des Wertes.',
      counter_condition: 'Ein einschlägiger Beleg weist die Zuständigkeit einer anderen Quelle zu, oder die behauptete Zuständigkeit ist für diesen Kontext aufgehoben beziehungsweise abgelaufen.',
      coverage_requirement: 'Die einschlägigen Zuständigkeitsregeln einschließlich Ausnahmen, Delegationen und zeitlicher Gültigkeit sind für das konkrete Attribut geprüft.',
      next_check: 'Den maßgeblichen Ownership-Beleg beschaffen und Attribut, Organisation und Zeitpunkt abgleichen; konkurrierende Zuständigkeitsbelege sichtbar halten.',
    },
  },
  {
    id: 'decision-authority',
    label: 'Berechtigung und Funktionstrennung',
    source: 'SAP Identity Management Master Guide, Version 1.6, 17.05.2024, Abschnitt 5.4, Seite 34',
    fundstelleHint: 'Konkrete Adresse des Berechtigungs-/Delegationsbelegs. Eine technische Reviewer-Rolle ist kein fachlicher Berechtigungsnachweis.',
    definition: {
      question: 'Darf die benannte Person diese konkrete Entscheidung treffen, ohne eine einschlägige Funktionstrennungsregel zu verletzen?',
      required_information: 'Personenidentität, Rolle, dokumentierte Delegation, Entscheidungsart, Fall-/Organisationskontext, Gültigkeit, Widerrufe und einschlägige Funktionstrennungsregeln.',
      required_address: '',
      check_condition: 'Eine gültige, nicht widerrufene Delegation deckt Person, Entscheidungsart und Geltungsbereich ab; die einschlägigen Funktionstrennungsregeln sind geprüft.',
      counter_condition: 'Ein tatsächlicher Widerruf, abgelaufene oder unpassende Delegation beziehungsweise eine nachgewiesene verbotene Rollenkombination widerspricht der Handlungsbefugnis.',
      coverage_requirement: 'Alle für diese Entscheidung maßgeblichen Delegationen, Widerrufe, Rollen und Funktionstrennungsregeln liegen im erklärten Prüfbereich vor.',
      next_check: 'Delegationsbeleg und aktuelle Widerrufe lesen, Entscheidungsscope abgleichen und die zutreffenden Funktionstrennungsregeln prüfen.',
    },
  },
];
