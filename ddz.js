const SUITS = ['♠', '♥', '♣', '♦'];
const LABELS = [
  { label: '3', val: 3 }, { label: '4', val: 4 }, { label: '5', val: 5 },
  { label: '6', val: 6 }, { label: '7', val: 7 }, { label: '8', val: 8 },
  { label: '9', val: 9 }, { label: '10', val: 10 }, { label: 'J', val: 11 },
  { label: 'Q', val: 12 }, { label: 'K', val: 13 }, { label: 'A', val: 14 },
  { label: '2', val: 15 },
];

function createDeck() {
  const deck = [];
  let id = 0;
  for (const item of LABELS) {
    for (const suit of SUITS) {
      const color = (suit === '♥' || suit === '♦') ? 'red' : 'black';
      deck.push({ id: id++, suit, label: item.label, val: item.val, color });
    }
  }
  deck.push({ id: id++, suit: '🃏', label: '小王', val: 16, color: 'black' });
  deck.push({ id: id++, suit: '👑', label: '大王', val: 17, color: 'red' });
  return deck;
}

function shuffle(arr) {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function sortCards(cards) {
  return [...cards].sort((a, b) => (b.val - a.val) || (a.id - b.id));
}

function countByVal(cards) {
  const map = new Map();
  for (const c of cards) {
    if (!map.has(c.val)) map.set(c.val, []);
    map.get(c.val).push(c);
  }
  return map;
}

function findConsecutiveRuns(vals, minLen) {
  const sorted = [...vals].filter(v => v <= 14).sort((a, b) => a - b);
  const runs = [];
  let cur = [];
  for (const v of sorted) {
    if (cur.length === 0 || v === cur[cur.length - 1] + 1) cur.push(v);
    else { if (cur.length >= minLen) runs.push(cur); cur = [v]; }
  }
  if (cur.length >= minLen) runs.push(cur);
  return runs;
}

function analyzeCards(cards) {
  if (!cards || cards.length === 0) return null;
  const n = cards.length;
  const byVal = countByVal(cards);
  const vals = [...byVal.keys()].sort((a, b) => a - b);
  const counts = vals.map(v => byVal.get(v).length);

  if (n === 2 && vals[0] === 16 && vals[1] === 17) return { type: 'ROCKET', main: 17, len: 2 };
  if (n === 4 && vals.length === 1) return { type: 'BOMB', main: vals[0], len: 4 };
  if (n === 1) return { type: 'SINGLE', main: vals[0], len: 1 };
  if (n === 2 && vals.length === 1) return { type: 'PAIR', main: vals[0], len: 2 };
  if (n === 3 && vals.length === 1) return { type: 'TRIPLE', main: vals[0], len: 3 };

  if (n === 4 && vals.length === 2 && counts.includes(3)) {
    return { type: 'TRIPLE_1', main: vals.find(v => byVal.get(v).length === 3), len: 4 };
  }
  if (n === 5 && vals.length === 2 && counts.includes(3) && counts.includes(2)) {
    return { type: 'TRIPLE_2', main: vals.find(v => byVal.get(v).length === 3), len: 5 };
  }
  if (n >= 5 && vals.length === n && vals[vals.length - 1] <= 14 && vals[vals.length - 1] - vals[0] === n - 1) {
    return { type: 'STRAIGHT', main: vals[0], len: n };
  }
  if (n >= 6 && n % 2 === 0 && counts.every(c => c === 2) && vals[vals.length - 1] <= 14 && vals[vals.length - 1] - vals[0] === vals.length - 1) {
    return { type: 'DOUBLE_STRAIGHT', main: vals[0], len: vals.length };
  }

  const tripleVals = vals.filter(v => byVal.get(v).length >= 3 && v <= 14);
  const runs = findConsecutiveRuns(tripleVals, 2);
  for (const run of runs) {
    if (n === run.length * 3 && counts.every(c => c === 3)) return { type: 'PLANE', main: run[0], len: run.length };
  }
  for (const run of runs) {
    for (let k = run.length; k >= 2; k--) {
      if (n === k * 4) return { type: 'PLANE_1', main: run[0], len: k };
    }
  }
  for (const run of runs) {
    for (let k = run.length; k >= 2; k--) {
      if (n === k * 5) {
        for (let i = 0; i <= run.length - k; i++) {
          const sub = run.slice(i, i + k);
          const remCounts = [];
          for (const v of vals) {
            const c = byVal.get(v).length - (sub.includes(v) ? 3 : 0);
            if (c > 0) remCounts.push(c);
          }
          if (remCounts.every(c => c === 2 || c === 4)) return { type: 'PLANE_2', main: sub[0], len: k };
        }
      }
    }
  }

  const fourVals = vals.filter(v => byVal.get(v).length === 4);
  if (fourVals.length >= 1) {
    const main = fourVals[fourVals.length - 1];
    if (n === 6) return { type: 'FOUR_2_SINGLE', main, len: 6 };
    if (n === 8 && vals.filter(v => v !== main).map(v => byVal.get(v).length).every(c => c === 2 || c === 4)) {
      return { type: 'FOUR_2_PAIR', main, len: 8 };
    }
  }
  return null;
}

function canBeat(newAnalysis, prevAnalysis) {
  if (!newAnalysis) return false;
  if (!prevAnalysis) return true;
  if (newAnalysis.type === 'ROCKET') return true;
  if (prevAnalysis.type === 'ROCKET') return false;
  if (newAnalysis.type === 'BOMB') return prevAnalysis.type !== 'BOMB' || newAnalysis.main > prevAnalysis.main;
  return newAnalysis.type === prevAnalysis.type && newAnalysis.len === prevAnalysis.len && newAnalysis.main > prevAnalysis.main;
}

function findBeatingPlays(hand, lastPlay) {
  const results = [];
  if (!hand || hand.length === 0) return results;
  const byVal = countByVal(hand);
  const vals = [...byVal.keys()].sort((a, b) => a - b);

  const addBombsAndRocket = (minBombVal = 0) => {
    for (const v of vals) {
      if (byVal.get(v).length === 4 && v > minBombVal) {
        results.push({ cards: byVal.get(v), analysis: { type: 'BOMB', main: v, len: 4 } });
      }
    }
    if (byVal.has(16) && byVal.has(17)) {
      results.push({ cards: [byVal.get(16)[0], byVal.get(17)[0]], analysis: { type: 'ROCKET', main: 17, len: 2 } });
    }
  };

  if (!lastPlay) {
    const whole = analyzeCards(hand);
    if (whole) results.push({ cards: [...hand], analysis: whole });
    for (const r of findConsecutiveRuns(vals, 5)) {
      for (let len = r.length; len >= 5; len--) {
        for (let i = 0; i <= r.length - len; i++) {
          results.push({ cards: r.slice(i, i + len).map(v => byVal.get(v)[0]), analysis: { type: 'STRAIGHT', main: r[i], len } });
        }
      }
    }
    for (const r of findConsecutiveRuns(vals.filter(v => byVal.get(v).length >= 2), 3)) {
      for (let len = r.length; len >= 3; len--) {
        for (let i = 0; i <= r.length - len; i++) {
          const cards = [];
          for (const v of r.slice(i, i + len)) cards.push(byVal.get(v)[0], byVal.get(v)[1]);
          results.push({ cards, analysis: { type: 'DOUBLE_STRAIGHT', main: r[i], len } });
        }
      }
    }
    for (const v of vals) {
      if (byVal.get(v).length === 3) {
        const tri = byVal.get(v);
        const sWing = vals.find(x => x !== v && byVal.get(x).length === 1);
        const pWing = vals.find(x => x !== v && byVal.get(x).length === 2);
        if (sWing !== undefined) results.push({ cards: [...tri, byVal.get(sWing)[0]], analysis: { type: 'TRIPLE_1', main: v, len: 4 } });
        if (pWing !== undefined) results.push({ cards: [...tri, ...byVal.get(pWing)], analysis: { type: 'TRIPLE_2', main: v, len: 5 } });
        results.push({ cards: tri, analysis: { type: 'TRIPLE', main: v, len: 3 } });
      }
    }
    for (const v of vals) if (byVal.get(v).length === 2) results.push({ cards: byVal.get(v), analysis: { type: 'PAIR', main: v, len: 2 } });
    for (const v of vals) {
      if (byVal.get(v).length === 1) results.push({ cards: byVal.get(v), analysis: { type: 'SINGLE', main: v, len: 1 } });
      else if (byVal.get(v).length <= 3) results.push({ cards: [byVal.get(v)[0]], analysis: { type: 'SINGLE', main: v, len: 1 } });
    }
    addBombsAndRocket(0);
    return results;
  }

  const { type, main, len } = lastPlay;
  if (type === 'ROCKET') return results;

  if (type === 'SINGLE') {
    for (const cLen of [1, 2, 3]) {
      for (const v of vals) if (v > main && byVal.get(v).length === cLen) results.push({ cards: [byVal.get(v)[0]], analysis: { type: 'SINGLE', main: v, len: 1 } });
    }
  } else if (type === 'PAIR') {
    for (const cLen of [2, 3]) {
      for (const v of vals) if (v > main && byVal.get(v).length === cLen) results.push({ cards: byVal.get(v).slice(0, 2), analysis: { type: 'PAIR', main: v, len: 2 } });
    }
  } else if (type === 'TRIPLE') {
    for (const v of vals) if (v > main && byVal.get(v).length === 3) results.push({ cards: byVal.get(v), analysis: { type: 'TRIPLE', main: v, len: 3 } });
  } else if (type === 'TRIPLE_1') {
    for (const v of vals) {
      if (v > main && byVal.get(v).length === 3) {
        const wing = vals.find(x => x !== v && byVal.get(x).length === 1) ?? vals.find(x => x !== v && byVal.get(x).length < 4);
        if (wing !== undefined) results.push({ cards: [...byVal.get(v), byVal.get(wing)[0]], analysis: { type: 'TRIPLE_1', main: v, len: 4 } });
      }
    }
  } else if (type === 'TRIPLE_2') {
    for (const v of vals) {
      if (v > main && byVal.get(v).length === 3) {
        const wing = vals.find(x => x !== v && byVal.get(x).length === 2) ?? vals.find(x => x !== v && byVal.get(x).length === 3);
        if (wing !== undefined) results.push({ cards: [...byVal.get(v), ...byVal.get(wing).slice(0, 2)], analysis: { type: 'TRIPLE_2', main: v, len: 5 } });
      }
    }
  } else if (type === 'STRAIGHT') {
    for (const r of findConsecutiveRuns(vals.filter(v => v > main), len)) {
      for (let i = 0; i <= r.length - len; i++) {
        results.push({ cards: r.slice(i, i + len).map(v => byVal.get(v)[0]), analysis: { type: 'STRAIGHT', main: r[i], len } });
      }
    }
  } else if (type === 'DOUBLE_STRAIGHT') {
    for (const r of findConsecutiveRuns(vals.filter(v => v > main && byVal.get(v).length >= 2), len)) {
      for (let i = 0; i <= r.length - len; i++) {
        const cards = [];
        for (const v of r.slice(i, i + len)) cards.push(byVal.get(v)[0], byVal.get(v)[1]);
        results.push({ cards, analysis: { type: 'DOUBLE_STRAIGHT', main: r[i], len } });
      }
    }
  } else if (type === 'PLANE' || type === 'PLANE_1' || type === 'PLANE_2') {
    for (const r of findConsecutiveRuns(vals.filter(v => v > main && byVal.get(v).length >= 3), len)) {
      for (let i = 0; i <= r.length - len; i++) {
        const sub = r.slice(i, i + len), core = [];
        for (const v of sub) core.push(...byVal.get(v).slice(0, 3));
        if (type === 'PLANE') results.push({ cards: core, analysis: { type: 'PLANE', main: sub[0], len } });
        else if (type === 'PLANE_1') {
          const pool = [];
          for (const v of vals) if (!sub.includes(v) && byVal.get(v).length < 4) pool.push(...byVal.get(v));
          if (pool.length >= len) results.push({ cards: [...core, ...pool.slice(0, len)], analysis: { type: 'PLANE_1', main: sub[0], len } });
        } else {
          const pairs = [];
          for (const v of vals) if (!sub.includes(v) && byVal.get(v).length >= 2 && byVal.get(v).length < 4) pairs.push(byVal.get(v).slice(0, 2));
          if (pairs.length >= len) results.push({ cards: [...core, ...pairs.slice(0, len).flat()], analysis: { type: 'PLANE_2', main: sub[0], len } });
        }
      }
    }
  }

  if (type === 'BOMB') addBombsAndRocket(main);
  else addBombsAndRocket(0);
  return results;
}

function chooseAiBid(hand, highestBid, diff) {
  let score = 0;
  const byVal = countByVal(hand);
  if (byVal.has(17)) score += 4;
  if (byVal.has(16)) score += 3;
  if (byVal.has(15)) score += byVal.get(15).length * 2;
  for (const [, list] of byVal) if (list.length === 4) score += 4;
  let target = score >= 9 ? 3 : (score >= 6 ? 2 : (score >= 4 ? 1 : 0));
  if (diff === 'easy' && Math.random() < 0.35) target = Math.min(3, target + 1);
  return target > highestBid ? target : 0;
}

function chooseAiPlay(hand, lastPlay, lastPlaySeat, mySeatIdx, landlordIdx, seatCounts, diff) {
  const plays = findBeatingPlays(hand, lastPlay);
  if (plays.length === 0) return null;
  const winPlay = plays.find(p => p.cards.length === hand.length);
  if (winPlay) return winPlay.cards;

  if (!lastPlay) {
    const nonBomb = plays.filter(p => p.analysis.type !== 'BOMB' && p.analysis.type !== 'ROCKET');
    const pool = nonBomb.length > 0 ? nonBomb : plays;
    if (diff === 'easy') return pool[Math.floor(Math.random() * Math.min(4, pool.length))].cards;

    const isLandlord = mySeatIdx === landlordIdx;
    const enemyDanger = [0, 1, 2].some(idx => idx !== mySeatIdx && (isLandlord || idx === landlordIdx) && seatCounts[idx] <= 2);
    if (diff === 'hard' && enemyDanger) {
      const multi = pool.filter(p => p.cards.length >= 2);
      return multi.length > 0 ? multi[0].cards : pool[pool.length - 1].cards;
    }
    const priority = { STRAIGHT: 1, DOUBLE_STRAIGHT: 2, TRIPLE_2: 3, TRIPLE_1: 4, TRIPLE: 5, PAIR: 6, SINGLE: 7 };
    pool.sort((a, b) => ((priority[a.analysis.type] || 8) - (priority[b.analysis.type] || 8)) || (a.analysis.main - b.analysis.main));
    return pool[0].cards;
  }

  const isMyLandlord = mySeatIdx === landlordIdx, isLastLandlord = lastPlaySeat === landlordIdx;
  const isTeammatePlay = !isMyLandlord && !isLastLandlord;
  const nonBomb = plays.filter(p => p.analysis.type !== 'BOMB' && p.analysis.type !== 'ROCKET');
  const bombs = plays.filter(p => p.analysis.type === 'BOMB' || p.analysis.type === 'ROCKET');

  if (diff !== 'easy' && isTeammatePlay && (lastPlay.main >= 13 || ['STRAIGHT', 'DOUBLE_STRAIGHT', 'TRIPLE_1', 'TRIPLE_2', 'BOMB'].includes(lastPlay.type))) {
    return null;
  }
  if (nonBomb.length > 0) {
    if (diff === 'easy') return nonBomb[Math.floor(Math.random() * nonBomb.length)].cards;
    const enemyCritical = [0, 1, 2].some(idx => idx !== mySeatIdx && (isMyLandlord || idx === landlordIdx) && seatCounts[idx] <= 2);
    return (diff === 'hard' && enemyCritical) ? nonBomb[nonBomb.length - 1].cards : nonBomb[0].cards;
  }
  if (bombs.length > 0 && !isTeammatePlay) {
    const enemyDanger = [0, 1, 2].some(idx => idx !== mySeatIdx && (isMyLandlord || idx === landlordIdx) && seatCounts[idx] <= 5);
    if (diff === 'easy' || enemyDanger || hand.length <= 6) return bombs[0].cards;
  }
  return null;
}

module.exports = { createDeck, shuffle, sortCards, analyzeCards, canBeat, findBeatingPlays, chooseAiBid, chooseAiPlay };
