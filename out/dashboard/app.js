// Token Radar's plain dashboard. It reads window.RADAR (written beside dashboard/ by main.ts) and
// renders the ranked board, a filterable table, a per-protocol detail drawer with the model's own
// inputs and the protocol's farm plan. No network: every byte it shows is in data.js.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var STORAGE_KEY = 'token-radar:board-preferences:v1';
  var state = {
    q: '',
    category: 'all',
    tab: 'pre-token',
    sort: 'implied',
    dir: -1,
    selected: null,
    compare: [],
    onlyHighConfidence: false,
    focusedSlug: null,
    restoreFocus: false
  };

  function storage() {
    try {
      return window.localStorage;
    } catch (error) {
      return null;
    }
  }

  function selectorValue(value) {
    if (window.CSS && typeof CSS.escape === 'function') return CSS.escape(value);
    return value.replace(/([^a-zA-Z0-9_.-])/g, '\\$1');
  }

  function isSortKey(key) {
    return ['implied', 'name', 'tvl', 'growth', 'age', 'ratio', 'confidence'].indexOf(key) >= 0;
  }

  function readPreferences() {
    var store = storage();
    if (!store) return;
    var raw;
    try {
      raw = store.getItem(STORAGE_KEY);
    } catch (error) {
      return;
    }
    if (!raw) return;
    try {
      var saved = JSON.parse(raw);
      if (saved && typeof saved === 'object') {
        if (isSortKey(saved.sort)) state.sort = saved.sort;
        if (saved.dir === 1 || saved.dir === -1) state.dir = saved.dir;
        if (typeof saved.onlyHighConfidence === 'boolean') {
          state.onlyHighConfidence = saved.onlyHighConfidence;
        }
      }
    } catch (error) {
      try {
        store.removeItem(STORAGE_KEY);
      } catch (removeError) {
        return;
      }
    }
  }

  function writePreferences() {
    var store = storage();
    if (!store) return;
    try {
      store.setItem(STORAGE_KEY, JSON.stringify({
        sort: state.sort,
        dir: state.dir,
        onlyHighConfidence: state.onlyHighConfidence
      }));
    } catch (error) {
      return;
    }
  }

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  // The model in one function: the page recomputes a row from the snapshot figures and checks the
  // number board.json carries, so the page's code and the board's data are visibly the same arithmetic.
  function impliedOf(row, model) {
    var growth = Math.min(model.growth_cap, Math.max(model.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var growthMult = 1 + (growth / 100) * model.growth_weight;
    var age = row.age_days === null || row.age_days === undefined ? model.unknown_age_days : row.age_days;
    var maturity = model.maturity_floor + (Math.min(Math.max(age, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
    var cat = row.category_multiplier || 1;
    return Math.max(1, Math.round(row.tvl_usd * model.base_multiple * growthMult * maturity * cat));
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  function svg(tag, attrs) {
    var node = document.createElementNS('http://www.w3.org/2000/svg', tag);
    if (attrs) Object.keys(attrs).forEach(function (key) { node.setAttribute(key, attrs[key]); });
    return node;
  }

  function historyOf(row) {
    var candidates = [row.history, row.history_7d, row.tvl_history_7d, row.change_history_7d];
    for (var i = 0; i < candidates.length; i++) {
      if (!Array.isArray(candidates[i])) continue;
      var values = candidates[i].filter(function (value) { return typeof value === 'number' && isFinite(value); });
      if (values.length > 1) return values;
    }
    return null;
  }

  function trendGlyph(row) {
    var history = historyOf(row);
    if (history && history.length > 1) {
      var min = Math.min.apply(Math, history);
      var max = Math.max.apply(Math, history);
      var range = max - min || 1;
      var path = history.map(function (value, index) {
        var x = (index / (history.length - 1)) * 46 + 1;
        var y = 14 - ((value - min) / range) * 12;
        return (index === 0 ? 'M' : 'L') + x.toFixed(1) + ' ' + y.toFixed(1);
      }).join(' ');
      var direction = history[history.length - 1] >= history[0] ? 'pos' : 'neg';
      var glyph = svg('svg', { class: 'trend ' + direction, viewBox: '0 0 48 16', width: '48', height: '16', 'aria-hidden': 'true' });
      glyph.appendChild(svg('path', { d: path, fill: 'none', stroke: 'currentColor', 'stroke-width': '1.6', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
      return glyph;
    }
    var up = row.change_7d === null || row.change_7d === undefined ? null : row.change_7d >= 0;
    var arrow = svg('svg', { class: 'trend ' + (up === null ? '' : up ? 'pos' : 'neg'), viewBox: '0 0 16 16', width: '16', height: '16', 'aria-hidden': 'true' });
    arrow.appendChild(svg('path', {
      d: up === null ? 'M2 8h12M10 4l4 4-4 4' : up ? 'M8 13V3M4 7l4-4 4 4' : 'M8 3v10M4 9l4 4 4-4',
      fill: 'none', stroke: 'currentColor', 'stroke-width': '1.6', 'stroke-linecap': 'round', 'stroke-linejoin': 'round'
    }));
    return arrow;
  }

  function median(values) {
    var list = values.slice().sort(function (a, b) { return a - b; });
    if (!list.length) return null;
    var middle = Math.floor(list.length / 2);
    return list.length % 2 ? list[middle] : (list[middle - 1] + list[middle]) / 2;
  }

  function thesisFor(row) {
    var peers = DATA.rows.filter(function (candidate) { return candidate.category === row.category && candidate.slug !== row.slug; });
    var tvlMedian = median(peers.map(function (peer) { return peer.tvl_usd; }));
    var growthMedian = median(peers.filter(function (peer) { return peer.change_7d !== null && peer.change_7d !== undefined; }).map(function (peer) { return peer.change_7d; }));
    if (row.change_7d !== null && row.change_7d !== undefined && growthMedian !== null && Math.abs(row.change_7d - growthMedian) >= 1) {
      var spread = row.change_7d - growthMedian;
      return (spread > 0 ? 'Fast 7d growth +' + row.change_7d.toFixed(1) + '%' : '7d growth ' + row.change_7d.toFixed(1) + '%') +
        ' (' + (spread > 0 ? '+' : '') + spread.toFixed(1) + '% vs category median)';
    }
    if (tvlMedian !== null && tvlMedian > 0 && Math.abs(row.tvl_usd / tvlMedian) >= 1.5) {
      return 'TVL ' + (row.tvl_usd / tvlMedian).toFixed(1) + 'x category median';
    }
    if (row.category_multiplier && row.category_multiplier !== 1) {
      return (row.category_multiplier > 1 ? 'Sector weight ' : 'Discounted sector weight ') + row.category_multiplier.toFixed(2) + 'x on ' + fmtUsd(row.tvl_usd) + ' TVL';
    }
    if (row.age_days !== null && row.age_days !== undefined) return 'At ' + Math.round(row.age_days) + ' days with no token';
    return 'TVL ' + fmtUsd(row.tvl_usd) + ' with no token';
  }

  function toggleCompare(slug) {
    var at = state.compare.indexOf(slug);
    if (at >= 0) state.compare.splice(at, 1);
    else state.compare = state.compare.concat([slug]).slice(-2);
    render();
  }

  function signedUsd(value) {
    return (value > 0 ? '+' : value < 0 ? '−' : '') + fmtUsd(Math.abs(value));
  }

  function signedNumber(value, suffix, digits) {
    return (value > 0 ? '+' : value < 0 ? '−' : '') + Math.abs(value).toFixed(digits) + suffix;
  }

  function deltaCell(label, left, right, renderValue, deltaSuffix, deltaDigits, leftDot, rightDot) {
    var delta = right - left;
    return el('tr', null,
      el('td', null, label),
      el('td', { class: 'num' }, leftDot, renderValue(left)),
      el('td', { class: 'num' }, rightDot, renderValue(right)),
      el('td', { class: 'num delta' }, renderValue === fmtUsd ? signedUsd(delta) : signedNumber(delta, deltaSuffix || '', deltaDigits || 0))
    );
  }

  function confidenceDot(row) {
    var confidence = typeof row.confidence === 'number' ? row.confidence : 0;
    var tone = confidence >= 70 ? 'green' : confidence >= 40 ? 'amber' : 'red';
    return el('span', {
      class: 'confidence-dot ' + tone,
      title: confidence + ' / 100 confidence',
      'aria-label': confidence + ' / 100 confidence'
    });
  }

  function confidenceOf(row) {
    return typeof row.confidence === 'number' && isFinite(row.confidence) ? row.confidence : 0;
  }

  function confidenceTone(confidence) {
    if (confidence >= 70) return 'green';
    if (confidence >= 40) return 'amber';
    return 'red';
  }

  function confidenceTier(row) {
    var confidence = confidenceOf(row);
    if (confidence >= 70) return 'high';
    if (confidence >= 40) return 'medium';
    return 'low';
  }

  function valueTvlRatio(row) {
    if (!row.tvl_usd || !isFinite(row.tvl_usd) || row.tvl_usd <= 0) return 0;
    if (!isFinite(row.implied_value_usd)) return 0;
    return row.implied_value_usd / row.tvl_usd;
  }

  function confidenceBadge(row) {
    var confidence = confidenceOf(row);
    return el('span', {
      class: 'confidence-badge ' + confidenceTone(confidence),
      text: confidence + '/100'
    });
  }

  function watchlistHealth() {
    var counts = { high: 0, medium: 0, low: 0 };
    DATA.rows.forEach(function (row) {
      counts[confidenceTier(row)] += 1;
    });
    var total = DATA.rows.length || 1;
    var tiers = [
      { key: 'high', label: 'Confidence 70+', count: counts.high },
      { key: 'medium', label: 'Confidence 40–69', count: counts.medium },
      { key: 'low', label: 'Confidence under 40', count: counts.low }
    ];
    return el('section', { class: 'panel health', 'aria-label': 'Watchlist health' },
      el('div', { class: 'health-head' },
        el('div', null,
          el('h2', { text: 'Watchlist health' }),
          el('p', { class: 'sub', text: 'Model confidence across all ' + DATA.rows.length + ' scored protocols.' })
        ),
        el('div', { class: 'health-total', 'aria-hidden': 'true' },
          el('i', { style: 'width:' + Math.round((counts.high / total) * 100) + '%' })
        )
      ),
      el('div', { class: 'health-grid' }, tiers.map(function (tier) {
        var share = Math.round((tier.count / total) * 100);
        return el('div', { class: 'health-item ' + tier.key },
          el('span', { class: 'health-label', text: tier.label }),
          el('b', { class: 'health-count', text: String(tier.count) }),
          el('span', { class: 'health-share', text: share + '% of board' })
        );
      })),
      el('p', { class: 'health-hint sub', text: 'High confidence is 70 or above. Medium scores are 40 through 69; lower scores remain visible but are less reliable.' })
    );
  }

  function confidenceTierLabel(row) {
    var tier = confidenceTier(row);
    if (tier === 'high') return 'high confidence';
    if (tier === 'medium') return 'medium confidence';
    return 'low confidence';
  }

  function pctOf(value) { return fmtPct(value); }
  function daysOf(value) { return fmtAge(value); }
  function multiplierOf(value) { return value.toFixed(2) + 'x'; }

  function comparisonPanel() {
    var selected = state.compare.map(function (slug) {
      return DATA.rows.filter(function (row) { return row.slug === slug; })[0];
    }).filter(Boolean);
    if (selected.length < 2) {
      return el('aside', { class: 'panel compare', 'aria-live': 'polite' },
        el('div', { class: 'compare-empty' }, el('strong', { text: 'Compare two rows' }), el('p', { class: 'sub', text: selected.length === 1 ? selected[0].name + ' selected. Check one more protocol.' : 'Check any two checkboxes to compare their model inputs.' }))
      );
    }
    var left = selected[0];
    var right = selected[1];
    return el('aside', { class: 'panel compare', 'aria-label': 'Protocol comparison' },
      el('div', { class: 'compare-head' },
        el('strong', { text: 'Side-by-side comparison' }),
        el('button', { class: 'button', type: 'button', text: 'Clear', onclick: function () { state.compare = []; render(); } })
      ),
      el('div', { class: 'table-wrap' },
        el('table', { class: 'compare-table' },
          el('thead', null, el('tr', null,
            el('th', { scope: 'col', text: 'Model input' }), el('th', { scope: 'col', text: left.name }),
            el('th', { scope: 'col', text: right.name }), el('th', { scope: 'col', text: 'Delta' })
          )),
          el('tbody', null,
            deltaCell('TVL', left.tvl_usd, right.tvl_usd, fmtUsd),
            deltaCell('7d growth', left.change_7d || 0, right.change_7d || 0, pctOf, '%', 2),
            deltaCell('Age', left.age_days || 0, right.age_days || 0, daysOf, 'd', 0),
            deltaCell('Category multiplier', left.category_multiplier || 1, right.category_multiplier || 1, multiplierOf, 'x', 2),
            deltaCell('Implied value', left.implied_value_usd, right.implied_value_usd, fmtUsd, undefined, 0, confidenceDot(left), confidenceDot(right)),
            deltaCell('Band low', left.band_low_usd, right.band_low_usd, fmtUsd),
            deltaCell('Band high', left.band_high_usd, right.band_high_usd, fmtUsd)
          )
        )
      )
    );
  }

  // The farm plan is the same derivation main.ts writes to board.json: category, chains, TVL and age
  // decide the action, the capital, the hold and every cost and time. No name is special-cased.
  function chainOf(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  function capitalFor(p) {
    if (p.tvl_usd >= 5e9) return 250;
    if (p.tvl_usd >= 1e9) return 150;
    if (p.tvl_usd >= 1e8) return 100;
    return 50;
  }
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 30;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }
  function actionFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ' and keep the position open.';
    if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('leveraged farm') >= 0) return 'Provide $' + capital + ' of liquidity to ' + name + "'s main pool on " + chain + ' and keep the position open.';
    if (c.indexOf('bridge') >= 0) return 'Bridge $' + capital + ' of USDC to ' + chain + ' through ' + name + ' and use the bridged funds in its app.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return "Stake $" + capital + " of the chain's staking asset through " + name + ' and keep the receipt.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0) return 'Deposit $' + capital + ' of USDC as margin on ' + name + ' and open one small hedge.';
    if (c.indexOf('prediction') >= 0) return 'Fund $' + capital + ' and place one market position on ' + name + '.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) return 'Deposit $' + capital + ' into a ' + name + ' vault on ' + chain + ' and keep the shares.';
    if (c.indexOf('stable') >= 0) return 'Mint or deposit $' + capital + ' of the stable asset through ' + name + ' on ' + chain + '.';
    if (c.indexOf('rwa') >= 0) return "Mint $" + capital + " of the protocol's yield asset on " + chain + ' and hold it.';
    if (c.indexOf('insurance') >= 0) return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy.';
    return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open.';
  }
  function stepText(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + " Hold the position and check the protocol's own page.";
    return s;
  }
  function farmSteps(p) {
    var chain = chainOf(p);
    var capital = capitalFor(p);
    var hold = holdDaysFor(p.age_days);
    return [
      { text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', cost: 'under $3 of gas for the first transaction', time: '5 minutes' },
      { text: actionFor(p, capital, chain), cost: '$' + capital + ' of capital and about $' + (capital >= 150 ? 8 : 4) + ' of gas', time: '15 minutes to set up' },
      { text: 'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.', cost: 'about $2 of gas a week', time: '10 minutes a week' },
      { text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: "Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.", cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
      { text: 'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.', cost: 'nothing but the log', time: '5 minutes' }
    ].map(stepText);
  }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('p')) state.selected = params.get('p');
    if (state.selected) state.focusedSlug = state.selected;
    if (params.get('category')) state.category = params.get('category');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function rows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (state.onlyHighConfidence && confidenceOf(r) < 70) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }

  function sortValue(row, key) {
    if (key === 'name') return row.name.toLowerCase();
    if (key === 'tvl') return row.tvl_usd;
    if (key === 'growth') return row.change_7d === null || row.change_7d === undefined ? -Infinity : row.change_7d;
    if (key === 'age') return row.age_days === null || row.age_days === undefined ? Infinity : row.age_days;
    if (key === 'ratio') return valueTvlRatio(row);
    if (key === 'confidence') return confidenceOf(row);
    return row.implied_value_usd;
  }

  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av = sortValue(a, key);
      var bv = sortValue(b, key);
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' }, el('span', { class: 'mark' }), el('span', { class: 'brand-name', text: 'Token Radar' })),
      el('div', { class: 'top-meta' },
        el('span', { text: 'Snapshot ' + DATA.as_of }),
        el('span', { text: 'DefiLlama protocol index' }),
        el('span', { text: DATA.model_version + ' model' })
      )
    );
  }

  function formatRatio(row) {
    var ratio = valueTvlRatio(row);
    return isFinite(ratio) ? ratio.toFixed(2) + 'x' : 'n/a';
  }

  function lede() {
    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', { text: DATA.watchlist_size + ' watchlist protocols, ranked by implied value' }),
        el('p', { text: 'The watchlist is the floor: every protocol with at least $' + Math.round(DATA.floor_usd / 1e6) + 'M of TVL and no token on record. The early radar adds ' + DATA.early_size + ' pre-token protocols below that floor. Implied value is a model, not a promise.' })
      ),
      el('div', { class: 'facts' },
        el('div', { class: 'fact' }, el('span', { text: 'Watchlist covered' }), el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size })),
        el('div', { class: 'fact' }, el('span', { text: 'Pre-token rows scored' }), el('b', { text: String(DATA.board_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Early rows below the floor' }), el('b', { text: String(DATA.early_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Live-token protocols set aside' }), el('b', { text: String(DATA.live_size) }))
      )
    );
  }

  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var select = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) { return el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null }); })
    );
    select.addEventListener('change', function () { state.category = select.value; writeHash(); render(); });
    var highConfidence = el('input', {
      type: 'checkbox',
      id: 'only-high-confidence',
      checked: state.onlyHighConfidence ? 'checked' : null
    });
    highConfidence.addEventListener('change', function () {
      state.onlyHighConfidence = highConfidence.checked;
      state.selected = null;
      writePreferences();
      writeHash();
      render();
    });
    var pre = el('button', { type: 'button', 'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token', onclick: function () { state.tab = 'pre-token'; render(); } });
    var live = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live token', onclick: function () { state.tab = 'live'; render(); } });
    var methodology = el('button', { class: 'button', type: 'button', text: 'Methodology', onclick: openMethodology });
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), select),
      el('div', { class: 'field toggle-field' },
        el('label', { class: 'toggle', for: 'only-high-confidence' }, highConfidence, el('span', { text: 'Only high confidence' }))
      ),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Token status' }), el('div', { class: 'tabs' }, pre, live)),
      methodology,
      el('span', { class: 'count', text: state.tab === 'pre-token' ? rows().length + ' rows shown' : DATA.live.length + ' live-token protocols' })
    );
  }

  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', {
        type: 'button',
        'aria-label': 'Sort by ' + label + (state.sort === key ? (state.dir < 0 ? ', currently descending' : ', currently ascending') : ''),
        onclick: function () {
          if (state.sort === key) state.dir = -state.dir;
          else { state.sort = key; state.dir = key === 'name' ? 1 : -1; }
          state.focusedSlug = null;
          writePreferences();
          render();
        }
      },
        label,
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' v' : ' ^' }) : null
      )
    );
  }

  function compareCell(row) {
    var checked = state.compare.indexOf(row.slug) >= 0;
    var box = el('input', { type: 'checkbox', checked: checked ? 'checked' : null, 'aria-label': 'Compare ' + row.name });
    box.addEventListener('click', function (event) { event.stopPropagation(); });
    box.addEventListener('change', function () { toggleCompare(row.slug); });
    return el('td', { class: 'compare-cell' }, box);
  }

  function visibleRowSlugs() {
    var tbody = app.querySelector('[data-board-table] tbody');
    if (!tbody) return [];
    return Array.prototype.slice.call(tbody.querySelectorAll('tr[data-slug]')).map(function (row) {
      return row.getAttribute('data-slug');
    });
  }

  function focusSelectedRow() {
    if (!state.restoreFocus || !state.focusedSlug) return;
    var row = app.querySelector('tr[data-slug="' + selectorValue(state.focusedSlug) + '"]');
    if (row) row.focus();
    state.restoreFocus = false;
  }

  function moveRowSelection(offset) {
    var slugs = visibleRowSlugs();
    if (!slugs.length) return;
    var current = slugs.indexOf(state.focusedSlug);
    var next = current < 0
      ? (offset > 0 ? 0 : slugs.length - 1)
      : Math.min(slugs.length - 1, Math.max(0, current + offset));
    state.focusedSlug = slugs[next];
    state.restoreFocus = true;
    render();
  }

  function jumpRowSelection(target) {
    var slugs = visibleRowSlugs();
    if (!slugs.length) return;
    state.focusedSlug = target === 'first' ? slugs[0] : slugs[slugs.length - 1];
    state.restoreFocus = true;
    render();
  }

  function isInteractiveTarget(target) {
    return Boolean(target && target.closest && target.closest(
      'input, textarea, select, button, a[href], [contenteditable="true"], [contenteditable=""]'
    ));
  }

  function handleBoardKeyboard(event) {
    if (dialog.open || methodology.open || isInteractiveTarget(event.target)) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
      event.preventDefault();
      moveRowSelection(1);
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
      event.preventDefault();
      moveRowSelection(-1);
    } else if ((event.ctrlKey || event.metaKey) && event.key === 'Home') {
      event.preventDefault();
      jumpRowSelection('first');
    } else if ((event.ctrlKey || event.metaKey) && event.key === 'End') {
      event.preventDefault();
      jumpRowSelection('last');
    }
  }

  function selectionLabel(slugs) {
    if (!state.focusedSlug) return null;
    var row = DATA.rows.filter(function (candidate) { return candidate.slug === state.focusedSlug; })[0];
    if (!row) return null;
    var position = slugs.indexOf(state.focusedSlug) + 1;
    return row.name + ' selected, ' + position + ' of ' + slugs.length + ', ' + confidenceTierLabel(row) + '.';
  }

  function announceBoardStatus() {
    var count = state.tab === 'pre-token' ? rows().length : DATA.live.length;
    var text = state.tab === 'pre-token'
      ? count + ' pre-token rows shown.'
      : count + ' live-token protocols shown.';
    if (state.tab === 'pre-token') {
      var message = selectionLabel(visibleRowSlugs());
      if (message) text += ' ' + message;
    }
    liveStatus.textContent = text;
  }

  function boardTable() {
    var list = sortedRows(rows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category to see the board again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.onlyHighConfidence = false; state.focusedSlug = null; writePreferences(); writeHash(); render(); } })
      ));
    }
    var max = list[0].implied_value_usd || 1;
    var tbody = el('tbody');
    list.forEach(function (r) {
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var tr = el('tr', {
        'data-slug': r.slug,
        'data-selected': state.focusedSlug === r.slug ? 'true' : 'false',
        tabindex: state.focusedSlug === r.slug ? '0' : '-1',
        onclick: function () {
          state.focusedSlug = r.slug;
          openDetail(r.slug);
        },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num', text: String(r.rank) }),
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') })
        )),
        compareCell(r),
        el('td', { class: 'num money', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', { class: 'num', text: formatRatio(r) }),
        el('td', { class: 'num' }, confidenceBadge(r)),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          el('span', { class: 'num money', text: fmtUsd(r.implied_value_usd) }),
          confidenceDot(r)
        )),
        el('td', null, el('div', { class: 'thesis' }, trendGlyph(r), el('span', { text: thesisFor(r) }))),
        el('td', null, el('span', { class: 'status', text: 'no token' }))
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel', 'data-board-table': 'true' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Pre-token protocols. Use the up or down arrow keys to select a row and Enter to open its model and farm plan.' }),
          el('thead', null, el('tr', null,
            el('th', { scope: 'col', 'aria-sort': state.sort === 'implied' ? (state.dir < 0 ? 'descending' : 'ascending') : 'none' },
              el('button', {
                type: 'button',
                'aria-label': 'Sort by rank' + (state.sort === 'implied' ? (state.dir < 0 ? ', currently descending' : ', currently ascending') : ''),
                onclick: function () {
                  if (state.sort === 'implied') state.dir = -state.dir;
                  else { state.sort = 'implied'; state.dir = -1; }
                  state.focusedSlug = null;
                  writePreferences();
                  render();
                }
              }, 'Rank', state.sort === 'implied' ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' v' : ' ^' }) : null)
            ),
            sortHeader('name', 'Protocol'),
            el('th', { scope: 'col', text: 'Compare' }),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'Age'),
            sortHeader('ratio', 'Value/TVL ratio'),
            sortHeader('confidence', 'Confidence'),
            el('th', { scope: 'col', text: 'Thesis' }),
            sortHeader('implied', 'Implied value'),
            el('th', { scope: 'col', text: 'Token' })
          )),
          tbody
        )
      )
    );
  }

  function modelParts(row) {
    var m = DATA.model;
    var growth = Math.min(m.growth_cap, Math.max(m.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var age = row.age_days === null || row.age_days === undefined ? m.unknown_age_days : row.age_days;
    return {
      growth: growth,
      growthMultiplier: 1 + (growth / 100) * m.growth_weight,
      age: age,
      maturity: m.maturity_floor + (Math.min(Math.max(age, 0), m.maturity_days) / m.maturity_days) * m.maturity_range,
      category: row.category_multiplier || 1,
      base: row.tvl_usd * m.base_multiple
    };
  }

  function formulaText() {
    var m = DATA.model;
    return 'implied = max(1, round(tvl_usd × ' + m.base_multiple +
      ' × (1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') ÷ 100 × ' + m.growth_weight +
      ') × (' + m.maturity_floor + ' + min(max(age_days, 0), ' + m.maturity_days + ') ÷ ' + m.maturity_days +
      ' × ' + m.maturity_range + ') × sector(category)))';
  }

  function methodologyDialog() {
    var row = DATA.rows.filter(function (candidate) { return candidate.rank === 1; })[0] || DATA.rows[0];
    var parts = modelParts(row);
    var method = el('dialog', { class: 'methodology', id: 'methodology', 'aria-labelledby': 'methodology-title' });
    method.appendChild(el('div', { class: 'detail-head' },
      el('div', null, el('span', { class: 'brand-name', text: DATA.model_version + ' model' }), el('h2', { id: 'methodology-title', text: 'Methodology' })),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close methodology', text: 'Close', onclick: function () { method.close(); } })
    ));
    method.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Plain-words model' }),
      el('p', { text: 'Start with TVL, because deposits are the raw material a protocol can monetize. Grow that base for current seven-day momentum. Adjust it for how long the protocol has run without a token, then use one sector weight for how strongly that category’s deposits have historically translated into token value.' }),
      el('div', { class: 'formula' }, formulaText()),
      el('p', { class: 'sub', text: 'The result is a point estimate, not a price. It ships with a low and high band so the same inputs never imply false precision.' })
    ));
    method.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Worked example: rank 1' }),
      el('p', { class: 'sub', text: row.name + ' — the same row the board lists first.' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'TVL' }), el('b', { class: 'num money', text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: 'Seven-day growth' }), el('b', { class: 'num', text: fmtPct(row.change_7d) })),
        el('div', null, el('span', { text: 'Age' }), el('b', { class: 'num', text: fmtAge(row.age_days) })),
        el('div', null, el('span', { text: 'Growth multiplier' }), el('b', { class: 'num', text: parts.growthMultiplier.toFixed(4) })),
        el('div', null, el('span', { text: 'Maturity multiplier' }), el('b', { class: 'num', text: parts.maturity.toFixed(4) })),
        el('div', null, el('span', { text: 'Sector multiplier' }), el('b', { class: 'num', text: parts.category.toFixed(2) })),
        el('div', null, el('span', { text: 'Implied value' }), el('b', { class: 'num money', text: fmtUsd(row.implied_value_usd) })),
        el('div', null, el('span', { text: 'Band' }), el('b', { class: 'num money', text: fmtUsd(row.band_low_usd) + ' – ' + fmtUsd(row.band_high_usd) }))
      ),
      el('p', { class: 'sub', text: 'Rank 1 recomputes on the page to ' + fmtUsd(impliedOf(row, DATA.model)) + (impliedOf(row, DATA.model) === row.implied_value_usd ? ', matching board.json.' : ', so the supplied board is stale.') })
    ));
    return method;
  }

  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', { class: 'num', text: 'live' }),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
        el('td', { class: 'num money', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num money', text: fmtUsd(r.mcap_usd) }),
        el('td', null, el('span', { class: 'status', text: 'already trades' }))
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Status' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: '7d' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'Token' }))),
          tbody
        )
      )
    );
  }

  function modelPanel() {
    var m = DATA.model;
    return el('section', { class: 'panel model' },
      el('h2', { text: 'How implied value is computed' }),
      el('p', { class: 'sub', text: 'Every row is scored by one function of the snapshot figures. No protocol name is special-cased, and no row is hand-picked.' }),
      el('div', { class: 'formula' }, formulaText()),
      el('p', { class: 'sub', text: 'sector(category) weighs how strongly a category TVL predicts token value, 0.9 to 1.25 across the snapshot. The implied value ships with a sensitivity band: a low of 0.72x and a high of 1.38x, because a model is a range, not a promise.' }),
      el('p', { class: 'sub', text: 'TVL and seven-day growth come from the snapshot. Age is the time since the protocol was first listed, the best record of how long it has run with no token; an unlisted age uses ' + m.unknown_age_days + ' days. The early radar is every pre-token protocol below the watchlist floor, by TVL, and the live-token protocols are set aside with their market caps shown.' })
    );
  }

  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  var liveStatus = el('p', { class: 'sr-only', id: 'board-status', role: 'status', 'aria-live': 'polite' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); });

  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    var steps = farmSteps(row);
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'brand-name', text: 'Rank ' + row.rank + ' of ' + DATA.board_size }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied value' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'TVL' }), el('b', { class: 'num', text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: 'Seven-day growth' }), el('b', { class: 'num', text: fmtPct(row.change_7d) })),
        el('div', null, el('span', { text: 'Age with no token' }), el('b', { class: 'num', text: fmtAge(row.age_days) })),
        el('div', null, el('span', { text: 'Value/TVL ratio' }), el('b', { class: 'num', text: formatRatio(row) })),
        el('div', null, el('span', { text: 'Growth multiplier' }), el('b', { class: 'num', text: String(row.growth_multiplier) })),
        el('div', null, el('span', { text: 'Maturity multiplier' }), el('b', { class: 'num', text: String(row.maturity_multiplier) })),
        el('div', null, el('span', { text: 'Sector multiplier' }), el('b', { class: 'num', text: String(row.category_multiplier || 1) })),
        el('div', null, el('span', { text: 'Implied value (band)' }), el('b', { class: 'num', text: fmtUsd(row.implied_value_usd) + '  (' + fmtUsd(row.band_low_usd) + ' – ' + fmtUsd(row.band_high_usd) + ')' }), confidenceDot(row)),
        el('div', null, el('span', { text: 'Confidence tier' }), el('b', { class: 'num', text: confidenceOf(row) + '/100 ' + confidenceTierLabel(row) }))
      ),
      el('p', { class: 'sub', text: 'Model ' + DATA.model_version + ': the same function scores every protocol. The page recomputes this row as ' + fmtUsd(impliedOf(row, DATA.model)) + (impliedOf(row, DATA.model) === row.implied_value_usd ? ', the same number board.json carries.' : ', which differs from the board: the data would be stale.') + ' This is an estimate, not a price.' })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan' }),
      el('ol', { class: 'steps' }, steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail }));
      }))
    ));
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  var methodology = methodologyDialog();
  methodology.addEventListener('close', function () { state.methodology = false; });

  function openMethodology() {
    state.methodology = true;
    if (typeof methodology.showModal === 'function') {
      if (!methodology.open) methodology.showModal();
    } else {
      methodology.setAttribute('open', '');
    }
  }

  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(lede());
    if (state.tab === 'pre-token') shell.appendChild(watchlistHealth());
    shell.appendChild(controls());
    if (state.tab === 'pre-token') shell.appendChild(comparisonPanel());
    shell.appendChild(state.tab === 'pre-token' ? boardTable() : liveTable());
    if (state.tab === 'pre-token') shell.appendChild(modelPanel());
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    focusSelectedRow();
    if (!dialog.isConnected) app.appendChild(dialog);
    if (!methodology.isConnected) app.appendChild(methodology);
    if (state.selected) openDetail(state.selected);
  }

  readHash();
  readPreferences();
  render();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      if (dialog.open) dialog.close();
      if (methodology.open) methodology.close();
    }
    handleBoardKeyboard(e);
  });
})();
