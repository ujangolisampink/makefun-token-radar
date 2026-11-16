// Token Radar — the dashboard (model radar-2).
//
// Reads window.RADAR, written beside dashboard/ by main.ts, and renders the whole page:
// hero + KPIs, top-5 spotlight, charts, search/category/chain/TVL filters, a pre-token /
// live-token tab, a sortable board, a per-protocol detail dialog with the model's own
// inputs line by line and a six-step farm plan, and a model sandbox that re-ranks the
// board live from two sliders. No network, no framework: every number on the page is in
// data.js, and the page recomputes each row from the snapshot figures with the same
// function lib/model.ts uses, so the page and board.json visibly agree.
//
// Two things the board shows that a TVL table cannot: a watchlist-only toggle (the
// snapshot's own 40), and a "vs TVL" column — each row's implied rank against the rank
// its TVL alone would give it. A row the model lifts above its TVL rank is exactly what
// the size curve, growth, maturity and breadth are for.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var mount = document.getElementById('board');

  var state = {
    q: '', category: 'all', chain: 'all', tab: 'pre-token',
    sort: 'implied', dir: -1, selected: null,
    watchOnly: false, minTvl: 0, shown: 50,
  };
  var sandbox = {
    active: false,
    growth_weight: DATA.model.growth_weight,
    size_exponent: DATA.model.size_exponent,
  };

  // The watchlist is the floor: the snapshot's own 40 slugs, carried in data.js so the
  // page can tell a watchlist row from an early row wherever it ranks.
  var WATCH = {};
  (DATA.watchlist || []).forEach(function (slug) { WATCH[slug] = true; });
  function onWatch(row) { return !!WATCH[row.slug]; }

  // Rank each row by TVL alone, once: the "vs TVL" column compares against this.
  var TVL_RANK = {};
  DATA.rows.slice().sort(function (a, b) { return b.tvl_usd - a.tvl_usd; })
    .forEach(function (row, i) { TVL_RANK[row.slug] = i + 1; });
  function tvlDelta(row) { return (TVL_RANK[row.slug] || row.rank) - row.rank; }

  /** The row the model lifts furthest above its TVL rank, as "Name (+n)". */
  function topMover() {
    var best = null, bestDelta = 0;
    DATA.rows.forEach(function (row) {
      var d = tvlDelta(row);
      if (d > bestDelta) { bestDelta = d; best = row; }
    });
    return best ? best.name + ' (+' + bestDelta + ')' : 'none';
  }

  var money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return money.format(n);
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

  /** Small DOM builder: el('div', {class, text, onclick...}, ...children). */
  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (key) {
      var value = attrs[key];
      if (key === 'class') node.className = value;
      else if (key === 'text') node.textContent = value;
      else if (key === 'html') node.innerHTML = value;
      else if (key.slice(0, 2) === 'on') node.addEventListener(key.slice(2), value);
      else if (value !== null && value !== undefined) node.setAttribute(key, value);
    });
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  // The model, exactly as lib/model.ts scores it. The sandbox changes growth_weight and
  // size_exponent; this function re-ranks the board live, while board.json keeps radar-2.
  function impliedOf(row, model) {
    var base = Math.min(model.base_cap, Math.max(model.base_floor,
      model.base_multiple * Math.pow(1e9 / Math.max(1, row.tvl_usd), model.size_exponent)));
    var growth = Math.min(model.growth_cap, Math.max(model.growth_floor,
      row.change_7d === null ? 0 : row.change_7d));
    var growthMult = 1 + (growth / 100) * model.growth_weight;
    var age = row.age_days === null ? model.unknown_age_days : row.age_days;
    var maturityMult = model.maturity_floor +
      (Math.min(Math.max(age, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
    var breadthMult = Math.min(model.breadth_cap,
      1 + model.breadth_per_chain * Math.max(0, (row.chains || []).length - 1));
    return {
      implied: Math.max(1, Math.round(row.tvl_usd * base * growthMult * maturityMult * breadthMult)),
      base: base, growthMult: growthMult, maturityMult: maturityMult,
      breadthMult: breadthMult, growthPct: growth,
    };
  }

  /** The board as the page shows it: base rows, or sandbox re-ranks when a slider moved. */
  function visibleRows() {
    if (!sandbox.active) return DATA.rows;
    var model = Object.assign({}, DATA.model, {
      growth_weight: sandbox.growth_weight, size_exponent: sandbox.size_exponent,
    });
    return DATA.rows.map(function (row) {
      var v = impliedOf(row, model);
      var copy = Object.assign({}, row);
      copy.implied_value_usd = v.implied;
      copy.base_multiple = Math.round(v.base * 1e4) / 1e4;
      copy.growth_multiplier = Math.round(v.growthMult * 1e4) / 1e4;
      copy.maturity_multiplier = Math.round(v.maturityMult * 1e4) / 1e4;
      copy.breadth_multiplier = Math.round(v.breadthMult * 1e4) / 1e4;
      return copy;
    }).sort(function (a, b) { return b.implied_value_usd - a.implied_value_usd; })
      .map(function (row, i) { var copy = Object.assign({}, row); copy.rank = i + 1; return copy; });
  }

  function chainOf(p) { return p.chains && p.chains.length ? p.chains[0] : 'its main chain'; }
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
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ' and keep the position open; borrow a small amount against it once so the borrow side is recorded too.';
    if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('aggregator') >= 0) return 'Provide $' + capital + ' of liquidity to ' + name + "'s main pool on " + chain + ' and keep the position open; route one swap through the pool each week.';
    if (c.indexOf('staking') >= 0 || c.indexOf('pooling') >= 0) return "Stake $" + capital + " of the chain's staking asset through " + name + ' and keep the receipt token in the same wallet.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0 || c.indexOf('basis') >= 0) return 'Deposit $' + capital + ' of USDC as margin on ' + name + ' and open one small hedged position, then close it after a day.';
    if (c.indexOf('prediction') >= 0) return 'Fund $' + capital + ' on ' + name + ' and place one small position in a market that settles within the month.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0 || c.indexOf('capital') >= 0) return 'Deposit $' + capital + ' into a ' + name + ' vault on ' + chain + ' and keep the vault shares; do not split them across wallets.';
    if (c.indexOf('stable') >= 0) return 'Mint or deposit $' + capital + ' of the stable asset through ' + name + ' on ' + chain + ' and hold it in the farming wallet.';
    if (c.indexOf('rwa') >= 0) return "Mint $" + capital + " of " + name + "'s yield-bearing asset on " + chain + ' and hold it; the balance itself is the farming signal.';
    if (c.indexOf('insurance') >= 0) return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy active for the full hold period.';
    if (c.indexOf('payment') >= 0) return 'Move $' + capital + ' through ' + name + ' on ' + chain + ' for a real payment, then keep a balance in its app.';
    if (c.indexOf('chain') >= 0) return 'Bridge $' + capital + ' of USDC to ' + name + "'s chain and use one of its native apps each week.";
    if (c.indexOf('governance') >= 0) return 'Deposit $' + capital + " into " + name + "'s incentive pool on " + chain + ' and vote once when a proposal opens.';
    return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open.';
  }
  function weeklyFor(p) {
    var c = (p.category || '').toLowerCase();
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Make one qualifying action each week: a small deposit, a borrow and repay, or a collateral top-up.';
    if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('aggregator') >= 0) return 'Make one qualifying action each week: a swap through the pool, a liquidity add, or a claim of accrued yield.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0 || c.indexOf('capital') >= 0) return 'Make one qualifying action each week: check the vault, deposit a little more, or vote on a curator proposal.';
    if (c.indexOf('rwa') >= 0) return 'Make one qualifying action each week: hold the yield asset, check its accrual, and mint a little more if the yield compounds.';
    if (c.indexOf('prediction') >= 0) return 'Make one qualifying action each week: place one small position in a fresh market.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0 || c.indexOf('basis') >= 0) return 'Make one qualifying action each week: one small hedged trade, opened and closed within the day.';
    if (c.indexOf('staking') >= 0 || c.indexOf('pooling') >= 0) return 'Make one qualifying action each week: restake the rewards or top up the stake by a small amount.';
    return 'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.';
  }
  function stepText(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    return s;
  }
  /** Six farm steps for a row, each an action with what it costs and how long it takes. */
  function farmSteps(p) {
    var chain = chainOf(p);
    var capital = capitalFor(p);
    var hold = holdDaysFor(p.age_days);
    return [
      { text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', cost: 'under $3 of gas for the first transaction', time: '5 minutes' },
      { text: actionFor(p, capital, chain), cost: '$' + capital + ' of capital and about $' + (capital >= 150 ? 8 : 4) + ' of gas', time: '15 minutes to set up' },
      { text: weeklyFor(p), cost: 'about $2 of gas a week', time: '10 minutes a week' },
      { text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: "Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.", cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
      { text: 'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.', cost: 'nothing but the log', time: '5 minutes' },
    ].map(stepText);
  }

  /** Deep-link state: ?q, category, chain and the open protocol live in the hash. */
  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('p')) state.selected = params.get('p');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('watch') === '1') state.watchOnly = true;
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.watchOnly) params.set('watch', '1');
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  /** Rows after search, category, chain, TVL and watchlist filters. */
  function filteredRows() {
    var q = state.q.trim().toLowerCase();
    return visibleRows().filter(function (row) {
      if (state.watchOnly && !onWatch(row)) return false;
      if (state.category !== 'all' && row.category !== state.category) return false;
      if (state.chain !== 'all' && (row.chains || []).indexOf(state.chain) < 0) return false;
      if (state.minTvl && row.tvl_usd < state.minTvl) return false;
      if (!q) return true;
      return [row.name, row.slug, row.category, (row.chains || []).join(' ')].join(' ').toLowerCase().indexOf(q) >= 0;
    });
  }

  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'delta') { av = tvlDelta(a); bv = tvlDelta(b); }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }
  function totalImplied(list) {
    return list.reduce(function (sum, row) { return sum + row.implied_value_usd; }, 0);
  }

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' },
        el('span', { class: 'mark' }),
        el('div', null,
          el('b', { text: 'Token Radar' }),
          el('span', { text: ' · pre-token protocols, ranked by implied value' }))),
      el('div', { class: 'top-meta' },
        el('span', { class: 'pill', html: 'Snapshot <b>' + DATA.as_of + '</b>' }),
        el('span', { class: 'pill', html: 'Source: <b>DefiLlama</b>' }),
        el('span', { class: 'pill', html: 'Model <b>' + DATA.model_version + '</b>' })));
  }

  function hero() {
    var top = DATA.rows[0];
    return el('section', { class: 'hero' },
      el('div', null,
        el('h1', { text: 'Which pre-token protocol is worth farming next?' }),
        el('p', { html: 'The watchlist is the floor: every protocol with at least <b>$' + Math.round(DATA.floor_usd / 1e6) + 'M of TVL and no token on record</b>. The early radar adds <b>' + DATA.early_size + ' more pre-token protocols</b> below that floor — the launches the floor would miss. Implied value is a model of TVL, seven-day growth, age with no token and chain breadth. It is an estimate, <b>not a price and not a promise</b> that a token ever launches.' }),
        el('p', { html: 'Top of the board: <b>' + top.name + '</b> at <b>' + fmtUsd(top.implied_value_usd) + '</b> implied, on ' + fmtUsd(top.tvl_usd) + ' of TVL.' })),
      el('div', { class: 'kpis' },
        el('div', { class: 'kpi' }, el('span', { text: 'Watchlist covered' }), el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size }), el('small', { text: 'every watchlist protocol is ranked' })),
        el('div', { class: 'kpi' }, el('span', { text: 'Pre-token rows scored' }), el('b', { text: String(DATA.board_size) }), el('small', { text: DATA.early_size + ' early rows below the floor' })),
        el('div', { class: 'kpi' }, el('span', { text: 'Total implied value' }), el('b', { text: fmtUsd(totalImplied(DATA.rows)) }), el('small', { text: 'sum of all ranked rows' })),
        el('div', { class: 'kpi' }, el('span', { text: 'Live-token set aside' }), el('b', { text: String(DATA.live_size) }), el('small', { text: 'already trading — shown by market cap, never ranked' }))));
  }

  function spotlight() {
    return el('section', { class: 'spot', 'aria-label': 'Top five protocols' },
      DATA.rows.slice(0, 5).map(function (row, i) {
        return el('button', {
          type: 'button', class: 'card' + (i === 0 ? ' first' : ''),
          onclick: function () { openDetail(row.slug); },
        },
        el('span', { class: 'rk', text: '#' + row.rank }),
        el('b', { text: row.name }),
        el('span', { class: 'v', text: fmtUsd(row.implied_value_usd) }),
        el('span', { class: 's', text: 'TVL ' + fmtUsd(row.tvl_usd) + ' · ' + fmtPct(row.change_7d) + ' 7d · ' + (row.category || 'Other') }));
      }));
  }

  function barChart(title, sub, items, fmt, sqrt) {
    var max = 0;
    items.forEach(function (it) { if (it.v > max) max = it.v; });
    return el('section', { class: 'panel pad' },
      el('h2', { text: title }),
      el('p', { class: 'sub', text: sub }),
      items.map(function (it) {
        var w = sqrt ? Math.sqrt(it.v / max) : it.v / max;
        return el('div', { class: 'bar-row' },
          el('span', { class: 'lbl', text: it.label }),
          el('div', { class: 'bar-track' }, el('i', { style: 'width:' + Math.max(2, Math.round(w * 100)) + '%' })),
          el('span', { class: 'n', text: fmt(it.v) }));
      }));
  }

  function charts() {
    var top10 = DATA.rows.slice(0, 10).map(function (row) { return { label: row.name, v: row.implied_value_usd }; });
    var byCat = {};
    DATA.rows.forEach(function (row) { var c = row.category || 'Other'; byCat[c] = (byCat[c] || 0) + 1; });
    var catItems = Object.keys(byCat).map(function (k) { return { label: k, v: byCat[k] }; })
      .sort(function (a, b) { return b.v - a.v; }).slice(0, 8);
    return el('div', { class: 'charts' },
      barChart('Top 10 by implied value', "The board's head: where the launch value concentrates. Bars are square-root scaled so the tail is visible.", top10, fmtUsd, true),
      barChart('Board by category', 'How many ranked protocols each category holds.', catItems, function (n) { return String(n); }, false));
  }

  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var chains = Array.from(new Set(DATA.rows.reduce(function (acc, r) { return acc.concat(r.chains || []); }, []))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; state.shown = 50; writeHash(); render(); });
    var cat = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) { return el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null }); }));
    cat.addEventListener('change', function () { state.category = cat.value; state.shown = 50; writeHash(); render(); });
    var chain = el('select', { id: 'chain', 'aria-label': 'Filter by chain' },
      el('option', { value: 'all', text: 'All chains' }),
      chains.map(function (c) { return el('option', { value: c, text: c, selected: c === state.chain ? 'selected' : null }); }));
    chain.addEventListener('change', function () { state.chain = chain.value; state.shown = 50; writeHash(); render(); });
    var tvl = el('select', { id: 'mintvl', 'aria-label': 'Minimum TVL' },
      el('option', { value: '0', text: 'Any TVL' }),
      el('option', { value: '50000000', text: 'TVL $50M+', selected: state.minTvl === 50000000 ? 'selected' : null }),
      el('option', { value: '100000000', text: 'TVL $100M+', selected: state.minTvl === 100000000 ? 'selected' : null }),
      el('option', { value: '500000000', text: 'TVL $500M+', selected: state.minTvl === 500000000 ? 'selected' : null }));
    tvl.addEventListener('change', function () { state.minTvl = Number(tvl.value); state.shown = 50; render(); });
    var watchBox = el('input', { type: 'checkbox', id: 'watchonly', checked: state.watchOnly ? 'checked' : null });
    watchBox.addEventListener('change', function () { state.watchOnly = watchBox.checked; state.shown = 50; writeHash(); render(); });
    var pre = el('button', { type: 'button', 'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token', onclick: function () { state.tab = 'pre-token'; render(); } });
    var live = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live token', onclick: function () { state.tab = 'live'; render(); } });
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), cat),
      el('div', { class: 'field' }, el('label', { for: 'chain', text: 'Chain' }), chain),
      el('div', { class: 'field' }, el('label', { for: 'mintvl', text: 'Min TVL' }), tvl),
      el('label', { class: 'check', for: 'watchonly' }, watchBox, ' Watchlist only'),
      el('div', { class: 'field' }, el('span', { text: 'Token status' }), el('div', { class: 'tabs' }, pre, live)),
      el('span', { class: 'count', text: state.tab === 'pre-token' ? filteredRows().length + ' rows match' : DATA.live.length + ' live-token protocols' }));
  }

  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', {
        type: 'button',
        onclick: function () {
          if (state.sort === key) state.dir = -state.dir;
          else { state.sort = key; state.dir = -1; }
          render();
        },
      },
      label, state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' ↓' : ' ↑' }) : null));
  }

  /** One board row: rank, protocol, TVL, 7d, age, implied value, vs-TVL move, token badge. */
  function boardRow(row, maxImplied) {
    var delta = tvlDelta(row);
    var growth = row.change_7d === null ? 'n/a' : fmtPct(row.change_7d);
    var growthClass = row.change_7d === null ? '' : row.change_7d >= 0 ? 'pos' : 'neg';
    var deltaText = delta > 0 ? '+' + delta : delta < 0 ? String(delta) : '±0';
    var deltaClass = delta > 0 ? 'pos' : delta < 0 ? 'neg' : '';
    return el('tr', {
      'data-selected': state.selected === row.slug ? 'true' : 'false', tabindex: '0',
      onclick: function () { openDetail(row.slug); },
      onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(row.slug); } },
    },
    el('td', { class: 'num', text: String(row.rank) }),
    el('td', null, el('div', { class: 'name' },
      el('b', { text: row.name }),
      el('span', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.slice(0, 2).join(', ') : 'an unnamed chain') + (row.chains && row.chains.length > 2 ? ' +' + (row.chains.length - 2) : '') }))),
    el('td', { class: 'num', text: fmtUsd(row.tvl_usd) }),
    el('td', { class: 'num ' + growthClass, text: growth }),
    el('td', { class: 'num', text: fmtAge(row.age_days) }),
    el('td', null, el('div', { class: 'implied' },
      el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round(Math.sqrt(row.implied_value_usd / maxImplied) * 100)) + '%' })),
      el('span', { class: 'num', text: fmtUsd(row.implied_value_usd) }))),
    el('td', { class: 'num ' + deltaClass, title: 'TVL rank #' + (TVL_RANK[row.slug] || '?') + ' vs implied rank #' + row.rank, text: deltaText }),
    el('td', null, el('span', { class: 'badge ' + (onWatch(row) ? 'watch' : 'early'), text: onWatch(row) ? 'watchlist · no token' : 'early · no token' })));
  }

  function boardTable() {
    var list = sortedRows(filteredRows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category or chain to see the board again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; state.minTvl = 0; state.watchOnly = false; writeHash(); render(); } })));
    }
    var shown = list.slice(0, state.shown);
    var maxImplied = shown.length ? shown[0].implied_value_usd : 1;
    var tbody = el('tbody');
    shown.forEach(function (row) { tbody.appendChild(boardRow(row, maxImplied)); });
    var wrap = el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Pre-token protocols, strongest implied value first. Bars are square-root scaled. "vs TVL" is the rank move against a plain TVL ranking — click it to sort by the move. Select a row for its model breakdown and farm plan.' }),
          el('thead', null, el('tr', null,
            sortHeader('implied', 'Rank'), sortHeader('name', 'Protocol'), sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'), sortHeader('age', 'Age'), sortHeader('implied', 'Implied value'),
            sortHeader('delta', 'vs TVL'), el('th', { scope: 'col', text: 'Token' }))),
          tbody)));
    if (list.length > state.shown) {
      wrap.appendChild(el('div', { class: 'more' },
        el('button', { class: 'button', type: 'button', text: 'Show 50 more (' + (list.length - state.shown) + ' left)', onclick: function () { state.shown += 50; render(); } })));
    }
    return wrap;
  }

  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (row) {
      tbody.appendChild(el('tr', null,
        el('td', { class: 'num', text: 'live' }),
        el('td', null, el('div', { class: 'name' },
          el('b', { text: row.name }),
          el('span', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
        el('td', { class: 'num', text: fmtUsd(row.tvl_usd) }),
        el('td', { class: 'num ' + (row.change_7d !== null && row.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(row.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(row.mcap_usd) }),
        el('td', null, el('span', { class: 'badge live', text: 'already trades' }))));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking.' }),
          el('thead', null, el('tr', null,
            el('th', { scope: 'col', text: 'Status' }), el('th', { scope: 'col', text: 'Protocol' }),
            el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: '7d' }),
            el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'Token' }))),
          tbody)));
  }

  function modelPanel() {
    var m = DATA.model;
    var gw = el('input', { type: 'range', min: '0', max: '1.5', step: '0.1', value: String(sandbox.growth_weight), 'aria-label': 'Growth weight' });
    var gwOut = el('output', { text: sandbox.growth_weight.toFixed(1) });
    gw.addEventListener('input', function () { gwOut.textContent = Number(gw.value).toFixed(1); });
    gw.addEventListener('change', function () { sandbox.growth_weight = Number(gw.value); sandbox.active = true; state.shown = 50; render(); });
    var se = el('input', { type: 'range', min: '0', max: '0.2', step: '0.02', value: String(sandbox.size_exponent), 'aria-label': 'Size exponent' });
    var seOut = el('output', { text: sandbox.size_exponent.toFixed(2) });
    se.addEventListener('input', function () { seOut.textContent = Number(se.value).toFixed(2); });
    se.addEventListener('change', function () { sandbox.size_exponent = Number(se.value); sandbox.active = true; state.shown = 50; render(); });
    var reset = el('button', { class: 'button', type: 'button', text: 'Reset to radar-2', onclick: function () { sandbox.active = false; sandbox.growth_weight = DATA.model.growth_weight; sandbox.size_exponent = DATA.model.size_exponent; render(); } });
    // Where the model disagrees with size alone: rows it lifts above their TVL rank,
    // and rows it drops below it. A board that never moved a row would be a TVL table.
    var lifted = 0, dropped = 0;
    DATA.rows.forEach(function (row) { var d = tvlDelta(row); if (d > 0) lifted++; else if (d < 0) dropped++; });
    return el('section', { class: 'panel model' },
      el('h2', { text: 'How implied value is computed' }),
      el('p', { class: 'sub', text: 'Every row is scored by one function of the snapshot figures. No protocol name is special-cased, and no row is hand-picked. Wrapped, staked and bridged products of tokens that already trade are excluded from the ranking entirely — they are not launches waiting to happen.' }),
      el('p', { class: 'sub', html: 'On this board the model lifts <b>' + lifted + ' of ' + DATA.board_size + ' protocols</b> above their TVL rank and drops <b>' + dropped + '</b> below it. The biggest lift is <b>' + topMover() + '</b> — a small protocol the model values on growth and age, not on size.' }),
      el('h2', { text: 'How implied value is computed' }),
      el('p', { class: 'sub', text: 'Every row is scored by one function of the snapshot figures. No protocol name is special-cased, and no row is hand-picked. Wrapped, staked and bridged products of tokens that already trade are excluded from the ranking entirely — they are not launches waiting to happen.' }),
      el('div', { class: 'formula' },
        'implied = round( tvl_usd × clamp(0.25 × (1e9 / tvl_usd)^' + m.size_exponent + ', 0.18, 0.40) × (1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 × ' + m.growth_weight + ') × (0.55 + min(age_days, ' + m.maturity_days + ') / ' + m.maturity_days + ' × 0.75) × min(1 + 0.02 × (chains − 1), 1.10) )'),
      el('p', { class: 'sub', text: 'TVL and seven-day growth come from the snapshot. Age is the time since the protocol was first listed, the best record of how long it has run with no token; an unlisted age uses ' + m.unknown_age_days + ' days. Chain breadth counts how many chains the protocol runs on. The early radar is every other genuine pre-token protocol in the snapshot, whatever its TVL, and the live-token protocols are set aside with their market caps shown.' }),
      el('div', { class: 'sandbox' },
        el('div', { class: 'field' }, el('label', { text: 'Sandbox: growth weight' }), gw, gwOut),
        el('div', { class: 'field' }, el('label', { text: 'Sandbox: size exponent' }), se, seOut),
        reset,
        sandbox.active
          ? el('span', { class: 'note', text: 'Sandbox active — the board above is re-ranked with your weights. board.json keeps the radar-2 model.' })
          : el('span', { class: 'sub', text: 'Move a slider to re-rank the board live and see what the model is sensitive to.' })));
  }

  function methodPanel() {
    return el('div', { class: 'grid2' },
      el('section', { class: 'panel pad' },
        el('h2', { text: 'How to read this board' }),
        el('p', { class: 'sub', text: 'Rank 1 is the protocol whose launch would be worth the most if its record stayed as it is. A high rank is not a prediction that a token launches, or when — it is a claim about value, built from size, momentum, age and breadth. The "vs TVL" column shows where the model disagrees with size alone: a protocol lifted above its TVL rank earned it on growth or age, not on being big. Farm the top of the board first, but spread the capital: no single protocol is a sure thing.' })),
      el('section', { class: 'panel pad' },
        el('h2', { text: 'What the snapshot does — and does not — say' }),
        el('p', { class: 'sub', text: 'The snapshot is DefiLlama\'s protocol index as fetched on ' + DATA.as_of + ' (' + DATA.source + '). It records no token for the ranked protocols; that is a record, never proof one does not exist. It carries no ranking, no implied value, no farm plan and no airdrop flag — deriving them is this radar\'s work. The dashboard renders with no network: every number on it is in data.js.' })));
  }

  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); });

  function flagsFor(row) {
    var flags = [];
    if (row.change_7d !== null && row.change_7d <= -10) flags.push({ t: 'TVL down ' + fmtPct(row.change_7d) + ' in 7 days', ok: false });
    if (row.change_7d !== null && row.change_7d >= 10) flags.push({ t: 'Growing fast: ' + fmtPct(row.change_7d) + ' in 7 days', ok: true });
    if ((row.chains || []).length === 1) flags.push({ t: 'Single chain: ' + (row.chains[0] || 'one chain'), ok: false });
    if ((row.chains || []).length >= 5) flags.push({ t: 'Broad: ' + row.chains.length + ' chains', ok: true });
    if (row.age_days !== null && row.age_days < 90) flags.push({ t: 'Young: listed ' + fmtAge(row.age_days) + ' ago', ok: false });
    if (row.age_days !== null && row.age_days >= 730) flags.push({ t: 'Long-lived with no token: ' + fmtAge(row.age_days), ok: true });
    if (row.tvl_usd >= 1e9) flags.push({ t: 'Large: ' + fmtUsd(row.tvl_usd) + ' TVL', ok: true });
    return flags;
  }

  function openDetail(slug) {
    var row = visibleRows().filter(function (r) { return r.slug === slug; })[0];
    if (!row) row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    var steps = farmSteps(row);
    var recomputed = impliedOf(row, DATA.model);
    var delta = tvlDelta(row);
    var peers = DATA.rows.filter(function (r) { return r.category === row.category && r.slug !== row.slug; }).slice(0, 3);
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'brand-name', text: 'Rank ' + row.rank + ' of ' + DATA.board_size + ' · ' + (onWatch(row) ? 'watchlist' : 'early radar') }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') + ' · first listed ' + (row.listed_at || 'unknown') })),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied value — the model, line by line' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'TVL' }), el('b', { class: 'num', text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: 'Base multiple (size curve)' }), el('b', { class: 'num', text: String(row.base_multiple) })),
        el('div', null, el('span', { text: 'Seven-day growth' }), el('b', { class: 'num', text: fmtPct(row.change_7d) })),
        el('div', null, el('span', { text: 'Growth multiplier' }), el('b', { class: 'num', text: String(row.growth_multiplier) })),
        el('div', null, el('span', { text: 'Age with no token' }), el('b', { class: 'num', text: fmtAge(row.age_days) })),
        el('div', null, el('span', { text: 'Maturity multiplier' }), el('b', { class: 'num', text: String(row.maturity_multiplier) })),
        el('div', null, el('span', { text: 'Chain breadth (' + (row.chains || []).length + ' chains)' }), el('b', { class: 'num', text: String(row.breadth_multiplier) })),
        el('div', null, el('span', { text: 'TVL rank alone' }), el('b', { class: 'num', text: '#' + (TVL_RANK[row.slug] || '?') + ' (' + (delta > 0 ? '+' + delta : delta < 0 ? String(delta) : '±0') + ' vs implied)' })),
        el('div', null, el('span', { text: 'Implied value' }), el('b', { class: 'num', text: fmtUsd(row.implied_value_usd) }))),
      el('p', { class: 'sub', text: 'Model ' + DATA.model_version + ': the same function scores every protocol. The page recomputes this row as ' + fmtUsd(recomputed.implied) + (recomputed.implied === row.implied_value_usd ? ', the same number board.json carries.' : ' — the sandbox is active, so this differs from board.json.') + ' This is an estimate, not a price.' }),
      el('div', { class: 'flags' }, flagsFor(row).map(function (f) { return el('span', { class: 'flag' + (f.ok ? ' ok' : ''), text: f.t }); }))));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan — six steps' }),
      el('ol', { class: 'steps' }, steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail }));
      }))));
    if (peers.length) {
      dialog.appendChild(el('section', { class: 'detail-section' },
        el('h3', { text: 'Also in ' + (row.category || 'this category') }),
        el('div', { class: 'comp' }, peers.map(function (r) {
          return el('button', { type: 'button', onclick: function () { openDetail(r.slug); } },
            el('span', { text: '#' + r.rank + ' ' + r.name }),
            el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) }));
        }))));
    }
    if (typeof dialog.showModal === 'function') { if (!dialog.open) dialog.showModal(); }
    else dialog.setAttribute('open', '');
  }

  function footer() {
    return el('footer', null,
      el('p', { html: '<b>Method.</b> Snapshot: DefiLlama protocol index, ' + DATA.source + '. Board: ' + DATA.board_size + ' pre-token protocols ranked by model ' + DATA.model_version + ' (TVL × size curve × growth × maturity × chain breadth). Farm plans are derived from each protocol\'s category, chains, TVL and age — no protocol is hand-picked.' }),
      el('p', { html: '<b>Honest limits.</b> “No token” means the snapshot records none; it is not proof none exists. Implied value is the entry\'s own claim, never a price, and no step here can make a protocol issue a token. Never pay to claim an airdrop, and never connect a wallet from a link you did not open yourself.' }));
  }

  function render() {
    mount.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(hero());
    shell.appendChild(spotlight());
    shell.appendChild(charts());
    shell.appendChild(controls());
    shell.appendChild(state.tab === 'pre-token' ? boardTable() : liveTable());
    if (state.tab === 'pre-token') { shell.appendChild(modelPanel()); shell.appendChild(methodPanel()); }
    shell.appendChild(footer());
    mount.appendChild(shell);
    mount.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) mount.appendChild(dialog);
    if (state.selected) openDetail(state.selected);
  }

  readHash();
  render();
  window.addEventListener('hashchange', function () { state.selected = null; readHash(); render(); });
  window.addEventListener('keydown', function (e) { if (e.key === 'Escape' && dialog.open) dialog.close(); });
})();
