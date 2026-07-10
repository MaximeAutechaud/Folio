import { describe, it, expect } from 'vitest';
import { calcSectorScore, narrativeMacroProfile, NARRATIVE_MACRO_OVERRIDES, type ScoreInput } from './scoring';

// Rappel sémantique : shortAccel = relPerf1W − relPerf1M/4
// (le RS de la semaine vs le rythme hebdo moyen du mois)
function input(overrides: Partial<ScoreInput> = {}): ScoreInput {
  return {
    relPerf1W: null,
    relPerf1M: null,
    relPerf3M: null,
    rsi: null,
    drawdown3M: null,
    drawdown6M: null,
    ma50Above: null,
    macroProfile: 'neutral',
    macroScore: 50,
    macroTrend: 'flat',
    ...overrides,
  };
}

describe('calcSectorScore — signaux', () => {
  it('tout à null → aucun signal, score neutre', () => {
    const s = calcSectorScore(input());
    expect(s.signal).toBeNull();
    expect(s.label).toBe('neutral');
    expect(s.total).toBeGreaterThanOrEqual(0);
    expect(s.total).toBeLessThanOrEqual(100);
  });

  it('exhaustion : fort 3M + RS qui décélère + RSI encore élevé', () => {
    // shortAccel = −1 − 4/4 = −2 < −0.5 ; r3M 5 > 3 ; rsi 70 > 62
    const s = calcSectorScore(input({ relPerf1W: -1, relPerf1M: 4, relPerf3M: 5, rsi: 70 }));
    expect(s.signal).toBe('exhaustion');
  });

  it('pas d exhaustion si le RSI est déjà retombé (≤ 62)', () => {
    const s = calcSectorScore(input({ relPerf1W: -1, relPerf1M: 4, relPerf3M: 5, rsi: 60 }));
    expect(s.signal).toBeNull();
  });

  it('reversal : à la traîne sur 3M mais surperforme cette semaine', () => {
    // r3M −5 < −1.5 ; r1W 1 > 0.5
    const s = calcSectorScore(input({ relPerf1W: 1, relPerf1M: -2, relPerf3M: -5, rsi: 50 }));
    expect(s.signal).toBe('reversal');
  });

  it('dip : RS en amélioration + pullback significatif + RSI sain', () => {
    // shortAccel = 0.4 − 0.8/4 = 0.2 > 0 ; drawdown −5 ∈ [−15, −3] ; rsi 50 < 65
    const s = calcSectorScore(input({
      relPerf1W: 0.4, relPerf1M: 0.8, relPerf3M: 2,
      drawdown3M: -5, rsi: 50,
    }));
    expect(s.signal).toBe('dip');
  });

  it('pas de dip si le pullback est trop profond (< −15)', () => {
    const s = calcSectorScore(input({
      relPerf1W: 0.4, relPerf1M: 0.8, relPerf3M: 2,
      drawdown3M: -20, rsi: 50,
    }));
    expect(s.signal).toBeNull();
  });

  it('accelerating : RS qui accélère nettement sans pullback', () => {
    // shortAccel = 2 − 2/4 = 1.5 > 1 ; r1W 2 > 0.5 ; rsi 55 < 65 ; drawdown −1 (pas un dip)
    const s = calcSectorScore(input({
      relPerf1W: 2, relPerf1M: 2, relPerf3M: 1,
      drawdown3M: -1, rsi: 55,
    }));
    expect(s.signal).toBe('accelerating');
  });

  it('priorité : reversal gagne sur dip quand les deux conditions sont réunies', () => {
    // Conditions dip réunies (shortAccel 1 > 0, drawdown −10, rsi 40)
    // ET conditions reversal (r3M −5, r1W 1) → reversal prioritaire
    const s = calcSectorScore(input({
      relPerf1W: 1, relPerf1M: 0, relPerf3M: -5,
      drawdown3M: -10, rsi: 40,
    }));
    expect(s.signal).toBe('reversal');
  });

  it('priorité : exhaustion gagne sur tout', () => {
    // r3M > 3 + décélération + RSI 70 : même avec un drawdown de zone dip,
    // exhaustion doit sortir (et dip exige de toute façon shortAccel > 0)
    const s = calcSectorScore(input({
      relPerf1W: -1, relPerf1M: 4, relPerf3M: 5,
      drawdown3M: -5, rsi: 70,
    }));
    expect(s.signal).toBe('exhaustion');
  });
});

describe('calcSectorScore — pénalité exhaustion', () => {
  it('exhaustion coûte exactement 15 points de total, sous-scores égaux par ailleurs', () => {
    // Seule différence : rsi 63 (> 62 → exhaustion) vs rsi 62 (pas d exhaustion).
    // Les deux RSI sont dans la même bande de calcRsiScore (55–65 → 75),
    // donc tous les sous-scores sont identiques.
    const base = { relPerf1W: -1, relPerf1M: 4, relPerf3M: 5, drawdown3M: -5, drawdown6M: -5, ma50Above: true as const };
    const withExhaustion = calcSectorScore(input({ ...base, rsi: 63 }));
    const without = calcSectorScore(input({ ...base, rsi: 62 }));
    expect(withExhaustion.signal).toBe('exhaustion');
    expect(without.signal).toBeNull();
    expect(withExhaustion.rsiEntry).toBe(without.rsiEntry);
    expect(without.total - withExhaustion.total).toBe(15);
  });
});

