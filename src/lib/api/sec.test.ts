import { describe, it, expect } from 'vitest';
import { isValidSecContactEmail, padCik, secContactUserAgent } from './sec';

/**
 * Les cas acceptes/refuses ci-dessous ne sont pas theoriques : ils ont ete
 * mesures contre `www.sec.gov/files/company_tickers.json`. Le filtre de la SEC
 * est purement syntaxique — une adresse de charabia bien formee passe, une
 * adresse plausible mais mal formee est rejetee en 403.
 */
describe('isValidSecContactEmail', () => {
  it('accepte les formes que la SEC renvoie en 200', () => {
    expect(isValidSecContactEmail('maxime.autechaud@gmail.com')).toBe(true);
    expect(isValidSecContactEmail('a@b.co')).toBe(true);
    expect(isValidSecContactEmail('bbb@ccc.ddd')).toBe(true);
    expect(isValidSecContactEmail('nom.prenom@sous.domaine.fr')).toBe(true);
  });

  it('refuse les formes que la SEC renvoie en 403', () => {
    expect(isValidSecContactEmail('x@y.z')).toBe(false);        // TLD d'une lettre
    expect(isValidSecContactEmail('contact@')).toBe(false);      // sans domaine
    expect(isValidSecContactEmail('nimportequoi')).toBe(false);  // sans @
  });

  it('refuse les cas degeneres', () => {
    expect(isValidSecContactEmail('')).toBe(false);
    expect(isValidSecContactEmail('   ')).toBe(false);
    expect(isValidSecContactEmail('@domaine.com')).toBe(false);   // partie locale vide
    expect(isValidSecContactEmail('nom@domaine')).toBe(false);    // pas de point
    expect(isValidSecContactEmail('nom@.com')).toBe(false);       // domaine vide
    expect(isValidSecContactEmail('a b@c.com')).toBe(false);      // espace interne
    expect(isValidSecContactEmail('a@b c.com')).toBe(false);
  });

  it('tolere les espaces autour', () => {
    expect(isValidSecContactEmail('  nom@domaine.com  ')).toBe(true);
  });
});

describe('secContactUserAgent', () => {
  it('produit le UA attendu et neutralise les espaces de bord', () => {
    expect(secContactUserAgent('  nom@domaine.com ')).toBe(
      'Folio Portfolio Tracker nom@domaine.com',
    );
  });
});

describe('padCik', () => {
  it('complete a 10 chiffres', () => {
    expect(padCik(320193)).toBe('0000320193');
    expect(padCik('320193')).toBe('0000320193');
  });

  it('est idempotent sur un CIK deja complet', () => {
    expect(padCik('0000320193')).toBe('0000320193');
  });

  it('ignore les caracteres non numeriques', () => {
    expect(padCik('CIK0000320193')).toBe('0000320193');
  });
});