describe('calcSectorScore — sous-score macroAlign', () => {
  it('risk_on : macro fort et en hausse → 100, macro faible → 10', () => {
    expect(calcSectorScore(input({ macroProfile: 'risk_on', macroScore: 70, macroTrend: 'up' })).macroAlign).toBe(100);
    expect(calcSectorScore(input({ macroProfile: 'risk_on', macroScore: 30 })).macroAlign).toBe(10);
  });

  it('defensive : logique miroir — macro faible et en baisse → 100', () => {
    expect(calcSectorScore(input({ macroProfile: 'defensive', macroScore: 30, macroTrend: 'down' })).macroAlign).toBe(100);
    expect(calcSectorScore(input({ macroProfile: 'defensive', macroScore: 70 })).macroAlign).toBe(10);
  });

  it('neutral : léger biais directionnel 58/42', () => {
    expect(calcSectorScore(input({ macroScore: 50 })).macroAlign).toBe(58);
    expect(calcSectorScore(input({ macroScore: 49 })).macroAlign).toBe(42);
  });
});

describe('calcSectorScore — sous-score drawdown (décotes)', () => {
  // drawdown3M/6M à −5 → calcDrawdownScore 100 des deux côtés → raw 100
  const dd = { drawdown3M: -5, drawdown6M: -5 };

  it('dip propre au-dessus de la MA50 → score plein', () => {
    const s = calcSectorScore(input({ ...dd, ma50Above: true }));
    expect(s.drawdown).toBe(100);
  });

  it('sous la MA50 → décote 0.6 (support cassé)', () => {
    const s = calcSectorScore(input({ ...dd, ma50Above: false }));
    expect(s.drawdown).toBe(60);
  });

  it('RS en décélération → décote 0.4, prioritaire sur la MA50', () => {
    // shortAccel = −1 − 0 = −1 < −0.5
    const s = calcSectorScore(input({ ...dd, relPerf1W: -1, relPerf1M: 0, ma50Above: false }));
    expect(s.drawdown).toBe(40);
  });

  it('le blend 60/40 pénalise un rebond dans un downtrend 6M', () => {
    // 3M à −5 (score 100) mais 6M à −30 (score 10) → 100*0.6 + 10*0.4 = 64
    const s = calcSectorScore(input({ drawdown3M: -5, drawdown6M: -30, ma50Above: true }));
    expect(s.drawdown).toBe(64);
  });
});

describe('calcSectorScore — boost rsiEntry sur reversal', () => {
  // rsi 38 → bande 30–40 de calcRsiScore → base 85 (le boost devient observable)
  const reversalBase = { relPerf1W: 1, relPerf1M: -2, relPerf3M: -5, rsi: 38 };

  it('reversal avec RSI < 45 → boost +15 (au-dessus de la MA50)', () => {
    // base 85 + 15 → 100
    const s = calcSectorScore(input({ ...reversalBase, ma50Above: true }));
    expect(s.signal).toBe('reversal');
    expect(s.rsiEntry).toBe(100);
  });

  it('boost affaibli à +8 sous la MA50 (rebond en downtrend)', () => {
    const s = calcSectorScore(input({ ...reversalBase, ma50Above: false }));
    expect(s.rsiEntry).toBe(93);
  });

  it('pas de boost si le RSI a déjà rattrapé (≥ 45)', () => {
    const s = calcSectorScore(input({ ...reversalBase, rsi: 50, ma50Above: true }));
    expect(s.signal).toBe('reversal');
    expect(s.rsiEntry).toBe(100); // bande 40–55 → 100, sans boost (déjà au max)
  });
});

describe('calcSectorScore — bornes et labels', () => {
  it('le total reste dans [0, 100] sur des entrées extrêmes', () => {
    const worst = calcSectorScore(input({
      relPerf1W: -10, relPerf1M: 10, relPerf3M: 10,
      rsi: 85, drawdown3M: -40, drawdown6M: -50, ma50Above: false,
      macroProfile: 'risk_on', macroScore: 10, macroTrend: 'down',
    }));
    expect(worst.total).toBeGreaterThanOrEqual(0);

    const best = calcSectorScore(input({
      relPerf1W: 5, relPerf1M: 8, relPerf3M: 12,
      rsi: 48, drawdown3M: -5, drawdown6M: -5, ma50Above: true,
      macroProfile: 'risk_on', macroScore: 70, macroTrend: 'up',
    }));
    expect(best.total).toBeLessThanOrEqual(100);
    expect(best.total).toBeGreaterThan(worst.total);
  });

  it('seuils de label : 70 hot / 52 warming / 38 neutral / sinon cooling', () => {
    // On vérifie la cohérence label ↔ total sur un balayage d entrées variées
    for (const r1W of [-5, -1, 0, 1, 5]) {
      for (const rsi of [25, 45, 60, 75]) {
        const s = calcSectorScore(input({ relPerf1W: r1W, relPerf1M: 0, relPerf3M: 0, rsi }));
        const expected = s.total >= 70 ? 'hot' : s.total >= 52 ? 'warming' : s.total >= 38 ? 'neutral' : 'cooling';
        expect(s.label).toBe(expected);
      }
    }
  });
});

describe('narrativeMacroProfile', () => {
  it('applique l override quand l ETF en a un', () => {
    expect(narrativeMacroProfile('GDX', 'risk_on')).toBe('defensive');
    expect(narrativeMacroProfile('UFO', 'defensive')).toBe('risk_on');
  });

  it('hérite du profil parent sinon', () => {
    expect(narrativeMacroProfile('SOXX', 'risk_on')).toBe('risk_on');
    expect(narrativeMacroProfile('XBI', 'neutral')).toBe('neutral');
  });

  it('tous les overrides sont des profils macro valides', () => {
    for (const profile of Object.values(NARRATIVE_MACRO_OVERRIDES)) {
      expect(['risk_on', 'defensive', 'neutral']).toContain(profile);
    }
  });
});
